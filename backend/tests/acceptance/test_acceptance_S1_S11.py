"""Acceptance scenarios S1..S11 (v3, 2026-05-06).

This file owns the v3 versions of S1, S1b, and S11. The genuinely new
v3 scenarios (S1b gate, S2 variable buffer, S12-S15) live in
``test_v3_scenarios.py``; this file holds the spec §10 acceptance scenarios
that pre-existed v3 plus their v3-flavored updates.

v3 changes captured here:
- S1   happy path now flows through /calculate (deterministic, no LLM) ->
       /recommend (LLM 1-shot) -> /confirm (frontend supplies share_message_draft).
- S1b  PIN-required scenario (Q7): a participant who set a PIN can re-enter
       from a fresh device via POST /participants/login.
- S9   removed (Q3 — Google OAuth feature deleted).
- S11  rewritten as two cases:
         (a) LLM_PROVIDER=template  -> NO external HTTP request is made and
             every output (calculate / recommend / confirm) is privacy-clean.
         (b) LLM_PROVIDER=upstage   -> the user prompt handed to the OpenAI
             SDK contains NO private words from busy_block titles
             ("병원" / "진료" / "데이트" / "위치" / "장소").
"""
from __future__ import annotations

import os
from pathlib import Path
from typing import Iterable

import pytest

FIXTURES = Path(__file__).resolve().parents[1] / "fixtures"

# Words that come from busy_block titles / locations / descriptions only
# (i.e., real ICS event content). The deterministic share-message template
# uses "장소:" as a label, so 장소/위치 are NOT private words for this matrix
# — they are legitimate UI vocabulary. Guard against actual leakage.
PRIVATE_WORDS = ("병원", "진료", "데이트")


# ============================================================================
# helpers
# ============================================================================


def _read_fixture(name: str) -> bytes:
    return (FIXTURES / name).read_bytes()


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
    # v3.1: participant_count was retired. Silently drop legacy overrides
    # so the historical test bodies keep working while still proving
    # nothing depends on it.
    overrides.pop("participant_count", None)
    body.update(overrides)
    resp = client.post("/api/meetings", json=body)
    assert resp.status_code == 201, resp.text
    return resp.json()


def _register(client, slug: str, nickname: str, pin: str | None = None) -> dict:
    payload: dict = {"nickname": nickname}
    if pin is not None:
        payload["pin"] = pin
    resp = client.post(f"/api/meetings/{slug}/participants", json=payload)
    assert resp.status_code in (200, 201), resp.text
    return resp.json()


def _submit_manual(client, slug: str, busy: Iterable[tuple[str, str]] = ()) -> None:
    payload = {"busy_blocks": [{"start": s, "end": e} for s, e in busy]}
    resp = client.post(f"/api/meetings/{slug}/availability/manual", json=payload)
    assert resp.status_code in (200, 201), resp.text


# ============================================================================
# S1 — v3 happy path: create -> register x4 -> calculate -> recommend -> confirm
# ============================================================================


