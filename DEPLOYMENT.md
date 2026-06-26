# Deploying DocuMind AI (free tier, private code)

Stack: **Frontend → Vercel**, **Backend → Render**, **DB → MongoDB Atlas**.
All three have free tiers and deploy from **private** GitHub repos, so your source
is never public.

> Note: browsers always download the (minified) frontend JS to run the app — that
> is unavoidable for any web app. Your **repository stays private** and the
> **backend source is never exposed**. Secrets live only in dashboard env vars.

## 0. Push to a PRIVATE GitHub repo
```
git remote add origin git@github.com:<you>/documind.git   # create it as PRIVATE
git push -u origin master
```
`.env` files are gitignored — confirm `git ls-files | grep .env` returns nothing.

## 1. MongoDB Atlas
- Use your existing `documind` cluster.
- **Network Access → Add `0.0.0.0/0`** (Render's egress IPs aren't static on free tier).
- Copy the SRV connection string for `MONGO_URL`.

## 2. Backend → Render
1. Render → **New → Blueprint** → connect the private repo. It reads `render.yaml`.
   (Or **New → Web Service**, root dir `backend`, build `pip install -r requirements.txt`,
   start `uvicorn server:app --host 0.0.0.0 --port $PORT`.)
2. Set env vars (Dashboard → Environment) — the `sync:false` ones:
   - `MONGO_URL` = Atlas SRV string
   - `JWT_SECRET` = `python -c "import secrets;print(secrets.token_urlsafe(48))"`
   - `OPENAI_API_KEY` = your Groq key  (LLM_PROVIDER/BASE_URL/MODEL preset in render.yaml)
   - `CORS_ORIGINS` = `https://<your-app>.vercel.app`
   - `APP_BASE_URL` = `https://<your-app>.vercel.app`
   - `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET` (live keys for production)
   - optional: `GOOGLE_CLIENT_ID`, `RESEND_API_KEY`, `RAZORPAY_WEBHOOK_SECRET`
3. Deploy. Health check: `https://<service>.onrender.com/health` → `{"database":true}`.
   (Free services sleep when idle; first request after idle is slow — expected.)

## 3. Frontend → Vercel
1. Vercel → **Add New → Project** → import the private repo.
2. **Root Directory = `frontend`**. Framework preset: Create React App. (`.npmrc`
   already sets `legacy-peer-deps`; `vercel.json` handles SPA routing.)
3. Environment Variables:
   - `REACT_APP_BACKEND_URL` = `https://<service>.onrender.com`
   - `REACT_APP_GOOGLE_CLIENT_ID` = (optional, same as backend)
4. Deploy → you get `https://<your-app>.vercel.app`.

## 4. Wire the two together
- Put the Vercel URL into Render's `CORS_ORIGINS` and `APP_BASE_URL`, redeploy backend.
- (If using Google sign-in) add the Vercel URL to the Google OAuth client's
  "Authorized JavaScript origins".
- (Razorpay) switch to **Live** keys; add a webhook → `POST /api/billing/webhook`
  with `RAZORPAY_WEBHOOK_SECRET`.

## 5. Production smoke test
Register → generate (Groq) → export DOCX/PDF (diagram + logo present) → open
Pricing → run a test payment → confirm plan becomes active.

## Pre-launch checklist
- [ ] Rotate the Groq key + Atlas password that were shared during development
- [ ] `CORS_ORIGINS` = exact Vercel domain (no `*`)
- [ ] Strong `JWT_SECRET` in Render (not the dev value)
- [ ] Razorpay **live** keys + webhook secret
- [ ] Atlas backups enabled
