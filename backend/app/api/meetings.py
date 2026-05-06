"""Meeting CRUD + calculate + confirm endpoints (v3).

Endpoints:
- POST /api/meetings           — create meeting (range or picked mode)
- GET  /api/meetings/{slug}    — public detail with submitted/target progress
- POST /api/meetings/{slug}/calculate — deterministic candidates only (NO LLM call)
- POST /api/meetings/{slug}/confirm   — slug-only, stores share_message_draft

v3 changes:
- /calculate is deterministic-only (LLM moved to /recommend).
- /confirm body MUST include share_message_draft; backend stores verbatim.
- GET /meetings reports submitted_count / is_ready_to_calculate.

v3.1 (2026-05-06 simplify pass):
- participant_count input removed from MeetingCreate.
- /calculate and /recommend gate on submitted_count >= 1 (was >= target).

v3.2 (2026-05-06 Path B):
- organizer_token deleted. Anyone with the slug can confirm. The
  ShareMessageDialog 2-step gate is the sole accident safeguard.
- /confirm now returns 409 already_confirmed when a confirmed_slot already
  exists (race protection for two simultaneous confirmers).
"""
from __future__ import annotations

import logging
from datetime import timedelta
from typing import List, Optional, Tuple

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.dependencies import (
    count_submitted,
    get_current_meeting,
    get_db,
    get_optional_participant,
    list_required_nicknames,
    list_submitted_nicknames,
)
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
from app.schemas.meeting import ConfirmedSlotInfo, MeetingSettingsUpdate
from app.services.scheduler import (
    calculate_candidates,
    deterministic_top_candidates,
    generate_candidate_windows,
)
from app.services.timezones import from_kst_naive, now_kst_naive, to_kst_naive
from app.services.tokens import generate_slug

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
    last_error: Optional[Exception] = None

    candidate_dates_iso: Optional[list] = None
    if payload.candidate_dates is not None:
        candidate_dates_iso = [d.isoformat() for d in payload.candidate_dates]

    for _ in range(5):
        candidate_slug = generate_slug()
        meeting = Meeting(
            slug=candidate_slug,
            title=payload.title,
            date_mode=payload.date_mode.value,
            date_range_start=payload.date_range_start,
            date_range_end=payload.date_range_end,
            candidate_dates=candidate_dates_iso,
            duration_minutes=payload.duration_minutes,
            location_type=payload.location_type.value,
            offline_buffer_minutes=payload.offline_buffer_minutes,
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
        share_url=f"{base_url}/m/{meeting.slug}",
    )


@router.get("/meetings/{slug}", response_model=MeetingDetail)
def get_meeting(
    request: Request,
    meeting: Meeting = Depends(get_current_meeting),
    db: Session = Depends(get_db),
) -> MeetingDetail:
    settings = get_settings()
    submitted = count_submitted(db, meeting.id)
    submitted_names = list_submitted_nicknames(db, meeting.id)
    required_names = list_required_nicknames(db, meeting.id)

    # v3.6: when a participant cookie is present, expose only that participant's
    # busy_blocks so the form can pre-fill on refresh. Other participants' input
    # never leaks here.
    me = get_optional_participant(request, meeting.slug, db)
    my_busy_blocks: Optional[List[ConfirmedSlotInfo]] = None
    if me is not None:
        rows = (
            db.query(BusyBlock)
            .filter(BusyBlock.participant_id == me.id)
            .order_by(BusyBlock.start_at.asc())
            .all()
        )
        my_busy_blocks = [
            ConfirmedSlotInfo(
                start=from_kst_naive(r.start_at),
                end=from_kst_naive(r.end_at),
            )
            for r in rows
        ]

    # Reconstruct candidate_dates as a python list[date] for the response.
    cd_list = None
    if meeting.candidate_dates:
        from datetime import date as _date

        cd_list = []
        for d in meeting.candidate_dates:
            if isinstance(d, _date):
                cd_list.append(d)
            else:
                cd_list.append(_date.fromisoformat(str(d)))

    confirmed_info: Optional[ConfirmedSlotInfo] = None
    if meeting.confirmed_slot_start and meeting.confirmed_slot_end:
        confirmed_info = ConfirmedSlotInfo(
            start=from_kst_naive(meeting.confirmed_slot_start),
            end=from_kst_naive(meeting.confirmed_slot_end),
        )

    return MeetingDetail(
        slug=meeting.slug,
        title=meeting.title,
        date_mode=meeting.date_mode,
        date_range_start=meeting.date_range_start,
        date_range_end=meeting.date_range_end,
        candidate_dates=cd_list,
        duration_minutes=meeting.duration_minutes,
        submitted_count=submitted,
        submitted_nicknames=submitted_names,
        required_nicknames=required_names,
        is_ready_to_calculate=submitted >= 1,
        location_type=meeting.location_type,
        offline_buffer_minutes=meeting.offline_buffer_minutes,
        time_window_start=meeting.time_window_start,
        time_window_end=meeting.time_window_end,
        include_weekends=meeting.include_weekends,
        share_url=f"{settings.APP_BASE_URL.rstrip('/')}/m/{meeting.slug}",
        confirmed_slot=confirmed_info,
        confirmed_share_message=meeting.confirmed_share_message,
        my_busy_blocks=my_busy_blocks,
        created_at=from_kst_naive(meeting.created_at),
    )


