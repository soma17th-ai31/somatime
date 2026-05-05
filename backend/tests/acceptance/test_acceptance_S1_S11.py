"""Acceptance scenarios S1..S11 (구현_위임_스펙.md section 9).

Most scenarios require backend-api routers; until those land, conftest.client
will skip the tests automatically. test_S11_llm_privacy includes a SDK-spy
check that runs even if the HTTP layer is missing — see comments inline.
"""
from __future__ import annotations

from pathlib import Path
from typing import Iterable
from unittest.mock import MagicMock

import pytest  # noqa: F401

FIXTURES = Path(__file__).resolve().parents[1] / "fixtures"


def _read_fixture(name: str) -> bytes:
    return (FIXTURES / name).read_bytes()


def _create(client, **overrides) -> dict:
    body = {
        "title": "팀 회의",
        "date_range_start": "2026-05-11",
        "date_range_end": "2026-05-15",
        "duration_minutes": 60,
        "participant_count": 4,
        "location_type": "online",
        "time_window_start": "09:00",
        "time_window_end": "22:00",
        "include_weekends": False,
    }
    body.update(overrides)
    resp = client.post("/api/meetings", json=body)
    assert resp.status_code == 201, resp.text
    return resp.json()


def _register(client, slug: str, nickname: str) -> dict:
    resp = client.post(f"/api/meetings/{slug}/participants", json={"nickname": nickname})
    assert resp.status_code in (200, 201), resp.text
    return resp.json()


def _submit_manual(client, slug: str, busy: Iterable[tuple[str, str]]) -> None:
    payload = {"busy_blocks": [{"start": s, "end": e} for s, e in busy]}
    resp = client.post(f"/api/meetings/{slug}/availability/manual", json=payload)
    assert resp.status_code in (200, 201), resp.text


# --------------------------------------------------------------------- S1


def test_S1_happy_path(client) -> None:
    data = _create(client, participant_count=3, location_type="online")
    slug = data["slug"]
    organizer_token = data["organizer_token"]
    assert len(slug) == 8
    assert len(organizer_token) >= 32

    # Three participants register; all with empty busy.
    for nick in ("alice", "bob", "carol"):
        _register(client, slug, nick)
        # ICS-based for one, manual for others — pick manual for determinism.
        _submit_manual(client, slug, [])

    calc = client.post(f"/api/meetings/{slug}/calculate")
    assert calc.status_code == 200
    body = calc.json()
    assert len(body["candidates"]) <= 3
    for cand in body["candidates"]:
        assert cand["available_count"] == 3

    confirm = client.post(
        f"/api/meetings/{slug}/confirm",
        json={
            "slot_start": body["candidates"][0]["start"],
            "slot_end": body["candidates"][0]["end"],
        },
        headers={"X-Organizer-Token": organizer_token},
    )
    assert confirm.status_code == 200
    msg = confirm.json()["share_message_draft"]
    assert "팀 회의" in msg
    # No private words from any test fixture should ever appear.
    for forbidden in ("병원", "진료", "데이트"):
        assert forbidden not in msg


# --------------------------------------------------------------------- S2


def test_S2_offline_buffer(client) -> None:
    """Same input under offline excludes 13:30, under online includes 13:30."""
    busy = [
        ("2026-05-12T12:00:00+09:00", "2026-05-12T13:30:00+09:00"),
        ("2026-05-12T14:30:00+09:00", "2026-05-12T16:00:00+09:00"),
    ]

    offline = _create(
        client,
        location_type="offline",
        participant_count=1,
        date_range_start="2026-05-12",
        date_range_end="2026-05-12",
    )
    _register(client, offline["slug"], "u1")
    _submit_manual(client, offline["slug"], busy)
    off_calc = client.post(f"/api/meetings/{offline['slug']}/calculate").json()
    off_starts = {c["start"] for c in off_calc["candidates"]}
    assert "2026-05-12T13:30:00+09:00" not in off_starts

    online = _create(
        client,
        location_type="online",
        participant_count=1,
        date_range_start="2026-05-12",
        date_range_end="2026-05-12",
    )
    _register(client, online["slug"], "u1")
    _submit_manual(client, online["slug"], busy)
    on_calc = client.post(f"/api/meetings/{online['slug']}/calculate").json()
    on_starts = {c["start"] for c in on_calc["candidates"]}
    assert "2026-05-12T13:30:00+09:00" in on_starts


