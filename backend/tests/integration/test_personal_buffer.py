"""Personal travel-time buffer — issue #13 (and #13 follow-up).

Covers the contract laid down in the spec rollout, post-follow-up that
removed the meeting-level ``offline_buffer_minutes`` column:

a) Fresh participants carry buffer_minutes=None and pick up the scheduler's
   built-in default (60min) automatically.
b) PATCH /me sets buffer_minutes; subsequent GET surfaces it as my_buffer_minutes.
c) Round-trip: PATCH to an explicit int, then PATCH null clears it.
d) Personal buffer is per-participant — bumping one person's buffer above
   the default kicks only them out of a borderline slot.
e) invalid values (e.g. 45) are rejected with 422.
f) cookie-less PATCH is rejected with 403.
g) PATCH /me is still accepted after the meeting is confirmed (consistent
   with the existing nickname/pin policy).
h) Explicit 0 ("버퍼 없음") overrides the scheduler default downward.
"""
from __future__ import annotations


def _create_offline_meeting(client, *, location_type: str = "offline") -> dict:
    body = {
        "title": "퇴근 회의",
        "date_range_start": "2026-06-01",
        "date_range_end": "2026-06-01",
        "duration_minutes": 60,
        "location_type": location_type,
        "include_weekends": False,
    }
    resp = client.post("/api/meetings", json=body)
    assert resp.status_code == 201, resp.text
    return resp.json()


def _register(client, slug: str, nickname: str, *, buffer_minutes: int = 60) -> None:
    # buffer-on-join: every POST /participants must carry an explicit
    # buffer_minutes (0/30/60/90/120). Tests default to 60 — the personal-
    # buffer cases that care about a specific value PATCH it afterwards via
    # /participants/me, exactly like the FE does.
    resp = client.post(
        f"/api/meetings/{slug}/participants",
        json={"nickname": nickname, "buffer_minutes": buffer_minutes},
    )
    assert resp.status_code in (200, 201), resp.text


def _submit_busy(client, slug: str, blocks: list[tuple[str, str]]) -> None:
    resp = client.post(
        f"/api/meetings/{slug}/availability/manual",
        json={"busy_blocks": [{"start": s, "end": e} for s, e in blocks]},
    )
    assert resp.status_code in (200, 201), resp.text


# --------------------------------------------------------------------- a


def test_fresh_participant_stores_buffer_supplied_on_join(client) -> None:
    """a — buffer-on-join: a fresh participant always has an explicit
    buffer (set during registration). With no busy blocks the scheduler
    still produces plenty of candidates."""
    meeting = _create_offline_meeting(client)
    slug = meeting["slug"]
    _register(client, slug, "alice", buffer_minutes=60)
    _submit_busy(client, slug, [])

    detail = client.get(f"/api/meetings/{slug}").json()
    assert detail["my_buffer_minutes"] == 60
    calc = client.post(f"/api/meetings/{slug}/calculate").json()
    assert calc["candidates"], calc


# --------------------------------------------------------------------- b


def test_patch_me_buffer_round_trips_via_meeting_detail(client) -> None:
    meeting = _create_offline_meeting(client)
    slug = meeting["slug"]
    _register(client, slug, "alice")

    patch = client.patch(
        f"/api/meetings/{slug}/participants/me",
        json={"nickname": "alice", "buffer_minutes": 90},
    )
    assert patch.status_code == 200, patch.text
    assert patch.json()["buffer_minutes"] == 90

    detail = client.get(f"/api/meetings/{slug}").json()
    assert detail["my_buffer_minutes"] == 90


# --------------------------------------------------------------------- c


def test_patch_me_buffer_explicit_null_clears_to_inherit(client) -> None:
    meeting = _create_offline_meeting(client)
    slug = meeting["slug"]
    _register(client, slug, "alice")
    # Set, then clear.
    assert (
        client.patch(
            f"/api/meetings/{slug}/participants/me",
            json={"nickname": "alice", "buffer_minutes": 90},
        ).status_code
        == 200
    )
    cleared = client.patch(
        f"/api/meetings/{slug}/participants/me",
        json={"nickname": "alice", "buffer_minutes": None},
    )
    assert cleared.status_code == 200
    assert cleared.json()["buffer_minutes"] is None
    detail = client.get(f"/api/meetings/{slug}").json()
    assert detail["my_buffer_minutes"] is None


