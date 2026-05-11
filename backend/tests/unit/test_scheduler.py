"""Unit tests for the deterministic scheduler.

Covers spec section 6: 30-min grid, weekday filter, time window, offline
buffer, ranking, fallback, suggestion, KST handling.
"""
from __future__ import annotations

from datetime import date, datetime, time
from typing import Dict, List

from app.db.models import BusyBlock, Meeting, Participant
from app.services.scheduler import (
    BUFFER_MINUTES,
    SLOT_MINUTES,
    build_timetable,
    calculate_candidates,
)


# -------------------------------------------------------- helpers


def _make_meeting(
    *,
    duration: int = 60,
    location: str = "online",
    include_weekends: bool = False,
    start_date: date = date(2026, 5, 11),
    end_date: date = date(2026, 5, 15),
    window_start: time = time(9, 0),  # noqa: ARG001 — kept for call-site compat
    window_end: time = time(22, 0),  # noqa: ARG001 — kept for call-site compat
    participant_count: int = 3,  # noqa: ARG001 — accepted for back-compat
) -> Meeting:
    # v3.1: participant_count was removed from Meeting; the scheduler does
    # not depend on it. Leave the kwarg in the helper signature so older
    # call sites keep compiling.
    # #57: meeting-level time_window_start/end columns were dropped in
    # favour of a process-wide MEETING_WINDOW_START / MEETING_WINDOW_END
    # constant (06:00-24:00). The window_* kwargs are kept as call-site
    # compat only — they are discarded here.
    del participant_count, window_start, window_end
    m = Meeting(
        slug="abc12345",
        title="meeting",
        date_range_start=start_date,
        date_range_end=end_date,
        duration_minutes=duration,
        location_type=location,
        include_weekends=include_weekends,
        created_at=datetime(2026, 5, 4),
    )
    return m


def _participant(pid: int, nickname: str) -> Participant:
    p = Participant(
        nickname=nickname,
        token=f"tok-{pid}".ljust(32, "x"),
        source_type="manual",
        created_at=datetime(2026, 5, 4),
    )
    p.id = pid
    p.meeting_id = 1
    return p


def _block(pid: int, start: datetime, end: datetime) -> BusyBlock:
    b = BusyBlock(participant_id=pid, start_at=start, end_at=end)
    return b


# -------------------------------------------------------- core: happy path


def test_returns_at_most_max_candidates() -> None:
    meeting = _make_meeting(participant_count=2)
    parts = [_participant(1, "a"), _participant(2, "b")]
    busy: Dict[int, List[BusyBlock]] = {1: [], 2: []}
    candidates, suggestion = calculate_candidates(meeting, busy, max_candidates=3, participants=parts)
    assert suggestion is None
    assert 0 < len(candidates) <= 3


def test_each_candidate_duration_matches_meeting_duration() -> None:
    meeting = _make_meeting(duration=90, participant_count=1)
    parts = [_participant(1, "a")]
    busy = {1: []}
    candidates, _ = calculate_candidates(meeting, busy, participants=parts)
    for c in candidates:
        assert (c.end - c.start).total_seconds() / 60 == 90


def test_busy_block_excludes_overlapping_slot() -> None:
    meeting = _make_meeting(participant_count=1)
    parts = [_participant(1, "a")]
    # Cover the entire MEETING_WINDOW (06:00-24:00) across the full
    # date_range so no slot survives anywhere.
    busy = {1: [_block(1, datetime(2026, 5, 11, 6, 0), datetime(2026, 5, 16, 0, 0))]}
    candidates, suggestion = calculate_candidates(meeting, busy, participants=parts)
    assert candidates == []
    assert suggestion is not None


# -------------------------------------------------------- S2: offline buffer


def test_offline_buffer_excludes_buffer_violation() -> None:
    """Offline meeting, 60min: 13:30-14:30 must be excluded when bordered by busy."""
    meeting = _make_meeting(
        duration=60,
        location="offline",
        participant_count=1,
        start_date=date(2026, 5, 12),
        end_date=date(2026, 5, 12),
    )
    parts = [_participant(1, "a")]
    busy = {
        1: [
            _block(1, datetime(2026, 5, 12, 12, 0), datetime(2026, 5, 12, 13, 30)),
            _block(1, datetime(2026, 5, 12, 14, 30), datetime(2026, 5, 12, 16, 0)),
        ]
    }
    candidates, _ = calculate_candidates(meeting, busy, participants=parts)
    starts = {c.start for c in candidates}
    assert datetime(2026, 5, 12, 13, 30) not in starts