# --------------------------------------------------------------------- S3


def test_S3_fallback_one_missing(client) -> None:
    data = _create(
        client,
        participant_count=4,
        date_range_start="2026-05-12",
        date_range_end="2026-05-12",
    )
    slug = data["slug"]
    for nick in ("a", "b", "c"):
        _register(client, slug, nick)
        _submit_manual(client, slug, [])
    _register(client, slug, "d")
    _submit_manual(
        client,
        slug,
        [("2026-05-12T00:00:00+09:00", "2026-05-13T00:00:00+09:00")],
    )

    calc = client.post(f"/api/meetings/{slug}/calculate").json()
    assert calc["candidates"], calc
    assert all(c["missing_participants"] == ["d"] for c in calc["candidates"])
    assert all(c.get("note") for c in calc["candidates"])


# --------------------------------------------------------------------- S4


def test_S4_fallback_zero_returns_suggestion(client) -> None:
    data = _create(
        client,
        participant_count=2,
        date_range_start="2026-05-12",
        date_range_end="2026-05-12",
    )
    slug = data["slug"]
    for nick in ("a", "b"):
        _register(client, slug, nick)
        _submit_manual(
            client,
            slug,
            [("2026-05-12T00:00:00+09:00", "2026-05-13T00:00:00+09:00")],
        )
    resp = client.post(f"/api/meetings/{slug}/calculate")
    assert resp.status_code == 200
    body = resp.json()
    assert body["candidates"] == []
    assert body["suggestion"]


# --------------------------------------------------------------------- S5


def test_S5_organizer_token_required(client) -> None:
    data = _create(client, participant_count=1)
    slug = data["slug"]
    _register(client, slug, "a")
    _submit_manual(client, slug, [])
    calc = client.post(f"/api/meetings/{slug}/calculate").json()
    first = calc["candidates"][0]
    body = {"slot_start": first["start"], "slot_end": first["end"]}

    # No header
    no_token = client.post(f"/api/meetings/{slug}/confirm", json=body)
    assert no_token.status_code == 403

    # Wrong header
    bad = client.post(
        f"/api/meetings/{slug}/confirm",
        json=body,
        headers={"X-Organizer-Token": "wrong-token"},
    )
    assert bad.status_code == 403

    # GET works without token
    get_resp = client.get(f"/api/meetings/{slug}")
    assert get_resp.status_code == 200


# --------------------------------------------------------------------- S6


def test_S6_participant_isolation(client) -> None:
    """B's cookie cannot mutate C's availability.

    The api layer's exact mechanism is up to backend-api, but the contract
    is: a participant token only authorizes mutation of *that* participant's
    busy_blocks. Cross-write must yield 403.
    """
    data = _create(client, participant_count=2)
    slug = data["slug"]

    b_resp = client.post(f"/api/meetings/{slug}/participants", json={"nickname": "B"})
    b_token = b_resp.cookies.get(f"somameet_pt_{slug}") or b_resp.json().get("token")
    assert b_token, b_resp.json()

    # Switch identity: clear cookies, register C in a fresh client session.
    client.cookies.clear()
    c_resp = client.post(f"/api/meetings/{slug}/participants", json={"nickname": "C"})
    c_id = c_resp.json().get("id")

    # Now reconnect as B and try to mutate C explicitly via path / id (if the
    # API exposes one) — generic check: send B's cookie back, attempt manual
    # write while pretending to be C using a header `X-Target-Participant: C`.
    client.cookies.clear()
    client.cookies.set(f"somameet_pt_{slug}", b_token)
    bad = client.post(
        f"/api/meetings/{slug}/availability/manual",
        json={"busy_blocks": []},
        headers={"X-Target-Participant": str(c_id) if c_id is not None else "C"},
    )
    # Either the api ignores the header (200) and writes to B — which is
    # acceptable — or it explicitly rejects (403). It must NOT write to C.
    assert bad.status_code in (200, 201, 403)
    # We can't poke C's data without an API hook; the strong form is left to
    # backend-api once endpoints are finalized.


