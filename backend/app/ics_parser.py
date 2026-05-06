from __future__ import annotations

from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo

from icalendar import Calendar


KST = ZoneInfo("Asia/Seoul")


def _to_datetime(value: object) -> datetime:
    if isinstance(value, datetime):
        parsed = value
    elif isinstance(value, date):
        parsed = datetime.combine(value, time.min)
    else:
        raise ValueError("Unsupported ICS datetime value")

    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=KST)
    return parsed.astimezone(KST)


def parse_ics_busy_blocks(content: bytes) -> list[dict[str, str]]:
    calendar = Calendar.from_ical(content)
    blocks: list[dict[str, str]] = []

    for component in calendar.walk("VEVENT"):
        dtstart = component.get("dtstart")
        if dtstart is None:
            continue

        start = _to_datetime(dtstart.dt)
        dtend = component.get("dtend")
        duration = component.get("duration")

        if dtend is not None:
            end = _to_datetime(dtend.dt)
        elif duration is not None:
            end = start + duration.dt
        else:
            end = start + timedelta(hours=1)

        if end > start:
            blocks.append({"start": start.isoformat(), "end": end.isoformat()})

    return blocks
