"""Participant register endpoint.

POST /api/meetings/{slug}/participants
- Body: {nickname: str}
- Effects: creates (or refreshes) the Participant for this meeting,
  sets HttpOnly cookie somameet_pt_{slug}=token, returns the token in body.
- Idempotency: same nickname inside the same meeting returns the existing
  participant (so a user can re-register on a new device and get the cookie
  back). The token in that case is the original token.
"""
from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy.orm import Session

from app.core.dependencies import cookie_name_for, get_current_meeting, get_db
from app.db.models import Meeting, Participant
from app.schemas.participant import ParticipantCreate
from app.services.timezones import now_kst_naive
from app.services.tokens import generate_participant_token

logger = logging.getLogger("somameet.participants")

router = APIRouter(prefix="/api", tags=["participants"])


@router.post("/meetings/{slug}/participants", status_code=status.HTTP_201_CREATED)
def register_participant(
    payload: ParticipantCreate,
    response: Response,
    meeting: Meeting = Depends(get_current_meeting),
    db: Session = Depends(get_db),
) -> dict:
    nickname = payload.nickname.strip()
    if not nickname:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={
                "error_code": "nickname_invalid",
                "message": "닉네임이 비어 있습니다.",
                "suggestion": "1자 이상 50자 이하로 입력해주세요.",
            },
        )

    existing = (
        db.query(Participant)
        .filter(
            Participant.meeting_id == meeting.id,
            Participant.nickname == nickname,
        )
        .first()
    )
    if existing is not None:
        token = existing.token
        participant_id = existing.id
    else:
        token = generate_participant_token()
        participant = Participant(
            meeting_id=meeting.id,
            nickname=nickname,
            token=token,
            source_type=None,
            confirmed_at=None,
            created_at=now_kst_naive(),
        )
        db.add(participant)
        db.commit()
        db.refresh(participant)
        participant_id = participant.id

    response.set_cookie(
        key=cookie_name_for(meeting.slug),
        value=token,
        httponly=True,
        samesite="lax",
        secure=False,
        path="/",
    )

    return {
        "id": participant_id,
        "nickname": nickname,
        "token": token,
    }
