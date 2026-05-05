"""Google Calendar free/busy adapter.

We use OAuth 2.0 with the freebusy-only scope. The OAuth state encodes
(meeting_slug, participant_token) so the callback can attribute results to
the correct participant without leaking other context.

Privacy invariant: we request ONLY the freebusy scope, and we record only
(start, end) pairs. We never request calendar.readonly or calendar.events.

Network calls use httpx; tests should monkeypatch httpx or the convenience
functions below to avoid hitting Google.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
from dataclasses import dataclass
from datetime import datetime
from typing import List, Optional, Tuple
from urllib.parse import urlencode

import httpx

DEFAULT_SCOPE = "https://www.googleapis.com/auth/calendar.freebusy"
GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
GOOGLE_FREEBUSY_URL = "https://www.googleapis.com/calendar/v3/freeBusy"


class GoogleOAuthError(Exception):
    pass


class GoogleConfigError(Exception):
    pass


@dataclass(frozen=True)
class OAuthConfig:
    client_id: str
    client_secret: str
    redirect_uri: str
    scopes: Tuple[str, ...]
    session_secret: str

    @classmethod
    def from_env(cls) -> "OAuthConfig":
        client_id = os.environ.get("GOOGLE_CLIENT_ID", "")
        client_secret = os.environ.get("GOOGLE_CLIENT_SECRET", "")
        redirect_uri = os.environ.get(
            "GOOGLE_REDIRECT_URI", "http://localhost:8000/api/auth/google/callback"
        )
        scopes_env = os.environ.get("GOOGLE_OAUTH_SCOPES", DEFAULT_SCOPE)
        scopes = tuple(s for s in (scopes_env.split() if " " in scopes_env else [scopes_env]) if s)
        session_secret = os.environ.get("SESSION_SECRET", "")
        if not client_id or not client_secret:
            raise GoogleConfigError("Google OAuth client id/secret not configured")
        if not session_secret:
            raise GoogleConfigError("SESSION_SECRET not configured")
        return cls(
            client_id=client_id,
            client_secret=client_secret,
            redirect_uri=redirect_uri,
            scopes=scopes,
            session_secret=session_secret,
        )


# --------------------------------------------------------------------------- state token


def encode_state(meeting_slug: str, participant_token: str, secret: str) -> str:
    payload = json.dumps(
        {"slug": meeting_slug, "pt": participant_token},
        separators=(",", ":"),
    ).encode("utf-8")
    sig = hmac.new(secret.encode("utf-8"), payload, hashlib.sha256).digest()
    return _b64url(payload) + "." + _b64url(sig)


def decode_state(state: str, secret: str) -> Tuple[str, str]:
    try:
        payload_b64, sig_b64 = state.split(".", 1)
    except ValueError as exc:
        raise GoogleOAuthError("invalid_state_format") from exc
    payload = _b64url_decode(payload_b64)
    sig = _b64url_decode(sig_b64)
    expected = hmac.new(secret.encode("utf-8"), payload, hashlib.sha256).digest()
    if not hmac.compare_digest(sig, expected):
        raise GoogleOAuthError("invalid_state_signature")
    try:
        data = json.loads(payload.decode("utf-8"))
    except Exception as exc:
        raise GoogleOAuthError("invalid_state_payload") from exc
    return data["slug"], data["pt"]


def _b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def _b64url_decode(data: str) -> bytes:
    pad = "=" * (-len(data) % 4)
    return base64.urlsafe_b64decode(data + pad)


# --------------------------------------------------------------------------- public API


def build_oauth_url(
    *, meeting_slug: str, participant_token: str, config: Optional[OAuthConfig] = None
) -> str:
    cfg = config or OAuthConfig.from_env()
    state = encode_state(meeting_slug, participant_token, cfg.session_secret)
    params = {
        "client_id": cfg.client_id,
        "redirect_uri": cfg.redirect_uri,
        "response_type": "code",
        "scope": " ".join(cfg.scopes),
        "access_type": "offline",
        "include_granted_scopes": "true",
        "prompt": "consent",
        "state": state,
    }
    return f"{GOOGLE_AUTH_URL}?{urlencode(params)}"


def exchange_code(code: str, *, config: Optional[OAuthConfig] = None) -> dict:
    cfg = config or OAuthConfig.from_env()
    data = {
        "code": code,
        "client_id": cfg.client_id,
        "client_secret": cfg.client_secret,
        "redirect_uri": cfg.redirect_uri,
        "grant_type": "authorization_code",
    }
    with httpx.Client(timeout=10.0) as client:
        resp = client.post(GOOGLE_TOKEN_URL, data=data)
    if resp.status_code != 200:
        raise GoogleOAuthError(f"token_exchange_failed status={resp.status_code}")
    return resp.json()


def fetch_freebusy(
    access_token: str,
    *,
    time_min: datetime,
    time_max: datetime,
    calendar_id: str = "primary",
) -> List[Tuple[datetime, datetime]]:
    """Call freeBusy.query and return list of (start, end) pairs.

    Returned datetimes are RFC 3339 strings parsed back to aware datetimes.
    Caller is responsible for KST normalization.
    """
    body = {
        "timeMin": time_min.isoformat(),
        "timeMax": time_max.isoformat(),
        "items": [{"id": calendar_id}],
    }
    headers = {"Authorization": f"Bearer {access_token}"}
    with httpx.Client(timeout=10.0) as client:
        resp = client.post(GOOGLE_FREEBUSY_URL, json=body, headers=headers)
    if resp.status_code != 200:
        raise GoogleOAuthError(f"freebusy_failed status={resp.status_code}")
    data = resp.json()
    cal = data.get("calendars", {}).get(calendar_id, {})
    busy = cal.get("busy", [])
    out: List[Tuple[datetime, datetime]] = []
    for entry in busy:
        start = datetime.fromisoformat(entry["start"].replace("Z", "+00:00"))
        end = datetime.fromisoformat(entry["end"].replace("Z", "+00:00"))
        out.append((start, end))
    return out
