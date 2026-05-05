"""FastAPI dependency providers.

- get_db: SQLAlchemy session dependency (re-export from app.db.session).
- get_current_meeting: load Meeting by slug (404 if missing).
- require_organizer: validate X-Organizer-Token header against meeting.organizer_token.
- get_participant: read somameet_pt_{slug} cookie and resolve Participant.

Authentication failures consistently map to HTTPException(403) so the global
error handler renders {error_code, message, suggestion}.
"""
from __future__ import annotations

from typing import Optional

from fastapi import Depends, Header, HTTPException, Path, Request, status
from sqlalchemy.orm import Session

from app.db.models import Meeting, Participant
from app.db.session import get_db as _get_db


def get_db():
    """Re-export for routers."""
    yield from _get_db()


def cookie_name_for(slug: str) -> str:
    return f"somameet_pt_{slug}"


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
                "message": f"회의를 찾을 수 없습니다: {slug}",
                "suggestion": "URL을 다시 확인해주세요.",
            },
        )
    return meeting


def require_organizer(
    x_organizer_token: Optional[str] = Header(default=None, alias="X-Organizer-Token"),
    meeting: Meeting = Depends(get_current_meeting),
) -> Meeting:
    if not x_organizer_token or x_organizer_token != meeting.organizer_token:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={
                "error_code": "organizer_token_invalid",
                "message": "주최자 권한이 필요합니다.",
                "suggestion": "주최자 전용 링크에서 다시 시도해주세요.",
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
                "error_code": "participant_cookie_missing",
                "message": "참여자 인증 쿠키가 없습니다.",
                "suggestion": "닉네임을 다시 등록해주세요.",
            },
        )
    meeting = db.query(Meeting).filter(Meeting.slug == slug).first()
    if meeting is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={
                "error_code": "meeting_not_found",
                "message": f"회의를 찾을 수 없습니다: {slug}",
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
                "error_code": "participant_token_invalid",
                "message": "참여자 인증에 실패했습니다.",
                "suggestion": "닉네임을 다시 등록해주세요.",
            },
        )
    return participant
