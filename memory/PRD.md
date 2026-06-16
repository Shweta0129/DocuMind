# DocuMind AI — PRD & Build Log

## Original problem statement
Build a modern AI-powered web application called "DocuMind AI" that helps Business Analysts, Project
Managers, QA Engineers, Consultants, and Operations Teams generate professional documentation.

A subsequent extension request expanded the scope into a **full AI Documentation Copilot** covering:
requirement gathering interviews, completeness validation, 25+ document types across 6 categories,
document pipelines, document review of uploaded PDFs/DOCX, company templates, header/footer
branding, industry modes, DOCX & PDF exports, versioning, and a centralized library.

## User personas
- Business Analyst — drafts BRDs, FRDs, SRSs, User Stories, Use Cases.
- Project Manager — drafts Project Charters, Risk Registers, RAID Logs, Stakeholder Matrix, Scope.
- QA Engineer — drafts Test Plans, Test Strategies, Test Cases, RTM, Defect Reports.
- Operations team — drafts SOPs, Work Instructions, Process Docs, Audit Checklists.
- Manufacturing team — drafts Quality Procedures, Inspection Checklists, CAPA, RCA, Maintenance SOP, Safety Procedure.
- HR team — drafts HR Policies, Employee Handbook, Onboarding Guides, Training Documentation.

## Core requirements (static)
- Light & dark themes (light is default, both functional)
- Document Generation across 29 document types, in 6 categories.
- Five distinct AI workflows (not one generic prompt): Requirement Gathering, Completeness, Generation, Review, Improvement.
- Industry Modes that adapt language / terminology.
- Document Pipeline (BRD → FRD → User Stories → Test Cases, etc.)
- Document Reviewer (upload PDF/DOCX/MD/TXT → AI critique).
- Company Templates (upload + reuse + apply to exports).
- Header/Footer Settings (company name, logo URL, project, doc ID, version, author, reviewer, approver).
- Library: search, filter (category/type/industry), sort, duplicate, delete, regenerate.
- Versioning: parent_id + version_number (1.0 → 1.1 → 2.0).
- Exports: PDF (jsPDF, client-side) & DOCX (python-docx server-side) with header/footer applied.
- AI-powered inline section improvement.
- Tracked in MongoDB collections: `documents`, `conversations`, `reviews`, `templates`, `settings`.
- All endpoints `/api/*`; no auth.

## What's implemented (2026-02)
**Backend** (/app/backend):
- `doc_types.py` — 29 document types + 6 categories + 10 industries + pipeline graph.
- `ai_engine.py` — 5 separate AI workflows on Claude Sonnet 4.5 (claude-sonnet-4-5-20250929) via Emergent Universal Key.
- `exports.py` — DOCX builder (python-docx) with markdown rendering, header/footer/page numbers; PDF and DOCX text extraction.
- `server.py` — full REST API:
  - Catalog/Stats: GET /api/catalog, GET /api/stats.
  - Generation: POST /api/generate, POST /api/completeness.
  - Pipeline: POST /api/pipeline/generate.
  - Documents: GET/PATCH/DELETE /api/documents/{id}; GET /api/documents (filters & sort); POST /api/documents/{id}/duplicate.
  - Versions: GET/POST /api/documents/{id}/versions.
  - Improve: POST /api/documents/{id}/improve.
  - Interview: POST /api/interview/start, /api/interview/{id}/message, GET /api/interview/{id}, POST /api/interview/{id}/generate.
  - Reviewer: POST /api/review/upload (PDF/DOCX/TXT/MD), GET/DELETE /api/reviews/{id}.
  - Templates: POST/GET/DELETE /api/templates.
  - Settings: GET/PUT /api/settings.
  - Export: GET /api/export/docx/{id}?template_id=...
- Persistence in MongoDB (all collections).
- Soft-delete on documents.

**Frontend** (/app/frontend/src):
- `lib/catalog.jsx` — CatalogProvider context for the doc-type registry from backend.
- `lib/api.js` — typed API client for every endpoint.
- `lib/pdf.js` — jsPDF-based PDF exporter (selectable, non-canvas).
- `lib/markdown.js` — small markdown→HTML renderer.
- Pages: Dashboard, Generator (Quick Form + AI Interview modes + industry selector), DocumentPage,
  History (with search/filter/sort/duplicate/regenerate), Reviewer, Templates, Settings.
- Components: Layout (sidebar with collapsible categories), ModuleCard, DocumentViewer (PDF/DOCX/Edit/Regenerate/Versions/Pipeline/Improve), QualityScore, InterviewPanel, GeneratingState.
- Theme: light/dark; design language preserved (neo-brutalist cards, Outfit/DM Sans).

## Backlog / Next Tasks (Prioritized)
- P0  · Refresh Emergent LLM key budget (currently exceeded — blocking AI calls).
- P1  · Async job pattern for long generations (poll job_id) to bypass 100s ingress timeout on slow LLM responses.
- P1  · Logo upload & embed (currently only logo URL is stored).
- P1  · Multi-user auth (Google or JWT) when team usage is needed.
- P2  · Real-time collaborative editing.
- P2  · PDF/DOCX page-break tuning + cover page.
- P2  · _next_version edge case for non-1.x parents.
- P2  · Sharable read-only links for documents.
- P2  · Tag system + favourites.
