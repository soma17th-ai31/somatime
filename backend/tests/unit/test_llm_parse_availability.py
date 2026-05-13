"""Unit tests for LLMAdapter.parse_availability (v3.28 — NL availability input)."""
from __future__ import annotations

from datetime import date, datetime

from app.db.models import Meeting
from app.services.llm.template import TemplateAdapter


def _meeting() -> Meeting:
    return Meeting(
        slug="abc12345",
        title="팀 회의",
        date_mode="range",
        date_range_start=date(2026, 5, 11),
        date_range_end=date(2026, 5, 15),
        candidate_dates=None,
        duration_minutes=60,
        location_type="online",
        include_weekends=False,
        created_at=datetime(2026, 5, 4),
    )


def test_template_parse_availability_returns_empty_blocks_with_summary() -> None:
    """Template fallback explains it can't parse NL and yields empty busy_blocks."""
    adapter = TemplateAdapter()
    out = adapter.parse_availability("월요일 9-12 수업 있음", _meeting())

    assert isinstance(out, dict)
    assert out["busy_blocks"] == []
    assert isinstance(out["summary"], str)
    assert "템플릿" in out["summary"]
    # Phase D — chip phrases default to an empty list in template mode.
    assert out["recognized_phrases"] == []


def test_parse_availability_payload_includes_meeting_dates_and_window() -> None:
    """Privacy-safe payload exposes only public meeting info + text."""
    adapter = TemplateAdapter()
    m = _meeting()
    payload = adapter.build_availability_parse_payload("월요일 9-12 수업", m)

    assert set(payload.keys()) == {"meeting", "text"}
    assert set(payload["meeting"].keys()) == {
        "title",
        "dates",
        "window_start",
        "window_end_inclusive",
    }
    assert payload["meeting"]["title"] == "팀 회의"
    # 5/11 (월) ~ 5/15 (금), weekends excluded → 5 weekdays.
    assert payload["meeting"]["dates"] == [
        "2026-05-11",
        "2026-05-12",
        "2026-05-13",
        "2026-05-14",
        "2026-05-15",
    ]
    assert payload["meeting"]["window_start"] == "06:00"
    assert payload["meeting"]["window_end_inclusive"] == "24:00"
    assert payload["text"] == "월요일 9-12 수업"


def test_parse_availability_payload_picked_mode_uses_candidate_dates() -> None:
    """date_mode=picked surfaces only the explicit candidate_dates."""
    adapter = TemplateAdapter()
    m = _meeting()
    m.date_mode = "picked"
    m.date_range_start = None
    m.date_range_end = None
    m.candidate_dates = ["2026-05-12", "2026-05-14"]

    payload = adapter.build_availability_parse_payload("화요일만 가능", m)
    assert payload["meeting"]["dates"] == ["2026-05-12", "2026-05-14"]


def test_parse_availability_payload_does_not_leak_private_data() -> None:
    """Payload must NOT include busy_blocks, participant identities, etc."""
    adapter = TemplateAdapter()
    m = _meeting()
    payload = adapter.build_availability_parse_payload("월 9-12 수업", m)
    # Top-level: only meeting + text.
    assert set(payload.keys()) == {"meeting", "text"}
    # Within meeting: nothing about participants or busy blocks.
    forbidden = {"participants", "busy_blocks", "events", "location_type", "duration_minutes"}
    assert forbidden.isdisjoint(payload["meeting"].keys())
