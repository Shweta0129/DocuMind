"""DocuMind AI — main FastAPI server."""
from __future__ import annotations

import os
import uuid
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import FastAPI, APIRouter, HTTPException, UploadFile, File, Form, Query
from fastapi.responses import StreamingResponse
from io import BytesIO
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, Field, ConfigDict

from doc_types import DOC_TYPES, CATEGORIES, INDUSTRIES, PIPELINE, doc_type_dict
import ai_engine as ai
from exports import build_docx, extract_text_from_pdf, extract_text_from_docx

# ---------------- bootstrapping ----------------
ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

mongo_url = os.environ["MONGO_URL"]
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ["DB_NAME"]]

app = FastAPI(title="DocuMind AI")
api = APIRouter(prefix="/api")

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s")
log = logging.getLogger("documind")


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _require_type(doc_type: str):
    if doc_type not in DOC_TYPES:
        raise HTTPException(status_code=400, detail=f"Unknown document type '{doc_type}'")
    return DOC_TYPES[doc_type]


# =========================================================
# Models
# =========================================================
class GenerateRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")
    type: str
    inputs: Dict[str, Any] = Field(default_factory=dict)
    industry: Optional[str] = None
    parent_id: Optional[str] = None         # if regenerating a version of an existing doc
    source_doc_id: Optional[str] = None     # if generated via pipeline from another doc


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
# Catalog
# =========================================================
@api.get("/")
async def root():
    return {"message": "DocuMind AI API", "status": "ok"}


@api.get("/catalog")
async def catalog():
    return {
        "categories": CATEGORIES,
        "industries": INDUSTRIES,
        "doc_types": doc_type_dict(),
        "pipeline": PIPELINE,
    }


@api.get("/stats")
async def stats():
    total = await db.documents.count_documents({"is_deleted": {"$ne": True}})
    by_type = {}
    for k in DOC_TYPES.keys():
        by_type[k] = await db.documents.count_documents({"type": k, "is_deleted": {"$ne": True}})
    template_count = await db.templates.count_documents({})
    review_count = await db.reviews.count_documents({})
    return {
        "total": total,
        "by_type": by_type,
        "templates": template_count,
        "reviews": review_count,
    }


# =========================================================
# Completeness
# =========================================================
@api.post("/completeness")
async def completeness(req: CompletenessRequest):
    meta = _require_type(req.type)
    try:
        result = await ai.completeness_check(meta, req.inputs, req.industry or "")
    except Exception as e:
        log.exception("completeness failure")
        raise HTTPException(status_code=502, detail=f"AI completeness failed: {e}")
    return result


# =========================================================
# Document generation + versioning
# =========================================================
async def _persist_new_document(req: GenerateRequest, ai_result: Dict[str, Any]) -> Dict[str, Any]:
    """Persist a generated document; manage parent/version chain."""
    meta = DOC_TYPES[req.type]

    # Resolve parent chain
    parent_id = req.parent_id
    version_number = "1.0"
    if parent_id:
        # Pick highest version under this parent
        existing = await db.documents.find({"parent_id": parent_id, "is_deleted": {"$ne": True}}).to_list(500)
        if not existing:
            # parent itself counts as v1.0; new one is v1.1
            parent_doc = await db.documents.find_one({"id": parent_id}, {"_id": 0})
            base_versions = [parent_doc["version_number"]] if parent_doc else ["1.0"]
        else:
            base_versions = [d.get("version_number", "1.0") for d in existing]
        version_number = _next_version(base_versions + (["1.0"] if not existing else []))

    doc_id = str(uuid.uuid4())
    record = {
        "id": doc_id,
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
        "is_deleted": False,
        "created_at": now_iso(),
        "updated_at": now_iso(),
    }
    await db.documents.insert_one(record)
    record.pop("_id", None)
    return record


def _next_version(existing: List[str]) -> str:
    """Bump minor version. existing like ['1.0', '1.1'] → '1.2'. If '1.9' → '2.0'."""
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


@api.post("/generate")
async def generate(req: GenerateRequest):
    meta = _require_type(req.type)
    try:
        ai_result = await ai.generate_document(meta, req.inputs, req.industry or "")
    except Exception as e:
        log.exception("generate failure")
        raise HTTPException(status_code=502, detail=f"AI generation failed: {e}")
    return await _persist_new_document(req, ai_result)


# =========================================================
# Pipeline
# =========================================================
class PipelineRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")
    source_id: str
    target_type: str
    industry: Optional[str] = None


