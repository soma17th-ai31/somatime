"""ICS parsing.

Privacy invariant: this module returns ONLY (start_at, end_at) tuples.
SUMMARY, DESCRIPTION, LOCATION, ORGANIZER, ATTENDEE fields are never
returned and never logged.
"""
from __future__ import annotations

from datetime import date, datetime, timedelta
from typing import List, Tuple

from app.services.availability import normalize_and_merge
from app.services.timezones import to_kst_naive


class ICSParseError(Exception):
    """Raised on empty/corrupt/unsupported ICS input."""


def parse_ics(content: bytes) -> List[Tuple[datetime, datetime]]:
    """Parse an ICS payload and return KST-naive (start, end) pairs.

    - Strips all metadata fields. Only DTSTART/DTEND timing is preserved.
    - Normalizes to 30-minute slot boundaries (floor start / ceil end).
    - Merges overlapping intervals.
    - Raises ICSParseError on unparseable / empty input.
    """
    if not content or not content.strip():
        raise ICSParseError("Empty ICS payload")

    try:
        from icalendar import Calendar
    except ImportError as exc:  # pragma: no cover
        raise ICSParseError("icalendar package is required") from exc

    try:
        cal = Calendar.from_ical(content)
    except Exception as exc:
        raise ICSParseError(f"Failed to parse ICS: {exc}") from exc

    raw_blocks: List[Tuple[datetime, datetime]] = []
    found_calendar_marker = False

    for component in cal.walk():
        if component.name == "VCALENDAR":
            found_calendar_marker = True
        if component.name != "VEVENT":
            continue

        dtstart = component.get("DTSTART")
        dtend = component.get("DTEND")
        if dtstart is None:
            continue

        start_value = dtstart.dt
        if dtend is not None:
            end_value = dtend.dt
        else:
            duration = component.get("DURATION")
            if duration is not None:
                try:
                    end_value = start_value + duration.dt
                except Exception:
                    continue
            else:
                continue

        start_dt = _coerce_datetime(start_value)
        end_dt = _coerce_datetime(end_value, end_of_day_if_date=True)
        if end_dt <= start_dt:
            continue

        raw_blocks.append((to_kst_naive(start_dt), to_kst_naive(end_dt)))

    if not found_calendar_marker:
        raise ICSParseError("No VCALENDAR root in ICS payload")

    return normalize_and_merge(raw_blocks)


def _coerce_datetime(value: object, *, end_of_day_if_date: bool = False) -> datetime:
    """Coerce icalendar dt value (date or datetime) to a datetime.

    All-day VEVENTs use date objects; treat start as 00:00 KST and end as
    next-day 00:00 KST so a full 24h is busy.
    """
    if isinstance(value, datetime):
        return value
    if isinstance(value, date):
        if end_of_day_if_date:
            return datetime(value.year, value.month, value.day) + timedelta(days=1)
        return datetime(value.year, value.month, value.day)
    raise ICSParseError(f"Unsupported DTSTART/DTEND type: {type(value)!r}")
