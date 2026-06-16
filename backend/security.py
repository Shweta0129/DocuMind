"""Security helpers: upload validation, URL (SSRF) validation, rate limiting.

Kept dependency-free (stdlib only) so it works on a single instance with no
extra services. For multi-instance production, swap the in-memory rate limiter
for a Redis-backed one.
"""
from __future__ import annotations

import os
import time
import ipaddress
from collections import defaultdict, deque
from urllib.parse import urlparse

from fastapi import HTTPException, Request, UploadFile

# --------------------------------------------------------------------------- #
# Upload validation
# --------------------------------------------------------------------------- #
MAX_UPLOAD_BYTES = int(os.environ.get("MAX_UPLOAD_BYTES", str(10 * 1024 * 1024)))  # 10 MB
ALLOWED_DOC_EXT = {".pdf", ".docx", ".txt", ".md"}


def check_extension(filename: str | None) -> str:
    """Return the lowercased extension if allowed, else 400. Never trust path."""
    base = os.path.basename(filename or "")
    ext = os.path.splitext(base.lower())[1]
    if ext not in ALLOWED_DOC_EXT:
        raise HTTPException(
            status_code=400,
            detail="Only PDF, DOCX, TXT, and MD files are supported",
        )
    return ext


async def read_upload(file: UploadFile, max_bytes: int = MAX_UPLOAD_BYTES) -> bytes:
    """Read an UploadFile in chunks, rejecting anything over the size cap."""
    chunks: list[bytes] = []
    total = 0
    while True:
        chunk = await file.read(1024 * 1024)
        if not chunk:
            break
        total += len(chunk)
        if total > max_bytes:
            raise HTTPException(
                status_code=413,
                detail=f"File too large (max {max_bytes // (1024 * 1024)} MB)",
            )
        chunks.append(chunk)
    data = b"".join(chunks)
    if not data:
        raise HTTPException(status_code=400, detail="Empty file")
    return data


# --------------------------------------------------------------------------- #
# URL / SSRF validation (for stored logo URLs and any future server-side fetch)
# --------------------------------------------------------------------------- #
def validate_public_url(url: str | None) -> str:
    """Allow only http(s) URLs that do not point at private/loopback hosts."""
    if not url:
        return ""
    url = url.strip()
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https"):
        raise HTTPException(status_code=400, detail="Logo URL must be http(s)")
    host = (parsed.hostname or "").lower()
    if not host:
        raise HTTPException(status_code=400, detail="Invalid logo URL")
    if host == "localhost" or host.endswith(".local") or host.endswith(".internal"):
        raise HTTPException(status_code=400, detail="Logo URL host is not allowed")
    try:
        ip = ipaddress.ip_address(host)
        if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved:
            raise HTTPException(status_code=400, detail="Logo URL host is not allowed")
    except ValueError:
        pass  # hostname, not a raw IP — acceptable
    return url


# --------------------------------------------------------------------------- #
# In-memory rate limiting (per-IP, per-named-bucket, sliding window)
# --------------------------------------------------------------------------- #
_buckets: dict[str, dict[str, deque]] = defaultdict(lambda: defaultdict(deque))


def _client_ip(request: Request) -> str:
    # Honor a single proxy hop if present; otherwise the socket peer.
    fwd = request.headers.get("x-forwarded-for")
    if fwd:
        return fwd.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


def rate_limit(name: str, max_calls: int, window_seconds: int):
    """Return a FastAPI dependency enforcing max_calls per window per client IP."""
    bucket = _buckets[name]

    async def dependency(request: Request) -> None:
        ip = _client_ip(request)
        dq = bucket[ip]
        now = time.time()
        cutoff = now - window_seconds
        while dq and dq[0] <= cutoff:
            dq.popleft()
        if len(dq) >= max_calls:
            raise HTTPException(
                status_code=429,
                detail="Too many requests — please slow down and try again shortly.",
            )
        dq.append(now)

    return dependency