@api.post("/pipeline/generate")
async def pipeline_generate(req: PipelineRequest):
    source = await db.documents.find_one({"id": req.source_id}, {"_id": 0})
    if not source:
        raise HTTPException(status_code=404, detail="Source document not found")
    if req.target_type not in DOC_TYPES:
        raise HTTPException(status_code=400, detail="Unknown target type")
    allowed = PIPELINE.get(source["type"], [])
    if req.target_type not in allowed:
        raise HTTPException(status_code=400, detail="Target type is not a valid pipeline step")

    # Construct inputs for the target by mining source content
    sec_summary = "\n\n".join(f"## {s['heading']}\n{s['content']}" for s in source.get("content", {}).get("sections", []))
    base_inputs = {**source.get("inputs", {})}
    base_inputs[f"Source {source['type'].upper()} Summary"] = sec_summary[:6000]
    base_inputs["Source Document Title"] = source.get("title", "")
    industry = req.industry or source.get("industry", "")

    gen_req = GenerateRequest(
        type=req.target_type,
        inputs=base_inputs,
        industry=industry,
        source_doc_id=source["id"],
    )
    return await generate(gen_req)


# =========================================================
# Documents CRUD, versions, duplicate, search/filter/sort
# =========================================================
@api.get("/documents")
async def list_documents(
    type: Optional[str] = None,
    category: Optional[str] = None,
    industry: Optional[str] = None,
    q: Optional[str] = None,
    sort: str = "created_desc",
    limit: int = 200,
):
    query: Dict[str, Any] = {"is_deleted": {"$ne": True}}
    if type:
        query["type"] = type
    if category:
        query["category"] = category
    if industry:
        query["industry"] = industry
    if q:
        query["title"] = {"$regex": q, "$options": "i"}

    sort_key = {
        "created_desc":  ("created_at", -1),
        "created_asc":   ("created_at", 1),
        "title_asc":     ("title", 1),
        "title_desc":    ("title", -1),
        "score_desc":    ("completeness_score", -1),
        "score_asc":     ("completeness_score", 1),
    }.get(sort, ("created_at", -1))

    cursor = db.documents.find(query, {"_id": 0}).sort(*sort_key).limit(limit)
    return await cursor.to_list(limit)


