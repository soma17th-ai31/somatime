"""Participant register endpoint (v3 — PIN optional).

POST /api/meetings/{slug}/participants
- Body: {nickname: str, pin?: str (4 digits)}
- Sets HttpOnly cookie somameet_pt_{slug}=token.
- Returns participant_id + nickname (cookie carries the token).

v3 behaviors:
- nickname uniqueness within a meeting -> 409 nickname_conflict on conflict
  with an existing CONFIRMED participant. We tolerate re-register before
  the first availability submission for ergonomics (refreshes cookie).
- PIN, if provided, is stored in plaintext (Q7). README will warn.
"""
from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy.orm import Session

from app.core.dependencies import (
    get_current_meeting,
    get_db,
    get_participant,
    set_participant_cookie,
)
from app.db.models import Meeting, Participant
from app.schemas.participant import ParticipantCreate, ParticipantNicknameUpdate
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
                "error_code": "validation_error",
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
        # v3.7: register doubles as login. If the existing participant has
        # already submitted, allow re-entry only when the supplied PIN matches.
        if existing.confirmed_at is not None:
            if existing.pin is None:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail={
                        "error_code": "nickname_conflict",
                        "message": "이미 사용 중인 닉네임입니다.",
                        "suggestion": "다른 닉네임을 입력해주세요.",
                    },
                )
            if payload.pin is None:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail={
                        "error_code": "nickname_conflict",
                        "message": "이미 사용 중인 닉네임입니다.",
                        "suggestion": "PIN을 함께 입력하면 재진입할 수 있습니다.",
                    },
                )
            if existing.pin != payload.pin:
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail={
                        "error_code": "invalid_pin",
                        "message": "PIN이 일치하지 않습니다.",
                        "suggestion": "PIN을 다시 확인해주세요.",
                    },
                )
            # PIN matches → re-issue cookie (login). Don't mutate PIN.
            # buffer-on-join: the register form always sends a fresh buffer
            # choice, so apply it here as well (the user just picked it).
            token = existing.token
            participant_id = existing.id
            existing.buffer_minutes = payload.buffer_minutes
            db.add(existing)
            db.commit()
        else:
            # Pre-submit re-register: refresh cookie + update PIN /
            # is_required when explicitly provided. buffer-on-join: also
            # update buffer_minutes to the freshly-chosen value.
            token = existing.token
            participant_id = existing.id
            if payload.pin is not None:
                existing.pin = payload.pin
            if payload.is_required is not None:
                existing.is_required = bool(payload.is_required)
            existing.buffer_minutes = payload.buffer_minutes
            db.add(existing)
            db.commit()
    else:
        token = generate_participant_token()
        participant = Participant(
            meeting_id=meeting.id,
            nickname=nickname,
            token=token,
            pin=payload.pin,
            source_type=None,
            confirmed_at=None,
            created_at=now_kst_naive(),
            is_required=bool(payload.is_required) if payload.is_required is not None else False,
            buffer_minutes=payload.buffer_minutes,
        )
        db.add(participant)
        db.commit()
        db.refresh(participant)
        participant_id = participant.id

    set_participant_cookie(response, meeting.slug, token)

    return {
        "id": participant_id,
        "participant_id": participant_id,
        "nickname": nickname,
        "token": token,
        "buffer_minutes": payload.buffer_minutes,
    }


@router.patch("/meetings/{slug}/participants/me")
def update_self(
    payload: ParticipantNicknameUpdate,
    meeting: Meeting = Depends(get_current_meeting),
    me: Participant = Depends(get_participant),
    db: Session = Depends(get_db),
) -> dict:
    """Update calling participant's nickname (and optionally PIN). v3.5 — cookie-authed."""
    new_nickname = payload.nickname.strip()
    if not new_nickname:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={
                "error_code": "validation_error",
                "message": "닉네임이 비어 있습니다.",
                "suggestion": "1자 이상 50자 이하로 입력해주세요.",
            },
        )

    # Nickname uniqueness check (skip if unchanged).
    if new_nickname != me.nickname:
        conflict = (
            db.query(Participant)
            .filter(
                Participant.meeting_id == meeting.id,
                Participant.nickname == new_nickname,
                Participant.id != me.id,
            )
            .first()
        )
        if conflict is not None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail={
                    "error_code": "nickname_conflict",
                    "message": "이미 사용 중인 닉네임입니다.",
                    "suggestion": "다른 닉네임을 입력해주세요.",
                },
            )
        me.nickname = new_nickname

    # PIN update — only if the field was explicitly provided in the request body.
    data = payload.model_dump(exclude_unset=True)
    if "pin" in data:
        raw = data["pin"]
        if raw is None or raw == "":
            me.pin = None  # explicit clear
        else:
            me.pin = raw  # already format-validated by the schema

    # v3.11 — is_required toggle (only if explicitly provided).
    if "is_required" in data and data["is_required"] is not None:
        me.is_required = bool(data["is_required"])

    # Issue #13 — personal buffer override.
    #   field absent → leave existing buffer_minutes unchanged.
    #   explicit null → reset to "inherit the meeting default".
    #   0/30/60/90/120 → store the explicit value.
    # Note: allowed even after the meeting is confirmed, mirroring the
    # nickname/pin/is_required policy. Confirmed slots are already pinned
    # so the value has no scheduling impact at that point.
    if "buffer_minutes" in data:
        me.buffer_minutes = data["buffer_minutes"]

    db.add(me)
    db.commit()
    db.refresh(me)
    return {
        "id": me.id,
        "nickname": me.nickname,
        "has_pin": me.pin is not None,
        "is_required": bool(me.is_required),
        "buffer_minutes": me.buffer_minutes,
    }
