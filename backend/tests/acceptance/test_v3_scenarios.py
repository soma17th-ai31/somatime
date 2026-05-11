"""Acceptance tests for v3 (2026-05-06) decisions.

S1b — calculate / recommend gate when submitted < target (Q2)
S2  — variable offline buffer (Q8) and any-location buffer
S12 — LLM validation fail -> deterministic fallback (Q9)
S13 — LLM call count cap = 4 (Q9)
S14 — PIN optional re-entry (Q7)
S15 — date_mode picked produces only listed dates (Q5)

Note: S1 and S11 in this v3 cycle live with qa-cleanup; this file ONLY
covers the genuinely new scenarios. The pre-existing S1/S11 stay in
test_acceptance_S1_S11.py until qa-cleanup updates them.
"""
from __future__ import annotations

from typing import Iterable
from unittest.mock import patch


# ============================================================================
# helpers
# ============================================================================


def _create(client, **overrides) -> dict:
    body = {
        "title": "팀 회의",
        "date_mode": "range",
        "date_range_start": "2026-05-11",
        "date_range_end": "2026-05-15",
        "duration_minutes": 60,
        "location_type": "online",
        "include_weekends": False,
    }
    # v3.1: participant_count was retired. Drop legacy overrides.
    overrides.pop("participant_count", None)
    # #13 follow-up: meeting-level offline_buffer_minutes was dropped. Tests
    # that used to pass `offline_buffer_minutes=N` on creation now PATCH the
    # registering participant after the fact.
    overrides.pop("offline_buffer_minutes", None)
    # #57: meeting-level time_window_* fields were dropped. Tests that used
    # to pass explicit windows have those overrides silently ignored.
    overrides.pop("time_window_start", None)
    overrides.pop("time_window_end", None)
    body.update(overrides)
    resp = client.post("/api/meetings", json=body)
    assert resp.status_code == 201, resp.text
    return resp.json()


def _set_my_buffer(client, slug: str, nickname: str, buffer_minutes: int) -> None:
    """Issue #13 helper — set the calling participant's personal buffer."""
    resp = client.patch(
        f"/api/meetings/{slug}/participants/me",
        json={"nickname": nickname, "buffer_minutes": buffer_minutes},
    )
    assert resp.status_code == 200, resp.text


def _register(
    client,
    slug: str,
    nickname: str,
    pin: str | None = None,
    buffer_minutes: int = 60,
) -> dict:
    # buffer-on-join: every POST /participants must carry an explicit
    # buffer_minutes (0/30/60/90/120). Tests default to 60.
    payload: dict = {"nickname": nickname, "buffer_minutes": buffer_minutes}
    if pin is not None:
        payload["pin"] = pin
    resp = client.post(f"/api/meetings/{slug}/participants", json=payload)
    assert resp.status_code in (200, 201), resp.text
    return resp.json()


def _submit_manual(client, slug: str, busy: Iterable[tuple] = ()) -> None:
    payload = {"busy_blocks": [{"start": s, "end": e} for s, e in busy]}
    r = client.post(f"/api/meetings/{slug}/availability/manual", json=payload)
    assert r.status_code in (200, 201), r.text


# ============================================================================
# S1b — gate (v3.1 simplify pass: gate flips on submitted_count >= 1)
# ============================================================================


def test_S1b_calculate_blocked_when_no_submission(client) -> None:
    data = _create(client)
    slug = data["slug"]

    calc = client.post(f"/api/meetings/{slug}/calculate")
    assert calc.status_code == 409
    body = calc.json()
    assert body["error_code"] == "insufficient_responses"
    assert body["current"] == 0
    assert body["required"] == 1


def test_S1b_recommend_blocked_when_no_submission(client) -> None:
    data = _create(client)
    slug = data["slug"]

    rec = client.post(f"/api/meetings/{slug}/recommend")
    assert rec.status_code == 409
    body = rec.json()
    assert body["error_code"] == "insufficient_responses"
    assert body["current"] == 0
    assert body["required"] == 1


def test_S1b_calculate_unlocked_after_first_submission(client) -> None:
    data = _create(client)
    slug = data["slug"]
    _register(client, slug, "alice")
    _submit_manual(client, slug, [])

    calc = client.post(f"/api/meetings/{slug}/calculate")
    assert calc.status_code == 200, calc.text


def test_S1b_get_meeting_reports_is_ready_to_calculate_false_when_zero(client) -> None:
    data = _create(client)
    slug = data["slug"]

    detail = client.get(f"/api/meetings/{slug}")
    assert detail.status_code == 200
    body = detail.json()
    assert body["submitted_count"] == 0
    assert body["is_ready_to_calculate"] is False
    assert "target_count" not in body
    assert "participant_count" not in body


