"""Unit tests for v3 scheduler features.

Covers:
- variable offline buffer (Q8): 30 / 60 / 120 minute exclusion correctness
- `any` location applies the buffer (Q8 — v3 reversal)
- picked date mode: only listed dates produce windows (Q5)
- empty windows when there are zero free intersections
- enumerate_search_dates honors include_weekends only in range mode
- validate_and_enrich raises CandidateValidationError on bogus LLM output
"""
from __future__ import annotations

from datetime import date, datetime, time

import pytest

from app.db.models import BusyBlock, Meeting, Participant
from app.services.scheduler import (
    CandidateValidationError,
    CandidateWindow,
    deterministic_top_candidates,
    enumerate_search_dates,
    generate_candidate_windows,
    validate_and_enrich,
)


def _make_meeting(
    *,
    location: str = "offline",
    buffer: int = 30,
    duration: int = 60,
    date_mode: str = "range",
    start_date: date = date(2026, 5, 12),
    end_date: date = date(2026, 5, 12),
    candidate_dates=None,
    include_weekends: bool = True,
    window_start: time = time(9, 0),
    window_end: time = time(22, 0),
    target: int = 1,  # noqa: ARG001 — accepted for back-compat
) -> Meeting:
    # v3.1: participant_count column dropped; scheduler is unaffected.
    del target
    return Meeting(
        slug="abc12345",
        title="meeting",
        date_mode=date_mode,
        date_range_start=start_date if date_mode == "range" else None,
        date_range_end=end_date if date_mode == "range" else None,
        candidate_dates=candidate_dates,
        duration_minutes=duration,
        location_type=location,
        offline_buffer_minutes=buffer,
        time_window_start=window_start,
        time_window_end=window_end,
        include_weekends=include_weekends,
        created_at=datetime(2026, 5, 4),
    )


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
    return BusyBlock(participant_id=pid, start_at=start, end_at=end)


# ============================================================================
# variable buffer
# ============================================================================


def test_buffer_30_excludes_adjacent_slot() -> None:
    meeting = _make_meeting(location="offline", buffer=30, duration=60)
    parts = [_participant(1, "a")]
    busy = {
        1: [
            _block(1, datetime(2026, 5, 12, 12, 0), datetime(2026, 5, 12, 13, 30)),
            _block(1, datetime(2026, 5, 12, 14, 30), datetime(2026, 5, 12, 16, 0)),
        ]
    }
    windows = generate_candidate_windows(meeting, busy, participants=parts)
    starts = {w.start for w in windows}
    # 13:30-14:30 violates the 30-min buffer (touches busy on both sides).
    assert datetime(2026, 5, 12, 13, 30) not in starts


def test_buffer_60_excludes_a_wider_slot() -> None:
    meeting = _make_meeting(location="offline", buffer=60, duration=60)
    parts = [_participant(1, "a")]
    busy = {
        1: [
            _block(1, datetime(2026, 5, 12, 12, 0), datetime(2026, 5, 12, 13, 30)),
            _block(1, datetime(2026, 5, 12, 14, 30), datetime(2026, 5, 12, 16, 0)),
        ]
    }
    windows = generate_candidate_windows(meeting, busy, participants=parts)
    starts = {w.start for w in windows}
    # buffer=60 still excludes 13:30 (busy ends 13:30, need free until 14:30).
    assert datetime(2026, 5, 12, 13, 30) not in starts
    # 14:00 (would extend +60 to 16:00 hits busy 14:30-16:00) also excluded.
    assert datetime(2026, 5, 12, 14, 0) not in starts


def test_buffer_120_excludes_a_much_wider_slot() -> None:
    meeting = _make_meeting(location="offline", buffer=120, duration=60)
    parts = [_participant(1, "a")]
    busy = {
        1: [_block(1, datetime(2026, 5, 12, 12, 0), datetime(2026, 5, 12, 13, 0))]
    }
    windows = generate_candidate_windows(meeting, busy, participants=parts)
    starts = {w.start for w in windows}
    # buffer=120 means a slot starting at 14:30 still violates: check_start = 12:30, busy 12-13 overlaps.
    assert datetime(2026, 5, 12, 14, 0) not in starts
    assert datetime(2026, 5, 12, 14, 30) not in starts
    # 15:00-16:00 with check window [13:00, 18:00] overlaps busy 12-13? No, overlap is [start, end). 13:00 is the boundary; busy_block.end_at=13:00 doesn't overlap.
    assert datetime(2026, 5, 12, 15, 0) in starts


