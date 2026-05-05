"""Busy-block normalization, merging, and atomic replacement.

Privacy invariant: this module never reads or writes title/description/location.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Iterable, List, Sequence, Tuple

from sqlalchemy import delete
from sqlalchemy.orm import Session

from app.db.models import BusyBlock
from app.services.timezones import to_kst_naive

SLOT_MINUTES = 30


@dataclass(frozen=True)
class TimeRange:
    start: datetime
    end: datetime


def _floor_to_slot(dt: datetime) -> datetime:
    """Floor to the nearest 30-minute boundary."""
    minute = (dt.minute // SLOT_MINUTES) * SLOT_MINUTES
    return dt.replace(minute=minute, second=0, microsecond=0)


def _ceil_to_slot(dt: datetime) -> datetime:
    """Ceil to the nearest 30-minute boundary."""
    floored = _floor_to_slot(dt)
    if floored == dt:
        return floored
    return floored + timedelta(minutes=SLOT_MINUTES)


def normalize_block(start: datetime, end: datetime) -> Tuple[datetime, datetime]:
    """Floor start, ceil end, KST naive.

    Per spec: 'busy_blocks 30분 경계로 내림 정규화'.
    Treat busy as 'occupied for any minute that overlaps a slot' — floor the
    start (so 12:15 -> 12:00) and ceil the end (so 13:30 -> 13:30) so the busy
    interval covers any partially-occupied slot.
    """
    start_kst = to_kst_naive(start)
    end_kst = to_kst_naive(end)
    if end_kst <= start_kst:
        raise ValueError("end must be > start")
    return _floor_to_slot(start_kst), _ceil_to_slot(end_kst)


def merge_overlapping(blocks: Iterable[Tuple[datetime, datetime]]) -> List[Tuple[datetime, datetime]]:
    """Merge overlapping or touching intervals."""
    sorted_blocks = sorted(blocks, key=lambda b: b[0])
    merged: List[Tuple[datetime, datetime]] = []
    for start, end in sorted_blocks:
        if merged and start <= merged[-1][1]:
            prev_start, prev_end = merged[-1]
            merged[-1] = (prev_start, max(prev_end, end))
        else:
            merged.append((start, end))
    return merged


def normalize_and_merge(
    blocks: Iterable[Tuple[datetime, datetime]],
) -> List[Tuple[datetime, datetime]]:
    normalized = [normalize_block(s, e) for s, e in blocks]
    return merge_overlapping(normalized)


def replace_busy_blocks_for_participant(
    db: Session,
    participant_id: int,
    blocks: Sequence[Tuple[datetime, datetime]],
) -> List[BusyBlock]:
    """Atomically delete all existing busy_blocks for participant_id and insert new ones.

    last-write-wins per spec section 6 / S7. Single transaction:
    if any insert fails, the prior delete is rolled back.
    """
    normalized = normalize_and_merge(blocks)
    try:
        db.execute(delete(BusyBlock).where(BusyBlock.participant_id == participant_id))
        new_rows = [
            BusyBlock(participant_id=participant_id, start_at=s, end_at=e)
            for s, e in normalized
        ]
        db.add_all(new_rows)
        db.commit()
    except Exception:
        db.rollback()
        raise
    for row in new_rows:
        db.refresh(row)
    return new_rows