def test_S1b_get_meeting_reports_is_ready_to_calculate_true_after_one(client) -> None:
    data = _create(client)
    slug = data["slug"]
    _register(client, slug, "alice")
    _submit_manual(client, slug, [])

    detail = client.get(f"/api/meetings/{slug}")
    assert detail.status_code == 200
    body = detail.json()
    assert body["submitted_count"] == 1
    assert body["is_ready_to_calculate"] is True


# ============================================================================
# S2 — variable offline buffer
# ============================================================================


def test_S2_buffer_30_excludes_borderline(client) -> None:
    busy = [
        ("2026-05-12T12:00:00+09:00", "2026-05-12T13:30:00+09:00"),
        ("2026-05-12T14:30:00+09:00", "2026-05-12T16:00:00+09:00"),
    ]
    data = _create(
        client,
        location_type="offline",
        date_range_start="2026-05-12",
        date_range_end="2026-05-12",
    )
    _register(client, data["slug"], "alice")
    _set_my_buffer(client, data["slug"], "alice", 30)
    _submit_manual(client, data["slug"], busy)
    calc = client.post(f"/api/meetings/{data['slug']}/calculate")
    assert calc.status_code == 200
    starts = {c["start"] for c in calc.json()["candidates"]}
    assert "2026-05-12T13:30:00+09:00" not in starts


def test_S2_buffer_60_excludes_a_wider_zone(client) -> None:
    busy = [
        ("2026-05-12T12:00:00+09:00", "2026-05-12T13:30:00+09:00"),
        ("2026-05-12T14:30:00+09:00", "2026-05-12T16:00:00+09:00"),
    ]
    data = _create(
        client,
        location_type="offline",
        date_range_start="2026-05-12",
        date_range_end="2026-05-12",
    )
    _register(client, data["slug"], "alice")
    _set_my_buffer(client, data["slug"], "alice", 60)
    _submit_manual(client, data["slug"], busy)
    calc = client.post(f"/api/meetings/{data['slug']}/calculate")
    starts = {c["start"] for c in calc.json()["candidates"]}
    assert "2026-05-12T13:30:00+09:00" not in starts
    # buffer=60 excludes 14:00 too (busy 14:30-16:00 within +60 buffer).
    assert "2026-05-12T14:00:00+09:00" not in starts


def test_S2_buffer_120_excludes_even_wider(client) -> None:
    busy = [
        ("2026-05-12T12:00:00+09:00", "2026-05-12T13:00:00+09:00"),
    ]
    data = _create(
        client,
        location_type="offline",
        date_range_start="2026-05-12",
        date_range_end="2026-05-12",
    )
    _register(client, data["slug"], "alice")
    _set_my_buffer(client, data["slug"], "alice", 120)
    _submit_manual(client, data["slug"], busy)
    calc = client.post(f"/api/meetings/{data['slug']}/calculate")
    starts = {c["start"] for c in calc.json()["candidates"]}
    assert "2026-05-12T14:30:00+09:00" not in starts


def test_S2_any_location_applies_buffer_v3(client) -> None:
    """v3 (Q8): any-location applies the personal buffer."""
    busy = [
        ("2026-05-12T12:00:00+09:00", "2026-05-12T13:30:00+09:00"),
        ("2026-05-12T14:30:00+09:00", "2026-05-12T16:00:00+09:00"),
    ]
    data = _create(
        client,
        location_type="any",
        date_range_start="2026-05-12",
        date_range_end="2026-05-12",
    )
    _register(client, data["slug"], "alice")
    _set_my_buffer(client, data["slug"], "alice", 30)
    _submit_manual(client, data["slug"], busy)
    calc = client.post(f"/api/meetings/{data['slug']}/calculate")
    starts = {c["start"] for c in calc.json()["candidates"]}
    assert "2026-05-12T13:30:00+09:00" not in starts


def test_S2_online_ignores_buffer(client) -> None:
    busy = [
        ("2026-05-12T12:00:00+09:00", "2026-05-12T13:30:00+09:00"),
        ("2026-05-12T14:30:00+09:00", "2026-05-12T16:00:00+09:00"),
    ]
    data = _create(
        client,
        location_type="online",
        date_range_start="2026-05-12",
        date_range_end="2026-05-12",
    )
    _register(client, data["slug"], "alice")
    # Personal buffer 120 would exclude plenty — but online flattens to 0.
    _set_my_buffer(client, data["slug"], "alice", 120)
    _submit_manual(client, data["slug"], busy)
    calc = client.post(f"/api/meetings/{data['slug']}/calculate")
    # /calculate's top-3 + 2h spread rule under the new 06:00-24:00 window
    # tends to anchor on the first morning slots, so we can't reliably
    # assert the 13:30 slot appears here even though it's free. The unit
    # test ``test_online_location_ignores_buffer`` proves the buffer
    # flattening directly. Here we only require that candidates exist.
    assert calc.status_code == 200
    assert calc.json()["candidates"]