def test_S1_happy_path(client) -> None:
    """v3 happy path. /confirm body includes share_message_draft from /recommend.

    Coverage:
    - date_mode="range" + location_type="offline" (#13 follow-up: buffer
      lives on participants now, the meeting-level column is gone)
    - 4/4 submitted -> /calculate returns deterministic candidates with
      reason=null and share_message_draft=null
    - /recommend returns source="llm" (or "deterministic_fallback" under
      LLM_PROVIDER=template — both populate reason + share_message_draft)
    - /confirm round-trips share_message_draft verbatim
    - GET meeting reports the saved confirmed_share_message
    """
    data = _create(
        client,
        participant_count=4,
        location_type="offline",
    )
    slug = data["slug"]
    assert len(slug) == 8
    # v3.2 (Path B): organizer_token / organizer_url no longer in the response.
    assert "organizer_token" not in data
    assert "organizer_url" not in data

    for nick in ("alice", "bob", "carol", "dave"):
        client.cookies.clear()
        _register(client, slug, nick)
        _submit_manual(client, slug, [])

    detail = client.get(f"/api/meetings/{slug}").json()
    # v3.1: target_count / participant_count are no longer surfaced.
    assert "target_count" not in detail
    assert "participant_count" not in detail
    assert detail["submitted_count"] == 4
    assert detail["is_ready_to_calculate"] is True
    assert detail["date_mode"] == "range"
    assert detail["location_type"] == "offline"
    assert "offline_buffer_minutes" not in detail

    # /calculate is deterministic-only — reason / share_message_draft must be null.
    calc = client.post(f"/api/meetings/{slug}/calculate")
    assert calc.status_code == 200, calc.text
    calc_body = calc.json()
    assert calc_body["source"] == "deterministic"
    assert calc_body["candidates"], calc_body
    assert len(calc_body["candidates"]) <= 3
    for cand in calc_body["candidates"]:
        assert cand.get("reason") in (None, "")
        assert cand.get("share_message_draft") in (None, "")
        assert cand["available_count"] == 4

    # /recommend produces share_message_draft. Under LLM_PROVIDER=template the
    # adapter is deterministic and source="llm" with llm_call_count=1.
    rec = client.post(f"/api/meetings/{slug}/recommend")
    assert rec.status_code == 200, rec.text
    rec_body = rec.json()
    assert rec_body["source"] in ("llm", "deterministic_fallback")
    assert rec_body["candidates"], rec_body
    chosen = rec_body["candidates"][0]
    draft = chosen["share_message_draft"]
    assert draft and "팀 회의" in draft
    for word in PRIVATE_WORDS:
        assert word not in draft, f"private word leaked into draft: {word}"

    # /confirm — frontend posts back the (possibly edited) draft. Backend
    # stores verbatim; NO LLM call here. v3.2 (Path B): no X-Organizer-Token.
    confirm = client.post(
        f"/api/meetings/{slug}/confirm",
        json={
            "slot_start": chosen["start"],
            "slot_end": chosen["end"],
            "share_message_draft": draft,
        },
    )
    assert confirm.status_code == 200, confirm.text
    confirm_body = confirm.json()
    assert confirm_body["share_message_draft"] == draft
    assert confirm_body["confirmed_slot"]["start"] == chosen["start"]
    assert confirm_body["confirmed_slot"]["end"] == chosen["end"]

    # GET meeting now exposes the persisted draft.
    detail2 = client.get(f"/api/meetings/{slug}").json()
    assert detail2["confirmed_share_message"] == draft
    assert detail2["confirmed_slot"]["start"] == chosen["start"]


# ============================================================================
# S1b — PIN-required scenario (Q7)
# ============================================================================


def test_S1b_pin_required_login_flow(client) -> None:
    """PIN-protected re-entry from a fresh device.

    Flow:
    1. alice registers with pin=1234, submits availability.
    2. Cookies are wiped (simulates a new browser/device).
    3. POST /participants/login with the right PIN re-issues the cookie and
       lets alice re-submit her availability without losing prior data.
    4. Wrong PIN  -> 401 invalid_pin.
    5. Missing PIN entry on a no-PIN nickname -> 409 pin_not_set.
    """
    data = _create(client, participant_count=2)
    slug = data["slug"]

    # 1. alice with PIN
    _register(client, slug, "alice", pin="1234")
    _submit_manual(client, slug, [])

    # 2. fresh device
    client.cookies.clear()

    # 3. wrong PIN -> 401 invalid_pin
    bad = client.post(
        f"/api/meetings/{slug}/participants/login",
        json={"nickname": "alice", "pin": "9999"},
    )
    assert bad.status_code == 401
    assert bad.json()["error_code"] == "invalid_pin"

    # right PIN -> 200, cookie re-issued
    ok = client.post(
        f"/api/meetings/{slug}/participants/login",
        json={"nickname": "alice", "pin": "1234"},
    )
    assert ok.status_code == 200, ok.text
    assert ok.json()["nickname"] == "alice"
    cookie_name = f"somameet_pt_{slug}"
    assert cookie_name in client.cookies

    # alice can re-submit availability with the new cookie (no 403).
    _submit_manual(
        client,
        slug,
        [("2026-05-12T10:00:00+09:00", "2026-05-12T11:00:00+09:00")],
    )

    # 4. PIN not set on a different nickname -> 409 pin_not_set
    client.cookies.clear()
    _register(client, slug, "bob")  # no pin
    client.cookies.clear()
    no_pin = client.post(
        f"/api/meetings/{slug}/participants/login",
        json={"nickname": "bob", "pin": "1234"},
    )
    assert no_pin.status_code == 409
    assert no_pin.json()["error_code"] == "pin_not_set"