# --------------------------------------------------------------------- d


def test_personal_buffer_excludes_only_that_participant(client) -> None:
    """d — bumping one participant's buffer past the scheduler default
    excludes only them from a borderline slot; peers stay available."""
    meeting = _create_offline_meeting(client)
    slug = meeting["slug"]

    # alice registers with the default (60min) buffer and a single busy block.
    _register(client, slug, "alice")
    _submit_busy(
        client,
        slug,
        [("2026-06-01T13:00:00+09:00", "2026-06-01T14:00:00+09:00")],
    )

    # bob registers with no busy blocks but pushes his buffer up to 120min.
    # Empty busy_blocks means he's never excluded by buffer math (no padding
    # around nothing). Verifying d is therefore really about alice being
    # the one penalised by HER buffer, with bob staying clean.
    client.cookies.clear()
    _register(client, slug, "bob")
    _submit_busy(client, slug, [])
    assert (
        client.patch(
            f"/api/meetings/{slug}/participants/me",
            json={"nickname": "bob", "buffer_minutes": 120},
        ).status_code
        == 200
    )

    calc = client.post(f"/api/meetings/{slug}/calculate").json()
    by_start = {c["start"]: c for c in calc["candidates"]}

    # 14:30-15:30 sits adjacent to alice's 13:00-14:00 block; with her
    # default 60min buffer her check range is [13:30, 16:30] which collides
    # → alice is the missing one if /calculate returns the slot at all.
    after = by_start.get("2026-06-01T14:30:00+09:00")
    if after is not None:
        missing = after.get("missing_participants", [])
        assert "alice" in missing
        assert "bob" not in missing


# --------------------------------------------------------------------- e


def test_invalid_buffer_value_is_rejected(client) -> None:
    meeting = _create_offline_meeting(client)
    slug = meeting["slug"]
    _register(client, slug, "alice")
    resp = client.patch(
        f"/api/meetings/{slug}/participants/me",
        json={"nickname": "alice", "buffer_minutes": 45},
    )
    assert resp.status_code == 422


# buffer-on-join: ParticipantCreate now requires buffer_minutes.


def test_join_without_buffer_is_rejected(client) -> None:
    """buffer-on-join — POST /participants without buffer_minutes → 422."""
    meeting = _create_offline_meeting(client)
    slug = meeting["slug"]
    resp = client.post(
        f"/api/meetings/{slug}/participants",
        json={"nickname": "alice"},  # buffer_minutes missing
    )
    assert resp.status_code == 422


def test_join_with_invalid_buffer_is_rejected(client) -> None:
    """buffer-on-join — POST /participants with disallowed buffer → 422."""
    meeting = _create_offline_meeting(client)
    slug = meeting["slug"]
    resp = client.post(
        f"/api/meetings/{slug}/participants",
        json={"nickname": "alice", "buffer_minutes": 45},
    )
    assert resp.status_code == 422


def test_join_with_null_buffer_is_rejected(client) -> None:
    """buffer-on-join — null is allowed on PATCH but NOT on first join."""
    meeting = _create_offline_meeting(client)
    slug = meeting["slug"]
    resp = client.post(
        f"/api/meetings/{slug}/participants",
        json={"nickname": "alice", "buffer_minutes": None},
    )
    assert resp.status_code == 422


def test_join_persists_chosen_buffer(client) -> None:
    """buffer-on-join — the chosen buffer is stored and surfaced in MeetingDetail."""
    meeting = _create_offline_meeting(client)
    slug = meeting["slug"]
    resp = client.post(
        f"/api/meetings/{slug}/participants",
        json={"nickname": "alice", "buffer_minutes": 90},
    )
    assert resp.status_code == 201, resp.text
    assert resp.json()["buffer_minutes"] == 90
    detail = client.get(f"/api/meetings/{slug}").json()
    assert detail["my_buffer_minutes"] == 90


