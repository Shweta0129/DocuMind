"""Billing & subscription routes for DocuMind AI (Razorpay).

- Plans/limits come from plans.py (config-driven).
- Checkout uses Razorpay Orders; activation is verified by HMAC signature.
- ``require_generation_access`` gates generation/export; ``record_generation``
  meters trial usage.

Call ``init(db)`` once at startup.
"""
from __future__ import annotations

import os
import hmac
import hashlib
import logging
from datetime import datetime, timezone
from typing import Any, Dict

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, ConfigDict

import plans
from auth import get_current_user

log = logging.getLogger("documind.billing")
router = APIRouter(prefix="/billing", tags=["billing"])

_db = None


def init(db) -> None:
    global _db
    _db = db


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _keys():
    kid = os.environ.get("RAZORPAY_KEY_ID")
    sec = os.environ.get("RAZORPAY_KEY_SECRET")
    if not kid or not sec:
        raise HTTPException(status_code=503, detail="Billing is not configured.")
    return kid, sec


async def _org(user: Dict[str, Any]) -> Dict[str, Any]:
    return await _db.organizations.find_one({"id": user["org_id"]}, {"_id": 0}) or {}


# --------------------------------------------------------------------------- #
# Gating + usage (imported by server.py)
# --------------------------------------------------------------------------- #
async def require_generation_access(user: Dict[str, Any] = Depends(get_current_user)) -> Dict[str, Any]:
    """Dependency for generation/export routes: 402 if trial/subscription lapsed."""
    ent = plans.entitlement(await _org(user))
    if not ent.get("allowed"):
        raise HTTPException(status_code=402, detail=ent.get("message", "Subscription required."))
    return user


async def record_generation(org_id: str) -> None:
    """Increment trial document usage (only counts while trialing)."""
    try:
        await _db.organizations.update_one(
            {"id": org_id, "subscription.status": "trialing"},
            {"$inc": {"subscription.trial_docs_used": 1}, "$set": {"subscription.updated_at": _now_iso()}},
        )
    except Exception:
        log.exception("record_generation failed for org %s", org_id)


# --------------------------------------------------------------------------- #
# Models
# --------------------------------------------------------------------------- #
class CheckoutBody(BaseModel):
    model_config = ConfigDict(extra="ignore")
    plan_id: str


class VerifyBody(BaseModel):
    model_config = ConfigDict(extra="ignore")
    razorpay_order_id: str
    razorpay_payment_id: str
    razorpay_signature: str
    plan_id: str


# --------------------------------------------------------------------------- #
# Endpoints
# --------------------------------------------------------------------------- #
@router.get("/plans")
async def list_plans(user: Dict[str, Any] = Depends(get_current_user)):
    return {"plans": plans.public_plans(), "key_id": os.environ.get("RAZORPAY_KEY_ID", "")}


@router.get("/subscription")
async def my_subscription(user: Dict[str, Any] = Depends(get_current_user)):
    org = await _org(user)
    sub = org.get("subscription") or plans.new_trial_subscription()
    return {"subscription": sub, "entitlement": plans.entitlement(org)}


@router.post("/checkout")
async def checkout(body: CheckoutBody, user: Dict[str, Any] = Depends(get_current_user)):
    plan = plans.get_plan(body.plan_id)
    if not plan or not plan.get("checkout"):
        raise HTTPException(status_code=400, detail="That plan is not purchasable here.")
    kid, sec = _keys()
    try:
        async with httpx.AsyncClient(timeout=20, auth=(kid, sec)) as c:
            r = await c.post(
                "https://api.razorpay.com/v1/orders",
                json={
                    "amount": plan["price_paise"], "currency": plan["currency"],
                    "receipt": f"{user['org_id'][:18]}-{plan['id']}",
                    "notes": {"org_id": user["org_id"], "plan_id": plan["id"]},
                },
            )
    except Exception:
        log.exception("razorpay order request failed")
        raise HTTPException(status_code=502, detail="Could not reach the payment provider.")
    if r.status_code >= 300:
        log.error("razorpay order error %s: %s", r.status_code, r.text[:300])
        raise HTTPException(status_code=502, detail="Could not start checkout.")
    order = r.json()
    return {
        "order_id": order["id"], "amount": plan["price_paise"], "currency": plan["currency"],
        "key_id": kid, "plan": {"id": plan["id"], "name": plan["name"]},
    }


@router.post("/verify")
async def verify(body: VerifyBody, user: Dict[str, Any] = Depends(get_current_user)):
    plan = plans.get_plan(body.plan_id)
    if not plan:
        raise HTTPException(status_code=400, detail="Unknown plan.")
    _, sec = _keys()
    expected = hmac.new(
        sec.encode(), f"{body.razorpay_order_id}|{body.razorpay_payment_id}".encode(), hashlib.sha256
    ).hexdigest()
    if not hmac.compare_digest(expected, body.razorpay_signature):
        raise HTTPException(status_code=400, detail="Payment verification failed.")
    await _db.organizations.update_one(
        {"id": user["org_id"]},
        {"$set": {
            "subscription.plan": plan["id"],
            "subscription.status": "active",
            "subscription.current_period_end": plans.period_end_for(plan["id"]),
            "subscription.razorpay_order_id": body.razorpay_order_id,
            "subscription.razorpay_payment_id": body.razorpay_payment_id,
            "subscription.updated_at": _now_iso(),
        }},
    )
    org = await _org(user)
    return {"status": "active", "subscription": org.get("subscription"), "entitlement": plans.entitlement(org)}


@router.post("/webhook")
async def webhook(request: Request):
    """Optional hardening: verify Razorpay webhook signature and log events."""
    secret = os.environ.get("RAZORPAY_WEBHOOK_SECRET")
    raw = await request.body()
    if secret:
        sig = request.headers.get("X-Razorpay-Signature", "")
        expected = hmac.new(secret.encode(), raw, hashlib.sha256).hexdigest()
        if not hmac.compare_digest(expected, sig):
            raise HTTPException(status_code=400, detail="Invalid webhook signature.")
    # Activation happens in /verify; webhook is for reconciliation/logging for now.
    return {"received": True}
