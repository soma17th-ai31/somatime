"""Deterministic scheduling engine.

Pure code. NEVER calls an LLM. NEVER reads busy block titles/descriptions.

Spec sections 6 and 6.1 are the source of truth for:
- 30-min slot grid
- weekday filter (include_weekends toggle)
- time window
- offline buffer
- ranking (available_count desc, time-spread vs prior chosen >= 2h, earlier date)
- fallback: drop 1 missing participant; if still empty, return ([], suggestion).
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, time, timedelta
from typing import Dict, List, Optional, Sequence, Set, Tuple

from app.db.models import BusyBlock, Meeting, Participant
from app.schemas.candidate import Candidate

SLOT_MINUTES = 30
BUFFER_MINUTES = 30
SPREAD_MIN_MINUTES = 120  # "2h+ apart" rule


@dataclass(frozen=True)
class Slot:
    """An immutable candidate slot in KST naive datetime."""

    start: datetime
    end: datetime


def calculate_candidates(
    meeting: Meeting,
    busy_blocks_by_participant: Dict[int, List[BusyBlock]],
    max_candidates: int = 3,
    participants: Optional[Sequence[Participant]] = None,
) -> Tuple[List[Candidate], Optional[str]]:
    """Compute up to max_candidates candidate slots.

    Args:
        meeting: meeting metadata.
        busy_blocks_by_participant: map participant_id -> list of busy blocks.
            Participants missing from the dict are treated as fully available.
        max_candidates: cap on the returned candidate list.
        participants: optional ordered Participant list. If provided, used to
            attach nicknames to missing_participants. If absent, missing
            participants are surfaced by id (str(id)).

    Returns:
        (candidates, suggestion). When candidates is non-empty, suggestion is None.
    """
    nickname_map = _nickname_map(participants, busy_blocks_by_participant)
    participant_ids = list(nickname_map.keys())

    candidate_slots = _enumerate_slots(meeting)
    if not candidate_slots:
        return [], _build_suggestion(meeting, reason="no_valid_slots")

    # Phase 1: full participant set must be available.
    full_candidates = _rank_candidates(
        candidate_slots,
        busy_blocks_by_participant,
        meeting,
        required_count=len(participant_ids),
        participant_ids=participant_ids,
        nickname_map=nickname_map,
        max_candidates=max_candidates,
    )
    if full_candidates:
        return full_candidates, None

    # Phase 2: fallback — accept slots where exactly 1 participant is missing.
    fallback_required = max(1, len(participant_ids) - 1)
    fallback_candidates = _rank_candidates(
        candidate_slots,
        busy_blocks_by_participant,
        meeting,
        required_count=fallback_required,
        participant_ids=participant_ids,
        nickname_map=nickname_map,
        max_candidates=max_candidates,
        annotate_missing=True,
    )
    if fallback_candidates:
        return fallback_candidates, None

    return [], _build_suggestion(meeting, reason="no_intersection")


# ----------------------------------------------------------------------------- helpers


def _nickname_map(
    participants: Optional[Sequence[Participant]],
    busy_blocks_by_participant: Dict[int, List[BusyBlock]],
) -> Dict[int, str]:
    if participants:
        return {p.id: p.nickname for p in participants}
    return {pid: str(pid) for pid in busy_blocks_by_participant.keys()}


def _enumerate_slots(meeting: Meeting) -> List[Slot]:
    """Generate every candidate slot of length duration_minutes that fits inside
    [time_window_start, time_window_end] for each in-range weekday-respecting day."""
    duration = timedelta(minutes=meeting.duration_minutes)
    step = timedelta(minutes=SLOT_MINUTES)

    slots: List[Slot] = []
    current_day: date = meeting.date_range_start
    while current_day <= meeting.date_range_end:
        if meeting.include_weekends or current_day.weekday() < 5:
            window_start = datetime.combine(current_day, _floor_time(meeting.time_window_start))
            window_end = datetime.combine(current_day, meeting.time_window_end)
            slot_start = window_start
            while slot_start + duration <= window_end:
                slots.append(Slot(start=slot_start, end=slot_start + duration))
                slot_start += step
        current_day += timedelta(days=1)
    return slots


def _floor_time(t: time) -> time:
    """Floor a time to a 30-min boundary."""
    minute = (t.minute // SLOT_MINUTES) * SLOT_MINUTES
    return time(t.hour, minute)


def _is_participant_free(
    busy_blocks: Sequence[BusyBlock],
    range_start: datetime,
    range_end: datetime,
) -> bool:
    """Return True iff none of the participant's busy blocks overlap [start, end)."""
    for block in busy_blocks:
        if block.start_at < range_end and block.end_at > range_start:
            return False
    return True


