"""Unit tests for UpstageAdapter privacy invariants (S11).

The build_recommendation_payload() dict is the only thing handed to the
LLM. The privacy guard:
- payload contains ONLY meeting metadata + candidate_windows
- candidate_windows entries contain ONLY {start, end, available_count,
  is_full_match, available_participants, unavailable_participants}
- NEVER busy_block titles / descriptions / locations
- NEVER strings like "병원" / "진료" / "데이트" even if such names appeared
  in raw ICS source events

This file uses a spy that captures the payload BEFORE any OpenAI call so
the test runs without network and without UPSTAGE_API_KEY.
"""
from __future__ import annotations

import json
from datetime import date, datetime, time

import pytest

from app.db.models import Meeting
from app.services.llm.upstage import UpstageAdapter
from app.services.scheduler import CandidateWindow


def _meeting(buffer: int = 30) -> Meeting:  # noqa: ARG001 — kept for call-site compat
    # #13 follow-up: meeting-level offline_buffer_minutes was dropped.
    return Meeting(
        slug="abc12345",
        title="팀 회의",
        date_mode="range",
        date_range_start=date(2026, 5, 11),
        date_range_end=date(2026, 5, 15),
        candidate_dates=None,
        duration_minutes=60,
        location_type="offline",
        time_window_start=time(9, 0),
        time_window_end=time(22, 0),
        include_weekends=False,
        created_at=datetime(2026, 5, 4),
    )


def _windows() -> list[CandidateWindow]:
    return [
        CandidateWindow(
            start=datetime(2026, 5, 12, 14, 0),
            end=datetime(2026, 5, 12, 15, 0),
            available_count=3,
            is_full_match=True,
            available_nicknames=["alice", "bob", "carol"],
            missing_participants=[],
        ),
        CandidateWindow(
            start=datetime(2026, 5, 13, 16, 0),
            end=datetime(2026, 5, 13, 17, 0),
            available_count=2,
            is_full_match=False,
            available_nicknames=["alice", "bob"],
            missing_participants=["carol"],
        ),
    ]


def _instantiate_adapter(monkeypatch) -> UpstageAdapter:
    monkeypatch.setenv("UPSTAGE_API_KEY", "fake-key-for-test")
    monkeypatch.setenv("UPSTAGE_BASE_URL", "http://example.invalid/v1")
    return UpstageAdapter()


def test_build_payload_contains_no_event_titles(monkeypatch) -> None:
    """Even if the test author imagines busy_blocks for '병원 진료' etc, the
    payload only carries meeting metadata + windows, so private words can't
    appear. This guards against future regressions where a careless edit
    might splice raw ICS strings into the prompt.
    """
    adapter = _instantiate_adapter(monkeypatch)
    payload = adapter.build_recommendation_payload(_windows(), _meeting(), 3)
    serialized = json.dumps(payload, ensure_ascii=False)
    for forbidden in ("병원", "진료", "데이트", "위치", "장소"):
        assert forbidden not in serialized


def test_payload_top_level_keys_locked(monkeypatch) -> None:
    adapter = _instantiate_adapter(monkeypatch)
    payload = adapter.build_recommendation_payload(_windows(), _meeting(), 3)
    assert set(payload.keys()) == {"meeting", "rules", "candidate_windows"}


def test_payload_meeting_keys_locked(monkeypatch) -> None:
    adapter = _instantiate_adapter(monkeypatch)
    payload = adapter.build_recommendation_payload(_windows(), _meeting(), 3)
    assert set(payload["meeting"].keys()) == {
        "title",
        "location_type",
        "duration_minutes",
    }


def test_payload_window_keys_locked(monkeypatch) -> None:
    adapter = _instantiate_adapter(monkeypatch)
    payload = adapter.build_recommendation_payload(_windows(), _meeting(), 3)
    for w in payload["candidate_windows"]:
        assert set(w.keys()) == {
            "start",
            "end",
            "available_count",
            "is_full_match",
            "available_participants",
            "unavailable_participants",
        }


def test_recommend_passes_safe_payload_to_openai(monkeypatch) -> None:
    """Spy on the OpenAI client to capture the user prompt and assert it
    only carries the privacy-safe payload. No network call happens.
    """
    adapter = _instantiate_adapter(monkeypatch)
    captured: dict = {}

    class _SpyChoiceMsg:
        def __init__(self, content: str):
            self.content = content

    class _SpyChoice:
        def __init__(self, content: str):
            self.message = _SpyChoiceMsg(content)

    class _SpyResponse:
        def __init__(self, content: str):
            self.choices = [_SpyChoice(content)]

    class _SpyChatCompletions:
        def create(self, *, model, temperature, messages):
            captured["model"] = model
            captured["temperature"] = temperature
            captured["messages"] = list(messages)
            valid_payload = {
                "summary": "오후 시간대 추천",
                "candidates": [
                    {
                        "start": "2026-05-12T14:00:00",
                        "end": "2026-05-12T15:00:00",
                        "reason": "오후 집중 시간대",
                        "share_message_draft": "안내",
                    }
                ],
            }
            return _SpyResponse(json.dumps(valid_payload, ensure_ascii=False))

    class _SpyChat:
        def __init__(self):
            self.completions = _SpyChatCompletions()

    class _SpyClient:
        chat = _SpyChat()

    adapter._client = _SpyClient()
    adapter._model = "solar-pro3"

    out = adapter.recommend(_windows(), _meeting(), max_candidates=3)
    assert "summary" in out
    assert "candidates" in out

    user_msg = captured["messages"][1]
    assert user_msg["role"] == "user"
    user_content = user_msg["content"]
    for forbidden in ("병원", "진료", "데이트"):
        assert forbidden not in user_content


def test_constructor_raises_when_api_key_missing(monkeypatch) -> None:
    monkeypatch.delenv("UPSTAGE_API_KEY", raising=False)
    with pytest.raises(RuntimeError):
        UpstageAdapter()