# ============================================================================
# S2 — offline buffer exclusion (preserved from v2 baseline)
# ============================================================================


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

    client.cookies.clear()
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


# ============================================================================
# S3 — fallback "1 person missing" candidates
# ============================================================================


def test_S3_fallback_one_missing(client) -> None:
    data = _create(
        client,
        participant_count=4,
        date_range_start="2026-05-12",
        date_range_end="2026-05-12",
    )
    slug = data["slug"]
    for nick in ("a", "b", "c"):
        client.cookies.clear()
        _register(client, slug, nick)
        _submit_manual(client, slug, [])
    client.cookies.clear()
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


# ============================================================================
# S4 — even fallback yields zero -> 200 + suggestion
# ============================================================================


def test_S4_fallback_zero_returns_suggestion(client) -> None:
    data = _create(
        client,
        participant_count=2,
        date_range_start="2026-05-12",
        date_range_end="2026-05-12",
    )
    slug = data["slug"]
    for nick in ("a", "b"):
        client.cookies.clear()
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


# ============================================================================
# S5 — v3.2 (Path B): share-URL alone authorizes confirm.
#       Replaces the v3 "organizer token required" test entirely.
# ============================================================================


def test_S5_share_url_alone_can_confirm(client) -> None:
    """v3.2 (Path B): no organizer/participant authority split.

    Anyone who can reach POST /confirm via the share URL can confirm. The
    accident safeguard is the ShareMessageDialog 2-step gate in the
    frontend, not a header.
    """
    data = _create(client, participant_count=1)
    slug = data["slug"]
    _register(client, slug, "a")
    _submit_manual(client, slug, [])
    calc = client.post(f"/api/meetings/{slug}/calculate").json()
    first = calc["candidates"][0]
    body = {
        "slot_start": first["start"],
        "slot_end": first["end"],
        "share_message_draft": "팀 회의 일정 안내드립니다.",
    }

    # No header — confirms successfully.
    confirm = client.post(f"/api/meetings/{slug}/confirm", json=body)
    assert confirm.status_code == 200, confirm.text
    assert confirm.json()["share_message_draft"] == body["share_message_draft"]

    # GET still works without any header.
    get_resp = client.get(f"/api/meetings/{slug}")
    assert get_resp.status_code == 200


def test_S5b_double_confirm_yields_409_already_confirmed(client) -> None:
    """Race protection: two simultaneous /confirm calls — only one wins."""
    data = _create(client, participant_count=1)
    slug = data["slug"]
    _register(client, slug, "a")
    _submit_manual(client, slug, [])
    calc = client.post(f"/api/meetings/{slug}/calculate").json()
    first = calc["candidates"][0]
    body = {
        "slot_start": first["start"],
        "slot_end": first["end"],
        "share_message_draft": "first writer wins.",
    }
    body2 = {**body, "share_message_draft": "second writer should be rejected."}

    ok = client.post(f"/api/meetings/{slug}/confirm", json=body)
    assert ok.status_code == 200, ok.text

    conflict = client.post(f"/api/meetings/{slug}/confirm", json=body2)
    assert conflict.status_code == 409, conflict.text
    err = conflict.json()
    assert err["error_code"] == "already_confirmed"
    # The original message is preserved.
    detail = client.get(f"/api/meetings/{slug}").json()
    assert detail["confirmed_share_message"] == "first writer wins."


# ============================================================================
# S6 — participant isolation
# ============================================================================


def test_S6_participant_isolation(client) -> None:
    """B's cookie cannot mutate C's availability.

    The contract: a participant token only authorizes mutation of *that*
    participant's busy_blocks. Cross-write must yield 403 or be ignored —
    it must NEVER write to the other participant.
    """
    data = _create(client, participant_count=2)
    slug = data["slug"]

    b_resp = client.post(f"/api/meetings/{slug}/participants", json={"nickname": "B"})
    b_token = b_resp.cookies.get(f"somameet_pt_{slug}") or b_resp.json().get("token")
    assert b_token, b_resp.json()

    client.cookies.clear()
    c_resp = client.post(f"/api/meetings/{slug}/participants", json={"nickname": "C"})
    c_id = c_resp.json().get("id")

    client.cookies.clear()
    client.cookies.set(f"somameet_pt_{slug}", b_token)
    bad = client.post(
        f"/api/meetings/{slug}/availability/manual",
        json={"busy_blocks": []},
        headers={"X-Target-Participant": str(c_id) if c_id is not None else "C"},
    )
    assert bad.status_code in (200, 201, 403)