def test_online_includes_slot_that_offline_would_buffer_out() -> None:
    """Same input but online -> 13:30-14:30 must be included."""
    meeting = _make_meeting(
        duration=60,
        location="online",
        participant_count=1,
        start_date=date(2026, 5, 12),
        end_date=date(2026, 5, 12),
    )
    parts = [_participant(1, "a")]
    busy = {
        1: [
            _block(1, datetime(2026, 5, 12, 12, 0), datetime(2026, 5, 12, 13, 30)),
            _block(1, datetime(2026, 5, 12, 14, 30), datetime(2026, 5, 12, 16, 0)),
        ]
    }
    candidates, _ = calculate_candidates(meeting, busy, participants=parts, max_candidates=10)
    starts = {c.start for c in candidates}
    assert datetime(2026, 5, 12, 13, 30) in starts


def test_any_location_applies_buffer_v3() -> None:
    """v3 (Q8): location=any now applies the offline buffer (was 'no buffer' in v2)."""
    meeting = _make_meeting(
        duration=60,
        location="any",
        participant_count=1,
        start_date=date(2026, 5, 12),
        end_date=date(2026, 5, 12),
    )
    parts = [_participant(1, "a")]
    busy = {
        1: [
            _block(1, datetime(2026, 5, 12, 12, 0), datetime(2026, 5, 12, 13, 30)),
            _block(1, datetime(2026, 5, 12, 14, 30), datetime(2026, 5, 12, 16, 0)),
        ]
    }
    candidates, _ = calculate_candidates(meeting, busy, participants=parts, max_candidates=10)
    starts = {c.start for c in candidates}
    # v3: any-location with default 30-min buffer excludes 13:30-14:30 because
    # the [13:00, 15:00] check window overlaps both adjacent busy blocks.
    assert datetime(2026, 5, 12, 13, 30) not in starts


def test_buffer_minutes_constant() -> None:
    # #13 follow-up — meeting-level offline_buffer_minutes was dropped.
    # The fallback when a participant has no personal buffer is now 60min.
    assert BUFFER_MINUTES == 60
    assert SLOT_MINUTES == 30


# -------------------------------------------------------- weekend / time window


def test_weekends_excluded_by_default() -> None:
    meeting = _make_meeting(
        participant_count=1,
        start_date=date(2026, 5, 16),  # Saturday
        end_date=date(2026, 5, 17),  # Sunday
    )
    parts = [_participant(1, "a")]
    candidates, suggestion = calculate_candidates(meeting, {1: []}, participants=parts)
    assert candidates == []
    assert suggestion is not None


def test_weekends_included_when_toggle_on() -> None:
    meeting = _make_meeting(
        participant_count=1,
        start_date=date(2026, 5, 16),
        end_date=date(2026, 5, 17),
        include_weekends=True,
    )
    parts = [_participant(1, "a")]
    candidates, _ = calculate_candidates(meeting, {1: []}, participants=parts)
    assert len(candidates) > 0


def test_time_window_respected() -> None:
    """Issue #57 — every meeting now uses the same MEETING_WINDOW
    (06:00-24:00). The per-meeting window column is gone, so no candidate
    may start before 06:00 or end after 24:00 regardless of input."""
    meeting = _make_meeting(participant_count=1, duration=60)
    parts = [_participant(1, "a")]
    candidates, _ = calculate_candidates(meeting, {1: []}, participants=parts, max_candidates=20)
    for c in candidates:
        assert c.start.time() >= time(6, 0)
        # Slot end of exactly 00:00 is the last 23:30 slot extending to
        # midnight; everything else stays within the same calendar day.
        assert c.end.time() == time(0, 0) or c.start.date() == c.end.date()


# -------------------------------------------------------- S3 fallback: 1 missing


def test_fallback_drops_one_missing_participant() -> None:
    """4-person meeting where p4 is fully busy -> fallback returns slots with missing=[p4]."""
    meeting = _make_meeting(
        participant_count=4,
        start_date=date(2026, 5, 12),
        end_date=date(2026, 5, 12),
    )
    parts = [_participant(i, f"p{i}") for i in range(1, 5)]
    busy = {
        1: [],
        2: [],
        3: [],
        4: [_block(4, datetime(2026, 5, 12, 0, 0), datetime(2026, 5, 13, 0, 0))],
    }
    candidates, suggestion = calculate_candidates(meeting, busy, participants=parts)
    assert suggestion is None
    assert len(candidates) > 0
    assert all(c.missing_participants == ["p4"] for c in candidates)
    assert all(c.note for c in candidates)


