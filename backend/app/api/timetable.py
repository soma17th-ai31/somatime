"""Timetable endpoint.

GET /api/meetings/{slug}/timetable
- Public (URL only).
- Returns the full 30-min slot grid across the meeting's date range and time
  window, with available_count and available_nicknames per slot.
- Privacy: only nicknames are exposed (S10).
"""
from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.dependencies import get_current_meeting, get_db
from app.db.models import BusyBlock, Meeting, Participant
from app.schemas.timetable import TimetableResponse, TimetableSlot
from app.services.scheduler import build_timetable
from app.services.timezones import from_kst_naive

router = APIRouter(prefix="/api", tags=["timetable"])


@router.get("/meetings/{slug}/timetable", response_model=TimetableResponse)
def get_timetable(
    meeting: Meeting = Depends(get_current_meeting),
    db: Session = Depends(get_db),
) -> TimetableResponse:
    participants = (
        db.query(Participant)
        .filter(Participant.meeting_id == meeting.id)
        .order_by(Participant.created_at.asc())
        .all()
    )
    busy_by_pid: dict[int, list[BusyBlock]] = {}
    for p in participants:
        blocks = (
            db.query(BusyBlock)
            .filter(BusyBlock.participant_id == p.id)
            .order_by(BusyBlock.start_at.asc())
            .all()
        )
        busy_by_pid[p.id] = blocks

    raw_slots = build_timetable(meeting, participants, busy_by_pid)
    slots = [
        TimetableSlot(
            start=from_kst_naive(s["start"]),
            end=from_kst_naive(s["end"]),
            available_count=s["available_count"],
            available_nicknames=sorted(s["available_nicknames"]),
        )
        for s in raw_slots
    ]
    return TimetableResponse(slots=slots)