# ============================================================================
# any-location buffer (v3)
# ============================================================================


def test_any_location_applies_buffer_v3() -> None:
    """v3 (Q8): location=any now applies offline_buffer_minutes (was buffer=0 in v2)."""
    meeting = _make_meeting(location="any", buffer=30, duration=60)
    parts = [_participant(1, "a")]
    busy = {
        1: [
            _block(1, datetime(2026, 5, 12, 12, 0), datetime(2026, 5, 12, 13, 30)),
            _block(1, datetime(2026, 5, 12, 14, 30), datetime(2026, 5, 12, 16, 0)),
        ]
    }
    windows = generate_candidate_windows(meeting, busy, participants=parts)
    starts = {w.start for w in windows}
    assert datetime(2026, 5, 12, 13, 30) not in starts


def test_online_location_ignores_buffer() -> None:
    meeting = _make_meeting(location="online", buffer=120, duration=60)
    parts = [_participant(1, "a")]
    busy = {
        1: [
            _block(1, datetime(2026, 5, 12, 12, 0), datetime(2026, 5, 12, 13, 30)),
            _block(1, datetime(2026, 5, 12, 14, 30), datetime(2026, 5, 12, 16, 0)),
        ]
    }
    windows = generate_candidate_windows(meeting, busy, participants=parts)
    starts = {w.start for w in windows}
    # online: buffer always 0 regardless of offline_buffer_minutes.
    assert datetime(2026, 5, 12, 13, 30) in starts


# ============================================================================
# picked mode (Q5)
# ============================================================================


def test_picked_mode_returns_only_listed_dates() -> None:
    meeting = _make_meeting(
        location="online",
        date_mode="picked",
        candidate_dates=["2026-05-07", "2026-05-09", "2026-05-10"],
        start_date=None,
        end_date=None,
    )
    dates = enumerate_search_dates(meeting)
    assert dates == [date(2026, 5, 7), date(2026, 5, 9), date(2026, 5, 10)]


def test_picked_mode_skips_unlisted_dates_in_windows() -> None:
    meeting = _make_meeting(
        location="online",
        date_mode="picked",
        candidate_dates=["2026-05-07", "2026-05-09", "2026-05-10"],
        start_date=None,
        end_date=None,
    )
    parts = [_participant(1, "a")]
    busy: dict[int, list] = {1: []}
    windows = generate_candidate_windows(meeting, busy, participants=parts, max_windows=200)
    dates_in_windows = {w.start.date() for w in windows}
    assert date(2026, 5, 8) not in dates_in_windows
    # Listed dates may produce windows.
    assert date(2026, 5, 7) in dates_in_windows
    assert date(2026, 5, 9) in dates_in_windows
    assert date(2026, 5, 10) in dates_in_windows


def test_picked_mode_with_date_objects_directly() -> None:
    """candidate_dates may be a list of date objects (round-tripped from JSON)."""
    meeting = _make_meeting(
        location="online",
        date_mode="picked",
        candidate_dates=[date(2026, 5, 9), date(2026, 5, 7)],
        start_date=None,
        end_date=None,
    )
    dates = enumerate_search_dates(meeting)
    assert dates == [date(2026, 5, 7), date(2026, 5, 9)]


def test_range_mode_respects_include_weekends() -> None:
    meeting = _make_meeting(
        location="online",
        date_mode="range",
        start_date=date(2026, 5, 9),  # Saturday
        end_date=date(2026, 5, 11),  # Monday
        include_weekends=False,
    )
    dates = enumerate_search_dates(meeting)
    assert dates == [date(2026, 5, 11)]


# ============================================================================
# empty windows
# ============================================================================


