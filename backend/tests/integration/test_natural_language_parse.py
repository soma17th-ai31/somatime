"""Integration tests for POST /api/meetings/{slug}/availability/natural-language/parse.

The conftest forces LLM_PROVIDER=template, so the endpoint will exercise
TemplateAdapter.parse_availability (empty blocks + explanatory summary) by
default. Tests that need real LLM-style output monkeypatch
get_llm_adapter() to inject a fake adapter.
"""
from __future__ import annotations

from datetime import date, datetime

import pytest


def _create_meeting(client) -> dict:
    body = {
        "title": "팀 회의",
        "date_range_start": "2026-05-11",
        "date_range_end": "2026-05-15",
        "duration_minutes": 60,
        "location_type": "online",
        "include_weekends": False,
    }
    resp = client.post("/api/meetings", json=body)
    assert resp.status_code == 201, resp.text
    return resp.json()


def _register(client, slug: str, nickname: str = "alice") -> None:
    resp = client.post(
        f"/api/meetings/{slug}/participants",
        json={"nickname": nickname, "buffer_minutes": 60},
    )
    assert resp.status_code in (200, 201), resp.text


def test_template_mode_returns_empty_blocks_with_summary(client) -> None:
    data = _create_meeting(client)
    slug = data["slug"]
    _register(client, slug)

    resp = client.post(
        f"/api/meetings/{slug}/availability/natural-language/parse",
        json={"text": "월요일은 9시부터 12시까지 수업 있음."},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["busy_blocks"] == []
    assert isinstance(body["summary"], str) and body["summary"]


def test_empty_text_returns_422(client) -> None:
    data = _create_meeting(client)
    slug = data["slug"]
    _register(client, slug)

    resp = client.post(
        f"/api/meetings/{slug}/availability/natural-language/parse",
        json={"text": "   "},
    )
    # Pydantic field validator -> validation_error envelope (422).
    assert resp.status_code == 422


def test_text_too_long_returns_422(client) -> None:
    data = _create_meeting(client)
    slug = data["slug"]
    _register(client, slug)

    long_text = "a" * 2001
    resp = client.post(
        f"/api/meetings/{slug}/availability/natural-language/parse",
        json={"text": long_text},
    )
    assert resp.status_code == 422


def test_requires_participant_cookie(client) -> None:
    """No cookie -> 403 participant_required."""
    data = _create_meeting(client)
    slug = data["slug"]

    # Drop cookies between the create and the call.
    client.cookies.clear()
    resp = client.post(
        f"/api/meetings/{slug}/availability/natural-language/parse",
        json={"text": "월요일 9-12 수업"},
    )
    assert resp.status_code == 403
    assert resp.json()["error_code"] == "participant_required"


def test_llm_parsed_blocks_pass_through(client, monkeypatch) -> None:
    """Inject a fake adapter that returns real busy_blocks; endpoint normalizes
    and returns them as KST-naive ISO strings."""

    class _FakeAdapter:
        def parse_availability(self, text, meeting):
            return {
                "busy_blocks": [
                    {
                        "start": "2026-05-11T09:00:00",
                        "end": "2026-05-11T12:00:00",
                    },
                    {
                        "start": "2026-05-12T19:00:00",
                        "end": "2026-05-13T00:00:00",
                    },
                ],
                "summary": "월 오전 + 화 저녁 이후 불가능.",
            }

    monkeypatch.setattr(
        "app.api.availability.get_llm_adapter", lambda *a, **k: _FakeAdapter()
    )

    data = _create_meeting(client)
    slug = data["slug"]
    _register(client, slug)

    resp = client.post(
        f"/api/meetings/{slug}/availability/natural-language/parse",
        json={"text": "월 9-12 수업, 화 7시 이후 약속"},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["summary"] == "월 오전 + 화 저녁 이후 불가능."
    assert body["busy_blocks"] == [
        {"start": "2026-05-11T09:00:00", "end": "2026-05-11T12:00:00"},
        {"start": "2026-05-12T19:00:00", "end": "2026-05-13T00:00:00"},
    ]


def test_llm_blocks_outside_meeting_dates_are_dropped(client, monkeypatch) -> None:
    """A block on a date outside the meeting range is silently dropped."""

    class _FakeAdapter:
        def parse_availability(self, text, meeting):
            return {
                "busy_blocks": [
                    # Inside meeting (5/12).
                    {"start": "2026-05-12T09:00:00", "end": "2026-05-12T10:00:00"},
                    # Way outside.
                    {"start": "2025-01-01T09:00:00", "end": "2025-01-01T10:00:00"},
                ],
                "summary": "ok",
            }

    monkeypatch.setattr(
        "app.api.availability.get_llm_adapter", lambda *a, **k: _FakeAdapter()
    )

    data = _create_meeting(client)
    slug = data["slug"]
    _register(client, slug)

    resp = client.post(
        f"/api/meetings/{slug}/availability/natural-language/parse",
        json={"text": "월 9-10"},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["busy_blocks"] == [
        {"start": "2026-05-12T09:00:00", "end": "2026-05-12T10:00:00"},
    ]


def test_llm_malformed_block_is_skipped(client, monkeypatch) -> None:
    """A block with end<=start or unparseable ISO is silently dropped."""

    class _FakeAdapter:
        def parse_availability(self, text, meeting):
            return {
                "busy_blocks": [
                    {"start": "not-a-date", "end": "still-not"},
                    {"start": "2026-05-12T10:00:00", "end": "2026-05-12T10:00:00"},
                    {"start": "2026-05-12T09:00:00", "end": "2026-05-12T11:00:00"},
                ],
                "summary": "ok",
            }

    monkeypatch.setattr(
        "app.api.availability.get_llm_adapter", lambda *a, **k: _FakeAdapter()
    )

    data = _create_meeting(client)
    slug = data["slug"]
    _register(client, slug)

    resp = client.post(
        f"/api/meetings/{slug}/availability/natural-language/parse",
        json={"text": "월 9-11"},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["busy_blocks"] == [
        {"start": "2026-05-12T09:00:00", "end": "2026-05-12T11:00:00"},
    ]


def test_llm_network_error_returns_503(client, monkeypatch) -> None:
    """If the adapter raises a non-ValueError exception, surface llm_unavailable."""

    class _FakeAdapter:
        def parse_availability(self, text, meeting):
            raise RuntimeError("network down")

    monkeypatch.setattr(
        "app.api.availability.get_llm_adapter", lambda *a, **k: _FakeAdapter()
    )

    data = _create_meeting(client)
    slug = data["slug"]
    _register(client, slug)

    resp = client.post(
        f"/api/meetings/{slug}/availability/natural-language/parse",
        json={"text": "월 9-12"},
    )
    assert resp.status_code == 503
    assert resp.json()["error_code"] == "llm_unavailable"


def test_llm_value_error_returns_500_llm_parse_failed(client, monkeypatch) -> None:
    """JSON parse failure surfaces as llm_parse_failed (500)."""
    import json as _json

    class _FakeAdapter:
        def parse_availability(self, text, meeting):
            raise _json.JSONDecodeError("expecting value", "doc", 0)

    monkeypatch.setattr(
        "app.api.availability.get_llm_adapter", lambda *a, **k: _FakeAdapter()
    )

    data = _create_meeting(client)
    slug = data["slug"]
    _register(client, slug)

    resp = client.post(
        f"/api/meetings/{slug}/availability/natural-language/parse",
        json={"text": "월 9-12"},
    )
    assert resp.status_code == 500
    assert resp.json()["error_code"] == "llm_parse_failed"
