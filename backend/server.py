"""DocuMind AI — main FastAPI server.

Multi-tenant: every request is authenticated and every data query is scoped to
the caller's organization (org_id), so companies never see each other's data.
"""
from __future__ import annotations

import os
import re
import uuid
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import FastAPI, APIRouter, HTTPException, UploadFile, File, Form, Depends
from fastapi.responses import StreamingResponse, JSONResponse
from fastapi.requests import Request
from io import BytesIO
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, Field, ConfigDict

from doc_types import DOC_TYPES, CATEGORIES, INDUSTRIES, PIPELINE, doc_type_dict
import ai_engine as ai
import llm_client
import auth
import billing
import plans
import security
from exports import build_docx, extract_text_from_pdf, extract_text_from_docx

# ---------------- bootstrapping ----------------
ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

mongo_url = os.environ["MONGO_URL"]
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ["DB_NAME"]]

auth.init(db)
billing.init(db)

app = FastAPI(title="DocuMind AI")
api = APIRouter(prefix="/api")

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s")
log = logging.getLogger("documind")

CurrentUser = Depends(auth.get_current_user)
# Gated dependency for AI/export routes: enforces active subscription/trial (402).
GenAccess = Depends(billing.require_generation_access)
ai_rate = Depends(security.rate_limit("ai", 30, 60))


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _require_type(doc_type: str):
    if doc_type not in DOC_TYPES:
        raise HTTPException(status_code=400, detail=f"Unknown document type '{doc_type}'")
    return DOC_TYPES[doc_type]


