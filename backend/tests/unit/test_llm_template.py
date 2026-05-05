"""Unit tests for the deterministic template LLM adapter and privacy guarantees."""
from __future__ import annotations

from datetime import date, datetime, time

from app.db.models import Meeting
from app.schemas.candidate import Candidate
from app.services.llm import get_llm_adapter
from app.services.llm.base import Slot
from app.services.llm.template import TemplateAdapter


def _meeting() -> Meeting:
    return Meeting(
        slug="abc12345",
        organizer_token="x" * 32,
        title="팀 회의",
        date_range_start=date(2026, 5, 11),
        date_range_end=date(2026, 5, 15),
        duration_minutes=60,
        participant_count=3,
        location_type="online",
        time_window_start=time(9, 0),
        time_window_end=time(22, 0),
        include_weekends=False,
        created_at=datetime(2026, 5, 4),
    )


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


def test_recommendation_reasons_match_candidate_count() -> None:
    adapter = TemplateAdapter()
    m = _meeting()
    candidates = [
        Candidate(
            start=datetime(2026, 5, 12, 14),
            end=datetime(2026, 5, 12, 15),
            available_count=3,
        ),
        Candidate(
            start=datetime(2026, 5, 13, 16),
            end=datetime(2026, 5, 13, 17),
            available_count=3,
        ),
    ]
    reasons = adapter.generate_recommendation_reasons(candidates, m)
    assert len(reasons) == len(candidates)
    for r in reasons:
        assert isinstance(r, str) and r


def test_share_message_contains_title_and_time() -> None:
    adapter = TemplateAdapter()
    m = _meeting()
    msg = adapter.generate_share_message(
        m,
        Slot(start=datetime(2026, 5, 12, 14), end=datetime(2026, 5, 12, 15)),
        ["a", "b", "c"],
    )
    assert "팀 회의" in msg
    assert "2026-05-12" in msg


def test_template_output_does_not_leak_private_event_words() -> None:
    """Even if the *context* of a candidate hypothetically came from an event called
    '병원 진료' or '데이트', the template adapter never emits those words because
    it only sees Candidate dataclasses (no titles/descriptions/locations).
    """
    adapter = TemplateAdapter()
    m = _meeting()

    # Candidates carry zero private-event content.
    candidates = [
        Candidate(
            start=datetime(2026, 5, 12, 14),
            end=datetime(2026, 5, 12, 15),
            available_count=3,
        ),
        Candidate(
            start=datetime(2026, 5, 13, 19),
            end=datetime(2026, 5, 13, 20),
            available_count=3,
        ),
    ]
    reasons = adapter.generate_recommendation_reasons(candidates, m)
    share = adapter.generate_share_message(
        m,
        Slot(start=candidates[0].start, end=candidates[0].end),
        ["a", "b", "c"],
    )
    forbidden = ("병원", "진료", "데이트")
    for word in forbidden:
        for r in reasons:
            assert word not in r
        assert word not in share


def test_recommendation_payload_contains_only_safe_fields() -> None:
    adapter = TemplateAdapter()
    m = _meeting()
    candidates = [
        Candidate(
            start=datetime(2026, 5, 12, 14),
            end=datetime(2026, 5, 12, 15),
            available_count=3,
        )
    ]
    payload = adapter.build_recommendation_payload(candidates, m)
    assert set(payload.keys()) == {"title", "location_type", "duration_minutes", "candidates"}
    for cand in payload["candidates"]:
        assert set(cand.keys()) == {"start_iso", "end_iso", "available_count", "missing"}