@router.patch("/meetings/{slug}/settings", response_model=MeetingDetail)
def update_meeting_settings(
    request: Request,
    payload: MeetingSettingsUpdate,
    meeting: Meeting = Depends(get_current_meeting),
    db: Session = Depends(get_db),
) -> MeetingDetail:
    """v3.19 — replace the editable scheduling fields wholesale.

    Anyone with the slug can edit (Path B). Confirmed meetings are locked
    so accidental edits don't break a finalized share message.
    """
    if meeting.confirmed_slot_start is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "error_code": "already_confirmed",
                "message": "이미 확정된 회의는 수정할 수 없습니다.",
                "suggestion": "확정 전 회의에서만 설정을 변경할 수 있습니다.",
            },
        )

    meeting.date_mode = payload.date_mode.value
    meeting.date_range_start = payload.date_range_start
    meeting.date_range_end = payload.date_range_end
    # candidate_dates is JSON; store as ISO strings for consistency with DB column type.
    meeting.candidate_dates = (
        [d.isoformat() for d in payload.candidate_dates]
        if payload.candidate_dates is not None
        else None
    )
    meeting.duration_minutes = payload.duration_minutes
    meeting.location_type = payload.location_type.value
    meeting.offline_buffer_minutes = payload.offline_buffer_minutes
    meeting.time_window_start = payload.time_window_start
    meeting.time_window_end = payload.time_window_end
    meeting.include_weekends = payload.include_weekends

    db.add(meeting)
    db.commit()
    db.refresh(meeting)

    # Return the same shape as GET so the frontend can replace local state.
    return get_meeting(request=request, meeting=meeting, db=db)


@router.post("/meetings/{slug}/calculate", response_model=CalculateResponse)
def calculate(
    meeting: Meeting = Depends(get_current_meeting),
    db: Session = Depends(get_db),
) -> CalculateResponse:
    """v3 — deterministic only. NO LLM call. Gated on submitted_count >= 1."""
    submitted = count_submitted(db, meeting.id)
    _enforce_responses_gate(submitted)

    participants, busy_by_pid = _load_participants_with_busy(db, meeting.id)

    candidates, suggestion = calculate_candidates(
        meeting=meeting,
        busy_blocks_by_participant=busy_by_pid,
        max_candidates=3,
        participants=participants,
    )

    # /calculate must NOT include LLM-generated reasons. Strip the reason
    # (LLM-only field) and share_message_draft. The "note" is deterministic
    # ("X님 제외 가능" for fallback candidates) and is preserved per S3.
    deterministic_candidates: List[Candidate] = []
    for c in candidates:
        deterministic_candidates.append(
            c.model_copy(
                update={
                    "start": from_kst_naive(c.start),
                    "end": from_kst_naive(c.end),
                    "reason": None,
                    "share_message_draft": None,
                }
            )
        )

    best_avail = (
        max((c.available_count for c in deterministic_candidates), default=0)
        if deterministic_candidates
        else None
    )

    return CalculateResponse(
        summary=None,
        candidates=deterministic_candidates,
        source="deterministic",
        best_available_count=best_avail,
        total_participants=len(participants),
        suggestion=suggestion,
    )