def org_scope(user: Dict[str, Any], extra: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """Base query scoped to the caller's organization."""
    q: Dict[str, Any] = {"org_id": user["org_id"]}
    if extra:
        q.update(extra)
    return q


def doc_scope(user: Dict[str, Any], extra: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """Document query scoped to org and excluding soft-deleted docs."""
    q: Dict[str, Any] = {"org_id": user["org_id"], "is_deleted": {"$ne": True}}
    if extra:
        q.update(extra)
    return q


def _ai_error(e: Exception) -> HTTPException:
    """Convert an AI/provider exception into a safe client-facing error."""
    if isinstance(e, llm_client.LLMConfigError):
        # Safe to surface: it's a setup hint with no secrets.
        return HTTPException(status_code=503, detail=str(e))
    log.exception("AI request failed")
    return HTTPException(status_code=502, detail="The AI service failed to respond. Please try again.")


# =========================================================
# Models
# =========================================================
class GenerateRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")
    type: str
    inputs: Dict[str, Any] = Field(default_factory=dict)
    industry: Optional[str] = None
    parent_id: Optional[str] = None
    source_doc_id: Optional[str] = None
    template_id: Optional[str] = None


class CompletenessRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")
    type: str
    inputs: Dict[str, Any] = Field(default_factory=dict)
    industry: Optional[str] = None


class InterviewStart(BaseModel):
    model_config = ConfigDict(extra="ignore")
    type: str
    industry: Optional[str] = None


class InterviewMessage(BaseModel):
    model_config = ConfigDict(extra="ignore")
    answer: str


class DocumentPatch(BaseModel):
    model_config = ConfigDict(extra="ignore")
    title: Optional[str] = None
    content: Optional[Dict[str, Any]] = None


class SettingsModel(BaseModel):
    model_config = ConfigDict(extra="ignore")
    company_name: Optional[str] = ""
    company_logo_url: Optional[str] = ""
    project_name: Optional[str] = ""
    document_id: Optional[str] = ""
    version_number: Optional[str] = ""
    author: Optional[str] = ""
    reviewer: Optional[str] = ""
    approver: Optional[str] = ""
    page_layout: Optional[str] = "letter"


# =========================================================
# Health / Catalog  (public)
# =========================================================
@api.get("/")
async def root():
    return {"message": "DocuMind AI API", "status": "ok"}


@app.get("/health")
async def health():
    db_ok = True
    try:
        await db.command("ping")
    except Exception:
        db_ok = False
    return {"status": "ok", "database": db_ok, "llm": llm_client.active_provider_info()}


@api.get("/catalog")
async def catalog():
    # Static metadata, no tenant data — left unauthenticated so the UI can load it.
    return {
        "categories": CATEGORIES,
        "industries": INDUSTRIES,
        "doc_types": doc_type_dict(),
        "pipeline": PIPELINE,
    }


@api.get("/stats")
async def stats(user: Dict[str, Any] = CurrentUser):
    base = {"org_id": user["org_id"], "is_deleted": {"$ne": True}}
    total = await db.documents.count_documents(base)
    by_type = {}
    for k in DOC_TYPES.keys():
        by_type[k] = await db.documents.count_documents({**base, "type": k})
    template_count = await db.templates.count_documents(org_scope(user))
    review_count = await db.reviews.count_documents(org_scope(user))
    return {"total": total, "by_type": by_type, "templates": template_count, "reviews": review_count}


# =========================================================
# Completeness
# =========================================================
@api.post("/completeness", dependencies=[ai_rate])
async def completeness(req: CompletenessRequest, user: Dict[str, Any] = GenAccess):
    meta = _require_type(req.type)
    try:
        return await ai.completeness_check(meta, req.inputs, req.industry or "")
    except Exception as e:
        raise _ai_error(e)


# =========================================================
# Document generation + versioning
# =========================================================
async def _persist_new_document(req: GenerateRequest, ai_result: Dict[str, Any], user: Dict[str, Any]) -> Dict[str, Any]:
    meta = DOC_TYPES[req.type]
    org_id = user["org_id"]

    parent_id = req.parent_id
    version_number = "1.0"
    if parent_id:
        existing = await db.documents.find(
            {"org_id": org_id, "parent_id": parent_id, "is_deleted": {"$ne": True}}
        ).to_list(500)
        if not existing:
            parent_doc = await db.documents.find_one({"org_id": org_id, "id": parent_id}, {"_id": 0})
            base_versions = [parent_doc["version_number"]] if parent_doc else ["1.0"]
        else:
            base_versions = [d.get("version_number", "1.0") for d in existing]
        version_number = _next_version(base_versions + (["1.0"] if not existing else []))

    doc_id = str(uuid.uuid4())
    record = {
        "id": doc_id,
        "org_id": org_id,
        "type": req.type,
        "category": meta["category"],
        "industry": req.industry or "",
        "title": ai_result.get("title", "Untitled"),
        "inputs": req.inputs,
        "content": {"sections": ai_result.get("sections", [])},
        "completeness_score": int(ai_result.get("completeness_score", 75)),
        "suggestions": list(ai_result.get("suggestions", [])),
        "parent_id": parent_id,
        "version_number": version_number,
        "source_doc_id": req.source_doc_id,
        "created_by": user["id"],
        "is_deleted": False,
        "created_at": now_iso(),
        "updated_at": now_iso(),
    }
    await db.documents.insert_one(record)
    record.pop("_id", None)
    return record


def _next_version(existing: List[str]) -> str:
    nums = []
    for v in existing:
        try:
            maj, mn = v.split(".")
            nums.append((int(maj), int(mn)))
        except Exception:
            continue
    if not nums:
        return "1.0"
    maj, mn = max(nums)
    if mn >= 9:
        return f"{maj + 1}.0"
    return f"{maj}.{mn + 1}"


async def _generate(req: GenerateRequest, user: Dict[str, Any]) -> Dict[str, Any]:
    _require_type(req.type)
    template_structure = ""
    if req.template_id:
        tpl = await db.templates.find_one(org_scope(user, {"id": req.template_id}), {"_id": 0})
        if tpl:
            template_structure = tpl.get("structure_excerpt", "")
    try:
        ai_result = await ai.generate_document(
            DOC_TYPES[req.type], req.inputs, req.industry or "", template_structure=template_structure
        )
    except Exception as e:
        raise _ai_error(e)
    record = await _persist_new_document(req, ai_result, user)
    await billing.record_generation(user["org_id"])  # meters trial usage
    return record


@api.post("/generate", dependencies=[ai_rate])
async def generate(req: GenerateRequest, user: Dict[str, Any] = GenAccess):
    return await _generate(req, user)


# =========================================================
# Pipeline
# =========================================================
class PipelineRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")
    source_id: str
    target_type: str
    industry: Optional[str] = None


@api.post("/pipeline/generate", dependencies=[ai_rate])
async def pipeline_generate(req: PipelineRequest, user: Dict[str, Any] = GenAccess):
    source = await db.documents.find_one(doc_scope(user, {"id": req.source_id}), {"_id": 0})
    if not source:
        raise HTTPException(status_code=404, detail="Source document not found")
    if req.target_type not in DOC_TYPES:
        raise HTTPException(status_code=400, detail="Unknown target type")
    if req.target_type not in PIPELINE.get(source["type"], []):
        raise HTTPException(status_code=400, detail="Target type is not a valid pipeline step")

    sec_summary = "\n\n".join(
        f"## {s['heading']}\n{s['content']}" for s in source.get("content", {}).get("sections", [])
    )
    base_inputs = {**source.get("inputs", {})}
    base_inputs[f"Source {source['type'].upper()} Summary"] = sec_summary[:6000]
    base_inputs["Source Document Title"] = source.get("title", "")

    gen_req = GenerateRequest(
        type=req.target_type,
        inputs=base_inputs,
        industry=req.industry or source.get("industry", ""),
        source_doc_id=source["id"],
    )
    return await _generate(gen_req, user)


# =========================================================
# Documents CRUD, versions, duplicate, search/filter/sort
# =========================================================
@api.get("/documents")
async def list_documents(
    user: Dict[str, Any] = CurrentUser,
    type: Optional[str] = None,
    category: Optional[str] = None,
    industry: Optional[str] = None,
    q: Optional[str] = None,
    sort: str = "created_desc",
    limit: int = 200,
):
    limit = max(1, min(limit, 500))
    query = doc_scope(user)
    if type:
        query["type"] = type
    if category:
        query["category"] = category
    if industry:
        query["industry"] = industry
    if q:
        # Escape user input so it can't act as a regular expression.
        query["title"] = {"$regex": re.escape(q), "$options": "i"}

    sort_key = {
        "created_desc": ("created_at", -1),
        "created_asc": ("created_at", 1),
        "title_asc": ("title", 1),
        "title_desc": ("title", -1),
        "score_desc": ("completeness_score", -1),
        "score_asc": ("completeness_score", 1),
    }.get(sort, ("created_at", -1))

    cursor = db.documents.find(query, {"_id": 0}).sort(*sort_key).limit(limit)
    return await cursor.to_list(limit)


@api.get("/documents/{doc_id}")
async def get_document(doc_id: str, user: Dict[str, Any] = CurrentUser):
    doc = await db.documents.find_one(doc_scope(user, {"id": doc_id}), {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    return doc


@api.patch("/documents/{doc_id}")
async def patch_document(doc_id: str, patch: DocumentPatch, user: Dict[str, Any] = CurrentUser):
    fields = {k: v for k, v in patch.model_dump().items() if v is not None}
    if not fields:
        raise HTTPException(status_code=400, detail="No fields to update")
    fields["updated_at"] = now_iso()
    res = await db.documents.update_one(doc_scope(user, {"id": doc_id}), {"$set": fields})
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Document not found")
    return await db.documents.find_one(org_scope(user, {"id": doc_id}), {"_id": 0})


@api.delete("/documents/{doc_id}")
async def delete_document(doc_id: str, user: Dict[str, Any] = CurrentUser):
    res = await db.documents.update_one(
        doc_scope(user, {"id": doc_id}), {"$set": {"is_deleted": True, "updated_at": now_iso()}}
    )
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Document not found")
    return {"deleted": True, "id": doc_id}


@api.post("/documents/{doc_id}/duplicate")
async def duplicate_document(doc_id: str, user: Dict[str, Any] = CurrentUser):
    doc = await db.documents.find_one(doc_scope(user, {"id": doc_id}), {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    new_id = str(uuid.uuid4())
    copy = {
        **doc,
        "id": new_id,
        "title": f"{doc['title']} (Copy)",
        "parent_id": None,
        "version_number": "1.0",
        "created_by": user["id"],
        "created_at": now_iso(),
        "updated_at": now_iso(),
    }
    await db.documents.insert_one(copy)
    copy.pop("_id", None)
    return copy


@api.get("/documents/{doc_id}/versions")
async def list_versions(doc_id: str, user: Dict[str, Any] = CurrentUser):
    root = await db.documents.find_one(doc_scope(user, {"id": doc_id}), {"_id": 0})
    if not root:
        raise HTTPException(status_code=404, detail="Document not found")
    root_id = root.get("parent_id") or root["id"]
    family = await db.documents.find(
        doc_scope(user, {"$or": [{"id": root_id}, {"parent_id": root_id}]}),
        {"_id": 0, "content": 0, "inputs": 0},
    ).to_list(500)
    family.sort(key=lambda d: (d.get("version_number") or "1.0"))
    return family


@api.post("/documents/{doc_id}/versions", dependencies=[ai_rate])
async def create_new_version(doc_id: str, user: Dict[str, Any] = GenAccess):
    doc = await db.documents.find_one(doc_scope(user, {"id": doc_id}), {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    req = GenerateRequest(
        type=doc["type"],
        inputs=doc.get("inputs", {}),
        industry=doc.get("industry") or "",
        parent_id=doc.get("parent_id") or doc["id"],
    )
    return await _generate(req, user)


# =========================================================
# Interview / requirement-gathering engine
# =========================================================
@api.post("/interview/start", dependencies=[ai_rate])
async def interview_start(req: InterviewStart, user: Dict[str, Any] = GenAccess):
    meta = _require_type(req.type)
    conv_id = str(uuid.uuid4())
    industry = req.industry or ""
    try:
        first = await ai.requirement_gathering(meta, [], industry)
    except Exception as e:
        raise _ai_error(e)
    record = {
        "id": conv_id,
        "org_id": user["org_id"],
        "created_by": user["id"],
        "type": req.type,
        "industry": industry,
        "messages": [{"role": "assistant", "content": first.get("next_question", "Let's get started.")}],
        "state": first,
        "created_at": now_iso(),
        "updated_at": now_iso(),
    }
    await db.conversations.insert_one(record)
    record.pop("_id", None)
    return record


@api.post("/interview/{conv_id}/message", dependencies=[ai_rate])
async def interview_message(conv_id: str, body: InterviewMessage, user: Dict[str, Any] = GenAccess):
    convo = await db.conversations.find_one(org_scope(user, {"id": conv_id}), {"_id": 0})
    if not convo:
        raise HTTPException(status_code=404, detail="Interview not found")
    meta = _require_type(convo["type"])

    convo["messages"].append({"role": "user", "content": body.answer})
    try:
        state = await ai.requirement_gathering(meta, convo["messages"], convo.get("industry", ""))
    except Exception as e:
        raise _ai_error(e)

    nxt = state.get("next_question")
    if nxt and not state.get("is_complete"):
        convo["messages"].append({"role": "assistant", "content": nxt})
    convo["state"] = state
    convo["updated_at"] = now_iso()
    await db.conversations.update_one(org_scope(user, {"id": conv_id}), {"$set": convo})
    return convo


@api.get("/interview/{conv_id}")
async def interview_get(conv_id: str, user: Dict[str, Any] = CurrentUser):
    convo = await db.conversations.find_one(org_scope(user, {"id": conv_id}), {"_id": 0})
    if not convo:
        raise HTTPException(status_code=404, detail="Not found")
    return convo


@api.post("/interview/{conv_id}/generate", dependencies=[ai_rate])
async def interview_generate(conv_id: str, user: Dict[str, Any] = GenAccess):
    convo = await db.conversations.find_one(org_scope(user, {"id": conv_id}), {"_id": 0})
    if not convo:
        raise HTTPException(status_code=404, detail="Interview not found")
    gathered = (convo.get("state") or {}).get("gathered") or {}
    req = GenerateRequest(type=convo["type"], inputs=gathered, industry=convo.get("industry") or "")
    return await _generate(req, user)


# =========================================================
# Document Reviewer (file upload)
# =========================================================
@api.post("/review/upload", dependencies=[ai_rate])
async def review_upload(user: Dict[str, Any] = GenAccess, file: UploadFile = File(...)):
    ext = security.check_extension(file.filename)
    data = await security.read_upload(file)
    if ext == ".pdf":
        text = extract_text_from_pdf(data)
    elif ext == ".docx":
        text = extract_text_from_docx(data)
    else:
        text = data.decode("utf-8", errors="ignore")

    if not text.strip():
        raise HTTPException(status_code=400, detail="Could not extract text from the file")

    try:
        analysis = await ai.review_document(file.filename or "document", text)
    except Exception as e:
        raise _ai_error(e)

    review = {
        "id": str(uuid.uuid4()),
        "org_id": user["org_id"],
        "created_by": user["id"],
        "filename": file.filename,
        "size_bytes": len(data),
        "text_excerpt": text[:1500],
        "analysis": analysis,
        "created_at": now_iso(),
    }
    await db.reviews.insert_one(review)
    review.pop("_id", None)
    return review


@api.get("/reviews")
async def list_reviews(user: Dict[str, Any] = CurrentUser):
    cursor = db.reviews.find(org_scope(user), {"_id": 0}).sort("created_at", -1).limit(100)
    return await cursor.to_list(100)


@api.get("/reviews/{review_id}")
async def get_review(review_id: str, user: Dict[str, Any] = CurrentUser):
    r = await db.reviews.find_one(org_scope(user, {"id": review_id}), {"_id": 0})
    if not r:
        raise HTTPException(status_code=404, detail="Review not found")
    return r


@api.delete("/reviews/{review_id}")
async def delete_review(review_id: str, user: Dict[str, Any] = CurrentUser):
    res = await db.reviews.delete_one(org_scope(user, {"id": review_id}))
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Review not found")
    return {"deleted": True, "id": review_id}


# =========================================================
# Templates
# =========================================================
@api.post("/templates")
async def upload_template(
    user: Dict[str, Any] = CurrentUser,
    file: UploadFile = File(...),
    name: str = Form(...),
    description: str = Form(""),
    header: str = Form(""),
    footer: str = Form(""),
    document_id_prefix: str = Form(""),
    version_number: str = Form("1.0"),
    author: str = Form(""),
    reviewer: str = Form(""),
    approver: str = Form(""),
):
    ext = security.check_extension(file.filename)
    data = await security.read_upload(file)
    if ext == ".pdf":
        text = extract_text_from_pdf(data)
    elif ext == ".docx":
        text = extract_text_from_docx(data)
    else:
        text = data.decode("utf-8", errors="ignore")

    template = {
        "id": str(uuid.uuid4()),
        "org_id": user["org_id"],
        "created_by": user["id"],
        "name": name,
        "description": description,
        "filename": file.filename,
        "size_bytes": len(data),
        "structure_excerpt": text[:4000],
        "header": header,
        "footer": footer,
        "document_id_prefix": document_id_prefix,
        "version_number": version_number,
        "author": author,
        "reviewer": reviewer,
        "approver": approver,
        "created_at": now_iso(),
    }
    await db.templates.insert_one(template)
    template.pop("_id", None)
    return template


@api.get("/templates")
async def list_templates(user: Dict[str, Any] = CurrentUser):
    cursor = db.templates.find(org_scope(user), {"_id": 0}).sort("created_at", -1).limit(200)
    return await cursor.to_list(200)


@api.get("/templates/{tpl_id}")
async def get_template(tpl_id: str, user: Dict[str, Any] = CurrentUser):
    t = await db.templates.find_one(org_scope(user, {"id": tpl_id}), {"_id": 0})
    if not t:
        raise HTTPException(status_code=404, detail="Template not found")
    return t


@api.delete("/templates/{tpl_id}")
async def delete_template(tpl_id: str, user: Dict[str, Any] = CurrentUser):
    res = await db.templates.delete_one(org_scope(user, {"id": tpl_id}))
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Template not found")
    return {"deleted": True, "id": tpl_id}


# =========================================================
# Settings (one document per organization)
# =========================================================
@api.get("/settings")
async def get_settings(user: Dict[str, Any] = CurrentUser):
    s = await db.settings.find_one(org_scope(user), {"_id": 0})
    if not s:
        s = {"org_id": user["org_id"], **SettingsModel().model_dump()}
        await db.settings.insert_one(dict(s))
    s.pop("_id", None)
    return s


@api.put("/settings")
async def update_settings(payload: SettingsModel, user: Dict[str, Any] = CurrentUser):
    data = payload.model_dump()
    data["company_logo_url"] = security.validate_public_url(data.get("company_logo_url"))
    new = {"org_id": user["org_id"], **data, "updated_at": now_iso()}
    await db.settings.update_one(org_scope(user), {"$set": new}, upsert=True)
    return await db.settings.find_one(org_scope(user), {"_id": 0})


# =========================================================
# Export: DOCX  (PDF is generated client-side via jsPDF)
# =========================================================
async def _build_docx_response(doc: Dict[str, Any], user: Dict[str, Any], template_id: Optional[str]):
    settings = await db.settings.find_one(org_scope(user), {"_id": 0}) or {}
    if template_id:
        tpl = await db.templates.find_one(org_scope(user, {"id": template_id}), {"_id": 0})
        if tpl:
            for k in ["header", "footer", "version_number", "author", "reviewer", "approver", "document_id_prefix"]:
                if tpl.get(k):
                    settings[k] = tpl[k]
            if tpl.get("document_id_prefix"):
                settings["document_id"] = f"{tpl['document_id_prefix']}-{doc['id'][:8].upper()}"
    if not settings.get("version_number"):
        settings["version_number"] = doc.get("version_number", "1.0")

    data = build_docx(doc, settings)
    safe = (doc.get("title") or "document").replace(" ", "_")[:60]
    return StreamingResponse(
        BytesIO(data),
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        headers={"Content-Disposition": f'attachment; filename="{safe}.docx"'},
    )


@api.get("/export/docx/{doc_id}")
async def export_docx(doc_id: str, user: Dict[str, Any] = GenAccess, template_id: Optional[str] = None):
    doc = await db.documents.find_one(doc_scope(user, {"id": doc_id}), {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    return await _build_docx_response(doc, user, template_id)


class DocxExportBody(BaseModel):
    model_config = ConfigDict(extra="ignore")
    template_id: Optional[str] = None
    # Client may send sections with Mermaid blocks already replaced by rendered
    # image data-URIs, so diagrams appear in the DOCX too.
    sections: Optional[List[Dict[str, Any]]] = None


@api.post("/export/docx/{doc_id}")
async def export_docx_post(doc_id: str, body: DocxExportBody, user: Dict[str, Any] = GenAccess):
    doc = await db.documents.find_one(doc_scope(user, {"id": doc_id}), {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    if body.sections is not None:
        doc = {**doc, "content": {"sections": body.sections}}
    return await _build_docx_response(doc, user, body.template_id)


# =========================================================
# Section improvement (single section)
# =========================================================
class ImproveRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")
    section_index: int


@api.post("/documents/{doc_id}/improve", dependencies=[ai_rate])
async def improve(doc_id: str, req: ImproveRequest, user: Dict[str, Any] = GenAccess):
    doc = await db.documents.find_one(doc_scope(user, {"id": doc_id}), {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    secs = doc.get("content", {}).get("sections", [])
    if req.section_index < 0 or req.section_index >= len(secs):
        raise HTTPException(status_code=400, detail="Invalid section index")
    sec = secs[req.section_index]
    try:
        out = await ai.improve_section(
            sec["heading"], sec.get("content", ""), DOC_TYPES[doc["type"]]["label"], doc.get("industry", "")
        )
    except Exception as e:
        raise _ai_error(e)

    secs[req.section_index] = {**sec, "content": out.get("improved_content", sec.get("content", ""))}
    await db.documents.update_one(
        org_scope(user, {"id": doc_id}),
        {"$set": {"content": {"sections": secs}, "updated_at": now_iso()}},
    )
    return await db.documents.find_one(org_scope(user, {"id": doc_id}), {"_id": 0})


# ---------------- wire up ----------------
api.include_router(auth.router)
api.include_router(billing.router)
app.include_router(api)

_cors_env = os.environ.get("CORS_ORIGINS", "")
_origins = [o.strip() for o in _cors_env.split(",") if o.strip() and o.strip() != "*"]
if not _origins:
    _origins = ["http://localhost:3000", "http://127.0.0.1:3000"]

app.add_middleware(
    CORSMiddleware,
    allow_credentials=False,  # we authenticate with Bearer tokens, not cookies
    allow_origins=_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["Permissions-Policy"] = "geolocation=(), microphone=(), camera=()"
    if request.url.scheme == "https":
        response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
    return response


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    log.exception("Unhandled error on %s %s", request.method, request.url.path)
    return JSONResponse(status_code=500, content={"detail": "Internal server error"})


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()


@app.on_event("startup")
async def ensure_indexes():
    try:
        await db.documents.create_index([("org_id", 1), ("is_deleted", 1), ("created_at", -1)])
        await db.documents.create_index([("org_id", 1), ("id", 1)])
        await db.documents.create_index([("org_id", 1), ("parent_id", 1)])
        await db.reviews.create_index([("org_id", 1), ("created_at", -1)])
        await db.templates.create_index([("org_id", 1), ("created_at", -1)])
        await db.conversations.create_index([("org_id", 1), ("id", 1)])
        await db.settings.create_index([("org_id", 1)], unique=True)
        await db.users.create_index([("email", 1)], unique=True)
        await db.users.create_index([("google_sub", 1)])
        await db.organizations.create_index([("id", 1)], unique=True)
        # Backfill: grant a fresh trial to any pre-existing org without a subscription.
        await db.organizations.update_many(
            {"subscription": {"$exists": False}},
            {"$set": {"subscription": plans.new_trial_subscription()}},
        )
    except Exception:
        log.exception("Index creation failed (continuing)")
