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
    # Phase D — recognized_phrases is always present; template adapter
    # produces an empty list.
    assert body["recognized_phrases"] == []


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
                "recognized_phrases": ["월 9-12시 불가", "화 19시~ 불가"],
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
    assert body["recognized_phrases"] == ["월 9-12시 불가", "화 19시~ 불가"]


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


def test_recognized_phrases_missing_key_normalizes_to_empty_list(
    client, monkeypatch
) -> None:
    """LLM omitting recognized_phrases yields []; response field still present."""

    class _FakeAdapter:
        def parse_availability(self, text, meeting):
            return {
                "busy_blocks": [
                    {"start": "2026-05-12T09:00:00", "end": "2026-05-12T10:00:00"},
                ],
                "summary": "ok",
                # no recognized_phrases key
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
    assert body["recognized_phrases"] == []


def test_recognized_phrases_drops_malformed_and_caps_length(
    client, monkeypatch
) -> None:
    """Non-string / empty entries are dropped; long phrases truncated to 24 chars;
    list is capped at 6 entries."""

    class _FakeAdapter:
        def parse_availability(self, text, meeting):
            return {
                "busy_blocks": [],
                "summary": "ok",
                "recognized_phrases": [
                    "월 9-12시 불가",          # keep
                    "",                          # drop (empty)
                    "   ",                       # drop (blank)
                    123,                         # drop (non-string)
                    None,                        # drop (non-string)
                    {"x": 1},                    # drop (non-string)
                    "이건 정말 정말 정말 정말 정말 정말 긴 표현입니다",  # truncated to 24 chars
                    "화 ~18시 가능",
                    "수 종일 가능",
                    "목 12-18시",
                    "금 ~18시",
                    "주말 없음",
                    "이건 잘려나갈 7번째",       # over the 6-item cap
                ],
            }

    monkeypatch.setattr(
        "app.api.availability.get_llm_adapter", lambda *a, **k: _FakeAdapter()
    )

    data = _create_meeting(client)
    slug = data["slug"]
    _register(client, slug)

    resp = client.post(
        f"/api/meetings/{slug}/availability/natural-language/parse",
        json={"text": "월 9-12, 등등"},
    )
    assert resp.status_code == 200
    body = resp.json()
    phrases = body["recognized_phrases"]
    assert len(phrases) == 6
    assert phrases[0] == "월 9-12시 불가"
    # The long entry survived (1st valid string after the drops) and was
    # truncated to 24 characters.
    assert len(phrases[1]) <= 24
    assert phrases[1].startswith("이건 정말")


def test_recognized_phrases_non_list_drops_to_empty(client, monkeypatch) -> None:
    """If the LLM returns recognized_phrases as a non-list (e.g. a string),
    we coerce it to []."""

    class _FakeAdapter:
        def parse_availability(self, text, meeting):
            return {
                "busy_blocks": [],
                "summary": "ok",
                "recognized_phrases": "월 9-12시 불가",  # wrong type
            }

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
    assert resp.status_code == 200
    assert resp.json()["recognized_phrases"] == []


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
