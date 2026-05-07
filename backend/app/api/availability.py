"""Availability inputs (manual + ICS upload).

POST /api/meetings/{slug}/availability/manual
POST /api/meetings/{slug}/availability/ics

Both endpoints require the participant cookie. Both atomically replace the
participant's busy_blocks (last-write-wins per spec section 6 / S7).
"""
from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, File, UploadFile, status
from sqlalchemy.orm import Session

from app.core.dependencies import get_db, get_participant
from app.db.models import Participant
from app.schemas.manual import ManualAvailabilityInput
from app.services.availability import replace_busy_blocks_for_participant
from app.services.ics_parser import parse_ics
from app.services.timezones import now_kst_naive

logger = logging.getLogger("somameet.availability")

router = APIRouter(prefix="/api", tags=["availability"])


@router.post(
    "/meetings/{slug}/availability/manual",
    status_code=status.HTTP_200_OK,
)
def submit_manual(
    payload: ManualAvailabilityInput,
    participant: Participant = Depends(get_participant),
    db: Session = Depends(get_db),
) -> dict:
    blocks = [(b.start, b.end) for b in payload.busy_blocks]
    new_rows = replace_busy_blocks_for_participant(db, participant.id, blocks)

    participant.source_type = "manual"
    participant.confirmed_at = now_kst_naive()
    db.add(participant)
    db.commit()
    db.refresh(participant)

    return {
        "source_type": "manual",
        "blocks_count": len(new_rows),
    }


@router.post(
    "/meetings/{slug}/availability/ics",
    status_code=status.HTTP_200_OK,
)
def submit_ics(
    file: UploadFile = File(...),
    participant: Participant = Depends(get_participant),
    db: Session = Depends(get_db),
) -> dict:
    content = file.file.read()
    blocks = parse_ics(content)  # raises ICSParseError -> 400 via exception handler

    new_rows = replace_busy_blocks_for_participant(db, participant.id, blocks)

    participant.source_type = "ics"
    participant.confirmed_at = now_kst_naive()
    db.add(participant)
    db.commit()
    db.refresh(participant)

    return {
        "source_type": "ics",
        "blocks_count": len(new_rows),
    }


@router.post(
    "/meetings/{slug}/availability/ics/parse",
    status_code=status.HTTP_200_OK,
)
def parse_ics_preview(
    file: UploadFile = File(...),
    participant: Participant = Depends(get_participant),
) -> dict:
    """v3.24 — parse only, don't save.

    Returns the parsed busy_blocks so the frontend can pre-fill the manual
    grid for review/edit before the user clicks `가용 시간 저장`.
    """
    content = file.file.read()
    blocks = parse_ics(content)
    # Drop the `_` (participant) — endpoint requires the cookie just so we
    # don't expose ICS parsing as an open utility on the slug.
    _ = participant
    return {
        "busy_blocks": [
            {"start": s.isoformat(), "end": e.isoformat()} for s, e in blocks
        ],
    }
