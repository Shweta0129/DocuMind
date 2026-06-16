"""Provider-agnostic LLM client for DocuMind AI.

The rest of the codebase only needs one capability: send a system prompt + a
user message and get back a string. This module hides which provider supplies
that capability so we are not locked to any single vendor.

Provider is chosen with the ``LLM_PROVIDER`` env var. If unset, it is inferred
from whichever API key is present.

  * ``openai``    – ANY OpenAI-compatible API. Works with OpenAI, xAI (Grok),
                    Groq, OpenRouter, Together, and most free gateways — you just
                    set the base URL + model. Keys: ``OPENAI_API_KEY``,
                    ``OPENAI_BASE_URL`` (default https://api.openai.com/v1),
                    ``OPENAI_MODEL``.
  * ``gemini``    – Google Gemini via ``google-generativeai`` (free tier).
                    Key: ``GEMINI_API_KEY`` (or ``GOOGLE_API_KEY``).
  * ``anthropic`` – Claude via the official ``anthropic`` SDK.
                    Key: ``ANTHROPIC_API_KEY``.

Examples (set OPENAI_BASE_URL + OPENAI_MODEL):
    Groq    : https://api.groq.com/openai/v1   model: llama-3.3-70b-versatile
    xAI Grok: https://api.x.ai/v1              model: grok-2-latest
    OpenRouter: https://openrouter.ai/api/v1   model: meta-llama/llama-3.3-70b-instruct:free
    OpenAI  : https://api.openai.com/v1        model: gpt-4o-mini

Switching providers is just an env change — no code edits.
"""
from __future__ import annotations

import os


class LLMConfigError(RuntimeError):
    """Raised when the selected provider is missing its key or SDK."""


def _provider() -> str:
    explicit = (os.environ.get("LLM_PROVIDER") or "").strip().lower()
    if explicit:
        return explicit
    # Infer from whichever key is present so "any key just works".
    if os.environ.get("OPENAI_API_KEY"):
        return "openai"
    if os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY"):
        return "gemini"
    if os.environ.get("ANTHROPIC_API_KEY"):
        return "anthropic"
    return "openai"


# --------------------------------------------------------------------------- #
# OpenAI-compatible (OpenAI, xAI/Grok, Groq, OpenRouter, Together, free gateways)
# --------------------------------------------------------------------------- #
def _openai_key() -> str:
    key = os.environ.get("OPENAI_API_KEY")
    if not key:
        raise LLMConfigError(
            "LLM_PROVIDER=openai but OPENAI_API_KEY is not set. "
            "Set OPENAI_API_KEY, OPENAI_BASE_URL and OPENAI_MODEL for your provider "
            "(OpenAI, Grok, Groq, OpenRouter, ...)."
        )
    return key


async def _openai_send(system: str, user: str) -> str:
    try:
        from openai import AsyncOpenAI
    except ImportError as e:  # pragma: no cover
        raise LLMConfigError("openai is not installed. Run: pip install openai") from e
    base_url = os.environ.get("OPENAI_BASE_URL", "https://api.openai.com/v1")
    model = os.environ.get("OPENAI_MODEL", "gpt-4o-mini")
    max_tokens = int(os.environ.get("OPENAI_MAX_TOKENS", "8000"))
    client = AsyncOpenAI(api_key=_openai_key(), base_url=base_url)
    resp = await client.chat.completions.create(
        model=model,
        max_tokens=max_tokens,
        messages=[
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
    )
    return (resp.choices[0].message.content or "").strip()


# --------------------------------------------------------------------------- #
# Gemini
# --------------------------------------------------------------------------- #
def _gemini_key() -> str:
    key = os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
    if not key:
        raise LLMConfigError(
            "LLM_PROVIDER=gemini but no GEMINI_API_KEY (or GOOGLE_API_KEY) is set. "
            "Get a free key at https://aistudio.google.com/apikey"
        )
    return key


async def _gemini_send(system: str, user: str) -> str:
    model_name = os.environ.get("GEMINI_MODEL", "gemini-2.0-flash")
    try:
        import google.generativeai as genai
    except ImportError as e:  # pragma: no cover
        raise LLMConfigError(
            "google-generativeai is not installed. Run: pip install google-generativeai"
        ) from e
    genai.configure(api_key=_gemini_key())
    # System instruction keeps the system prompt separate from user content,
    # which also helps resist prompt injection from document text.
    model = genai.GenerativeModel(model_name, system_instruction=system)
    resp = await model.generate_content_async(user)
    return (resp.text or "").strip()


# --------------------------------------------------------------------------- #
# Anthropic
# --------------------------------------------------------------------------- #
def _anthropic_key() -> str:
    key = os.environ.get("ANTHROPIC_API_KEY")
    if not key:
        raise LLMConfigError(
            "LLM_PROVIDER=anthropic but ANTHROPIC_API_KEY is not set."
        )
    return key


async def _anthropic_send(system: str, user: str) -> str:
    try:
        from anthropic import AsyncAnthropic
    except ImportError as e:  # pragma: no cover
        raise LLMConfigError(
            "anthropic is not installed. Run: pip install anthropic"
        ) from e
    model_name = os.environ.get("ANTHROPIC_MODEL", "claude-sonnet-4-6")
    max_tokens = int(os.environ.get("ANTHROPIC_MAX_TOKENS", "8000"))
    client = AsyncAnthropic(api_key=_anthropic_key())
    msg = await client.messages.create(
        model=model_name,
        max_tokens=max_tokens,
        system=system,
        messages=[{"role": "user", "content": user}],
    )
    parts = [b.text for b in msg.content if getattr(b, "type", None) == "text"]
    return "".join(parts).strip()


# --------------------------------------------------------------------------- #
# Public API
# --------------------------------------------------------------------------- #
async def send_message(system: str, user: str) -> str:
    """Send a system + user prompt to the configured provider; return text."""
    provider = _provider()
    if provider == "openai":
        return await _openai_send(system, user)
    if provider == "gemini":
        return await _gemini_send(system, user)
    if provider == "anthropic":
        return await _anthropic_send(system, user)
    raise LLMConfigError(
        f"Unknown LLM_PROVIDER '{provider}'. Use 'openai', 'gemini', or 'anthropic'."
    )


def active_provider_info() -> dict:
    """Lightweight, non-secret description of the active provider (for /health)."""
    provider = _provider()
    if provider == "openai":
        return {
            "provider": "openai-compatible",
            "model": os.environ.get("OPENAI_MODEL", "gpt-4o-mini"),
            "base_url": os.environ.get("OPENAI_BASE_URL", "https://api.openai.com/v1"),
        }
    if provider == "gemini":
        return {"provider": "gemini", "model": os.environ.get("GEMINI_MODEL", "gemini-2.0-flash")}
    if provider == "anthropic":
        return {"provider": "anthropic", "model": os.environ.get("ANTHROPIC_MODEL", "claude-sonnet-4-6")}
    return {"provider": provider, "model": "unknown"}
