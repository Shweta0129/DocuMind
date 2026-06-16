# DocuMind AI

An AI Documentation Copilot for enterprise teams. Generate, review, version, and
export professional business documents — BRDs, FRDs, SRS, SOPs, CAPA/RCA, test
plans, HR policies and more (29 document types across 6 categories) — with
conversational requirement-gathering, completeness scoring, document pipelines,
AI review of uploaded files, branded DOCX/PDF export, and per-company data
isolation.

## Architecture

| Layer | Tech |
|-------|------|
| Frontend | React 19 (CRA + Craco), Tailwind, shadcn/ui, React Router 7 |
| Backend | FastAPI (async), MongoDB via Motor |
| Auth | Email/password (JWT) + Google Sign-In; every user belongs to one organization (tenant) |
| LLM | Provider-agnostic (`backend/llm_client.py`): Google Gemini (free tier) now, Anthropic Claude later via one env var |

**Multi-tenant:** every request is authenticated and every data query is scoped
to the caller's `org_id`, so one company never sees another company's data.

## Prerequisites

- Python **3.10–3.12** (3.10 recommended; some deps lack 3.14 wheels)
- Node 18+ and npm
- MongoDB — either local (mongodb://localhost:27017) or a MongoDB Atlas free cluster
- A free Gemini API key: https://aistudio.google.com/apikey
- (Optional) Google OAuth Web client id for Google Sign-In

## Setup

### 1. Backend

```bash
cd backend
py -3.10 -m venv .venv
.venv\Scripts\activate          # Windows
pip install -r requirements.txt
copy .env.example .env          # then edit .env
```

Fill `backend/.env`:
- `MONGO_URL`, `DB_NAME`
- `JWT_SECRET` — generate: `python -c "import secrets; print(secrets.token_urlsafe(48))"`
- `LLM_PROVIDER=gemini` and `GEMINI_API_KEY=...`
- (optional) `GOOGLE_CLIENT_ID=...`

Run:

```bash
uvicorn server:app --reload --port 8000
```

Health check: http://localhost:8000/health

### 2. Frontend

```bash
cd frontend
npm install
copy .env.example .env          # set REACT_APP_BACKEND_URL=http://localhost:8000
npm start
```

Open http://localhost:3000 — register a workspace, then generate a document.

## Switching to Claude later

When your Anthropic key is ready, in `backend/.env`:

```
LLM_PROVIDER=anthropic
ANTHROPIC_API_KEY=sk-ant-...
ANTHROPIC_MODEL=claude-sonnet-4-6
```

No code changes required.

## Tests

```bash
cd backend
.venv\Scripts\activate
set REACT_APP_BACKEND_URL=http://localhost:8000
pytest tests/
```

## Security notes

- Secrets live only in `.env` (gitignored); never commit real keys.
- Uploads are size- and type-limited; logo URLs are validated against SSRF.
- CORS is restricted to `CORS_ORIGINS`; auth uses bearer tokens (no cookies).
- Rate limiting protects auth and AI endpoints (in-memory; use Redis for multi-instance).
