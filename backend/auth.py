"""Authentication & organization (tenant) management for DocuMind AI.

- Email/password signup & login (passwords hashed with bcrypt).
- Google Sign-In (verifies the Google ID token).
- JWT bearer tokens carrying the user id + org id.
- Every user belongs to exactly one organization (tenant). Registration creates
  a new organization; the registrant becomes its admin. Data isolation between
  organizations is enforced in server.py by always scoping queries to org_id.

Call ``init(db)`` once at startup to give this module its Motor database handle.
"""
from __future__ import annotations

import os
import uuid
import logging
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, Optional

import bcrypt
import jwt
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel, EmailStr, Field, ConfigDict

from security import rate_limit

log = logging.getLogger("documind.auth")

router = APIRouter(prefix="/auth", tags=["auth"])
_bearer = HTTPBearer(auto_error=False)

_db = None  # set via init()


def init(db) -> None:
    global _db
    _db = db


# --------------------------------------------------------------------------- #
# Config
# --------------------------------------------------------------------------- #
JWT_ALGO = "HS256"
JWT_EXPIRE_HOURS = int(os.environ.get("JWT_EXPIRE_HOURS", "168"))  # 7 days


def _jwt_secret() -> str:
    secret = os.environ.get("JWT_SECRET")
    if not secret or len(secret) < 16:
        raise HTTPException(
            status_code=500,
            detail="Server auth is misconfigured (JWT_SECRET missing or too short).",
        )
    return secret


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _now_iso() -> str:
    return _now().isoformat()


# --------------------------------------------------------------------------- #
# Password hashing (bcrypt, 72-byte safe)
# --------------------------------------------------------------------------- #
def hash_password(password: str) -> str:
    pw = password.encode("utf-8")[:72]
    return bcrypt.hashpw(pw, bcrypt.gensalt()).decode("utf-8")


def verify_password(password: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode("utf-8")[:72], hashed.encode("utf-8"))
    except (ValueError, TypeError):
        return False


# --------------------------------------------------------------------------- #
# JWT
# --------------------------------------------------------------------------- #
def create_access_token(user: Dict[str, Any]) -> str:
    payload = {
        "sub": user["id"],
        "org_id": user["org_id"],
        "email": user["email"],
        "exp": _now() + timedelta(hours=JWT_EXPIRE_HOURS),
        "iat": _now(),
    }
    return jwt.encode(payload, _jwt_secret(), algorithm=JWT_ALGO)


def decode_token(token: str) -> Dict[str, Any]:
    return jwt.decode(token, _jwt_secret(), algorithms=[JWT_ALGO])


def create_reset_token(user: Dict[str, Any]) -> str:
    payload = {"sub": user["id"], "typ": "reset",
               "exp": _now() + timedelta(hours=1), "iat": _now()}
    return jwt.encode(payload, _jwt_secret(), algorithm=JWT_ALGO)


def decode_reset_token(token: str) -> Dict[str, Any]:
    p = jwt.decode(token, _jwt_secret(), algorithms=[JWT_ALGO])
    if p.get("typ") != "reset":
        raise jwt.InvalidTokenError("not a reset token")
    return p


async def _send_reset_email(email: str, link: str) -> None:
    """Email the reset link via Resend. If no key is set, log it (dev fallback)."""
    key = os.environ.get("RESEND_API_KEY")
    if not key:
        log.warning("RESEND_API_KEY not set — password reset link for %s: %s", email, link)
        return
    sender = os.environ.get("MAIL_FROM", "DocuMind AI <onboarding@resend.dev>")
    html = (
        "<p>You requested a password reset for DocuMind AI.</p>"
        f'<p><a href="{link}">Click here to reset your password</a></p>'
        "<p>This link expires in 1 hour. If you didn't request it, ignore this email.</p>"
    )
    try:
        import httpx
        async with httpx.AsyncClient(timeout=15) as c:
            await c.post(
                "https://api.resend.com/emails",
                headers={"Authorization": f"Bearer {key}"},
                json={"from": sender, "to": [email],
                      "subject": "Reset your DocuMind AI password", "html": html},
            )
    except Exception as e:  # never fail the request because email failed
        log.warning("Failed to send reset email to %s: %s", email, e)


