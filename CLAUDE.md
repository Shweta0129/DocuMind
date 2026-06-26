# CLAUDE.md — DocuMind AI (DocGen)

Context file for AI sessions. Keep this updated as the project evolves.

## What this is
**DocuMind AI** — an AI Documentation Copilot. Generates professional enterprise
documents (29 types across 6 categories: BRD, FRD, SRS, SOP, CAPA, Test Plans, HR
policies, Project Charter, etc.) from a form or an AI interview. Originally
scaffolded on **Emergent**, now being hardened into a real product.

**Owner:** Shweta (email shwetapasi2901@gmail.com), India. Git author on commits:
SudhanshuSarkhel. Solo build; goal is a sellable multi-tenant SaaS, eventually
with per-company on-prem installs.

**Moat / positioning:** structured enterprise docs + document pipeline (BRD→FRD→
test cases) + **private per-company data**. Biggest enterprise gap still open:
approval/sign-off *workflow* + audit trail (sign-off table exists, no routing).

## Architecture
| Layer | Tech |
|-------|------|
| Frontend | React 19, CRA + **craco**, Tailwind, shadcn/ui, react-router 7, axios, sonner, framer-motion, **mermaid** |
| Backend | **FastAPI** (async) + **Motor/MongoDB**, Python **3.10** |
| Auth | Email/password + Google (JWT bearer). Every user ∈ one **organization** (tenant) |
| LLM | Provider-agnostic (`backend/llm_client.py`) — any OpenAI-compatible key (Grok/Groq/OpenAI), Gemini, or Anthropic. Currently **Groq** (llama-3.3-70b-versatile) |

**Multi-tenant rule (critical):** every DB query is scoped by `org_id` via
`org_scope()` / `doc_scope()` helpers in `server.py`. Companies never see each
other's data. Verified. Don't add a data route without this scoping.

## Key files
- `backend/server.py` — all REST routes (`/api/*`), org scoping, export, indexes.
- `backend/auth.py` — register/login/google/forgot/reset, JWT, `get_current_user`,
  seeds per-org Settings from signup (company_name + author).
- `backend/llm_client.py` — `send_message(system,user)`; provider via `LLM_PROVIDER`
  (auto-detected from whichever key is set). Switch to Claude = env change only.
- `backend/ai_engine.py` — 5 workflows (requirement_gathering, completeness,
  generate_document, review, improve). Prompts are **table-first + Mermaid-when-
  useful + use-all-inputs**. JSON parsed with `strict=False` (Llama emits literal
  newlines). `generate_document(..., template_structure=...)` for template-driven.
- `backend/doc_types.py` — 29 doc types: fields, sections, guidance.
- `backend/exports.py` — DOCX builder: header/footer, **Document Control + sign-off
  tables**, markdown→Word (tables tolerate rows without outer pipes), embeds
  data-URI images (user images + client-rendered diagrams) + logo in header.
- `backend/security.py` — upload limits, SSRF URL check (allows `data:image/`),
  in-memory rate limiter.
- `frontend/src/lib/api.js` — axios client, token interceptor, all endpoints.
  DOCX export is **POST** `/export/docx/{id}` with client-rendered diagram images.
- `frontend/src/lib/auth.jsx` — AuthProvider/useAuth. `App.js` — routes (public:
  login/register/forgot/reset; protected behind `ProtectedLayout`).