def test_empty_windows_when_no_free_intersection() -> None:
    meeting = _make_meeting(location="online", duration=60, target=2)
    parts = [_participant(1, "a"), _participant(2, "b")]
    busy = {
        1: [_block(1, datetime(2026, 5, 12, 9, 0), datetime(2026, 5, 12, 22, 0))],
        2: [_block(2, datetime(2026, 5, 12, 9, 0), datetime(2026, 5, 12, 22, 0))],
    }
    windows = generate_candidate_windows(meeting, busy, participants=parts)
    assert windows == []


# ============================================================================
# validate_and_enrich
# ============================================================================


def test_validate_and_enrich_accepts_matching_window() -> None:
    meeting = _make_meeting(location="online", duration=60)
    windows = [
        CandidateWindow(
            start=datetime(2026, 5, 12, 14, 0),
            end=datetime(2026, 5, 12, 15, 0),
            available_count=2,
            is_full_match=True,
            available_nicknames=["a", "b"],
            missing_participants=[],
        ),
    ]
    enriched = validate_and_enrich(
        [
            {
                "start": "2026-05-12T14:00:00",
                "end": "2026-05-12T15:00:00",
                "reason": "오후 집중 시간대",
                "share_message_draft": "안내 메시지",
            }
        ],
        windows,
        meeting,
    )
    assert len(enriched) == 1
    assert enriched[0].start == datetime(2026, 5, 12, 14, 0)
    assert enriched[0].available_count == 2  # taken from window, not LLM
    assert enriched[0].reason == "오후 집중 시간대"
    assert enriched[0].share_message_draft == "안내 메시지"


def test_validate_and_enrich_rejects_unknown_window() -> None:
    meeting = _make_meeting(location="online", duration=60)
    windows = [
        CandidateWindow(
            start=datetime(2026, 5, 12, 14, 0),
            end=datetime(2026, 5, 12, 15, 0),
            available_count=2,
            is_full_match=True,
            available_nicknames=["a", "b"],
            missing_participants=[],
        ),
    ]
    with pytest.raises(CandidateValidationError):
        validate_and_enrich(
            [
                {
                    "start": "2026-05-13T14:00:00",  # not in windows
                    "end": "2026-05-13T15:00:00",
                    "reason": "x",
                    "share_message_draft": "y",
                }
            ],
            windows,
            meeting,
        )


def test_validate_and_enrich_rejects_blank_share_message() -> None:
    meeting = _make_meeting(location="online", duration=60)
    windows = [
        CandidateWindow(
            start=datetime(2026, 5, 12, 14, 0),
            end=datetime(2026, 5, 12, 15, 0),
            available_count=2,
            is_full_match=True,
            available_nicknames=["a", "b"],
            missing_participants=[],
        ),
    ]
    with pytest.raises(CandidateValidationError):
        validate_and_enrich(
            [
                {
                    "start": "2026-05-12T14:00:00",
                    "end": "2026-05-12T15:00:00",
                    "reason": "오후",
                    "share_message_draft": "",
                }
            ],
            windows,
            meeting,
        )


def test_validate_and_enrich_rejects_empty_list() -> None:
    meeting = _make_meeting(location="online", duration=60)
    windows: list[CandidateWindow] = []
    with pytest.raises(CandidateValidationError):
        validate_and_enrich([], windows, meeting)


# ============================================================================
# deterministic_top_candidates
# ============================================================================


def test_deterministic_top_candidates_picks_full_match() -> None:
    windows = [
        CandidateWindow(
            start=datetime(2026, 5, 12, 14, 0),
            end=datetime(2026, 5, 12, 15, 0),
            available_count=2,
            is_full_match=True,
            available_nicknames=["a", "b"],
            missing_participants=[],
        ),
        CandidateWindow(
            start=datetime(2026, 5, 12, 17, 0),
            end=datetime(2026, 5, 12, 18, 0),
            available_count=1,
            is_full_match=False,
            available_nicknames=["a"],
            missing_participants=["b"],
        ),
    ]
    out = deterministic_top_candidates(windows, max_candidates=3)
    # full-match wins on rank.
    assert out[0].available_count == 2


def test_deterministic_top_candidates_empty_when_no_windows() -> None:
    assert deterministic_top_candidates([]) == []