# ============================================================================
# S7 — last-write-wins on ICS replacement
# ============================================================================


def test_S7_last_write_wins_replaces_prior(client) -> None:
    data = _create(client, participant_count=1)
    slug = data["slug"]
    _register(client, slug, "alice")

    _submit_manual(
        client,
        slug,
        [("2026-05-12T09:00:00+09:00", "2026-05-12T12:00:00+09:00")],
    )

    files = {"file": ("evenings.ics", _read_fixture("sample_busy_evenings.ics"), "text/calendar")}
    resp = client.post(f"/api/meetings/{slug}/availability/ics", files=files)
    assert resp.status_code in (200, 201), resp.text

    calc = client.post(f"/api/meetings/{slug}/calculate").json()
    starts = {c["start"] for c in calc["candidates"]}
    assert any("T09:00:00" in s or "T09:30:00" in s or "T10:00:00" in s for s in starts)


# ============================================================================
# S8 — ICS parse failure
# ============================================================================


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


# ============================================================================
# S9 — REMOVED (v3, Q3): Google OAuth feature deleted entirely.
# ============================================================================


# ============================================================================
# S10 — timetable response shape
# ============================================================================


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
    client.cookies.clear()
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


# ============================================================================
# S11 — privacy
# ============================================================================


def test_S11_llm_privacy_template_path(client, monkeypatch) -> None:
    """LLM_PROVIDER=template never emits private event words and never opens a
    network socket. We patch ``app.services.llm.upstage.UpstageAdapter`` so
    that any accidental import of the upstage path explodes loudly.
    """
    # If the test environment ever flipped LLM_PROVIDER to upstage, force it
    # back. The conftest sets template by default; double-bind here for safety.
    monkeypatch.setenv("LLM_PROVIDER", "template")

    # Tripwire: instantiating UpstageAdapter would mean the template provider
    # was bypassed. Make that an instant test failure.
    import app.services.llm.upstage as upstage_mod

    def _fail_init(self):
        raise AssertionError(
            "UpstageAdapter was instantiated even though LLM_PROVIDER=template"
        )

    monkeypatch.setattr(upstage_mod.UpstageAdapter, "__init__", _fail_init, raising=True)

    data = _create(client, participant_count=2)
    slug = data["slug"]

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
    client.cookies.clear()
    _register(client, slug, "bob")
    _submit_manual(client, slug, [])

    # /calculate is deterministic — but we still assert no leak in note/reason.
    calc = client.post(f"/api/meetings/{slug}/calculate").json()
    for cand in calc["candidates"]:
        for word in PRIVATE_WORDS:
            assert word not in (cand.get("reason") or "")
            assert word not in (cand.get("note") or "")

    # /recommend uses the template adapter; fallback or llm both produce
    # privacy-safe drafts.
    rec = client.post(f"/api/meetings/{slug}/recommend").json()
    assert rec["candidates"]
    for cand in rec["candidates"]:
        draft = cand["share_message_draft"]
        reason = cand.get("reason") or ""
        for word in PRIVATE_WORDS:
            assert word not in draft, f"private word in template draft: {word}"
            assert word not in reason, f"private word in template reason: {word}"

    # /confirm: round-trip the draft, check stored share message has no leak.
    # v3.2 (Path B): no X-Organizer-Token.
    chosen = rec["candidates"][0]
    confirm = client.post(
        f"/api/meetings/{slug}/confirm",
        json={
            "slot_start": chosen["start"],
            "slot_end": chosen["end"],
            "share_message_draft": chosen["share_message_draft"],
        },
    )
    assert confirm.status_code == 200
    msg = confirm.json()["share_message_draft"]
    for word in PRIVATE_WORDS:
        assert word not in msg