@api.get("/documents/{doc_id}")
async def get_document(doc_id: str):
    doc = await db.documents.find_one({"id": doc_id, "is_deleted": {"$ne": True}}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    return doc


@api.patch("/documents/{doc_id}")
async def patch_document(doc_id: str, patch: DocumentPatch):
    fields = {k: v for k, v in patch.model_dump().items() if v is not None}
    if not fields:
        raise HTTPException(status_code=400, detail="No fields to update")
    fields["updated_at"] = now_iso()
    res = await db.documents.update_one({"id": doc_id}, {"$set": fields})
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Document not found")
    return await db.documents.find_one({"id": doc_id}, {"_id": 0})


@api.delete("/documents/{doc_id}")
async def delete_document(doc_id: str):
    res = await db.documents.update_one({"id": doc_id}, {"$set": {"is_deleted": True, "updated_at": now_iso()}})
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Document not found")
    return {"deleted": True, "id": doc_id}


@api.post("/documents/{doc_id}/duplicate")
async def duplicate_document(doc_id: str):
    doc = await db.documents.find_one({"id": doc_id, "is_deleted": {"$ne": True}}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    new_id = str(uuid.uuid4())
    copy = {
        **doc,
        "id": new_id,
        "title": f"{doc['title']} (Copy)",
        "parent_id": None,
        "version_number": "1.0",
        "created_at": now_iso(),
        "updated_at": now_iso(),
    }
    await db.documents.insert_one(copy)
    copy.pop("_id", None)
    return copy


@api.get("/documents/{doc_id}/versions")
async def list_versions(doc_id: str):
    """Return all versions of a document family (root + children, ordered)."""
    root = await db.documents.find_one({"id": doc_id, "is_deleted": {"$ne": True}}, {"_id": 0})
    if not root:
        raise HTTPException(status_code=404, detail="Document not found")
    root_id = root.get("parent_id") or root["id"]
    family = await db.documents.find(
        {"$or": [{"id": root_id}, {"parent_id": root_id}], "is_deleted": {"$ne": True}},
        {"_id": 0, "content": 0, "inputs": 0}
    ).to_list(500)
    family.sort(key=lambda d: (d.get("version_number") or "1.0"))
    return family


@api.post("/documents/{doc_id}/versions")
async def create_new_version(doc_id: str):
    """Regenerate using the same inputs but bump version under same parent."""
    doc = await db.documents.find_one({"id": doc_id, "is_deleted": {"$ne": True}}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    parent_id = doc.get("parent_id") or doc["id"]
    req = GenerateRequest(
        type=doc["type"],
        inputs=doc.get("inputs", {}),
        industry=doc.get("industry") or "",
        parent_id=parent_id,
    )
    return await generate(req)


# =========================================================
# Interview / requirement-gathering engine
# =========================================================
@api.post("/interview/start")
async def interview_start(req: InterviewStart):
    meta = _require_type(req.type)
    conv_id = str(uuid.uuid4())
    industry = req.industry or ""
    try:
        first = await ai.requirement_gathering(meta, [], industry)
    except Exception as e:
        log.exception("interview start failure")
        raise HTTPException(status_code=502, detail=f"AI failure: {e}")
    record = {
        "id": conv_id,
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


@api.post("/interview/{conv_id}/message")
async def interview_message(conv_id: str, body: InterviewMessage):
    convo = await db.conversations.find_one({"id": conv_id}, {"_id": 0})
    if not convo:
        raise HTTPException(status_code=404, detail="Interview not found")
    meta = _require_type(convo["type"])

    convo["messages"].append({"role": "user", "content": body.answer})
    try:
        state = await ai.requirement_gathering(meta, convo["messages"], convo.get("industry", ""))
    except Exception as e:
        log.exception("interview message failure")
        raise HTTPException(status_code=502, detail=f"AI failure: {e}")

    nxt = state.get("next_question")
    if nxt and not state.get("is_complete"):
        convo["messages"].append({"role": "assistant", "content": nxt})
    convo["state"] = state
    convo["updated_at"] = now_iso()
    await db.conversations.update_one({"id": conv_id}, {"$set": convo})
    return convo


@api.get("/interview/{conv_id}")
async def interview_get(conv_id: str):
    convo = await db.conversations.find_one({"id": conv_id}, {"_id": 0})
    if not convo:
        raise HTTPException(status_code=404, detail="Not found")
    return convo


@api.post("/interview/{conv_id}/generate")
async def interview_generate(conv_id: str):
    """Finalize the interview and generate the document from gathered data."""
    convo = await db.conversations.find_one({"id": conv_id}, {"_id": 0})
    if not convo:
        raise HTTPException(status_code=404, detail="Interview not found")
    gathered = (convo.get("state") or {}).get("gathered") or {}
    req = GenerateRequest(
        type=convo["type"],
        inputs=gathered,
        industry=convo.get("industry") or "",
    )
    return await generate(req)


# =========================================================
# Document Reviewer (file upload)
# =========================================================
@api.post("/review/upload")
async def review_upload(file: UploadFile = File(...)):
    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail="Empty file")
    name = (file.filename or "").lower()
    if name.endswith(".pdf"):
        text = extract_text_from_pdf(data)
    elif name.endswith(".docx"):
        text = extract_text_from_docx(data)
    elif name.endswith(".txt") or name.endswith(".md"):
        text = data.decode("utf-8", errors="ignore")
    else:
        raise HTTPException(status_code=400, detail="Only PDF, DOCX, TXT, MD files are supported")

    if not text.strip():
        raise HTTPException(status_code=400, detail="Could not extract text from the file")

    try:
        analysis = await ai.review_document(file.filename or "document", text)
    except Exception as e:
        log.exception("review failure")
        raise HTTPException(status_code=502, detail=f"AI review failed: {e}")

    review = {
        "id": str(uuid.uuid4()),
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
async def list_reviews():
    cursor = db.reviews.find({}, {"_id": 0}).sort("created_at", -1).limit(100)
    return await cursor.to_list(100)


@api.get("/reviews/{review_id}")
async def get_review(review_id: str):
    r = await db.reviews.find_one({"id": review_id}, {"_id": 0})
    if not r:
        raise HTTPException(status_code=404, detail="Review not found")
    return r


@api.delete("/reviews/{review_id}")
async def delete_review(review_id: str):
    res = await db.reviews.delete_one({"id": review_id})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Review not found")
    return {"deleted": True, "id": review_id}


# =========================================================
# Templates
# =========================================================
@api.post("/templates")
async def upload_template(
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
    data = await file.read()
    filename = (file.filename or "").lower()
    if not (filename.endswith(".pdf") or filename.endswith(".docx") or filename.endswith(".txt") or filename.endswith(".md")):
        raise HTTPException(status_code=400, detail="Only PDF, DOCX, TXT, MD allowed")

    if filename.endswith(".pdf"):
        text = extract_text_from_pdf(data)
    elif filename.endswith(".docx"):
        text = extract_text_from_docx(data)
    else:
        text = data.decode("utf-8", errors="ignore")

    template = {
        "id": str(uuid.uuid4()),
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
async def list_templates():
    cursor = db.templates.find({}, {"_id": 0}).sort("created_at", -1).limit(200)
    return await cursor.to_list(200)


@api.get("/templates/{tpl_id}")
async def get_template(tpl_id: str):
    t = await db.templates.find_one({"id": tpl_id}, {"_id": 0})
    if not t:
        raise HTTPException(status_code=404, detail="Template not found")
    return t


@api.delete("/templates/{tpl_id}")
async def delete_template(tpl_id: str):
    res = await db.templates.delete_one({"id": tpl_id})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Template not found")
    return {"deleted": True, "id": tpl_id}


# =========================================================
# Settings (singleton: id="default")
# =========================================================
@api.get("/settings")
async def get_settings():
    s = await db.settings.find_one({"id": "default"}, {"_id": 0})
    if not s:
        s = {"id": "default", **SettingsModel().model_dump()}
        await db.settings.insert_one(s)
        s.pop("_id", None)
    return s


@api.put("/settings")
async def update_settings(payload: SettingsModel):
    new = {"id": "default", **payload.model_dump(), "updated_at": now_iso()}
    await db.settings.update_one({"id": "default"}, {"$set": new}, upsert=True)
    return await db.settings.find_one({"id": "default"}, {"_id": 0})


# =========================================================
# Export: DOCX  (PDF is generated client-side via jsPDF)
# =========================================================
@api.get("/export/docx/{doc_id}")
async def export_docx(doc_id: str, template_id: Optional[str] = None):
    doc = await db.documents.find_one({"id": doc_id, "is_deleted": {"$ne": True}}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    settings = await db.settings.find_one({"id": "default"}, {"_id": 0}) or {}
    if template_id:
        tpl = await db.templates.find_one({"id": template_id}, {"_id": 0})
        if tpl:
            # Template values override settings
            for k in ["header", "footer", "version_number", "author", "reviewer", "approver", "document_id_prefix"]:
                if tpl.get(k):
                    settings[k] = tpl[k]
            if tpl.get("document_id_prefix"):
                settings["document_id"] = f"{tpl['document_id_prefix']}-{doc['id'][:8].upper()}"
    # Ensure version_number falls back to the document's
    if not settings.get("version_number"):
        settings["version_number"] = doc.get("version_number", "1.0")

    data = build_docx(doc, settings)
    safe = (doc.get("title") or "document").replace(" ", "_")[:60]
    return StreamingResponse(
        BytesIO(data),
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        headers={"Content-Disposition": f'attachment; filename="{safe}.docx"'},
    )


# =========================================================
# Section improvement (single section)
# =========================================================
class ImproveRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")
    section_index: int


@api.post("/documents/{doc_id}/improve")
async def improve(doc_id: str, req: ImproveRequest):
    doc = await db.documents.find_one({"id": doc_id, "is_deleted": {"$ne": True}}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    secs = doc.get("content", {}).get("sections", [])
    if req.section_index < 0 or req.section_index >= len(secs):
        raise HTTPException(status_code=400, detail="Invalid section index")
    sec = secs[req.section_index]
    try:
        out = await ai.improve_section(sec["heading"], sec.get("content", ""), DOC_TYPES[doc["type"]]["label"], doc.get("industry", ""))
    except Exception as e:
        log.exception("improve failure")
        raise HTTPException(status_code=502, detail=f"AI failure: {e}")

    secs[req.section_index] = {**sec, "content": out.get("improved_content", sec.get("content", ""))}
    await db.documents.update_one(
        {"id": doc_id},
        {"$set": {"content": {"sections": secs}, "updated_at": now_iso()}},
    )
    return await db.documents.find_one({"id": doc_id}, {"_id": 0})


# ---------------- wire up ----------------
app.include_router(api)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get("CORS_ORIGINS", "*").split(","),
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
