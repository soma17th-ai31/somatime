"""Unit tests for availability normalization, merging, and atomic replacement."""
from __future__ import annotations

from datetime import date, datetime, time, timezone

import pytest

from app.db.models import BusyBlock, Meeting, Participant
from app.services.availability import (
    SLOT_MINUTES,
    merge_overlapping,
    normalize_and_merge,
    normalize_block,
    replace_busy_blocks_for_participant,
)
from app.services.timezones import now_kst_naive


def test_floor_start_to_30min() -> None:
    s, e = normalize_block(datetime(2026, 5, 12, 12, 15), datetime(2026, 5, 12, 13, 30))
    assert s == datetime(2026, 5, 12, 12, 0)
    assert e == datetime(2026, 5, 12, 13, 30)


def test_ceil_end_to_30min() -> None:
    s, e = normalize_block(datetime(2026, 5, 12, 12, 0), datetime(2026, 5, 12, 13, 35))
    assert s == datetime(2026, 5, 12, 12, 0)
    assert e == datetime(2026, 5, 12, 14, 0)


def test_slot_minutes_constant() -> None:
    assert SLOT_MINUTES == 30


def test_normalize_block_rejects_zero_or_negative() -> None:
    with pytest.raises(ValueError):
        normalize_block(datetime(2026, 5, 12, 12, 0), datetime(2026, 5, 12, 12, 0))
    with pytest.raises(ValueError):
        normalize_block(datetime(2026, 5, 12, 13, 0), datetime(2026, 5, 12, 12, 0))


def test_merge_overlapping() -> None:
    a = (datetime(2026, 5, 12, 10), datetime(2026, 5, 12, 12))
    b = (datetime(2026, 5, 12, 11, 30), datetime(2026, 5, 12, 13))
    c = (datetime(2026, 5, 12, 14), datetime(2026, 5, 12, 15))
    merged = merge_overlapping([a, b, c])
    assert merged == [
        (datetime(2026, 5, 12, 10), datetime(2026, 5, 12, 13)),
        (datetime(2026, 5, 12, 14), datetime(2026, 5, 12, 15)),
    ]


def test_merge_touching_blocks() -> None:
    a = (datetime(2026, 5, 12, 10), datetime(2026, 5, 12, 12))
    b = (datetime(2026, 5, 12, 12), datetime(2026, 5, 12, 13))
    merged = merge_overlapping([a, b])
    assert merged == [(datetime(2026, 5, 12, 10), datetime(2026, 5, 12, 13))]


def test_normalize_and_merge_combines_normalize_then_merge() -> None:
    inputs = [
        (datetime(2026, 5, 12, 10, 5), datetime(2026, 5, 12, 12, 5)),
        (datetime(2026, 5, 12, 11, 45), datetime(2026, 5, 12, 13, 0)),
    ]
    merged = normalize_and_merge(inputs)
    assert merged == [(datetime(2026, 5, 12, 10, 0), datetime(2026, 5, 12, 13, 0))]


def _make_participant_in_meeting(db_session) -> Participant:
    meeting = Meeting(
        slug="testslug",
        title="t",
        date_range_start=date(2026, 5, 11),
        date_range_end=date(2026, 5, 15),
        duration_minutes=60,
        location_type="online",
        include_weekends=False,
        created_at=now_kst_naive(),
    )
    db_session.add(meeting)
    db_session.flush()
    p = Participant(
        meeting_id=meeting.id,
        nickname="bob",
        token="t" * 32,
        source_type="manual",
        created_at=now_kst_naive(),
    )
    db_session.add(p)
    db_session.commit()
    db_session.refresh(p)
    return p


def test_replace_busy_blocks_inserts(db_session) -> None:
    p = _make_participant_in_meeting(db_session)
    blocks = [(datetime(2026, 5, 12, 10), datetime(2026, 5, 12, 12))]
    rows = replace_busy_blocks_for_participant(db_session, p.id, blocks)
    assert len(rows) == 1
    persisted = db_session.query(BusyBlock).filter_by(participant_id=p.id).all()
    assert len(persisted) == 1


def test_replace_busy_blocks_replaces(db_session) -> None:
    p = _make_participant_in_meeting(db_session)
    first = [(datetime(2026, 5, 12, 10), datetime(2026, 5, 12, 12))]
    second = [(datetime(2026, 5, 13, 14), datetime(2026, 5, 13, 16))]
    replace_busy_blocks_for_participant(db_session, p.id, first)
    replace_busy_blocks_for_participant(db_session, p.id, second)
    persisted = db_session.query(BusyBlock).filter_by(participant_id=p.id).all()
    assert len(persisted) == 1
    assert persisted[0].start_at == datetime(2026, 5, 13, 14)


def test_replace_busy_blocks_atomic_rollback_on_failure(db_session, monkeypatch) -> None:
    p = _make_participant_in_meeting(db_session)
    first = [(datetime(2026, 5, 12, 10), datetime(2026, 5, 12, 12))]
    replace_busy_blocks_for_participant(db_session, p.id, first)
    # Force commit failure on the second call.
    original_commit = db_session.commit

    def boom() -> None:
        raise RuntimeError("simulated failure")

    monkeypatch.setattr(db_session, "commit", boom)
    with pytest.raises(RuntimeError):
        replace_busy_blocks_for_participant(
            db_session,
            p.id,
            [(datetime(2026, 5, 13, 14), datetime(2026, 5, 13, 16))],
        )
    monkeypatch.setattr(db_session, "commit", original_commit)
    db_session.expire_all()
    persisted = db_session.query(BusyBlock).filter_by(participant_id=p.id).all()
    # Original rows preserved (transaction rolled back).
    assert len(persisted) == 1
    assert persisted[0].start_at == datetime(2026, 5, 12, 10)