@router.post("/meetings/{slug}/confirm", response_model=ConfirmResponse)
def confirm(
    payload: ConfirmRequest,
    meeting: Meeting = Depends(get_current_meeting),
    db: Session = Depends(get_db),
) -> ConfirmResponse:
    """v3 — body MUST include share_message_draft. NO LLM call here.

    v3.2 (Path B): no organizer header required — share-URL holders may
    confirm. To guard against two clients confirming simultaneously we
    refuse the second writer with 409 already_confirmed.
    """
    slot_start, slot_end = _validate_confirm_slot(meeting, payload)

    # Race protection: re-read with row lock (best-effort across SQLite).
    # If a confirmed_slot already exists at this point we refuse to overwrite.
    locked = (
        db.query(Meeting).filter(Meeting.id == meeting.id).with_for_update().first()
        if db.bind and db.bind.dialect.name != "sqlite"
        else db.query(Meeting).filter(Meeting.id == meeting.id).first()
    )
    if locked is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={
                "error_code": "meeting_not_found",
                "message": "회의를 찾을 수 없습니다.",
                "suggestion": "URL을 다시 확인해주세요.",
            },
        )

    if locked.confirmed_slot_start is not None and locked.confirmed_slot_end is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "error_code": "already_confirmed",
                "message": "이미 확정된 회의입니다.",
                "suggestion": "회의 페이지에서 확정된 시각을 확인하세요.",
                "confirmed_slot": {
                    "start": from_kst_naive(locked.confirmed_slot_start).isoformat(),
                    "end": from_kst_naive(locked.confirmed_slot_end).isoformat(),
                },
            },
        )

    locked.confirmed_slot_start = slot_start
    locked.confirmed_slot_end = slot_end
    locked.confirmed_share_message = payload.share_message_draft
    db.add(locked)
    db.commit()
    db.refresh(locked)

    return ConfirmResponse(
        confirmed_slot=ConfirmedSlot(
            start=from_kst_naive(slot_start),
            end=from_kst_naive(slot_end),
        ),
        share_message_draft=payload.share_message_draft,
    )


# ============================================================================
# Helpers
# ============================================================================


def _enforce_responses_gate(submitted: int) -> None:
    """Raise 409 insufficient_responses when no participant has submitted yet.

    v3.1 simplification: gate flips active as soon as the first submission
    arrives (was: submitted >= target). Required stays in the response body
    as 1 so existing clients keep parsing the same shape.
    """
    if submitted < 1:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "error_code": "insufficient_responses",
                "message": "아직 제출된 일정이 없습니다.",
                "suggestion": "최소 한 명이 일정을 제출하면 결과를 볼 수 있습니다.",
                "current": submitted,
                "required": 1,
            },
        )


def _load_participants_with_busy(
    db: Session,
    meeting_id: int,
) -> Tuple[List[Participant], dict]:
    """v3.16 — only submitted participants enter the scheduling pool.

    Participants who registered but haven't yet submitted any availability
    (confirmed_at IS NULL) used to be treated as ghost-free everywhere because
    their busy_blocks list was empty. That inflated full_target and skewed
    is_full_match / available_count. They're now excluded from /calculate and
    /recommend; submitted_count + required_nicknames + the "필수 미제출" UI
    callout still surface them.
    """
    participants: List[Participant] = (
        db.query(Participant)
        .filter(
            Participant.meeting_id == meeting_id,
            Participant.confirmed_at.is_not(None),
        )
        .order_by(Participant.created_at.asc())
        .all()
    )
    busy_by_pid: dict = {}
    for participant in participants:
        blocks = (
            db.query(BusyBlock)
            .filter(BusyBlock.participant_id == participant.id)
            .order_by(BusyBlock.start_at.asc())
            .all()
        )
        busy_by_pid[participant.id] = blocks
    return participants, busy_by_pid


def _validate_confirm_slot(
    meeting: Meeting, payload: ConfirmRequest
) -> Tuple["object", "object"]:
    """Strip tz, ensure 30-min boundary + duration matches meeting.duration_minutes."""
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

    # Validate slot is within the meeting's effective date range.
    from app.services.scheduler import enumerate_search_dates

    valid_dates = set(enumerate_search_dates(meeting))
    if slot_start.date() not in valid_dates:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={
                "error_code": "slot_out_of_range",
                "message": "슬롯이 회의 날짜 범위 밖에 있습니다.",
                "suggestion": "회의 날짜 범위 안에서 선택해주세요.",
            },
        )

    return slot_start, slot_end
