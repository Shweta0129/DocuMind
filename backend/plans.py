"""Subscription plan catalog + entitlement logic for DocuMind AI.

Config-driven: plans, limits, and feature flags live here, not scattered through
routes. Prices are in paise (INR). ``doc_limit=None`` means unlimited.

Entitlement model (first cut):
  * New org starts on the FREE trial: 7 days OR 3 generated documents, whichever
    comes first.
  * A paid plan grants unlimited generation until ``current_period_end``.
  * After trial/period expiry, generation + export are gated (HTTP 402).

Auto-recurring billing (Razorpay Subscriptions) is a future enhancement; the
first cut uses one-time Orders per period with manual renewal.
"""
from __future__ import annotations

from datetime import datetime, timezone, timedelta
from typing import Any, Dict, Optional

TRIAL_DAYS = 7
TRIAL_DOC_LIMIT = 3

# Feature flags are intentionally generous now; tighten per plan later.
_BASE_FEATURES = {
    "generate": True,
    "export_docx": True,
    "export_pdf": True,
    "templates": True,
    "reviewer": True,
}

PLANS: Dict[str, Dict[str, Any]] = {
    "free": {
        "id": "free", "name": "Free Trial", "price_paise": 0, "currency": "INR",
        "interval_days": TRIAL_DAYS, "doc_limit": TRIAL_DOC_LIMIT, "checkout": False,
        "blurb": "7 days or 3 documents — try everything, no card needed.",
        "features": _BASE_FEATURES,
    },
    "starter_weekly": {
        "id": "starter_weekly", "name": "Starter", "price_paise": 19900, "currency": "INR",
        "interval_days": 7, "doc_limit": None, "checkout": True, "period_label": "week",
        "blurb": "For quick bursts of work. Unlimited documents for a week.",
        "features": _BASE_FEATURES,
    },
    "pro_monthly": {
        "id": "pro_monthly", "name": "Professional (Monthly)", "price_paise": 59900, "currency": "INR",
        "interval_days": 30, "doc_limit": None, "checkout": True, "period_label": "month",
        "blurb": "For regular use. Unlimited documents, all features.",
        "features": _BASE_FEATURES,
    },
    "pro_yearly": {
        "id": "pro_yearly", "name": "Professional (Yearly)", "price_paise": 499900, "currency": "INR",
        "interval_days": 365, "doc_limit": None, "checkout": True, "period_label": "year",
        "blurb": "Best value — two months free vs monthly.",
        "features": _BASE_FEATURES,
    },
    "enterprise": {
        "id": "enterprise", "name": "Enterprise", "price_paise": None, "currency": "INR",
        "interval_days": None, "doc_limit": None, "checkout": False, "contact": True,
        "blurb": "On-prem install, your-own-LLM, SSO, custom templates, support.",
        "features": _BASE_FEATURES,
    },
}

PUBLIC_PLAN_ORDER = ["free", "starter_weekly", "pro_monthly", "pro_yearly", "enterprise"]


def get_plan(plan_id: str) -> Optional[Dict[str, Any]]:
    return PLANS.get(plan_id)


def public_plans() -> list:
    return [PLANS[p] for p in PUBLIC_PLAN_ORDER if p in PLANS]


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _parse(dt: Any) -> Optional[datetime]:
    if not dt:
        return None
    if isinstance(dt, datetime):
        return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
    try:
        d = datetime.fromisoformat(str(dt).replace("Z", "+00:00"))
        return d if d.tzinfo else d.replace(tzinfo=timezone.utc)
    except Exception:
        return None


def new_trial_subscription() -> Dict[str, Any]:
    """Initial subscription state stamped onto a new organization."""
    return {
        "plan": "free",
        "status": "trialing",
        "trial_started_at": _now().isoformat(),
        "trial_docs_used": 0,
        "current_period_end": None,
        "razorpay_order_id": None,
        "razorpay_payment_id": None,
        "updated_at": _now().isoformat(),
    }


def entitlement(org: Dict[str, Any]) -> Dict[str, Any]:
    """Compute whether the org may generate/export right now, with context."""
    sub = (org or {}).get("subscription") or {}
    now = _now()

    period_end = _parse(sub.get("current_period_end"))
    if sub.get("status") == "active" and period_end and period_end > now:
        return {
            "allowed": True, "reason": "active", "plan": sub.get("plan"),
            "current_period_end": sub.get("current_period_end"),
        }

    trial_start = _parse(sub.get("trial_started_at"))
    docs_used = int(sub.get("trial_docs_used", 0))
    if trial_start:
        elapsed = now - trial_start
        days_left = TRIAL_DAYS - elapsed.days
        docs_left = TRIAL_DOC_LIMIT - docs_used
        if days_left > 0 and docs_left > 0:
            return {
                "allowed": True, "reason": "trial", "plan": "free",
                "trial_days_left": days_left, "trial_docs_left": docs_left,
            }

    return {
        "allowed": False,
        "reason": "expired",
        "plan": sub.get("plan", "free"),
        "message": "Your free trial has ended. Choose a plan to keep generating documents.",
    }


def period_end_for(plan_id: str) -> Optional[str]:
    plan = get_plan(plan_id)
    if not plan or not plan.get("interval_days"):
        return None
    return (_now() + timedelta(days=plan["interval_days"])).isoformat()