# --------------------------------------------------------------------------- #
# Google ID token verification
# --------------------------------------------------------------------------- #
def verify_google_token(credential: str) -> Dict[str, Any]:
    client_id = os.environ.get("GOOGLE_CLIENT_ID")
    if not client_id:
        raise HTTPException(status_code=500, detail="Google sign-in is not configured.")
    try:
        from google.oauth2 import id_token as google_id_token
        from google.auth.transport import requests as google_requests

        info = google_id_token.verify_oauth2_token(
            credential, google_requests.Request(), client_id
        )
        return info
    except HTTPException:
        raise
    except Exception as e:
        log.warning("Google token verification failed: %s", e)
        raise HTTPException(status_code=401, detail="Invalid Google credential")


# --------------------------------------------------------------------------- #
# Data helpers
# --------------------------------------------------------------------------- #
def _public_user(user: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "id": user["id"],
        "email": user["email"],
        "name": user.get("name", ""),
        "org_id": user["org_id"],
        "role": user.get("role", "member"),
        "auth_provider": user.get("auth_provider", "password"),
    }


async def _create_org(name: str, owner_user_id: str) -> Dict[str, Any]:
    org = {
        "id": str(uuid.uuid4()),
        "name": name.strip() or "My Workspace",
        "owner_user_id": owner_user_id,
        "created_at": _now_iso(),
    }
    await _db.organizations.insert_one(org)
    org.pop("_id", None)
    return org


async def _create_user(
    email: str,
    name: str,
    org_id: str,
    *,
    password_hash: Optional[str] = None,
    auth_provider: str = "password",
    google_sub: Optional[str] = None,
    role: str = "admin",
) -> Dict[str, Any]:
    user = {
        "id": str(uuid.uuid4()),
        "email": email.lower().strip(),
        "name": name.strip(),
        "org_id": org_id,
        "password_hash": password_hash,
        "auth_provider": auth_provider,
        "google_sub": google_sub,
        "role": role,
        "created_at": _now_iso(),
    }
    await _db.users.insert_one(user)
    user.pop("_id", None)
    return user


async def _register_org_and_user(
    email: str, name: str, company_name: str, **user_kwargs
) -> Dict[str, Any]:
    """Create a fresh organization plus its first (admin) user atomically-ish."""
    user_id = str(uuid.uuid4())
    org = await _create_org(company_name or f"{name or email}'s Workspace", user_id)
    user = {
        "id": user_id,
        "email": email.lower().strip(),
        "name": name.strip(),
        "org_id": org["id"],
        "role": "admin",
        "created_at": _now_iso(),
        **user_kwargs,
    }
    user.setdefault("password_hash", None)
    user.setdefault("auth_provider", "password")
    user.setdefault("google_sub", None)
    await _db.users.insert_one(user)
    user.pop("_id", None)

    # Seed per-org settings from signup so branding appears in documents without
    # the user re-typing it. They can change any of this later in Branding & Settings.
    await _db.settings.update_one(
        {"org_id": org["id"]},
        {"$setOnInsert": {
            "org_id": org["id"],
            "company_name": org["name"],
            "company_logo_url": "",
            "project_name": "",
            "document_id": "",
            "version_number": "",
            "author": (name or "").strip(),
            "reviewer": "",
            "approver": "",
            "page_layout": "letter",
        }},
        upsert=True,
    )
    return user


# --------------------------------------------------------------------------- #
# Dependency
# --------------------------------------------------------------------------- #
async def get_current_user(
    creds: Optional[HTTPAuthorizationCredentials] = Depends(_bearer),
) -> Dict[str, Any]:
    if creds is None or not creds.credentials:
        raise HTTPException(status_code=401, detail="Not authenticated")
    try:
        payload = decode_token(creds.credentials)
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Session expired, please log in again")
    except jwt.PyJWTError:
        raise HTTPException(status_code=401, detail="Invalid authentication token")

    user = await _db.users.find_one({"id": payload.get("sub")}, {"_id": 0})
    if not user:
        raise HTTPException(status_code=401, detail="User no longer exists")
    return user


# --------------------------------------------------------------------------- #
# Request / response models
# --------------------------------------------------------------------------- #
class RegisterBody(BaseModel):
    model_config = ConfigDict(extra="ignore")
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    name: str = Field(default="", max_length=120)
    company_name: str = Field(default="", max_length=120)


