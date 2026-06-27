"""
DocuMind AI — engine module.

Implements four discrete AI workflows:

  1. requirement_gathering()   – conversational interview that asks one
                                 question at a time and tracks completeness.
  2. completeness_check()      – static scoring against a target doc-type.
  3. generate_document()       – doc-type-specific generation prompt.
  4. review_document()         – analyses uploaded documents.
  5. improve_section()         – rewrites/extends a single section.

Every workflow uses its own system prompt so we never have a one-size-fits-all
generic prompt across document types.
"""
from __future__ import annotations

import json
import re
from typing import Dict, Any, List, Optional

import llm_client


# ---------------- low-level helpers ----------------
def _extract_json(raw: str) -> Dict[str, Any]:
    t = raw.strip()
    if t.startswith("```"):
        t = re.sub(r"^```(?:json)?\s*", "", t)
        t = re.sub(r"\s*```\s*$", "", t)
    # strict=False tolerates literal newlines/tabs inside string values, which
    # some models (e.g. Llama via Groq) emit when returning markdown content.
    try:
        return json.loads(t, strict=False)
    except json.JSONDecodeError:
        s, e = t.find("{"), t.rfind("}")
        if s != -1 and e != -1 and e > s:
            return json.loads(t[s:e + 1], strict=False)
        raise


# Models (esp. Llama) sometimes emit Mermaid diagrams inline inside a sentence,
# collapsed onto one line, and/or with Unicode arrows (⟶ → ⇒) instead of the
# ASCII `-->` Mermaid requires. The frontend only renders a ```mermaid fence that
# sits on its own line with valid syntax, so those malformed blocks show as raw
# text. We repair them here so the viewer, PDF and DOCX exports all get clean
# Mermaid. Run on every generated section before it is stored.
_MERMAID_ARROWS = {
    "⟶": "-->", "→": "-->", "➝": "-->", "➞": "-->", "➜": "-->",
    "⇒": "-->", "⟹": "-->", "↦": "-->", "⟼": "-->", "—>": "-->", "–>": "-->",
}
_MERMAID_RE = re.compile(r"```\s*mermaid\b(.*?)```", re.DOTALL | re.IGNORECASE)


def _normalize_mermaid_body(body: str) -> str:
    b = body.strip()
    for uni, ascii_arrow in _MERMAID_ARROWS.items():
        b = b.replace(uni, ascii_arrow)
    if "\n" in b:
        return b  # already multi-line — trust the model's formatting
    # Single-line flowchart/graph: break the declaration and each statement onto
    # its own line so Mermaid can parse it.
    m = re.match(r"^(flowchart|graph)\s+(TB|TD|BT|RL|LR)\b\s*", b, re.IGNORECASE)
    if not m:
        return b  # other diagram types: leave as-is rather than risk corrupting
    decl, rest = b[:m.end()].strip(), b[m.end():]
    # A new statement begins where a node's closing shape (] } )) is followed by
    # an identifier that starts the next edge.
    rest = re.sub(
        r"([\]\}\)])\s+(?=[A-Za-z0-9_]+\s*(?:\[|\{|\(|-->|---|--x|==>|\|))",
        r"\1\n", rest,
    )
    return decl + "\n" + rest.strip()


def _normalize_mermaid(content: str) -> str:
    if not content or "```" not in content:
        return content
    out = _MERMAID_RE.sub(
        lambda mt: "\n\n```mermaid\n" + _normalize_mermaid_body(mt.group(1)) + "\n```\n\n",
        content,
    )
    return re.sub(r"\n{3,}", "\n\n", out).strip()


async def _call(system: str, user: str, session_id: Optional[str] = None) -> str:
    # session_id kept for signature compatibility; the stateless provider layer
    # does not need it (each workflow sends the full context it requires).
    return await llm_client.send_message(system, user)


def _pretty_inputs(inputs: Dict[str, Any]) -> str:
    if not inputs:
        return "(no inputs collected yet)"
    return "\n".join(f"- **{k}**: {v if v else '(empty)'}" for k, v in inputs.items())


# =========================================================
# 1. REQUIREMENT GATHERING ENGINE  (conversational interview)
# =========================================================
REQ_GATHER_SYSTEM = """You are DocuMind AI's Requirement Gathering Engine — a senior business analyst who runs intelligent intake interviews.

Your job for the current conversation:
- Drive a *short, focused* interview to collect everything needed to produce a high-quality {doc_label} for the {industry} industry.
- Ask ONE focused, intelligent question at a time. Never dump a list.
- Use the user's previous answers to make smart follow-ups — drill into thin or vague answers.
- Use industry terminology appropriate to: {industry}.
- The target sections of the final document are: {sections}.
- Required fields you must collect (and any reasonable extras you discover are missing):
{required_fields}

RESPOND WITH ONLY VALID JSON in this schema, nothing else:

{{
  "next_question": "string — the next question to ask the user, or null if interview is complete",
  "summary_so_far": "1-2 sentence summary of what you've learned",
  "gathered": {{ "<Field Name>": "<value>", ... }},     // best-effort structured extraction across the whole conversation
  "completeness_score": 0-100,
  "missing_fields": ["string"],
  "suggestions": ["string"],
  "is_complete": true/false                              // true ONLY when the score is high enough and no critical info is missing
}}
"""