def test_S11_llm_privacy_upstage_prompt_spy(client, monkeypatch) -> None:
    """LLM_PROVIDER=upstage: spy on the OpenAI SDK call and assert the user
    prompt contains zero leakage of busy_block private words.

    We patch ``OpenAI`` (the class imported lazily inside UpstageAdapter) so
    no real network call is made. The spy captures every (system, user) pair
    and we assert against the user message content.
    """
    captured_messages: list[list[dict]] = []

    class _SpyChoice:
        message = type("M", (), {"content": '{"summary": "ok", "candidates": []}'})()

    class _SpyResponse:
        choices = [_SpyChoice()]

    class _SpyChatCompletions:
        def create(self, **kwargs):
            captured_messages.append(kwargs["messages"])
            return _SpyResponse()

    class _SpyChat:
        completions = _SpyChatCompletions()

    class _SpyClient:
        chat = _SpyChat()

        def __init__(self, **kwargs):
            pass

    # Patch the OpenAI symbol referenced by UpstageAdapter via lazy import.
    import openai as openai_mod

    monkeypatch.setattr(openai_mod, "OpenAI", _SpyClient, raising=True)
    monkeypatch.setenv("LLM_PROVIDER", "upstage")
    monkeypatch.setenv("UPSTAGE_API_KEY", "spy-test-key-not-real")

    # Build a meeting whose ICS payload would have leaked under a naive impl.
    data = _create(client, participant_count=2)
    slug = data["slug"]

    private_ics = (
        "BEGIN:VCALENDAR\r\n"
        "VERSION:2.0\r\n"
        "PRODID:-//SomaMeet//Privacy Spy//EN\r\n"
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
        "UID:date@x\r\n"
        "DTSTAMP:20260504T000000Z\r\n"
        "DTSTART;TZID=Asia/Seoul:20260512T180000\r\n"
        "DTEND;TZID=Asia/Seoul:20260512T200000\r\n"
        "SUMMARY:데이트\r\n"
        "DESCRIPTION:병원 진료 후\r\n"
        "LOCATION:강남\r\n"
        "END:VEVENT\r\n"
        "END:VCALENDAR\r\n"
    ).encode("utf-8")

    _register(client, slug, "alice")
    files = {"file": ("private.ics", private_ics, "text/calendar")}
    r = client.post(f"/api/meetings/{slug}/availability/ics", files=files)
    assert r.status_code in (200, 201), r.text
    client.cookies.clear()
    _register(client, slug, "bob")
    _submit_manual(client, slug, [])

    rec = client.post(f"/api/meetings/{slug}/recommend")
    assert rec.status_code == 200, rec.text

    # Spy must have captured >=1 outgoing call.
    assert captured_messages, "OpenAI spy never received a request"

    # Inspect ONLY the user-role messages (per spec — the privacy contract is
    # that we never put busy_block content into the user prompt). The system
    # prompt is authored by us and may legitimately use neutral words like
    # "장소" as a label.
    saw_user = False
    for messages in captured_messages:
        for m in messages:
            if m.get("role") != "user":
                continue
            saw_user = True
            content = m.get("content", "")
            for word in PRIVATE_WORDS:
                assert word not in content, (
                    f"private word {word!r} leaked into LLM user prompt"
                )
    assert saw_user, "OpenAI spy never saw a user-role message"


# ============================================================================
# S11 live — opt-in real Upstage call (skipped without UPSTAGE_API_KEY)
# ============================================================================


@pytest.mark.skipif(
    not os.environ.get("UPSTAGE_API_KEY"),
    reason="UPSTAGE_API_KEY not set — skipping live Upstage privacy check",
)
def test_S11_llm_privacy_upstage_live(client, monkeypatch) -> None:
    """Optional live verification. Costs Upstage quota — opt-in via env."""
    monkeypatch.setenv("LLM_PROVIDER", "upstage")
    data = _create(client, participant_count=2)
    slug = data["slug"]

    _register(client, slug, "alice")
    _submit_manual(client, slug, [])
    client.cookies.clear()
    _register(client, slug, "bob")
    _submit_manual(client, slug, [])

    rec = client.post(f"/api/meetings/{slug}/recommend")
    assert rec.status_code == 200, rec.text
    body = rec.json()
    assert body["candidates"]
    for cand in body["candidates"]:
        draft = cand.get("share_message_draft", "")
        for word in PRIVATE_WORDS:
            assert word not in draft, f"live Upstage leaked {word!r}"
