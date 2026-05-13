"""Availability inputs (manual + ICS upload + natural-language parse).

POST /api/meetings/{slug}/availability/manual
POST /api/meetings/{slug}/availability/ics
POST /api/meetings/{slug}/availability/ics/parse                (preview only)
POST /api/meetings/{slug}/availability/natural-language/parse   (preview only)

manual + ics persist (last-write-wins per spec §6 / S7). The two `parse`
routes are preview-only — the FE shows the result and the participant
confirms via the manual endpoint (with merge/overwrite chosen on the FE
side).

All endpoints require the participant cookie.
"""
from __future__ import annotations

import json
import logging
from datetime import datetime

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from sqlalchemy.orm import Session

from app.core.dependencies import get_current_meeting, get_db, get_participant
from app.db.models import Meeting, Participant
from app.schemas.manual import ManualAvailabilityInput
from app.schemas.natural_language import NaturalLanguageParseInput
from app.services.availability import replace_busy_blocks_for_participant
from app.services.ics_parser import parse_ics
from app.services.llm import get_llm_adapter
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


@router.post(
    "/meetings/{slug}/availability/natural-language/parse",
    status_code=status.HTTP_200_OK,
)
def parse_natural_language_availability(
    payload: NaturalLanguageParseInput,
    participant: Participant = Depends(get_participant),
    meeting: Meeting = Depends(get_current_meeting),
) -> dict:
    """v3.28 — parse only, don't save.

    Takes free-text Korean availability input (e.g. "월요일 9-12 수업 있음")
    and returns the LLM-parsed busy_blocks. The FE displays the result as a
    preview; the participant chooses merge-with-existing or overwrite via
    the normal manual endpoint.
    """
    # The cookie is required so this isn't an open utility — discard the
    # participant object itself.
    _ = participant

    try:
        adapter = get_llm_adapter()
    except RuntimeError as exc:
        logger.warning("LLM adapter unavailable for NL parse: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={
                "error_code": "llm_unavailable",
                "message": "자연어 파싱 엔진을 호출할 수 없습니다.",
                "suggestion": "수동 입력 또는 ICS 업로드를 사용해주세요.",
            },
        ) from exc

    try:
        raw = adapter.parse_availability(payload.text, meeting)
    except (ValueError, json.JSONDecodeError) as exc:
        logger.exception("NL parse: LLM returned unparseable output: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={
                "error_code": "llm_parse_failed",
                "message": "자연어 응답을 해석하지 못했습니다.",
                "suggestion": "조금 더 명확한 표현으로 다시 시도해주세요.",
            },
        ) from exc
    except Exception as exc:
        logger.exception("NL parse: LLM network/SDK error: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={
                "error_code": "llm_unavailable",
                "message": "자연어 파싱 엔진 호출에 실패했습니다.",
                "suggestion": "잠시 후 다시 시도해주세요.",
            },
        ) from exc

    busy_blocks, summary = _normalize_nl_parse_output(raw, meeting)
    return {
        "busy_blocks": busy_blocks,
        "summary": summary,
    }


def _normalize_nl_parse_output(
    raw: dict,
    meeting: Meeting,
) -> tuple[list[dict], str]:
    """Defensive parser around the LLM's natural-language output.

    Drops anything malformed silently (the FE shows what we kept; users can
    edit the grid before saving). Returns (busy_blocks, summary) where
    busy_blocks is a list of {"start": ISO str, "end": ISO str} — datetimes
    are normalized to KST naive ISO strings to match parse_ics_preview.
    """
    if not isinstance(raw, dict):
        return [], "응답을 해석하지 못했습니다."

    summary_raw = raw.get("summary")
    summary = (
        summary_raw.strip()
        if isinstance(summary_raw, str) and summary_raw.strip()
        else "자연어 입력을 불가능 시간으로 변환했습니다."
    )

    raw_blocks = raw.get("busy_blocks")
    if not isinstance(raw_blocks, list):
        return [], summary

    normalized: list[dict] = []
    for block in raw_blocks:
        if not isinstance(block, dict):
            continue
        start_iso = block.get("start")
        end_iso = block.get("end")
        if not isinstance(start_iso, str) or not isinstance(end_iso, str):
            continue
        try:
            start_dt = datetime.fromisoformat(start_iso)
            end_dt = datetime.fromisoformat(end_iso)
        except ValueError:
            logger.info("NL parse: dropping unparseable block %r-%r", start_iso, end_iso)
            continue
        # Strip any tz so we stay in the project's KST-naive convention.
        if start_dt.tzinfo is not None:
            start_dt = start_dt.replace(tzinfo=None)
        if end_dt.tzinfo is not None:
            end_dt = end_dt.replace(tzinfo=None)
        if end_dt <= start_dt:
            continue
        if not _block_intersects_meeting_dates(start_dt, end_dt, meeting):
            continue
        normalized.append(
            {"start": start_dt.isoformat(), "end": end_dt.isoformat()}
        )
    return normalized, summary


def _block_intersects_meeting_dates(
    start: datetime, end: datetime, meeting: Meeting
) -> bool:
    """Return True iff the (start, end) block touches any meeting search date."""
    from app.services.scheduler import enumerate_search_dates

    dates = set(enumerate_search_dates(meeting))
    if not dates:
        return False
    # Walk every date the block spans (usually 1).
    current = start.date()
    end_date = end.date()
    while current <= end_date:
        if current in dates:
            return True
        # Move to next day.
        from datetime import timedelta

        current = current + timedelta(days=1)
    return False