def _check_slot(
    slot: Slot,
    busy_blocks_by_participant: Dict[int, List[BusyBlock]],
    meeting: Meeting,
    participant_ids: Sequence[int],
) -> Tuple[Set[int], Set[int]]:
    """Return (available_ids, missing_ids) for the slot.

    Applies the offline buffer (extends both sides by 30 min) when meeting.location_type
    is 'offline'. 'online' and 'any' do not get a buffer.
    """
    if meeting.location_type == "offline":
        check_start = slot.start - timedelta(minutes=BUFFER_MINUTES)
        check_end = slot.end + timedelta(minutes=BUFFER_MINUTES)
    else:
        check_start = slot.start
        check_end = slot.end

    available: Set[int] = set()
    missing: Set[int] = set()
    for pid in participant_ids:
        blocks = busy_blocks_by_participant.get(pid, [])
        if _is_participant_free(blocks, check_start, check_end):
            available.add(pid)
        else:
            missing.add(pid)
    return available, missing


def _rank_candidates(
    slots: Sequence[Slot],
    busy_blocks_by_participant: Dict[int, List[BusyBlock]],
    meeting: Meeting,
    required_count: int,
    participant_ids: Sequence[int],
    nickname_map: Dict[int, str],
    max_candidates: int,
    annotate_missing: bool = False,
) -> List[Candidate]:
    """Greedy selection respecting the spec ranking rules."""
    qualifying: List[Tuple[Slot, Set[int], Set[int]]] = []
    for slot in slots:
        available, missing = _check_slot(slot, busy_blocks_by_participant, meeting, participant_ids)
        if len(available) >= required_count:
            qualifying.append((slot, available, missing))

    if not qualifying:
        return []

    # Sort by primary criteria: available_count desc, then earlier start.
    qualifying.sort(key=lambda item: (-len(item[1]), item[0].start))

    chosen: List[Tuple[Slot, Set[int], Set[int]]] = []
    for entry in qualifying:
        if not chosen:
            chosen.append(entry)
            continue
        # Prefer entries that are >= 2h apart from every prior chosen slot.
        if all(_minutes_apart(entry[0], prior[0]) >= SPREAD_MIN_MINUTES for prior in chosen):
            chosen.append(entry)
        if len(chosen) >= max_candidates:
            break

    # If fewer than max_candidates passed the spread filter, top up with the
    # next-highest-ranked entries even if they violate the spread rule.
    if len(chosen) < max_candidates:
        for entry in qualifying:
            if entry in chosen:
                continue
            chosen.append(entry)
            if len(chosen) >= max_candidates:
                break

    return [
        _to_candidate(slot, available, missing, nickname_map, annotate_missing)
        for slot, available, missing in chosen
    ]


def _minutes_apart(a: Slot, b: Slot) -> int:
    delta = abs((a.start - b.start).total_seconds()) / 60.0
    return int(delta)


def _to_candidate(
    slot: Slot,
    available: Set[int],
    missing: Set[int],
    nickname_map: Dict[int, str],
    annotate_missing: bool,
) -> Candidate:
    missing_nicks = sorted(nickname_map[pid] for pid in missing if pid in nickname_map)
    note: Optional[str] = None
    if annotate_missing and missing_nicks:
        if len(missing_nicks) == 1:
            note = f"{missing_nicks[0]}님 제외 가능"
        else:
            note = f"{', '.join(missing_nicks)}님 제외 가능"
    weekday = ["월", "화", "수", "목", "금", "토", "일"][slot.start.weekday()]
    reason = (
        f"참여자 {len(available)}명 가능, {weekday}요일 {slot.start.strftime('%H:%M')}"
    )
    return Candidate(
        start=slot.start,
        end=slot.end,
        available_count=len(available),
        missing_participants=missing_nicks if annotate_missing else [],
        reason=reason,
        note=note,
    )


def _build_suggestion(meeting: Meeting, reason: str) -> str:
    """Deterministic fallback suggestion text. Used when LLM is unavailable.

    Privacy: only meeting title and structured metadata are referenced.
    """
    if reason == "no_valid_slots":
        return (
            "선택한 날짜 범위와 시간대에 가능한 슬롯이 없습니다. "
            "날짜 범위를 넓히거나 시간대를 조정하거나 주말 포함을 켜보세요."
        )
    return (
        "모든 참여자가 함께 가능한 시간이 없습니다. "
        "회의 길이를 줄이거나 날짜 범위를 넓히거나 주말 포함을 켜보세요."
    )


# ----------------------------------------------------------------------------- timetable


def build_timetable(
    meeting: Meeting,
    participants: Sequence[Participant],
    busy_blocks_by_participant: Dict[int, List[BusyBlock]],
) -> List[dict]:
    """Build 30-min timetable slots within the meeting window.

    Each slot is a dict {start, end, available_count, available_nicknames}.
    Privacy: only nicknames are exposed (S10).
    """
    step = timedelta(minutes=SLOT_MINUTES)
    nickname_map = {p.id: p.nickname for p in participants}
    participant_ids = [p.id for p in participants]

    out: List[dict] = []
    current_day: date = meeting.date_range_start
    while current_day <= meeting.date_range_end:
        if meeting.include_weekends or current_day.weekday() < 5:
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
        current_day += timedelta(days=1)
    return out
