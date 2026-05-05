"""Unit tests for the ICS parser.

Privacy: assert that no SUMMARY/DESCRIPTION/LOCATION text leaks into the parsed output.
"""
from __future__ import annotations

from pathlib import Path

import pytest

from app.services.ics_parser import ICSParseError, parse_ics

FIXTURES = Path(__file__).resolve().parents[1] / "fixtures"


def _read(name: str) -> bytes:
    return (FIXTURES / name).read_bytes()


def test_parses_busy_weekdays_fixture() -> None:
    blocks = parse_ics(_read("sample_busy_weekdays.ics"))
    # 5 weekday VEVENTs, each 09:00-12:00 -> 5 blocks.
    assert len(blocks) == 5
    for start, end in blocks:
        assert start.hour == 9 and start.minute == 0
        assert end.hour == 12 and end.minute == 0
        assert start.tzinfo is None  # KST naive
        assert end.tzinfo is None


def test_parses_busy_evenings_fixture() -> None:
    blocks = parse_ics(_read("sample_busy_evenings.ics"))
    assert len(blocks) == 5
    for start, end in blocks:
        assert start.hour == 18
        assert end.hour == 22


def test_parses_empty_calendar() -> None:
    blocks = parse_ics(_read("sample_empty.ics"))
    assert blocks == []


def test_invalid_empty_file_raises() -> None:
    with pytest.raises(ICSParseError):
        parse_ics(_read("invalid_empty.ics"))


def test_invalid_corrupt_file_raises() -> None:
    with pytest.raises(ICSParseError):
        parse_ics(_read("invalid_corrupt.ics"))


def test_parser_does_not_leak_summary_or_description() -> None:
    """Even if the ICS contains 'morning-busy', the returned tuples are pure datetimes."""
    blocks = parse_ics(_read("sample_busy_weekdays.ics"))
    for item in blocks:
        # Each block is exactly (start, end). No 3rd element, no string content.
        assert len(item) == 2
        for value in item:
            assert hasattr(value, "year")  # datetime-like
            assert not isinstance(value, str)


def test_30_min_normalization_floors_start_and_ceils_end() -> None:
    # 12:15 -> 12:00, end 13:35 -> 14:00
    ics = b"""BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//SomaMeet//Test//EN
BEGIN:VTIMEZONE
TZID:Asia/Seoul
BEGIN:STANDARD
DTSTART:19700101T000000
TZOFFSETFROM:+0900
TZOFFSETTO:+0900
TZNAME:KST
END:STANDARD
END:VTIMEZONE
BEGIN:VEVENT
UID:t@somameet.test
DTSTAMP:20260504T000000Z
DTSTART;TZID=Asia/Seoul:20260512T121500
DTEND;TZID=Asia/Seoul:20260512T133500
SUMMARY:secret
END:VEVENT
END:VCALENDAR
"""
    blocks = parse_ics(ics)
    assert len(blocks) == 1
    start, end = blocks[0]
    assert start.hour == 12 and start.minute == 0
    assert end.hour == 14 and end.minute == 0


def test_overlapping_events_are_merged() -> None:
    ics = b"""BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//SomaMeet//Test//EN
BEGIN:VTIMEZONE
TZID:Asia/Seoul
BEGIN:STANDARD
DTSTART:19700101T000000
TZOFFSETFROM:+0900
TZOFFSETTO:+0900
TZNAME:KST
END:STANDARD
END:VTIMEZONE
BEGIN:VEVENT
UID:a@x
DTSTAMP:20260504T000000Z
DTSTART;TZID=Asia/Seoul:20260512T100000
DTEND;TZID=Asia/Seoul:20260512T120000
SUMMARY:a
END:VEVENT
BEGIN:VEVENT
UID:b@x
DTSTAMP:20260504T000000Z
DTSTART;TZID=Asia/Seoul:20260512T113000
DTEND;TZID=Asia/Seoul:20260512T130000
SUMMARY:b
END:VEVENT
END:VCALENDAR
"""
    blocks = parse_ics(ics)
    assert len(blocks) == 1
    start, end = blocks[0]
    assert start.hour == 10 and end.hour == 13
