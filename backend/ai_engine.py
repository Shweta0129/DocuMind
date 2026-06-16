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
    try:
        return json.loads(t)
    except json.JSONDecodeError:
        s, e = t.find("{"), t.rfind("}")
        if s != -1 and e != -1 and e > s:
            return json.loads(t[s:e + 1])
        raise


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
GEN_SYSTEM = """You are DocuMind AI's Generation Engine for **{doc_label}** documents in the **{industry}** industry.

You write enterprise-grade {doc_label} documents that pass real-world quality review. Tailor terminology, regulatory references and tone to the {industry} industry.

Rules:
- Be substantial in each section (multiple paragraphs or rich bullet/numbered lists).
- Use Markdown inside section content (bold, lists, tables) — render real Markdown tables wherever appropriate.
- Be specific. Never write filler like "various stakeholders" — name plausible roles.
- Follow the EXACT section order and headings provided.

Return ONLY valid JSON in this schema (no commentary, no code fences):

{{
  "title": "string",
  "sections": [{{"heading": "string", "content": "markdown string"}}],
  "completeness_score": 0-100,
  "suggestions": ["string"]
}}
"""


async def generate_document(doc_type_meta: Dict[str, Any], inputs: Dict[str, Any], industry: str = "") -> Dict[str, Any]:
    system = GEN_SYSTEM.format(
        doc_label=doc_type_meta["label"],
        industry=industry or "General Business",
    )
    sections = "\n".join(f"  {i+1}. {s}" for i, s in enumerate(doc_type_meta["sections"]))
    guidance = doc_type_meta.get("guidance", "")
    guidance_block = f"## Type-specific guidance\n{guidance}" if guidance else ""
    user = f"""## Industry
{industry or "General Business"}

## User Inputs
{_pretty_inputs(inputs)}

## Required Sections (in exact order, with exact heading names)
{sections}

{guidance_block}

Return ONLY the JSON object."""
    data = _extract_json(await _call(system, user))
    data.setdefault("title", inputs.get("Project Name") or inputs.get("Process Name") or inputs.get("Feature Name") or doc_type_meta["label"])
    data.setdefault("sections", [])
    data.setdefault("completeness_score", 75)
    data.setdefault("suggestions", [])
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
    return _extract_json(await _call(IMPROVE_SYSTEM, user))