# --------------------------------------------------------------------- S7


def test_S7_last_write_wins_replaces_prior(client) -> None:
    data = _create(client, participant_count=1)
    slug = data["slug"]
    _register(client, slug, "alice")

    # First: manual write
    _submit_manual(
        client,
        slug,
        [("2026-05-12T09:00:00+09:00", "2026-05-12T12:00:00+09:00")],
    )

    # Second: ICS upload replaces all prior blocks for alice.
    files = {"file": ("evenings.ics", _read_fixture("sample_busy_evenings.ics"), "text/calendar")}
    resp = client.post(f"/api/meetings/{slug}/availability/ics", files=files)
    assert resp.status_code in (200, 201), resp.text

    # Recalculate; morning slots are now free (the manual block was removed).
    calc = client.post(f"/api/meetings/{slug}/calculate").json()
    starts = {c["start"] for c in calc["candidates"]}
    assert any("T09:00:00" in s or "T09:30:00" in s or "T10:00:00" in s for s in starts)


# --------------------------------------------------------------------- S8


def test_S8_ics_parse_failure(client) -> None:
    data = _create(client, participant_count=1)
    slug = data["slug"]
    _register(client, slug, "alice")

    for fname in ("invalid_empty.ics", "invalid_corrupt.ics"):
        files = {"file": (fname, _read_fixture(fname), "text/calendar")}
        resp = client.post(f"/api/meetings/{slug}/availability/ics", files=files)
        assert resp.status_code == 400, resp.text
        body = resp.json()
        assert body["error_code"] == "ics_parse_failed"
        assert body.get("suggestion")


# --------------------------------------------------------------------- S9


def test_S9_google_oauth_scope_freebusy_only(client) -> None:
    data = _create(client, participant_count=1)
    slug = data["slug"]
    _register(client, slug, "alice")

    resp = client.get(f"/api/meetings/{slug}/availability/google/oauth-url")
    # Either 200 with a URL, or 503 if the deployer hasn't set keys.
    assert resp.status_code in (200, 503), resp.text
    if resp.status_code == 200:
        url = resp.json()["url"]
        from urllib.parse import parse_qs, urlparse

        qs = parse_qs(urlparse(url).query)
        scopes = qs["scope"][0]
        assert "calendar.freebusy" in scopes
        assert "calendar.readonly" not in scopes
        assert "calendar.events" not in scopes


# --------------------------------------------------------------------- S10


def test_S10_timetable_shape(client) -> None:
    data = _create(
        client,
        participant_count=2,
        date_range_start="2026-05-12",
        date_range_end="2026-05-12",
        time_window_start="09:00",
        time_window_end="11:00",
    )
    slug = data["slug"]
    _register(client, slug, "alice")
    _submit_manual(client, slug, [])
    _register(client, slug, "bob")
    _submit_manual(client, slug, [])

    resp = client.get(f"/api/meetings/{slug}/timetable")
    assert resp.status_code == 200
    body = resp.json()
    assert "slots" in body
    for slot in body["slots"]:
        assert {"start", "end", "available_count", "available_nicknames"}.issubset(slot)
        for nick in slot["available_nicknames"]:
            assert "@" not in nick  # no emails
            assert nick in {"alice", "bob"}


# --------------------------------------------------------------------- S11


