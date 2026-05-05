"""Meeting CRUD + calculate + confirm endpoints.

Endpoints:
- POST /api/meetings           — create meeting (returns slug + organizer_token)
- GET  /api/meetings/{slug}    — public detail (no token)
- POST /api/meetings/{slug}/calculate — public, runs scheduler + LLM reasons
- POST /api/meetings/{slug}/confirm   — organizer-only, persists confirmed slot
"""
from __future__ import annotations

import logging
from datetime import timedelta
from typing import List, Tuple

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.dependencies import get_current_meeting, get_db, require_organizer
from app.db.models import BusyBlock, Meeting, Participant
from app.schemas import (
    CalculateResponse,
    Candidate,
    ConfirmRequest,
    ConfirmResponse,
    ConfirmedSlot,
    MeetingCreate,
    MeetingCreateResponse,
    MeetingDetail,
)
from app.services.llm import get_llm_adapter
from app.services.llm.base import Slot
from app.services.scheduler import calculate_candidates
from app.services.timezones import from_kst_naive, now_kst_naive, to_kst_naive
from app.services.tokens import generate_organizer_token, generate_slug

logger = logging.getLogger("somameet.meetings")

router = APIRouter(prefix="/api", tags=["meetings"])


@router.post(
    "/meetings",
    status_code=status.HTTP_201_CREATED,
    response_model=MeetingCreateResponse,
)
def create_meeting(
    payload: MeetingCreate,
    db: Session = Depends(get_db),
) -> MeetingCreateResponse:
    settings = get_settings()
    organizer_token = generate_organizer_token()
    last_error: Exception | None = None
    for _ in range(5):
        candidate_slug = generate_slug()
        meeting = Meeting(
            slug=candidate_slug,
            organizer_token=organizer_token,
            title=payload.title,
            date_range_start=payload.date_range_start,
            date_range_end=payload.date_range_end,
            duration_minutes=payload.duration_minutes,
            participant_count=payload.participant_count,
            location_type=payload.location_type.value,
            time_window_start=payload.time_window_start,
            time_window_end=payload.time_window_end,
            include_weekends=payload.include_weekends,
            created_at=now_kst_naive(),
        )
        try:
            db.add(meeting)
            db.commit()
            db.refresh(meeting)
            break
        except IntegrityError as exc:
            db.rollback()
            last_error = exc
    else:
        logger.error("slug collision retries exhausted: %s", last_error)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={
                "error_code": "slug_collision",
                "message": "회의 식별자 생성에 실패했습니다.",
                "suggestion": "잠시 후 다시 시도해주세요.",
            },
        )

    base_url = settings.APP_BASE_URL.rstrip("/")
    return MeetingCreateResponse(
        slug=meeting.slug,
        organizer_token=meeting.organizer_token,
        organizer_url=f"{base_url}/m/{meeting.slug}?org={meeting.organizer_token}",
        share_url=f"{base_url}/m/{meeting.slug}",
    )


@router.get("/meetings/{slug}", response_model=MeetingDetail)
def get_meeting(meeting: Meeting = Depends(get_current_meeting)) -> MeetingDetail:
    return MeetingDetail.model_validate(meeting)


@router.post("/meetings/{slug}/calculate", response_model=CalculateResponse)
def calculate(
    meeting: Meeting = Depends(get_current_meeting),
    db: Session = Depends(get_db),
) -> CalculateResponse:
    participants: List[Participant] = (
        db.query(Participant).filter(Participant.meeting_id == meeting.id).all()
    )
    busy_by_pid: dict[int, list[BusyBlock]] = {}
    for participant in participants:
        blocks = (
            db.query(BusyBlock)
            .filter(BusyBlock.participant_id == participant.id)
            .order_by(BusyBlock.start_at.asc())
            .all()
        )
        busy_by_pid[participant.id] = blocks

    candidates, suggestion = calculate_candidates(
        meeting=meeting,
        busy_blocks_by_participant=busy_by_pid,
        max_candidates=3,
        participants=participants,
    )

    if candidates:
        candidates = _attach_llm_reasons(candidates, meeting)

    # Convert naive KST datetimes to aware KST so JSON includes +09:00 offset.
    aware_candidates = [
        c.model_copy(
            update={
                "start": from_kst_naive(c.start),
                "end": from_kst_naive(c.end),
            }
        )
        for c in candidates
    ]
    return CalculateResponse(candidates=aware_candidates, suggestion=suggestion)