- `frontend/src/lib/markdown.js` — markdown→HTML (tables, mermaid `<div class=mermaid>`, images).
- `frontend/src/lib/pdf.js` — jsPDF export: tables, images, **rendered Mermaid**,
  logo, Document Control. ASCII glyphs only (jsPDF can't encode •/·/—).
- `frontend/src/lib/diagrams.js` — renders ```mermaid → PNG data-URI for DOCX export.
- `frontend/src/components/DocumentViewer.jsx` — renders doc, Mermaid (mermaid.run),
  Document Control panel + logo, insert-image (edit mode), PDF/DOCX export.

## Running locally (Windows, PowerShell)
Backend (terminal 1):
```
cd C:\Users\Shwetaa\Desktop\DocGen\backend
.\.venv\Scripts\python.exe -m uvicorn server:app --host 127.0.0.1 --port 8000
```
Frontend (terminal 2):
```
cd C:\Users\Shwetaa\Desktop\DocGen\frontend
npm start
```
Open http://localhost:3000 → Create account. Health: http://localhost:8000/health.

## Environment / secrets
- Secrets live ONLY in `backend/.env` and `frontend/.env` (gitignored). Examples in
  `.env.example`. Never commit real keys.
- Backend env: `MONGO_URL`, `DB_NAME=documind`, `CORS_ORIGINS`, `JWT_SECRET`,
  `LLM_PROVIDER`/`OPENAI_API_KEY`/`OPENAI_BASE_URL`/`OPENAI_MODEL` (Groq now),
  `GOOGLE_CLIENT_ID` (optional), `APP_BASE_URL`, `RESEND_API_KEY`+`MAIL_FROM`
  (password reset; if unset the reset link is logged to console), `MAX_UPLOAD_BYTES`.
- Frontend env: `REACT_APP_BACKEND_URL=http://localhost:8000`, `REACT_APP_GOOGLE_CLIENT_ID`.
- DB is **MongoDB Atlas** (cluster docugen, DB `documind`). User must keep the
  current IP in Atlas → Network Access allow-list, else TLS handshake fails
  (`TLSV1_ALERT_INTERNAL_ERROR`).

## Gotchas / conventions
- **Python 3.10** venv at `backend/.venv` (3.14 is also installed but lacks some
  wheels — use 3.10). Use `.\.venv\Scripts\python.exe -m ...`.
- The Bash tool's working directory can drift; prefer **absolute paths**.
- On Windows + asyncio scripts, set `WindowsSelectorEventLoopPolicy` to avoid noisy
  "Event loop is closed" teardown errors.
- Frontend install needs `frontend/.npmrc` (`legacy-peer-deps=true`) and a pinned
  `ajv@^8` (CRA/ajv-keywords conflict). `CI=false` for builds (warnings ≠ errors).
- Files are LF; git warns about CRLF — harmless.
- No AI **image** generation, ever — diagrams are Mermaid (code → rendered),
  images are user-uploaded only. (User requirement.)

## Done so far (committed)
Auth + multi-tenant isolation; provider-agnostic LLM; security hardening
(uploads/SSRF/CORS/rate-limit/generic errors/**security headers**); table-first
concise generation; Mermaid diagrams in viewer + PDF + DOCX; user image upload;
Document Control + sign-off + header/footer; logo upload/embed; template-driven
generation; forgot-password (Resend); removed ALL Emergent branding + PostHog
tracking; auto-fill company branding from signup. **Subscription/billing layer**
(`plans.py` config-driven + `billing.py` Razorpay): 7-day-OR-3-doc trial, gating
(402) on all AI/export routes, usage metering, checkout + signature verify,
Pricing page. **Deploy configs**: `backend/Dockerfile`, `render.yaml`,
`frontend/vercel.json`, `DEPLOYMENT.md`. Verified end-to-end (Atlas + Groq) +
billing gating tested in-process.

## Billing / subscription
- `backend/plans.py` — PLANS dict (free/starter_weekly/pro_monthly/pro_yearly/
  enterprise), `entitlement(org)`, `new_trial_subscription()`. Trial = 7 days OR
  3 docs. Prices in paise INR.
- `backend/billing.py` — `/api/billing/{plans,subscription,checkout,verify,webhook}`,
  `require_generation_access` dep (used as `GenAccess` in server.py), `record_generation`.
- Org doc has `subscription:{plan,status,trial_started_at,trial_docs_used,
  current_period_end,razorpay_*}`. Seeded on signup; backfilled on startup.
- Frontend `pages/Pricing.jsx` loads Razorpay checkout.js; api 402 → /pricing.

## Decisions locked
- DB: **MongoDB** (Atlas free tier). Multi-tenant by org_id; on-prem = single org.
- Auth: email/password + Google. Forgot-password email via **Resend**.
- LLM: provider-agnostic, Groq now, switchable to Anthropic/OpenAI/Gemini later.
- Pricing: **Razorpay**; **7-day OR 3-document** free trial → Weekly/Monthly/Yearly
  + Enterprise custom. Proposed prices (unconfirmed): ₹199 / ₹599 / ₹4,999.
- Deploy target: **Vercel** (frontend) + **Render/Railway** (backend) + Atlas.

## Open / next (in order)
1. **Deploy the first cut** — configs ready (`DEPLOYMENT.md`); needs user to push
   to a PRIVATE GitHub repo + create Render/Vercel projects + set env vars + Atlas
   `0.0.0.0/0`. Then prod smoke test (incl. a Razorpay test payment).
2. **Auth hardening (post-launch P1):** refresh tokens + access-token expiry,
   email verification, change-password, logout-all. (Currently 7-day JWT, no revoke.)
3. **Project visibility model (P2):** Private/Team/Org/Public (currently org-scoped only).
4. **Dark mode** polish — verify contrast (user said added; confirm).
5. Razorpay **auto-recurring** (Subscriptions API) — first cut is one-time Orders per period.
6. Later/enterprise: approval workflow + audit trail, integrations, collaboration, privacy policy.

## Pre-launch reminders
- Rotate the Groq key + Atlas password (were shared in chat).
- Set real `CORS_ORIGINS`, strong Atlas password, lock Atlas Network Access.

## Plan file
Latest planning notes: `~/.claude/plans/okay-so-i-have-quiet-dragon.md`.