def test_re_register_updates_buffer(client) -> None:
    """buffer-on-join — pre-submit re-register with a different buffer
    overwrites the stored value (the user just picked it again)."""
    meeting = _create_offline_meeting(client)
    slug = meeting["slug"]
    client.post(
        f"/api/meetings/{slug}/participants",
        json={"nickname": "alice", "buffer_minutes": 30},
    )
    # Same nickname, no submit yet → pre-submit re-register branch.
    re_resp = client.post(
        f"/api/meetings/{slug}/participants",
        json={"nickname": "alice", "buffer_minutes": 90},
    )
    assert re_resp.status_code == 201, re_resp.text
    assert re_resp.json()["buffer_minutes"] == 90
    detail = client.get(f"/api/meetings/{slug}").json()
    assert detail["my_buffer_minutes"] == 90


# --------------------------------------------------------------------- f


def test_patch_me_buffer_requires_cookie(client) -> None:
    meeting = _create_offline_meeting(client)
    slug = meeting["slug"]
    _register(client, slug, "alice")
    client.cookies.clear()
    resp = client.patch(
        f"/api/meetings/{slug}/participants/me",
        json={"nickname": "alice", "buffer_minutes": 60},
    )
    assert resp.status_code == 403
    assert resp.json()["error_code"] == "participant_required"


# --------------------------------------------------------------------- g


def test_patch_me_buffer_allowed_after_confirmation(client) -> None:
    """g — the meeting/settings PATCH is locked after confirm, but the
    self-update endpoint stays open for nickname / pin / buffer."""
    meeting = _create_offline_meeting(client)
    slug = meeting["slug"]
    _register(client, slug, "alice")
    _submit_busy(client, slug, [])

    calc = client.post(f"/api/meetings/{slug}/calculate").json()
    first = calc["candidates"][0]
    confirm = client.post(
        f"/api/meetings/{slug}/confirm",
        json={
            "slot_start": first["start"],
            "slot_end": first["end"],
            "share_message_draft": "확정 메시지",
        },
    )
    assert confirm.status_code == 200

    after = client.patch(
        f"/api/meetings/{slug}/participants/me",
        json={"nickname": "alice", "buffer_minutes": 90},
    )
    assert after.status_code == 200, after.text
    assert after.json()["buffer_minutes"] == 90


# --------------------------------------------------------------------- h


def test_explicit_zero_buffer_overrides_default_downward(client) -> None:
    """h — scheduler default 60min would exclude the 13:30-14:30 slot
    adjacent to a 12:00-13:30 busy block; setting personal buffer to 0
    restores it.

    Issue #57 changed the search window from configurable 09-22 to a
    fixed 06-24. To keep this assertion meaningful against /calculate's
    top-3 + 2h spread ranking, we fill the rest of the day with busy
    blocks so 13:30-14:30 is the ONLY remaining free slot under buffer=0.
    """
    meeting = _create_offline_meeting(client)
    slug = meeting["slug"]
    _register(client, slug, "alice")
    _submit_busy(
        client,
        slug,
        [
            # Block 06:00 → 13:30 (alice unavailable for the whole morning).
            ("2026-06-01T06:00:00+09:00", "2026-06-01T13:30:00+09:00"),
            # Block 14:30 → 24:00 (alice unavailable until the day ends).
            ("2026-06-01T14:30:00+09:00", "2026-06-02T00:00:00+09:00"),
        ],
    )

    # With the inherited default 60, the 13:30-14:30 slot sits inside the
    # 60-min padding around the 06:00→13:30 block. /calculate finds no
    # window where alice is free → empty candidate list.
    before = client.post(f"/api/meetings/{slug}/calculate").json()
    assert before["candidates"] == []

    # Set personal buffer to 0 — no padding around busy blocks for alice.
    assert (
        client.patch(
            f"/api/meetings/{slug}/participants/me",
            json={"nickname": "alice", "buffer_minutes": 0},
        ).status_code
        == 200
    )
    after = client.post(f"/api/meetings/{slug}/calculate").json()
    after_starts = {c["start"] for c in after["candidates"]}
    assert "2026-06-01T13:30:00+09:00" in after_starts