async def requirement_gathering(doc_type_meta: Dict[str, Any], history: List[Dict[str, str]], industry: str = "") -> Dict[str, Any]:
    """history is [{role: 'user'|'assistant', content: ...}, ...]"""
    required = [f["name"] for f in doc_type_meta["fields"] if f.get("required")]
    nice_fields = "\n".join(f"  - {f['name']}" + (" (required)" if f.get("required") else "") for f in doc_type_meta["fields"])

    system = REQ_GATHER_SYSTEM.format(
        doc_label=doc_type_meta["label"],
        industry=industry or "General Business",
        sections=", ".join(doc_type_meta["sections"]),
        required_fields=nice_fields,
    )
    convo = "\n\n".join(
        f"### {m['role'].upper()}\n{m['content']}" for m in history
    ) if history else "(no messages yet — start the interview)"
    user = f"""Required fields list: {required}

Conversation so far:
{convo}

Determine the next best question (or finish the interview if you have enough). Return only the JSON object."""
    raw = await _call(system, user)
    return _extract_json(raw)


# =========================================================
# 2. COMPLETENESS VALIDATION ENGINE
# =========================================================
COMPLETENESS_SYSTEM = """You are DocuMind AI's Completeness Validator. Score whether the supplied inputs are sufficient to produce a high-quality {doc_label} for the {industry} industry.

Return ONLY valid JSON:
{{
  "completeness_score": 0-100,
  "missing_fields": ["Field Name", ...],   // fields the user should fill in or expand
  "suggestions": ["actionable, specific suggestion", ...],
  "strengths": ["what's already good"]
}}

Scoring rubric:
- 90-100: All required + most optional inputs are detailed (2+ sentences each).
- 70-89 : Required inputs present, but some optionals are thin or missing.
- 50-69 : Required inputs are thin or one required field empty.
- < 50  : Multiple required fields empty or all answers too short to draft from.
"""


async def completeness_check(doc_type_meta: Dict[str, Any], inputs: Dict[str, Any], industry: str = "") -> Dict[str, Any]:
    system = COMPLETENESS_SYSTEM.format(
        doc_label=doc_type_meta["label"],
        industry=industry or "General Business",
    )
    field_list = "\n".join(
        f"  - **{f['name']}** {'(required)' if f.get('required') else ''}: {inputs.get(f['name']) or '(empty)'}"
        for f in doc_type_meta["fields"]
    )
    user = f"""Document type: {doc_type_meta['label']}
Sections that will be produced: {doc_type_meta['sections']}

User-provided inputs:
{field_list}

Score the completeness of these inputs."""
    return _extract_json(await _call(system, user))


# =========================================================
# 3. DOCUMENT GENERATION ENGINE  (type-specific prompts)
# =========================================================
GEN_SYSTEM = """You are DocuMind AI's Generation Engine for **{doc_label}** documents in the **{industry}** industry. You produce enterprise-grade documents that pass real-world review, tailored to {industry} terminology and regulations.

WRITING STYLE — high signal, low verbosity:
- Be concise. Short paragraphs (2-4 sentences max). No filler, no repetition. Never write "various stakeholders" — name concrete roles, systems, and standards.
- Prefer STRUCTURE over prose. When content is a list of structured items, output a Markdown TABLE, not paragraphs or long bullet lists.

USE TABLES for (at minimum, when the section calls for them):
- Requirements:  | ID | Requirement | Priority | Acceptance Criteria |
- Risks:         | ID | Risk | Likelihood | Impact | Mitigation |
- Stakeholders / RACI:  | Stakeholder | Role | Responsibility | R/A/C/I |
- Metrics/KPIs:  | Metric | Baseline | Target | Owner |
- Data fields:   | Field | Type | Required | Description |
- Test cases:    | ID | Scenario | Steps | Expected Result |
Every table MUST have a header row and a |---|---| separator row.

USE DIAGRAMS only where a visual genuinely clarifies (process flow, system/architecture overview, sequence, or data model). Emit a fenced Mermaid block, e.g.:
```mermaid
flowchart TD
  A[Customer] --> B[KYC Capture]
  B --> C{{Approved?}}
  C -->|Yes| D[Onboard]
  C -->|No| E[Review]
```
Use flowchart/graph for processes & architecture, sequenceDiagram for interactions, erDiagram for data models. Keep diagrams to ~5-12 nodes. Do NOT force a diagram into every section — only where it adds real value (often Overview, Architecture, Process, or Workflow sections). Only ever produce Mermaid; never reference an external image.
MERMAID SYNTAX RULES (strict): the opening ```mermaid fence and the closing ``` MUST each be on their own line; never embed a diagram inside a sentence. Put the diagram declaration (e.g. `flowchart TD`) on its own line and EACH node/edge statement on its own line. Use ONLY ASCII arrows `-->` (and `-->|label|`); never use Unicode arrows like ⟶ → ⇒.

FORMAT:
- Use Markdown inside content (bold, tables, lists, mermaid). Follow the EXACT section order and headings provided.

Return ONLY valid JSON in this schema. Do NOT wrap the JSON itself in code fences (note: fenced ```mermaid blocks are allowed INSIDE the section content strings):

{{
  "title": "string",
  "sections": [{{"heading": "string", "content": "markdown string"}}],
  "completeness_score": 0-100,
  "suggestions": ["string"]
}}
"""