# -------------------------------------------------------- S4 suggestion


def test_returns_suggestion_when_no_intersection() -> None:
    meeting = _make_meeting(
        participant_count=2,
        start_date=date(2026, 5, 12),
        end_date=date(2026, 5, 12),
    )
    parts = [_participant(1, "a"), _participant(2, "b")]
    busy = {
        1: [_block(1, datetime(2026, 5, 12, 0), datetime(2026, 5, 13, 0))],
        2: [_block(2, datetime(2026, 5, 12, 0), datetime(2026, 5, 13, 0))],
    }
    candidates, suggestion = calculate_candidates(meeting, busy, participants=parts)
    assert candidates == []
    assert suggestion and "줄이" in suggestion or "넓히" in suggestion


# -------------------------------------------------------- ranking


def test_higher_available_count_ranks_first() -> None:
    """When some slots have 2 participants free and others have 1, the 2-free wins phase 1."""
    meeting = _make_meeting(
        participant_count=2,
        start_date=date(2026, 5, 12),
        end_date=date(2026, 5, 12),
    )
    parts = [_participant(1, "a"), _participant(2, "b")]
    # b is busy 06:00-12:00 -> only afternoon both free under the new
    # 06:00-24:00 window.
    busy = {1: [], 2: [_block(2, datetime(2026, 5, 12, 6), datetime(2026, 5, 12, 12))]}
    candidates, _ = calculate_candidates(meeting, busy, participants=parts)
    assert candidates[0].available_count == 2
    assert candidates[0].start.hour >= 12


def test_time_spread_prefers_2h_apart_when_possible() -> None:
    meeting = _make_meeting(
        participant_count=1,
        start_date=date(2026, 5, 12),
        end_date=date(2026, 5, 12),
    )
    parts = [_participant(1, "a")]
    candidates, _ = calculate_candidates(meeting, {1: []}, participants=parts)
    # With 3 candidates we expect spread >= 2h between adjacent picks.
    starts = sorted(c.start for c in candidates)
    if len(starts) >= 2:
        diffs = [(starts[i + 1] - starts[i]).total_seconds() / 60 for i in range(len(starts) - 1)]
        assert min(diffs) >= 120


# -------------------------------------------------------- KST handling


def test_candidate_datetimes_are_kst_naive() -> None:
    meeting = _make_meeting(participant_count=1)
    parts = [_participant(1, "a")]
    candidates, _ = calculate_candidates(meeting, {1: []}, participants=parts)
    for c in candidates:
        # naive (DB-style) datetimes; the API layer attaches +09:00 on serialization.
        assert c.start.tzinfo is None
        assert c.end.tzinfo is None


# -------------------------------------------------------- timetable (S10)


def test_build_timetable_30min_slots_and_nicknames() -> None:
    """Issue #57 — fixed 06:00-24:00 window means 36 30-min slots per day.
    The first slot starts at 06:00 regardless of any (now-removed) window
    kwargs the test supplies.
    """
    meeting = _make_meeting(
        duration=60,
        participant_count=2,
        start_date=date(2026, 5, 12),
        end_date=date(2026, 5, 12),
    )
    parts = [_participant(1, "alice"), _participant(2, "bob")]
    busy = {1: [_block(1, datetime(2026, 5, 12, 9, 0), datetime(2026, 5, 12, 9, 30))], 2: []}
    slots = build_timetable(meeting, parts, busy)
    # 06:00-24:00 = 18 hours × 2 slots/hour = 36 30-min slots.
    assert len(slots) == 36
    assert slots[0]["start"] == datetime(2026, 5, 12, 6, 0)
    assert slots[0]["end"] == datetime(2026, 5, 12, 6, 30)
    assert slots[-1]["start"] == datetime(2026, 5, 12, 23, 30)
    # 06:00-06:30 — neither alice nor bob busy → both free.
    assert slots[0]["available_count"] == 2
    # 09:00-09:30 — alice is in that exact slot → only bob free.
    nine = next(s for s in slots if s["start"] == datetime(2026, 5, 12, 9, 0))
    assert nine["available_count"] == 1
    assert nine["available_nicknames"] == ["bob"]
    nine_thirty = next(s for s in slots if s["start"] == datetime(2026, 5, 12, 9, 30))
    assert nine_thirty["available_count"] == 2
    assert sorted(nine_thirty["available_nicknames"]) == ["alice", "bob"]