# ============================================================================
# S12 — LLM validation fails 4x -> fallback
# ============================================================================


def test_S12_llm_validation_failure_falls_back(client) -> None:
    data = _create(client, participant_count=2)
    slug = data["slug"]
    _register(client, slug, "alice")
    _submit_manual(client, slug, [])
    client.cookies.clear()
    _register(client, slug, "bob")
    _submit_manual(client, slug, [])

    class _BadAdapter:
        def recommend(self, candidate_windows, meeting, max_candidates=3, **kwargs):
            return {
                "summary": "x",
                "candidates": [
                    {
                        "start": "2030-01-01T14:00:00",
                        "end": "2030-01-01T15:00:00",
                        "reason": "x",
                        "share_message_draft": "y",
                    }
                ],
            }

        def build_recommendation_payload(self, *args, **kwargs):
            return {}

    with patch("app.api.recommend.get_llm_adapter", return_value=_BadAdapter()):
        rec = client.post(f"/api/meetings/{slug}/recommend")

    assert rec.status_code == 200, rec.text
    body = rec.json()
    assert body["source"] == "deterministic_fallback"
    assert body["llm_call_count"] == 4
    assert body["candidates"]
    for cand in body["candidates"]:
        assert cand["share_message_draft"]


# ============================================================================
# S13 — LLM call count spy: cap = 4
# ============================================================================


def test_S13_llm_call_count_one_on_first_pass(client) -> None:
    data = _create(client, participant_count=2)
    slug = data["slug"]
    _register(client, slug, "alice")
    _submit_manual(client, slug, [])
    client.cookies.clear()
    _register(client, slug, "bob")
    _submit_manual(client, slug, [])

    spy = {"count": 0}

    class _Once:
        def recommend(self, windows, meeting, max_candidates=3, **kwargs):
            spy["count"] += 1
            iso_pairs = [(w.start.isoformat(), w.end.isoformat()) for w in windows[:1]]
            return {
                "summary": "오후",
                "candidates": [
                    {
                        "start": s,
                        "end": e,
                        "reason": "오후 시간",
                        "share_message_draft": "안내",
                    }
                    for s, e in iso_pairs
                ],
            }

        def build_recommendation_payload(self, *args, **kwargs):
            return {}

    with patch("app.api.recommend.get_llm_adapter", return_value=_Once()):
        rec = client.post(f"/api/meetings/{slug}/recommend")

    assert rec.status_code == 200
    assert rec.json()["llm_call_count"] == 1
    assert spy["count"] == 1


def test_S13_llm_call_count_caps_at_4(client) -> None:
    """The most important regression test: verify retry loop never exceeds 4 calls."""
    data = _create(client, participant_count=2)
    slug = data["slug"]
    _register(client, slug, "alice")
    _submit_manual(client, slug, [])
    client.cookies.clear()
    _register(client, slug, "bob")
    _submit_manual(client, slug, [])

    spy = {"count": 0}

    class _AlwaysBad:
        def recommend(self, windows, meeting, max_candidates=3, **kwargs):
            spy["count"] += 1
            return {
                "summary": "x",
                "candidates": [
                    {
                        "start": "2030-01-01T14:00:00",
                        "end": "2030-01-01T15:00:00",
                        "reason": "x",
                        "share_message_draft": "y",
                    }
                ],
            }

        def build_recommendation_payload(self, *args, **kwargs):
            return {}

    with patch("app.api.recommend.get_llm_adapter", return_value=_AlwaysBad()):
        rec = client.post(f"/api/meetings/{slug}/recommend")

    assert rec.status_code == 200
    body = rec.json()
    assert spy["count"] == 4, f"LLM was called {spy['count']} times, expected 4"
    assert spy["count"] != 5, "5th call would breach Q9 cap"
    assert body["llm_call_count"] == 4
    assert body["source"] == "deterministic_fallback"