def _attach_llm_reasons(
    candidates: List[Candidate], meeting: Meeting
) -> List[Candidate]:
    """Replace each candidate's reason with the LLM-generated string.

    Falls back silently to deterministic reasons (already populated by the
    scheduler) on any failure.
    """
    try:
        adapter = get_llm_adapter()
        reasons = adapter.generate_recommendation_reasons(list(candidates), meeting)
    except Exception as exc:  # pragma: no cover - defensive
        logger.warning("LLM reason generation failed: %s", exc)
        return candidates

    if not isinstance(reasons, list) or len(reasons) != len(candidates):
        return candidates

    out: List[Candidate] = []
    for original, reason in zip(candidates, reasons):
        if isinstance(reason, str) and reason.strip():
            out.append(original.model_copy(update={"reason": reason}))
        else:
            out.append(original)
    return out


@router.post("/meetings/{slug}/confirm", response_model=ConfirmResponse)
def confirm(
    payload: ConfirmRequest,
    meeting: Meeting = Depends(require_organizer),
    db: Session = Depends(get_db),
) -> ConfirmResponse:
    slot_start, slot_end = _validate_confirm_slot(meeting, payload)

    meeting.confirmed_slot_start = slot_start
    meeting.confirmed_slot_end = slot_end
    db.add(meeting)
    db.commit()
    db.refresh(meeting)

    nicknames = _participant_nicknames(db, meeting.id)
    share_message = _generate_share_message(meeting, slot_start, slot_end, nicknames)

    # Build response slot with KST offset for client display.
    return ConfirmResponse(
        confirmed_slot=ConfirmedSlot(
            start=from_kst_naive(slot_start),
            end=from_kst_naive(slot_end),
        ),
        share_message_draft=share_message,
    )


def _validate_confirm_slot(
    meeting: Meeting, payload: ConfirmRequest
) -> Tuple["object", "object"]:
    """Strip tz, ensure 30-min boundary + duration matches meeting.duration_minutes.

    Returns naive KST datetimes.
    """
    slot_start = to_kst_naive(payload.slot_start)
    slot_end = to_kst_naive(payload.slot_end)

    if slot_start.minute % 30 != 0 or slot_end.minute % 30 != 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={
                "error_code": "slot_not_on_grid",
                "message": "슬롯은 30분 경계여야 합니다.",
                "suggestion": "후보 목록에서 선택해주세요.",
            },
        )

    actual_minutes = int((slot_end - slot_start).total_seconds() // 60)
    if actual_minutes != meeting.duration_minutes:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={
                "error_code": "slot_duration_mismatch",
                "message": "슬롯 길이가 회의 길이와 일치하지 않습니다.",
                "suggestion": f"회의 길이는 {meeting.duration_minutes}분입니다.",
            },
        )

    if slot_start.date() < meeting.date_range_start or slot_end.date() > (
        meeting.date_range_end + timedelta(days=1)
    ):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={
                "error_code": "slot_out_of_range",
                "message": "슬롯이 회의 날짜 범위 밖에 있습니다.",
                "suggestion": "회의 날짜 범위 안에서 선택해주세요.",
            },
        )

    return slot_start, slot_end


def _participant_nicknames(db: Session, meeting_id: int) -> List[str]:
    rows = (
        db.query(Participant.nickname)
        .filter(Participant.meeting_id == meeting_id)
        .order_by(Participant.created_at.asc())
        .all()
    )
    return [row[0] for row in rows]


def _generate_share_message(meeting: Meeting, slot_start, slot_end, nicknames: List[str]) -> str:
    try:
        adapter = get_llm_adapter()
        return adapter.generate_share_message(
            meeting=meeting,
            confirmed_slot=Slot(start=slot_start, end=slot_end),
            nicknames=list(nicknames),
        )
    except Exception as exc:  # pragma: no cover - defensive
        logger.warning("LLM share message generation failed; using template: %s", exc)
        from app.services.llm.template import TemplateAdapter

        return TemplateAdapter().generate_share_message(
            meeting=meeting,
            confirmed_slot=Slot(start=slot_start, end=slot_end),
            nicknames=list(nicknames),
        )
