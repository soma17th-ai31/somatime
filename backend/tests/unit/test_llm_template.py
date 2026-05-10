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


def test_recommend_share_message_full_format_same_day() -> None:
    """issue #26 + bracket-title — full 5-line format with [title] header."""
    adapter = TemplateAdapter()
    m = _meeting()
    out = adapter.recommend(_windows()[:1], m, max_candidates=1)
    msg = out["candidates"][0]["share_message_draft"]
    expected = (
        "[팀 회의] 일정 안내드립니다.\n"
        "\n"
        "날짜: 5/12 (화)\n"
        "시간: 14:00 - 15:00\n"
        "장소: 온라인"
    )
    assert msg == expected
    # No single-quotes around title.
    assert "'팀 회의'" not in msg
    # Old joined line must be gone.
    assert "일시:" not in msg


def test_share_message_title_wrapped_in_brackets() -> None:
    """bracket-title — non-empty title is wrapped in [] on the header line."""
    from app.services.llm.base import render_template_share_message

    m = _meeting()
    msg = render_template_share_message(m, _windows()[0])
    # First line must start with [<title>] and end with the standard suffix.
    first_line = msg.split("\n", 1)[0]
    assert first_line == "[팀 회의] 일정 안내드립니다."
    # Bare title (without brackets) followed by 일정 must NOT appear at line start.
    assert not msg.startswith("팀 회의 일정")


def test_share_message_empty_title_drops_prefix_and_no_quotes() -> None:
    """issue #26 — empty title produces a clean header with no stray quotes."""
    adapter = TemplateAdapter()
    m = _meeting()
    m.title = ""
    out = adapter.recommend(_windows()[:1], m, max_candidates=1)
    msg = out["candidates"][0]["share_message_draft"]
    expected = (
        "일정 안내드립니다.\n"
        "\n"
        "날짜: 5/12 (화)\n"
        "시간: 14:00 - 15:00\n"
        "장소: 온라인"
    )
    assert msg == expected
    assert "''" not in msg
    assert "' '" not in msg


def test_share_message_whitespace_only_title_treated_as_empty() -> None:
    """Whitespace-only title is stripped and treated as empty."""
    from app.services.llm.base import render_template_share_message

    m = _meeting()
    m.title = "   "
    msg = render_template_share_message(m, _windows()[0])
    assert msg.startswith("일정 안내드립니다.\n\n")


def test_share_message_blank_line_between_header_and_body() -> None:
    """issue #26 — first line followed by a blank line then 날짜:."""
    from app.services.llm.base import render_template_share_message

    m = _meeting()
    msg = render_template_share_message(m, _windows()[0])
    lines = msg.split("\n")
    assert lines[0] == "[팀 회의] 일정 안내드립니다."
    assert lines[1] == ""
    assert lines[2].startswith("날짜: ")
    assert lines[3].startswith("시간: ")
    assert lines[4].startswith("장소: ")


def test_share_message_single_digit_month_day_no_padding() -> None:
    """issue #26 — 1/3 not 01/03."""
    from app.services.llm.base import render_template_share_message

    m = _meeting()
    win = CandidateWindow(
        start=datetime(2026, 1, 3, 9),
        end=datetime(2026, 1, 3, 10),
        available_count=1,
        is_full_match=True,
        available_nicknames=["a"],
        missing_participants=[],
    )
    msg = render_template_share_message(m, win)
    assert "날짜: 1/3 (토)" in msg
    assert "시간: 09:00 - 10:00" in msg
    assert "01/03" not in msg


def test_share_message_midnight_boundary_expands_date_line() -> None:
    """issue #26 — when start/end days differ, 날짜 line lists both dates."""
    from app.services.llm.base import render_template_share_message

    m = _meeting()
    m.title = "야간"
    win = CandidateWindow(
        start=datetime(2026, 5, 12, 23, 30),
        end=datetime(2026, 5, 13, 0, 30),
        available_count=1,
        is_full_match=True,
        available_nicknames=["a"],
        missing_participants=[],
    )
    msg = render_template_share_message(m, win)
    expected = (
        "[야간] 일정 안내드립니다.\n"
        "\n"
        "날짜: 5/12 (화) - 5/13 (수)\n"
        "시간: 23:30 - 00:30\n"
        "장소: 온라인"
    )
    assert msg == expected


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