def test_S13_progressive_failures_reach_target_attempt(client) -> None:
    """1 fail then success -> count=2; 2 fails then success -> count=3."""
    data = _create(client, participant_count=2)
    slug = data["slug"]
    _register(client, slug, "alice")
    _submit_manual(client, slug, [])
    client.cookies.clear()
    _register(client, slug, "bob")
    _submit_manual(client, slug, [])

    spy = {"count": 0}

    class _ThirdSuccess:
        def recommend(self, windows, meeting, max_candidates=3, **kwargs):
            spy["count"] += 1
            if spy["count"] < 3:
                return {
                    "summary": "x",
                    "candidates": [
                        {
                            "start": "2030-01-01T14:00:00",
                            "end": "2030-01-01T15:00:00",
                            "reason": "x",
                            "share_message_draft": "y",
                        }
                    ],
                }
            iso_pairs = [(w.start.isoformat(), w.end.isoformat()) for w in windows[:1]]
            return {
                "summary": "x",
                "candidates": [
                    {
                        "start": s,
                        "end": e,
                        "reason": "오후",
                        "share_message_draft": "안내",
                    }
                    for s, e in iso_pairs
                ],
            }

        def build_recommendation_payload(self, *args, **kwargs):
            return {}

    with patch("app.api.recommend.get_llm_adapter", return_value=_ThirdSuccess()):
        rec = client.post(f"/api/meetings/{slug}/recommend")

    assert rec.status_code == 200
    body = rec.json()
    assert spy["count"] == 3
    assert body["llm_call_count"] == 3
    assert body["source"] == "llm"


# ============================================================================
# S14 — PIN optional re-entry
# ============================================================================


def test_S14_pin_login_happy_path(client) -> None:
    data = _create(client, participant_count=1)
    slug = data["slug"]
    _register(client, slug, "alice", pin="1234")
    # Drop cookie to simulate new device.
    client.cookies.clear()

    login = client.post(
        f"/api/meetings/{slug}/participants/login",
        json={"nickname": "alice", "pin": "1234"},
    )
    assert login.status_code == 200, login.text
    assert login.json()["nickname"] == "alice"
    cookie_name = f"somameet_pt_{slug}"
    assert cookie_name in client.cookies


def test_S14_pin_login_wrong_pin_returns_401(client) -> None:
    data = _create(client, participant_count=1)
    slug = data["slug"]
    _register(client, slug, "alice", pin="1234")
    client.cookies.clear()

    login = client.post(
        f"/api/meetings/{slug}/participants/login",
        json={"nickname": "alice", "pin": "9999"},
    )
    assert login.status_code == 401
    body = login.json()
    assert body["error_code"] == "invalid_pin"


def test_S14_pin_login_no_pin_set_returns_409(client) -> None:
    data = _create(client, participant_count=1)
    slug = data["slug"]
    _register(client, slug, "alice")  # no pin
    client.cookies.clear()

    login = client.post(
        f"/api/meetings/{slug}/participants/login",
        json={"nickname": "alice", "pin": "1234"},
    )
    assert login.status_code == 409
    body = login.json()
    assert body["error_code"] == "pin_not_set"


def test_S14_pin_stored_in_plaintext(client, db_session) -> None:
    """Q7 — PIN is stored as plain text (MVP simplification)."""
    from app.db.models import Participant

    data = _create(client, participant_count=1)
    slug = data["slug"]
    _register(client, slug, "alice", pin="4321")

    rows = db_session.query(Participant).filter(Participant.nickname == "alice").all()
    assert len(rows) == 1
    assert rows[0].pin == "4321"  # plaintext, NOT a hash


# ============================================================================
# S15 — picked date mode
# ============================================================================


def test_S15_picked_mode_only_listed_dates_in_calculate(client) -> None:
    data = _create(
        client,
        date_mode="picked",
        date_range_start=None,
        date_range_end=None,
        candidate_dates=["2026-05-07", "2026-05-09", "2026-05-10"],
        participant_count=1,
    )
    slug = data["slug"]
    _register(client, slug, "alice")
    _submit_manual(client, slug, [])

    calc = client.post(f"/api/meetings/{slug}/calculate")
    assert calc.status_code == 200
    starts = [c["start"] for c in calc.json()["candidates"]]
    # No 2026-05-08 — the gap day must NOT appear.
    for s in starts:
        assert "2026-05-08" not in s


def test_S15_picked_mode_meeting_detail_round_trips(client) -> None:
    data = _create(
        client,
        date_mode="picked",
        date_range_start=None,
        date_range_end=None,
        candidate_dates=["2026-05-07", "2026-05-09"],
        participant_count=1,
    )
    detail = client.get(f"/api/meetings/{data['slug']}")
    assert detail.status_code == 200
    body = detail.json()
    assert body["date_mode"] == "picked"
    assert body["candidate_dates"] == ["2026-05-07", "2026-05-09"]
    assert body["date_range_start"] is None
    assert body["date_range_end"] is None
