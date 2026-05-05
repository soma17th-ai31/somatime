"""Google OAuth endpoints.

GET /api/meetings/{slug}/availability/google/oauth-url
    - Auth: participant cookie
    - 200: {url} when keys configured
    - 503: {error_code: google_oauth_disabled} otherwise

GET /api/auth/google/callback
    - Validates HMAC-signed state, exchanges code for token, fetches free/busy
      for the meeting's date range, replaces participant busy_blocks.
    - On success: redirect to APP_BASE_URL/m/{slug}?google=connected
    - On failure: redirect to APP_BASE_URL/m/{slug}?google=error&error_code=...
"""
from __future__ import annotations

import logging
from datetime import datetime, time, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import RedirectResponse
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.dependencies import get_current_meeting, get_db, get_participant
from app.db.models import Meeting, Participant
from app.services.availability import replace_busy_blocks_for_participant
from app.services.google_freebusy import (
    DEFAULT_SCOPE,
    GoogleConfigError,
    GoogleOAuthError,
    OAuthConfig,
    build_oauth_url,
    decode_state,
    exchange_code,
    fetch_freebusy,
)
from app.services.timezones import KST, now_kst_naive, to_kst_naive

logger = logging.getLogger("somameet.oauth")

router = APIRouter(prefix="/api", tags=["oauth"])


def _build_oauth_config() -> OAuthConfig:
    settings = get_settings()
    if not settings.google_oauth_configured:
        raise GoogleConfigError("Google OAuth client id/secret not configured")
    return OAuthConfig(
        client_id=settings.GOOGLE_CLIENT_ID,
        client_secret=settings.GOOGLE_CLIENT_SECRET,
        redirect_uri=settings.GOOGLE_REDIRECT_URI,
        scopes=tuple(settings.google_oauth_scope_list or [DEFAULT_SCOPE]),
        session_secret=settings.SESSION_SECRET,
    )


@router.get("/meetings/{slug}/availability/google/oauth-url")
def google_oauth_url(
    meeting: Meeting = Depends(get_current_meeting),
    participant: Participant = Depends(get_participant),
) -> dict:
    try:
        config = _build_oauth_config()
    except GoogleConfigError:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={
                "error_code": "google_oauth_disabled",
                "message": "Google OAuth가 구성되지 않았습니다.",
                "suggestion": "관리자에게 GOOGLE_CLIENT_ID/SECRET 설정을 요청하세요.",
            },
        )
    url = build_oauth_url(
        meeting_slug=meeting.slug,
        participant_token=participant.token,
        config=config,
    )
    return {"url": url}


@router.get("/auth/google/callback")
def google_callback(
    code: Optional[str] = None,
    state: Optional[str] = None,
    error: Optional[str] = None,
    db: Session = Depends(get_db),
):
    settings = get_settings()
    base_url = settings.APP_BASE_URL.rstrip("/")

    if error:
        return _error_redirect(base_url, slug=None, error_code=f"google_{error}")
    if not code or not state:
        return _error_redirect(base_url, slug=None, error_code="missing_code_or_state")

    try:
        slug, participant_token = decode_state(state, settings.SESSION_SECRET)
    except GoogleOAuthError as exc:
        logger.warning("invalid OAuth state: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={
                "error_code": "invalid_state",
                "message": "OAuth state 검증에 실패했습니다.",
                "suggestion": "처음부터 다시 시도해주세요.",
            },
        )

    meeting = db.query(Meeting).filter(Meeting.slug == slug).first()
    if meeting is None:
        return _error_redirect(base_url, slug=slug, error_code="meeting_not_found")

    participant = (
        db.query(Participant)
        .filter(
            Participant.token == participant_token,
            Participant.meeting_id == meeting.id,
        )
        .first()
    )
    if participant is None:
        return _error_redirect(base_url, slug=slug, error_code="participant_not_found")

    try:
        config = _build_oauth_config()
        token_resp = exchange_code(code, config=config)
        access_token = token_resp.get("access_token")
        if not access_token:
            raise GoogleOAuthError("missing_access_token")

        time_min = datetime.combine(meeting.date_range_start, time(0, 0)).replace(
            tzinfo=KST
        )
        time_max = (
            datetime.combine(meeting.date_range_end, time(0, 0)) + timedelta(days=1)
        ).replace(tzinfo=KST)
        busy_blocks = fetch_freebusy(
            access_token, time_min=time_min, time_max=time_max
        )
    except (GoogleConfigError, GoogleOAuthError) as exc:
        logger.warning("Google freebusy failed: %s", exc)
        return _error_redirect(base_url, slug=slug, error_code="google_api_failed")
    except Exception as exc:
        logger.exception("unexpected google callback failure: %s", exc)
        return _error_redirect(base_url, slug=slug, error_code="google_api_failed")

    kst_blocks = [(to_kst_naive(s), to_kst_naive(e)) for s, e in busy_blocks]
    replace_busy_blocks_for_participant(db, participant.id, kst_blocks)
    participant.source_type = "google"
    participant.confirmed_at = now_kst_naive()
    db.add(participant)
    db.commit()

    return RedirectResponse(
        url=f"{base_url}/m/{slug}?google=connected",
        status_code=status.HTTP_302_FOUND,
    )


def _error_redirect(base_url: str, *, slug: Optional[str], error_code: str) -> RedirectResponse:
    target = base_url
    if slug:
        target = f"{base_url}/m/{slug}"
    return RedirectResponse(
        url=f"{target}?google=error&error_code={error_code}",
        status_code=status.HTTP_302_FOUND,
    )
