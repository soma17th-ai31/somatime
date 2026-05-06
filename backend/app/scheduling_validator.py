from __future__ import annotations

from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo


KST = ZoneInfo("Asia/Seoul")
SLOT_UNIT_MINUTES = 30
OFFLINE_BUFFER_MINUTES = 30


class CandidateValidationError(ValueError):
    pass


def parse_datetime(value: str | datetime) -> datetime:
    if isinstance(value, datetime):
        parsed = value
    else:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))

    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=KST)
    return parsed.astimezone(KST)


def _parse_date(value: str | date) -> date:
    if isinstance(value, date):
        return value
    return date.fromisoformat(value)


def _parse_time(value: str | time) -> time:
    if isinstance(value, time):
        return value
    return time.fromisoformat(value)


def _date_range(start: date, end: date) -> list[date]:
    days = []
    cursor = start
    while cursor <= end:
        days.append(cursor)
        cursor += timedelta(days=1)
    return days


def _overlaps(start_a: datetime, end_a: datetime, start_b: datetime, end_b: datetime) -> bool:
    return start_a < end_b and start_b < end_a


def _contains(outer_start: datetime, outer_end: datetime, inner_start: datetime, inner_end: datetime) -> bool:
    return outer_start <= inner_start and inner_end <= outer_end


def _expanded_busy_block(block: dict, location_type: str) -> tuple[datetime, datetime]:
    start = parse_datetime(block["start"])
    end = parse_datetime(block["end"])
    if location_type == "offline":
        buffer = timedelta(minutes=OFFLINE_BUFFER_MINUTES)
        return start - buffer, end + buffer
    return start, end


def participant_is_available(participant: dict, start: datetime, end: datetime, location_type: str) -> bool:
    blocks = participant.get("blocks", [])
    free_blocks = [block for block in blocks if block.get("block_type") == "free"]
    busy_blocks = [block for block in blocks if block.get("block_type") == "busy"]

    if free_blocks:
        is_inside_free_block = any(
            _contains(parse_datetime(block["start"]), parse_datetime(block["end"]), start, end)
            for block in free_blocks
        )
        if not is_inside_free_block:
            return False

    for block in busy_blocks:
        busy_start, busy_end = _expanded_busy_block(block, location_type)
        if _overlaps(start, end, busy_start, busy_end):
            return False

    return True


def availability_for_window(participants: list[dict], start: datetime, end: datetime, location_type: str) -> dict:
    available = []
    unavailable = []
    for participant in participants:
        nickname = participant["nickname"]
        if participant_is_available(participant, start, end, location_type):
            available.append(nickname)
        else:
            unavailable.append(nickname)
    return {
        "available_participants": available,
        "unavailable_participants": unavailable,
        "available_count": len(available),
        "is_full_match": len(available) == len(participants),
    }


def generate_candidate_windows(meeting: dict) -> list[tuple[datetime, datetime]]:
    start_date = _parse_date(meeting["start_date"])
    end_date = _parse_date(meeting["end_date"])
    daily_start_time = _parse_time(meeting["daily_start_time"])
    daily_end_time = _parse_time(meeting["daily_end_time"])
    duration = timedelta(minutes=int(meeting["duration_minutes"]))
    step = timedelta(minutes=SLOT_UNIT_MINUTES)

    windows = []
    for current_date in _date_range(start_date, end_date):
        cursor = datetime.combine(current_date, daily_start_time, tzinfo=KST)
        day_end = datetime.combine(current_date, daily_end_time, tzinfo=KST)
        while cursor + duration <= day_end:
            windows.append((cursor, cursor + duration))
            cursor += step
    return windows


def compute_best_available_count(meeting: dict, participants: list[dict]) -> int:
    windows = generate_candidate_windows(meeting)
    if not windows:
        return 0
    return max(
        availability_for_window(participants, start, end, meeting["location_type"])["available_count"]
        for start, end in windows
    )


def build_timetable(meeting: dict, participants: list[dict]) -> list[dict]:
    start_date = _parse_date(meeting["start_date"])
    end_date = _parse_date(meeting["end_date"])
    daily_start_time = _parse_time(meeting["daily_start_time"])
    daily_end_time = _parse_time(meeting["daily_end_time"])
    step = timedelta(minutes=SLOT_UNIT_MINUTES)

    slots = []
    for current_date in _date_range(start_date, end_date):
        cursor = datetime.combine(current_date, daily_start_time, tzinfo=KST)
        day_end = datetime.combine(current_date, daily_end_time, tzinfo=KST)
        while cursor + step <= day_end:
            end = cursor + step
            availability = availability_for_window(participants, cursor, end, meeting["location_type"])
            slots.append(
                {
                    "start": cursor.isoformat(),
                    "end": end.isoformat(),
                    **availability,
                }
            )
            cursor = end
    return slots


def build_best_candidate_fallback(meeting: dict, participants: list[dict], limit: int = 3) -> list[dict]:
    best_available_count = compute_best_available_count(meeting, participants)
    if best_available_count == 0:
        return []

    candidates = []
    for start, end in generate_candidate_windows(meeting):
        availability = availability_for_window(participants, start, end, meeting["location_type"])
        if availability["available_count"] != best_available_count:
            continue
        candidates.append(
            {
                "start": start.isoformat(),
                "end": end.isoformat(),
                "reason": "참여자 가용 시간이 가장 많이 겹치는 검증 가능한 후보입니다.",
                **availability,
            }
        )
        if len(candidates) == limit:
            break

    return candidates


def validate_and_enrich_candidates(raw_candidates: list[dict], meeting: dict, participants: list[dict]) -> list[dict]:
    duration = timedelta(minutes=int(meeting["duration_minutes"]))
    valid_windows = set((start.isoformat(), end.isoformat()) for start, end in generate_candidate_windows(meeting))
    best_available_count = compute_best_available_count(meeting, participants)
    enriched = []
    seen = set()

    for candidate in raw_candidates[:5]:
        try:
            start = parse_datetime(candidate["start"])
            end = parse_datetime(candidate["end"])
        except Exception as exc:
            raise CandidateValidationError(f"Invalid candidate datetime: {candidate}") from exc

        if end - start != duration:
            raise CandidateValidationError("Candidate duration does not match meeting duration.")

        window_key = (start.isoformat(), end.isoformat())
        if window_key not in valid_windows:
            raise CandidateValidationError("Candidate is outside the configured date or daily time range.")

        if window_key in seen:
            continue
        seen.add(window_key)

        availability = availability_for_window(participants, start, end, meeting["location_type"])
        if best_available_count > 0 and availability["available_count"] < best_available_count:
            raise CandidateValidationError("Candidate does not use the best available participant count.")

        reason = str(candidate.get("reason") or "입력된 busy/free 정보를 기준으로 추천한 시간입니다.")[:240]
        enriched.append(
            {
                "start": start.isoformat(),
                "end": end.isoformat(),
                "reason": reason,
                **availability,
            }
        )

        if len(enriched) == 3:
            break

    if best_available_count > 0 and not enriched:
        raise CandidateValidationError("No valid candidates were returned.")
    return enriched