async def generate_document(doc_type_meta: Dict[str, Any], inputs: Dict[str, Any], industry: str = "", template_structure: str = "") -> Dict[str, Any]:
    system = GEN_SYSTEM.format(
        doc_label=doc_type_meta["label"],
        industry=industry or "General Business",
    )
    sections = "\n".join(f"  {i+1}. {s}" for i, s in enumerate(doc_type_meta["sections"]))
    guidance = doc_type_meta.get("guidance", "")
    guidance_block = f"## Type-specific guidance\n{guidance}" if guidance else ""
    if template_structure:
        guidance_block += (
            "\n\n## Company Template (FOLLOW THIS FORMAT)\n"
            "The customer uploaded their own template below. Match its section structure, "
            "headings, ordering, and style as closely as possible, while still covering the "
            "required sections above. Where the template and required sections overlap, prefer "
            "the template's wording.\n---\n"
            f"{template_structure[:4000]}\n---"
        )
    user = f"""## Industry
{industry or "General Business"}

## User Inputs
{_pretty_inputs(inputs)}

## Required Sections (in exact order, with exact heading names)
{sections}

{guidance_block}

Use EVERY detail the user provided in "User Inputs" above — incorporate all specifics (names, systems, metrics, constraints, stakeholders, requirements) into the relevant sections. Do not drop, generalize, or summarize away any provided detail.

Formatting: keep prose tight; put structured lists into Markdown tables; add a Mermaid diagram in sections where a process/architecture/data view aids understanding.

Return ONLY the JSON object."""
    data = _extract_json(await _call(system, user))
    data.setdefault("title", inputs.get("Project Name") or inputs.get("Process Name") or inputs.get("Feature Name") or doc_type_meta["label"])
    data.setdefault("sections", [])
    data.setdefault("completeness_score", 75)
    data.setdefault("suggestions", [])
    for s in data["sections"]:
        if isinstance(s, dict) and isinstance(s.get("content"), str):
            s["content"] = _normalize_mermaid(s["content"])
    return data


# =========================================================
# 4. REVIEW ENGINE  (uploaded documents)
# =========================================================
REVIEW_SYSTEM = """You are DocuMind AI's Document Review Engine — a senior reviewer who critiques business / process documents the way an audit lead would.

Return ONLY valid JSON:

{
  "doc_type_guess": "BRD / SOP / Test Plan / …",
  "quality_score": 0-100,
  "strengths": ["specific strength"],
  "weaknesses": ["specific weakness"],
  "missing_sections": ["section name"],
  "risks": ["risk that the document poses or contains"],
  "clarity_issues": ["confusing or ambiguous parts"],
  "recommendations": ["actionable improvement"],
  "summary": "2-3 sentence executive summary of the review"
}
"""


async def review_document(filename: str, text: str) -> Dict[str, Any]:
    user = f"""Filename: {filename}

Document content:
---
{text[:16000]}
---

Review the document and return the JSON analysis."""
    return _extract_json(await _call(REVIEW_SYSTEM, user))


# =========================================================
# 5. IMPROVE / EXPAND ENGINE  (single section)
# =========================================================
IMPROVE_SYSTEM = """You are DocuMind AI's Improvement Engine. Rewrite the supplied section so it is more thorough, specific, and professionally written, while keeping the same intent.

Return ONLY valid JSON:
{
  "improved_content": "markdown string"
}
"""


async def improve_section(section_heading: str, current_content: str, doc_type_label: str, industry: str = "") -> Dict[str, Any]:
    user = f"""Document type: {doc_type_label}
Industry: {industry or "General Business"}
Section heading: {section_heading}

Current content:
---
{current_content}
---

Rewrite/expand the section. Keep the same heading. Output JSON only."""
    data = _extract_json(await _call(IMPROVE_SYSTEM, user))
    if isinstance(data.get("improved_content"), str):
        data["improved_content"] = _normalize_mermaid(data["improved_content"])
    return data
