"""Unit tests for the deterministic template LLM adapter (v3 — Q9 single-call recommend)."""
from __future__ import annotations

from datetime import date, datetime, time

from app.db.models import Meeting
from app.services.llm import get_llm_adapter
from app.services.llm.template import TemplateAdapter
from app.services.scheduler import CandidateWindow


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
        offline_buffer_minutes=30,
        time_window_start=time(9, 0),
        time_window_end=time(22, 0),
        include_weekends=False,
        created_at=datetime(2026, 5, 4),
    )


def _windows() -> list[CandidateWindow]:
    return [
        CandidateWindow(
            start=datetime(2026, 5, 12, 14),
            end=datetime(2026, 5, 12, 15),
            available_count=3,
            is_full_match=True,
            available_nicknames=["a", "b", "c"],
            missing_participants=[],
        ),
        CandidateWindow(
            start=datetime(2026, 5, 13, 19),
            end=datetime(2026, 5, 13, 20),
            available_count=3,
            is_full_match=True,
            available_nicknames=["a", "b", "c"],
            missing_participants=[],
        ),
    ]


def test_factory_returns_template_when_provider_template(monkeypatch) -> None:
    monkeypatch.setenv("LLM_PROVIDER", "template")
    adapter = get_llm_adapter()
    assert isinstance(adapter, TemplateAdapter)


def test_factory_explicit_provider() -> None:
    adapter = get_llm_adapter(provider="template")
    assert isinstance(adapter, TemplateAdapter)


def test_factory_unknown_provider_raises() -> None:
    import pytest

    with pytest.raises(ValueError):
        get_llm_adapter(provider="bogus")


def test_factory_only_supports_upstage_and_template() -> None:
    """v3: gemini / anthropic / openai branches are removed (Q3 + LLM provider lock)."""
    import pytest

    for legacy in ("gemini", "anthropic", "openai-direct"):
        with pytest.raises(ValueError):
            get_llm_adapter(provider=legacy)


def test_recommend_returns_summary_and_candidates() -> None:
    adapter = TemplateAdapter()
    m = _meeting()
    out = adapter.recommend(_windows(), m, max_candidates=3)
    assert isinstance(out, dict)
    assert "summary" in out and isinstance(out["summary"], str) and out["summary"]
    assert "candidates" in out
    assert len(out["candidates"]) == 2
    for cand in out["candidates"]:
        assert {"start", "end", "reason", "share_message_draft"}.issubset(cand)
        assert cand["reason"]
        assert cand["share_message_draft"]


def test_recommend_share_message_contains_title_and_time() -> None:
    adapter = TemplateAdapter()
    m = _meeting()
    out = adapter.recommend(_windows()[:1], m, max_candidates=1)
    msg = out["candidates"][0]["share_message_draft"]
    assert "팀 회의" in msg
    assert "2026-05-12" in msg


def test_template_output_does_not_leak_private_event_words() -> None:
    """Template adapter sees only CandidateWindow + Meeting metadata, never
    titles/descriptions/locations of personal events. Output must be clean
    even when the test author imagines hypothetical leaks.
    """
    adapter = TemplateAdapter()
    m = _meeting()
    out = adapter.recommend(_windows(), m, max_candidates=3)
    forbidden = ("병원", "진료", "데이트")
    for cand in out["candidates"]:
        for word in forbidden:
            assert word not in cand["reason"]
            assert word not in cand["share_message_draft"]
    for word in forbidden:
        assert word not in out["summary"]


def test_recommendation_payload_contains_only_safe_fields() -> None:
    adapter = TemplateAdapter()
    m = _meeting()
    payload = adapter.build_recommendation_payload(_windows(), m, max_candidates=3)
    assert set(payload.keys()) == {"meeting", "rules", "candidate_windows"}
    assert set(payload["meeting"].keys()) == {
        "title",
        "location_type",
        "duration_minutes",
        "offline_buffer_minutes",
    }
    assert set(payload["rules"].keys()) == {"slot_unit_minutes", "max_candidates"}
    for window in payload["candidate_windows"]:
        assert set(window.keys()) == {
            "start",
            "end",
            "available_count",
            "is_full_match",
            "available_participants",
            "unavailable_participants",
        }