class LoginBody(BaseModel):
    model_config = ConfigDict(extra="ignore")
    email: EmailStr
    password: str = Field(min_length=1, max_length=128)


class GoogleBody(BaseModel):
    model_config = ConfigDict(extra="ignore")
    credential: str
    company_name: str = Field(default="", max_length=120)


class ForgotBody(BaseModel):
    model_config = ConfigDict(extra="ignore")
    email: EmailStr


class ResetBody(BaseModel):
    model_config = ConfigDict(extra="ignore")
    token: str
    password: str = Field(min_length=8, max_length=128)


async def _auth_response(user: Dict[str, Any]) -> Dict[str, Any]:
    org = await _db.organizations.find_one({"id": user["org_id"]}, {"_id": 0})
    return {
        "access_token": create_access_token(user),
        "token_type": "bearer",
        "user": _public_user(user),
        "organization": org or {"id": user["org_id"], "name": ""},
    }


# --------------------------------------------------------------------------- #
# Endpoints
# --------------------------------------------------------------------------- #
@router.post("/register", dependencies=[Depends(rate_limit("auth", 10, 60))])
async def register(body: RegisterBody):
    email = body.email.lower().strip()
    if await _db.users.find_one({"email": email}):
        raise HTTPException(status_code=409, detail="An account with this email already exists")
    user = await _register_org_and_user(
        email=email,
        name=body.name,
        company_name=body.company_name,
        password_hash=hash_password(body.password),
        auth_provider="password",
    )
    return await _auth_response(user)


@router.post("/login", dependencies=[Depends(rate_limit("auth", 10, 60))])
async def login(body: LoginBody):
    email = body.email.lower().strip()
    user = await _db.users.find_one({"email": email})
    if not user or not user.get("password_hash") or not verify_password(body.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    return await _auth_response(user)


@router.post("/google", dependencies=[Depends(rate_limit("auth", 10, 60))])
async def google_login(body: GoogleBody):
    info = verify_google_token(body.credential)
    google_sub = info.get("sub")
    email = (info.get("email") or "").lower().strip()
    name = info.get("name") or info.get("given_name") or email.split("@")[0]
    if not email:
        raise HTTPException(status_code=401, detail="Google account has no email")

    user = await _db.users.find_one({"$or": [{"google_sub": google_sub}, {"email": email}]})
    if user:
        # Link google_sub on first Google login for an existing email account.
        if not user.get("google_sub"):
            await _db.users.update_one(
                {"id": user["id"]},
                {"$set": {"google_sub": google_sub, "auth_provider": "google"}},
            )
        return await _auth_response(user)

    user = await _register_org_and_user(
        email=email,
        name=name,
        company_name=body.company_name,
        auth_provider="google",
        google_sub=google_sub,
    )
    return await _auth_response(user)


@router.post("/forgot-password", dependencies=[Depends(rate_limit("auth", 10, 60))])
async def forgot_password(body: ForgotBody):
    email = body.email.lower().strip()
    user = await _db.users.find_one({"email": email})
    if user and user.get("password_hash"):
        base = os.environ.get("APP_BASE_URL", "http://localhost:3000").rstrip("/")
        link = f"{base}/reset-password?token={create_reset_token(user)}"
        await _send_reset_email(email, link)
    # Always generic, so we never reveal whether an account exists.
    return {"message": "If an account with that email exists, a reset link has been sent."}


@router.post("/reset-password", dependencies=[Depends(rate_limit("auth", 10, 60))])
async def reset_password(body: ResetBody):
    try:
        p = decode_reset_token(body.token)
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=400, detail="This reset link has expired. Please request a new one.")
    except jwt.PyJWTError:
        raise HTTPException(status_code=400, detail="Invalid or already-used reset link.")
    res = await _db.users.update_one(
        {"id": p.get("sub")}, {"$set": {"password_hash": hash_password(body.password)}}
    )
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Account not found.")
    return {"message": "Password updated. You can now sign in."}


@router.get("/me")
async def me(user: Dict[str, Any] = Depends(get_current_user)):
    org = await _db.organizations.find_one({"id": user["org_id"]}, {"_id": 0})
    return {"user": _public_user(user), "organization": org or {"id": user["org_id"], "name": ""}}
