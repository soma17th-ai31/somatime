"""Integration tests for /api/meetings/{slug}/recommend (v3 — Q9).

Covers:
- happy path: 1 LLM call, validated -> source=llm, llm_call_count=1
- validation failure 4 times -> deterministic_fallback, llm_call_count=4
- network/SDK error -> immediate fallback, llm_call_count=0
- gate: insufficient submissions -> 409 insufficient_responses
"""
from __future__ import annotations

import json
from typing import Iterable
from unittest.mock import patch


def _create(client, **overrides) -> dict:
    body = {
        "title": "팀 회의",
        "date_mode": "range",
        "date_range_start": "2026-05-11",
        "date_range_end": "2026-05-15",
        "duration_minutes": 60,
        "location_type": "online",
        "time_window_start": "09:00",
        "time_window_end": "22:00",
        "include_weekends": False,
    }
    # Drop legacy participant_count overrides — the field no longer exists.
    overrides.pop("participant_count", None)
    body.update(overrides)
    resp = client.post("/api/meetings", json=body)
    assert resp.status_code == 201, resp.text
    return resp.json()


def _register_and_submit(client, slug: str, nickname: str, busy: Iterable[tuple] = ()):
    r = client.post(
        f"/api/meetings/{slug}/participants",
        json={"nickname": nickname, "buffer_minutes": 60},
    )
    assert r.status_code in (200, 201), r.text
    payload = {"busy_blocks": [{"start": s, "end": e} for s, e in busy]}
    r2 = client.post(f"/api/meetings/{slug}/availability/manual", json=payload)
    assert r2.status_code in (200, 201), r2.text


def _good_llm_response(slug, candidates_iso):
    return {
        "summary": "오후 시간대를 추천드립니다.",
        "candidates": [
            {
                "start": s,
                "end": e,
                "reason": "오후 집중 시간대",
                "share_message_draft": "회의 안내드립니다.",
            }
            for s, e in candidates_iso
        ],
    }


# ============================================================================
# happy path: 1 call -> source=llm, count=1
# ============================================================================


def test_recommend_happy_path_one_llm_call(client) -> None:
    data = _create(client, participant_count=2)
    slug = data["slug"]

    _register_and_submit(client, slug, "alice", [])
    client.cookies.clear()
    _register_and_submit(client, slug, "bob", [])

    # Pre-fetch deterministic windows so we can construct a valid LLM reply.
    calc = client.post(f"/api/meetings/{slug}/calculate")
    assert calc.status_code == 200
    cands = calc.json()["candidates"]
    assert cands

    valid_iso_pairs = [(c["start"], c["end"]) for c in cands[:2]]

    spy_calls = {"count": 0}

    class _MockAdapter:
        def recommend(self, candidate_windows, meeting, max_candidates=3):
            spy_calls["count"] += 1
            # v3.27 — _validate_llm_output enforces 2h+ spread between
            # candidates, so the mock picks windows that are at least 120min
            # apart to match the real LLM contract.
            from datetime import timedelta

            iso_pairs = []
            last_start = None
            for w in candidate_windows:
                if last_start is None or (w.start - last_start) >= timedelta(minutes=120):
                    iso_pairs.append((w.start.isoformat(), w.end.isoformat()))
                    last_start = w.start
                if len(iso_pairs) >= 2:
                    break
            if not iso_pairs:
                first = candidate_windows[0]
                iso_pairs.append((first.start.isoformat(), first.end.isoformat()))
            return {
                "summary": "오후 추천",
                "candidates": [
                    {
                        "start": s,
                        "end": e,
                        "reason": "오후 시간대",
                        "share_message_draft": "안내",
                    }
                    for s, e in iso_pairs
                ],
            }

        def build_recommendation_payload(self, *args, **kwargs):
            return {}

    with patch(
        "app.api.recommend.get_llm_adapter",
        return_value=_MockAdapter(),
    ):
        rec = client.post(f"/api/meetings/{slug}/recommend")

    assert rec.status_code == 200, rec.text
    body = rec.json()
    assert body["source"] == "llm"
    assert body["llm_call_count"] == 1
    assert spy_calls["count"] == 1
    assert body["candidates"]
    for cand in body["candidates"]:
        assert cand["reason"]
        assert cand["share_message_draft"]


# ============================================================================
# validation failure 4 times -> fallback
# ============================================================================


def test_recommend_validation_failures_fall_back(client) -> None:
    data = _create(client, participant_count=2)
    slug = data["slug"]
    _register_and_submit(client, slug, "alice", [])
    client.cookies.clear()
    _register_and_submit(client, slug, "bob", [])

    spy_calls = {"count": 0}

    class _BadAdapter:
        def recommend(self, candidate_windows, meeting, max_candidates=3):
            spy_calls["count"] += 1
            # Bogus times that won't match any window.
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

    with patch(
        "app.api.recommend.get_llm_adapter",
        return_value=_BadAdapter(),
    ):
        rec = client.post(f"/api/meetings/{slug}/recommend")

    assert rec.status_code == 200, rec.text
    body = rec.json()
    assert body["source"] == "deterministic_fallback"
    assert body["llm_call_count"] == 4  # Q9 cap, hit
    assert spy_calls["count"] == 4
    # fallback share_message_draft is fabricated by template helper
    assert body["candidates"]
    for cand in body["candidates"]:
        assert cand["share_message_draft"]


# ============================================================================
# network error -> immediate fallback
# ============================================================================


def test_recommend_network_error_immediate_fallback(client) -> None:
    data = _create(client, participant_count=2)
    slug = data["slug"]
    _register_and_submit(client, slug, "alice", [])
    client.cookies.clear()
    _register_and_submit(client, slug, "bob", [])

    spy_calls = {"count": 0}

    class _NetworkBrokenAdapter:
        def recommend(self, candidate_windows, meeting, max_candidates=3):
            spy_calls["count"] += 1
            raise ConnectionError("upstream down")

        def build_recommendation_payload(self, *args, **kwargs):
            return {}

    with patch(
        "app.api.recommend.get_llm_adapter",
        return_value=_NetworkBrokenAdapter(),
    ):
        rec = client.post(f"/api/meetings/{slug}/recommend")

    assert rec.status_code == 200, rec.text
    body = rec.json()
    assert body["source"] == "deterministic_fallback"
    assert body["llm_call_count"] == 0
    assert spy_calls["count"] == 1  # called once, immediate bail


# ============================================================================
# gate: not enough submitted
# ============================================================================


def test_recommend_blocks_when_no_one_submitted(client) -> None:
    """v3.1 simplify pass: gate flips on submitted_count >= 1, so the only
    blocking state is zero submissions."""
    data = _create(client)
    slug = data["slug"]

    rec = client.post(f"/api/meetings/{slug}/recommend")
    assert rec.status_code == 409
    body = rec.json()
    assert body["error_code"] == "insufficient_responses"
    assert body["current"] == 0
    assert body["required"] == 1


def test_recommend_unblocked_after_first_submission(client) -> None:
    """A single submission is enough to unlock /recommend."""
    data = _create(client)
    slug = data["slug"]
    _register_and_submit(client, slug, "alice", [])

    rec = client.post(f"/api/meetings/{slug}/recommend")
    assert rec.status_code == 200, rec.text
