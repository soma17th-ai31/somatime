"""Participant PIN re-entry endpoint (v3 — Q7).

POST /api/meetings/{slug}/participants/login
- Body: {nickname, pin (4 digits)}
- Plaintext PIN comparison (Q7 — MVP simplification, README warns).
- 401 invalid_pin on mismatch
- 409 pin_not_set if the participant exists but has no PIN
- 404 meeting_not_found if the slug is bogus
- On success: re-issues HttpOnly cookie + returns participant info.
"""
from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy.orm import Session

from app.core.dependencies import get_current_meeting, get_db, set_participant_cookie
from app.db.models import Meeting, Participant
from app.schemas.participant import ParticipantLogin

logger = logging.getLogger("somameet.auth")

router = APIRouter(prefix="/api", tags=["auth"])


@router.post(
    "/meetings/{slug}/participants/login",
    status_code=status.HTTP_200_OK,
)
def login_with_pin(
    payload: ParticipantLogin,
    response: Response,
    meeting: Meeting = Depends(get_current_meeting),
    db: Session = Depends(get_db),
) -> dict:
    nickname = payload.nickname.strip()

    participant = (
        db.query(Participant)
        .filter(
            Participant.meeting_id == meeting.id,
            Participant.nickname == nickname,
        )
        .first()
    )
    if participant is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={
                "error_code": "invalid_pin",
                "message": "PIN이 일치하지 않습니다.",
                "suggestion": "닉네임 또는 PIN을 다시 확인해주세요.",
            },
        )

    if participant.pin is None or participant.pin == "":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "error_code": "pin_not_set",
                "message": "이 닉네임에는 PIN이 설정되어 있지 않습니다.",
                "suggestion": "다른 닉네임으로 새로 등록해주세요.",
            },
        )

    if participant.pin != payload.pin:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={
                "error_code": "invalid_pin",
                "message": "PIN이 일치하지 않습니다.",
                "suggestion": "PIN을 다시 확인해주세요.",
            },
        )

    set_participant_cookie(response, meeting.slug, participant.token)
    return {
        "id": participant.id,
        "participant_id": participant.id,
        "nickname": participant.nickname,
    }
