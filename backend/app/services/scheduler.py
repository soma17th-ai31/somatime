"""Deterministic scheduling engine (v3).

Pure code. NEVER calls an LLM. NEVER reads busy block titles/descriptions.

Spec sections 4 / 7 / 7.1 are the source of truth for:
- 30-min slot grid
- weekday filter (include_weekends toggle)
- time window
- offline buffer (variable: 30/60/90/120, Q8)
- date_mode: range vs picked (Q5)
- ranking: available_count desc, time-spread vs prior chosen >= 2h, earlier date
- fallback: drop 1 missing participant; if still empty, return ([], suggestion)

v3 changes:
- enumerate_search_dates(meeting) honors meeting.date_mode.
- generate_candidate_windows(...) uses meeting.offline_buffer_minutes.
- "any" now applies the same buffer as "offline" (Q8 — v2->v3 reversal).
- deterministic_top_candidates(...) is the unified ranker for /calculate
  AND /recommend's fallback path.
- validate_and_enrich(...) re-validates LLM-supplied candidates against
  windows; raises CandidateValidationError on any mismatch.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, datetime, time, timedelta
from typing import Dict, List, Optional, Sequence, Set, Tuple

from app.db.models import BusyBlock, Meeting, Participant
from app.schemas.candidate import Candidate

SLOT_MINUTES = 30
BUFFER_MINUTES = 30  # legacy default, kept for backward-compat tests
SPREAD_MIN_MINUTES = 120  # "2h+ apart" rule
DEFAULT_MAX_WINDOWS = 40


class CandidateValidationError(ValueError):
    """Raised when an LLM-supplied candidate cannot be matched to a window."""


@dataclass(frozen=True)
class Slot:
    """An immutable candidate slot in KST naive datetime."""

    start: datetime
    end: datetime


@dataclass(frozen=True)
class CandidateWindow:
    """A candidate window built deterministically (spec §7.1)."""

    start: datetime
    end: datetime
    available_count: int
    is_full_match: bool
    available_nicknames: List[str] = field(default_factory=list)
    missing_participants: List[str] = field(default_factory=list)


# ============================================================================
# Public v3 API
# ============================================================================


def enumerate_search_dates(meeting: Meeting) -> List[date]:
    """Return all dates the scheduler should search.

    range mode: every date between date_range_start and date_range_end
                inclusive. include_weekends toggle filters Sat/Sun.
    picked mode: exactly the dates listed in candidate_dates (no weekend
                filter — picked dates are explicitly chosen).
    """
    mode = (getattr(meeting, "date_mode", None) or "range").lower()

    if mode == "picked":
        raw_dates = list(meeting.candidate_dates or [])
        normalized: List[date] = []
        for d in raw_dates:
            if isinstance(d, date):
                normalized.append(d)
            elif isinstance(d, str):
                normalized.append(date.fromisoformat(d))
            else:
                raise ValueError(f"unsupported candidate_date type: {type(d)!r}")
        # Sort + de-duplicate while preserving order.
        seen: Set[date] = set()
        out: List[date] = []
        for d in normalized:
            if d not in seen:
                seen.add(d)
                out.append(d)
        out.sort()
        return out

    # default: range mode
    if meeting.date_range_start is None or meeting.date_range_end is None:
        return []
    out_range: List[date] = []
    current = meeting.date_range_start
    while current <= meeting.date_range_end:
        if meeting.include_weekends or current.weekday() < 5:
            out_range.append(current)
        current += timedelta(days=1)
    return out_range


def generate_candidate_windows(
    meeting: Meeting,
    busy_blocks_by_participant: Dict[int, List[BusyBlock]],
    *,
    participants: Optional[Sequence[Participant]] = None,
    max_windows: int = DEFAULT_MAX_WINDOWS,
) -> List[CandidateWindow]:
    """Deterministic candidate windows for a meeting.

    Iterates the 30-min grid across enumerate_search_dates, applies
    meeting.offline_buffer_minutes for offline AND any locations
    (online == buffer 0), and returns up to max_windows windows ordered
    by ranking (available_count desc, then earliest start).

    Includes both full-match and partial-match windows so that LLM has
    enough context to choose; consumers can filter as needed.
    """
    nickname_map = _nickname_map(participants, busy_blocks_by_participant)
    participant_ids = list(nickname_map.keys())

    slots = _enumerate_slots_v3(meeting)
    if not slots:
        return []

    full_target = len(participant_ids)
    windows: List[CandidateWindow] = []

    for slot in slots:
        available, missing = _check_slot(
            slot=slot,
            busy_blocks_by_participant=busy_blocks_by_participant,
            buffer_minutes_by_pid=_build_buffer_by_pid(
                meeting, participants, participant_ids
            ),
            participant_ids=participant_ids,
        )
        if not available:
            continue
        windows.append(
            CandidateWindow(
                start=slot.start,
                end=slot.end,
                available_count=len(available),
                is_full_match=(len(available) == full_target and full_target > 0),
                available_nicknames=sorted(nickname_map[pid] for pid in available),
                missing_participants=sorted(nickname_map[pid] for pid in missing),
            )
        )

    # Rank: available_count desc, earlier start.
    windows.sort(key=lambda w: (-w.available_count, w.start))
    return windows[:max_windows]


def deterministic_top_candidates(
    windows: Sequence[CandidateWindow],
    max_candidates: int = 3,
) -> List[Candidate]:
    """Pick top candidates from windows per the spec §7 ranking table.

    1. available_count desc
    2. >=2h spread vs already-chosen
    3. earlier date

    Used by both /calculate and /recommend deterministic fallback.
    """
    if not windows:
        return []

    # If any window has the maximum available_count and is a full match,
    # we still allow lower-count windows when no full match exists.
    best_available = max(w.available_count for w in windows)
    candidates_pool = [w for w in windows if w.available_count == best_available]

    # Phase 1: pick spread.
    chosen: List[CandidateWindow] = []
    for w in candidates_pool:
        if not chosen:
            chosen.append(w)
            continue
        if all(_minutes_between(w, prior) >= SPREAD_MIN_MINUTES for prior in chosen):
            chosen.append(w)
        if len(chosen) >= max_candidates:
            break

    # Phase 2: top-up with next-best from same available_count.
    if len(chosen) < max_candidates:
        for w in candidates_pool:
            if w not in chosen:
                chosen.append(w)
                if len(chosen) >= max_candidates:
                    break

    # Phase 3: if still short, allow lower available_count windows (fallback).
    if len(chosen) < max_candidates:
        for w in windows:
            if w not in chosen:
                chosen.append(w)
                if len(chosen) >= max_candidates:
                    break

    return [_window_to_candidate(w) for w in chosen]


def validate_and_enrich(
    llm_candidates: Sequence[dict],
    windows: Sequence[CandidateWindow],
    meeting: Meeting,
) -> List[Candidate]:
    """Re-validate LLM-supplied candidates against deterministic windows.

    For each entry the LLM produced:
    - start / end must match a window in `windows` (exact KST datetime)
    - reason / share_message_draft are kept as-is
    - available_count / available_nicknames / missing_participants come from
      the matched window (NEVER from the LLM)

    Raises:
        CandidateValidationError if any candidate cannot be matched, if
        required fields are missing, or if the list is empty.
    """
    if not llm_candidates:
        raise CandidateValidationError("LLM returned 0 candidates")

    by_key = {(_strip_tz(_to_dt(w.start)), _strip_tz(_to_dt(w.end))): w for w in windows}

    out: List[Candidate] = []
    for entry in llm_candidates:
        if not isinstance(entry, dict):
            raise CandidateValidationError(f"candidate is not an object: {entry!r}")
        try:
            start_dt = _strip_tz(_to_dt(entry["start"]))
            end_dt = _strip_tz(_to_dt(entry["end"]))
        except KeyError as exc:
            raise CandidateValidationError(
                f"candidate missing field: {exc.args[0]}"
            ) from exc
        except (TypeError, ValueError) as exc:
            raise CandidateValidationError(
                f"candidate has invalid datetime: {exc}"
            ) from exc

        window = by_key.get((start_dt, end_dt))
        if window is None:
            raise CandidateValidationError(
                f"candidate {start_dt}-{end_dt} not in candidate_windows"
            )

        reason = entry.get("reason") or ""
        share = entry.get("share_message_draft") or ""
        if not isinstance(reason, str) or not reason.strip():
            raise CandidateValidationError("candidate.reason missing or blank")
        if not isinstance(share, str) or not share.strip():
            raise CandidateValidationError("candidate.share_message_draft missing or blank")

        out.append(
            Candidate(
                start=window.start,
                end=window.end,
                available_count=window.available_count,
                missing_participants=list(window.missing_participants),
                reason=reason.strip(),
                share_message_draft=share.strip(),
                note=None,
            )
        )

    return out


# ============================================================================
# Legacy /calculate API (kept for backward-compat tests)
# ============================================================================


def calculate_candidates(
    meeting: Meeting,
    busy_blocks_by_participant: Dict[int, List[BusyBlock]],
    max_candidates: int = 3,
    participants: Optional[Sequence[Participant]] = None,
) -> Tuple[List[Candidate], Optional[str]]:
    """Compute up to max_candidates candidate slots (legacy entry).

    Backward-compat wrapper used by the existing /calculate route + unit
    tests. Internally re-uses generate_candidate_windows so the v3 buffer
    rules (any == offline) flow through.
    """
    nickname_map = _nickname_map(participants, busy_blocks_by_participant)
    participant_ids = list(nickname_map.keys())

    slots = _enumerate_slots_v3(meeting)
    if not slots:
        return [], _build_suggestion(meeting, reason="no_valid_slots")

    full_target = len(participant_ids)
    full_windows: List[CandidateWindow] = []
    fallback_windows: List[CandidateWindow] = []

    for slot in slots:
        available, missing = _check_slot(
            slot=slot,
            busy_blocks_by_participant=busy_blocks_by_participant,
            buffer_minutes_by_pid=_build_buffer_by_pid(
                meeting, participants, participant_ids
            ),
            participant_ids=participant_ids,
        )
        avail_count = len(available)
        if avail_count == full_target and full_target > 0:
            full_windows.append(
                CandidateWindow(
                    start=slot.start,
                    end=slot.end,
                    available_count=avail_count,
                    is_full_match=True,
                    available_nicknames=sorted(nickname_map[pid] for pid in available),
                    missing_participants=[],
                )
            )
        elif full_target > 1 and avail_count == full_target - 1:
            fallback_windows.append(
                CandidateWindow(
                    start=slot.start,
                    end=slot.end,
                    available_count=avail_count,
                    is_full_match=False,
                    available_nicknames=sorted(nickname_map[pid] for pid in available),
                    missing_participants=sorted(nickname_map[pid] for pid in missing),
                )
            )

    if full_windows:
        full_windows.sort(key=lambda w: (-w.available_count, w.start))
        chosen = _spread_pick(full_windows, max_candidates)
        return [_window_to_candidate_with_reason(w, meeting) for w in chosen], None

    if fallback_windows:
        fallback_windows.sort(key=lambda w: (-w.available_count, w.start))
        chosen = _spread_pick(fallback_windows, max_candidates)
        return [
            _window_to_candidate_with_reason(w, meeting, annotate_missing=True)
            for w in chosen
        ], None

    return [], _build_suggestion(meeting, reason="no_intersection")


# ============================================================================
# Helpers
# ============================================================================


def _effective_buffer_minutes(
    meeting: Meeting, participant: Optional[Participant] = None
) -> int:
    """Per-participant effective buffer (issue #13).

    Rules (in order):
      * online meeting → 0, regardless of personal override.
      * participant.buffer_minutes IS NOT NULL → that value (personal override).
      * otherwise → meeting.offline_buffer_minutes (the meeting-level default).
    """
    if meeting.location_type == "online":
        return 0
    if participant is not None and participant.buffer_minutes is not None:
        return int(participant.buffer_minutes)
    return int(getattr(meeting, "offline_buffer_minutes", None) or BUFFER_MINUTES)


def _build_buffer_by_pid(
    meeting: Meeting,
    participants: Optional[Sequence[Participant]],
    participant_ids: Sequence[int],
) -> Dict[int, int]:
    """Map pid → effective buffer minutes for this meeting+participant.

    Falls back to the meeting-level default for any pid that doesn't appear
    in ``participants`` (e.g. tests that drive the scheduler with pids alone).
    """
    out: Dict[int, int] = {}
    by_id: Dict[int, Participant] = (
        {p.id: p for p in participants} if participants else {}
    )
    default_buffer = _effective_buffer_minutes(meeting)
    for pid in participant_ids:
        p = by_id.get(pid)
        out[pid] = _effective_buffer_minutes(meeting, p) if p is not None else default_buffer
    return out


def _nickname_map(
    participants: Optional[Sequence[Participant]],
    busy_blocks_by_participant: Dict[int, List[BusyBlock]],
) -> Dict[int, str]:
    if participants:
        return {p.id: p.nickname for p in participants}
    return {pid: str(pid) for pid in busy_blocks_by_participant.keys()}


def _enumerate_slots_v3(meeting: Meeting) -> List[Slot]:
    duration = timedelta(minutes=meeting.duration_minutes)
    step = timedelta(minutes=SLOT_MINUTES)

    slots: List[Slot] = []
    for current_day in enumerate_search_dates(meeting):
        window_start = datetime.combine(current_day, _floor_time(meeting.time_window_start))
        window_end = datetime.combine(current_day, meeting.time_window_end)
        slot_start = window_start
        while slot_start + duration <= window_end:
            slots.append(Slot(start=slot_start, end=slot_start + duration))
            slot_start += step
    return slots


def _floor_time(t: time) -> time:
    minute = (t.minute // SLOT_MINUTES) * SLOT_MINUTES
    return time(t.hour, minute)


def _is_participant_free(
    busy_blocks: Sequence[BusyBlock],
    range_start: datetime,
    range_end: datetime,
) -> bool:
    for block in busy_blocks:
        if block.start_at < range_end and block.end_at > range_start:
            return False
    return True


def _check_slot(
    *,
    slot: Slot,
    busy_blocks_by_participant: Dict[int, List[BusyBlock]],
    buffer_minutes_by_pid: Dict[int, int],
    participant_ids: Sequence[int],
) -> Tuple[Set[int], Set[int]]:
    """Per-participant gating (issue #13).

    Each pid is checked against ``[slot.start - their_buffer, slot.end +
    their_buffer]``, so participants with a larger personal buffer may be
    excluded from a window where shorter-buffer peers are fine.
    """
    available: Set[int] = set()
    missing: Set[int] = set()
    for pid in participant_ids:
        buf = buffer_minutes_by_pid.get(pid, 0)
        if buf:
            check_start = slot.start - timedelta(minutes=buf)
            check_end = slot.end + timedelta(minutes=buf)
        else:
            check_start = slot.start
            check_end = slot.end
        blocks = busy_blocks_by_participant.get(pid, [])
        if _is_participant_free(blocks, check_start, check_end):
            available.add(pid)
        else:
            missing.add(pid)
    return available, missing


def _spread_pick(
    sorted_windows: Sequence[CandidateWindow],
    max_candidates: int,
) -> List[CandidateWindow]:
    chosen: List[CandidateWindow] = []
    for w in sorted_windows:
        if not chosen:
            chosen.append(w)
            continue
        if all(_minutes_between(w, prior) >= SPREAD_MIN_MINUTES for prior in chosen):
            chosen.append(w)
        if len(chosen) >= max_candidates:
            break
    if len(chosen) < max_candidates:
        for w in sorted_windows:
            if w not in chosen:
                chosen.append(w)
                if len(chosen) >= max_candidates:
                    break
    return chosen


def _minutes_between(a: CandidateWindow, b: CandidateWindow) -> int:
    delta = abs((a.start - b.start).total_seconds()) / 60.0
    return int(delta)


def _window_to_candidate(w: CandidateWindow) -> Candidate:
    return Candidate(
        start=w.start,
        end=w.end,
        available_count=w.available_count,
        missing_participants=list(w.missing_participants),
        reason=None,
        share_message_draft=None,
        note=None,
    )


def _window_to_candidate_with_reason(
    w: CandidateWindow,
    meeting: Meeting,
    annotate_missing: bool = False,
) -> Candidate:
    weekday = ["월", "화", "수", "목", "금", "토", "일"][w.start.weekday()]
    reason = (
        f"참여자 {w.available_count}명 가능, {weekday}요일 {w.start.strftime('%H:%M')}"
    )
    note: Optional[str] = None
    if annotate_missing and w.missing_participants:
        if len(w.missing_participants) == 1:
            note = f"{w.missing_participants[0]}님 제외 가능"
        else:
            note = f"{', '.join(w.missing_participants)}님 제외 가능"
    return Candidate(
        start=w.start,
        end=w.end,
        available_count=w.available_count,
        missing_participants=list(w.missing_participants) if annotate_missing else [],
        reason=reason,
        share_message_draft=None,
        note=note,
    )


def _build_suggestion(meeting: Meeting, reason: str) -> str:
    if reason == "no_valid_slots":
        return (
            "선택한 날짜 범위와 시간대에 가능한 슬롯이 없습니다. "
            "날짜 범위를 넓히거나 시간대를 조정하거나 주말 포함을 켜보세요."
        )
    return (
        "모든 참여자가 함께 가능한 시간이 없습니다. "
        "회의 길이를 줄이거나 날짜 범위를 넓히거나 주말 포함을 켜보세요."
    )


def _to_dt(value) -> datetime:
    if isinstance(value, datetime):
        return value
    if isinstance(value, str):
        return datetime.fromisoformat(value)
    raise TypeError(f"cannot coerce to datetime: {value!r}")


def _strip_tz(dt: datetime) -> datetime:
    """Convert any tz-aware datetime to naive KST. Naive input passes through."""
    if dt.tzinfo is None:
        return dt
    from app.services.timezones import to_kst_naive

    return to_kst_naive(dt)


# ============================================================================
# Timetable
# ============================================================================


def build_timetable(
    meeting: Meeting,
    participants: Sequence[Participant],
    busy_blocks_by_participant: Dict[int, List[BusyBlock]],
) -> List[dict]:
    """Build 30-min timetable slots within the meeting window.

    Each slot dict: {start, end, available_count, available_nicknames}.
    Privacy: only nicknames are exposed (S10).
    """
    step = timedelta(minutes=SLOT_MINUTES)
    nickname_map = {p.id: p.nickname for p in participants}
    participant_ids = [p.id for p in participants]

    out: List[dict] = []
    for current_day in enumerate_search_dates(meeting):
        window_start = datetime.combine(current_day, _floor_time(meeting.time_window_start))
        window_end = datetime.combine(current_day, meeting.time_window_end)
        slot_start = window_start
        while slot_start + step <= window_end:
            slot_end = slot_start + step
            available_nicks: List[str] = []
            for pid in participant_ids:
                blocks = busy_blocks_by_participant.get(pid, [])
                if _is_participant_free(blocks, slot_start, slot_end):
                    available_nicks.append(nickname_map[pid])
            out.append(
                {
                    "start": slot_start,
                    "end": slot_end,
                    "available_count": len(available_nicks),
                    "available_nicknames": available_nicks,
                }
            )
            slot_start += step
    return out