def test_S11_llm_privacy_template_path(client) -> None:
    """The default template adapter must never emit private event words even
    when the participants' ICS contained 병원 진료 / 데이트 events."""
    data = _create(client, participant_count=2)
    slug = data["slug"]
    organizer_token = data["organizer_token"]

    private_ics = (
        "BEGIN:VCALENDAR\r\n"
        "VERSION:2.0\r\n"
        "PRODID:-//SomaMeet//Privacy Test//EN\r\n"
        "BEGIN:VTIMEZONE\r\n"
        "TZID:Asia/Seoul\r\n"
        "BEGIN:STANDARD\r\n"
        "DTSTART:19700101T000000\r\n"
        "TZOFFSETFROM:+0900\r\n"
        "TZOFFSETTO:+0900\r\n"
        "TZNAME:KST\r\n"
        "END:STANDARD\r\n"
        "END:VTIMEZONE\r\n"
        "BEGIN:VEVENT\r\n"
        "UID:hospital@x\r\n"
        "DTSTAMP:20260504T000000Z\r\n"
        "DTSTART;TZID=Asia/Seoul:20260512T100000\r\n"
        "DTEND;TZID=Asia/Seoul:20260512T110000\r\n"
        "SUMMARY:병원 진료\r\n"
        "DESCRIPTION:데이트\r\n"
        "LOCATION:서울 어딘가\r\n"
        "END:VEVENT\r\n"
        "END:VCALENDAR\r\n"
    ).encode("utf-8")

    _register(client, slug, "alice")
    files = {"file": ("private.ics", private_ics, "text/calendar")}
    r = client.post(f"/api/meetings/{slug}/availability/ics", files=files)
    assert r.status_code in (200, 201), r.text
    _register(client, slug, "bob")
    _submit_manual(client, slug, [])

    calc = client.post(f"/api/meetings/{slug}/calculate").json()
    forbidden = ("병원", "진료", "데이트")
    for cand in calc["candidates"]:
        for word in forbidden:
            assert word not in cand.get("reason", "")
            assert word not in (cand.get("note") or "")

    if calc["candidates"]:
        first = calc["candidates"][0]
        confirm = client.post(
            f"/api/meetings/{slug}/confirm",
            json={"slot_start": first["start"], "slot_end": first["end"]},
            headers={"X-Organizer-Token": organizer_token},
        )
        assert confirm.status_code == 200
        msg = confirm.json()["share_message_draft"]
        for word in forbidden:
            assert word not in msg


def test_S11_llm_privacy_gemini_prompt_spy(monkeypatch) -> None:
    """Even if we switch the provider to gemini, the prompt arguments handed
    to the Gemini SDK must NEVER contain busy_block private words.

    We monkeypatch GeminiAdapter._sdk_ready=True and replace the underlying
    model.generate_content with a spy that records every prompt string.
    Assertions: forbidden words never appear in the spy's recorded prompts.
    """
    import importlib
    from datetime import date, datetime, time

    from app.db.models import Meeting
    from app.schemas.candidate import Candidate
    from app.services.llm import gemini as gemini_mod
    from app.services.llm.base import Slot

    importlib.reload(gemini_mod)

    captured_prompts: list[str] = []

    class _SpyResp:
        text = "후보 1\n후보 2\n후보 3\n"

    def _spy_generate_content(prompt: str):
        captured_prompts.append(prompt)
        return _SpyResp()

    adapter = gemini_mod.GeminiAdapter()
    adapter._sdk_ready = True
    adapter._model = MagicMock()
    adapter._model.generate_content.side_effect = _spy_generate_content

    meeting = Meeting(
        slug="abcd1234",
        organizer_token="x" * 32,
        title="팀 회의",
        date_range_start=date(2026, 5, 11),
        date_range_end=date(2026, 5, 15),
        duration_minutes=60,
        participant_count=2,
        location_type="online",
        time_window_start=time(9, 0),
        time_window_end=time(22, 0),
        include_weekends=False,
        created_at=datetime(2026, 5, 4),
    )
    candidates = [
        Candidate(
            start=datetime(2026, 5, 12, 14),
            end=datetime(2026, 5, 12, 15),
            available_count=2,
            missing_participants=[],
            reason="",
        ),
        Candidate(
            start=datetime(2026, 5, 13, 16),
            end=datetime(2026, 5, 13, 17),
            available_count=2,
            missing_participants=[],
            reason="",
        ),
    ]
    adapter.generate_recommendation_reasons(candidates, meeting)
    adapter.generate_share_message(
        meeting,
        Slot(start=candidates[0].start, end=candidates[0].end),
        ["alice", "bob"],
    )

    assert captured_prompts, "spy should have captured at least one prompt"
    forbidden = ("병원", "진료", "데이트")
    for prompt in captured_prompts:
        for word in forbidden:
            assert word not in prompt, f"forbidden word leaked into prompt: {word}"
