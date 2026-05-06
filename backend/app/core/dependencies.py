"""FastAPI dependency providers (v3).

- get_db: SQLAlchemy session.
- get_current_meeting: load Meeting by slug (404 -> meeting_not_found).
- get_participant: read somameet_pt_{slug} cookie (403 -> participant_required).
- count_submitted: helper for the calculate/recommend gate (Q2).
- set_participant_cookie: writes the cookie per spec §6.2.

v3.2 (Path B): require_organizer / X-Organizer-Token verification deleted.
Anyone with the slug (= share URL) is allowed to invoke any meeting action.
"""
from __future__ import annotations

from typing import Optional

from fastapi import Depends, HTTPException, Path, Request, Response, status
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.db.models import Meeting, Participant
from app.db.session import get_db as _get_db


COOKIE_MAX_AGE_SECONDS = 7 * 24 * 60 * 60  # 7 days, per spec §6.2


def get_db():
    """Re-export for routers."""
    yield from _get_db()


def cookie_name_for(slug: str) -> str:
    return f"somameet_pt_{slug}"


def set_participant_cookie(response: Response, slug: str, token: str) -> None:
    """Write the per-meeting participant cookie per spec §6.2.

    HttpOnly + SameSite=Lax + Path=/ + Max-Age=604800. Secure read from env.
    """
    settings = get_settings()
    response.set_cookie(
        key=cookie_name_for(slug),
        value=token,
        httponly=True,
        samesite=settings.COOKIE_SAMESITE,
        secure=settings.COOKIE_SECURE,
        path="/",
        max_age=COOKIE_MAX_AGE_SECONDS,
    )


def get_current_meeting(
    slug: str = Path(..., min_length=1, max_length=64),
    db: Session = Depends(get_db),
) -> Meeting:
    meeting = db.query(Meeting).filter(Meeting.slug == slug).first()
    if meeting is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={
                "error_code": "meeting_not_found",
                "message": f"회의를 찾을 수 없습니다.",
                "suggestion": "URL을 다시 확인해주세요.",
            },
        )
    return meeting


def get_participant(
    request: Request,
    slug: str = Path(..., min_length=1, max_length=64),
    db: Session = Depends(get_db),
) -> Participant:
    """Resolve the calling participant via the slug-scoped cookie."""
    cookie_value = request.cookies.get(cookie_name_for(slug))
    if not cookie_value:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={
                "error_code": "participant_required",
                "message": "본인 인증이 필요합니다.",
                "suggestion": "닉네임을 다시 등록해주세요.",
            },
        )
    meeting = db.query(Meeting).filter(Meeting.slug == slug).first()
    if meeting is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={
                "error_code": "meeting_not_found",
                "message": "회의를 찾을 수 없습니다.",
                "suggestion": "URL을 다시 확인해주세요.",
            },
        )
    participant = (
        db.query(Participant)
        .filter(
            Participant.token == cookie_value,
            Participant.meeting_id == meeting.id,
        )
        .first()
    )
    if participant is None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={
                "error_code": "participant_required",
                "message": "본인 인증이 필요합니다.",
                "suggestion": "닉네임을 다시 등록해주세요.",
            },
        )
    return participant


def get_optional_participant(
    request: Request,
    slug: str,
    db: Session,
) -> Optional[Participant]:
    """Like get_participant but returns None on missing/invalid cookie instead of 403.
    Use in endpoints (e.g. GET /meetings/{slug}) that should respond to anonymous
    callers but enrich the response when a participant cookie is present.
    """
    cookie_value = request.cookies.get(cookie_name_for(slug))
    if not cookie_value:
        return None
    meeting = db.query(Meeting).filter(Meeting.slug == slug).first()
    if meeting is None:
        return None
    return (
        db.query(Participant)
        .filter(
            Participant.token == cookie_value,
            Participant.meeting_id == meeting.id,
        )
        .first()
    )


def count_submitted(db: Session, meeting_id: int) -> int:
    """Count participants whose confirmed_at is not null (Q2)."""
    n = (
        db.query(func.count(Participant.id))
        .filter(
            Participant.meeting_id == meeting_id,
            Participant.confirmed_at.is_not(None),
        )
        .scalar()
    )
    return int(n or 0)


def list_submitted_nicknames(db: Session, meeting_id: int) -> list[str]:
    """Nicknames of participants who have submitted availability, in submission order."""
    rows = (
        db.query(Participant.nickname)
        .filter(
            Participant.meeting_id == meeting_id,
            Participant.confirmed_at.is_not(None),
        )
        .order_by(Participant.confirmed_at.asc())
        .all()
    )
    return [row[0] for row in rows]


def list_required_nicknames(db: Session, meeting_id: int) -> list[str]:
    """v3.11 — nicknames of participants who self-marked is_required=True."""
    rows = (
        db.query(Participant.nickname)
        .filter(
            Participant.meeting_id == meeting_id,
            Participant.is_required.is_(True),
        )
        .order_by(Participant.created_at.asc())
        .all()
    )
    return [row[0] for row in rows]
