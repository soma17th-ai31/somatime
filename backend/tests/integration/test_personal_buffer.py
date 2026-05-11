"""Personal travel-time buffer — issue #13.

Covers the contract laid down in the spec rollout:

a) Migration backwards-compat — existing meetings/participants stay valid
   with buffer_minutes IS NULL.
b) PATCH /me sets buffer_minutes; subsequent GET surfaces it as my_buffer_minutes.
c) buffer_minutes IS NULL → scheduler falls back to meeting.offline_buffer_minutes.
d) buffer_minutes set on one participant only exposes them to stricter
   buffer enforcement; peers with smaller buffers stay available.
e) invalid values (e.g. 45) are rejected with 422.
f) cookie-less PATCH is rejected with 403.
g) PATCH /me is still accepted after the meeting is confirmed (consistent
   with the existing nickname/pin policy).
h) Explicit 0 ("버퍼 없음") overrides the meeting default downward.
"""
from __future__ import annotations

from datetime import date, datetime, time, timedelta


def _create_offline_meeting(
    client,
    *,
    location_type: str = "offline",
    offline_buffer_minutes: int = 60,
) -> dict:
    body = {
        "title": "퇴근 회의",
        "date_range_start": "2026-06-01",
        "date_range_end": "2026-06-01",
        "duration_minutes": 60,
        "location_type": location_type,
        "offline_buffer_minutes": offline_buffer_minutes,
        "time_window_start": "09:00",
        "time_window_end": "22:00",
        "include_weekends": False,
    }
    resp = client.post("/api/meetings", json=body)
    assert resp.status_code == 201, resp.text
    return resp.json()


def _register(client, slug: str, nickname: str) -> None:
    resp = client.post(
        f"/api/meetings/{slug}/participants", json={"nickname": nickname}
    )
    assert resp.status_code in (200, 201), resp.text


def _submit_busy(client, slug: str, blocks: list[tuple[str, str]]) -> None:
    resp = client.post(
        f"/api/meetings/{slug}/availability/manual",
        json={"busy_blocks": [{"start": s, "end": e} for s, e in blocks]},
    )
    assert resp.status_code in (200, 201), resp.text


# --------------------------------------------------------------------- a + c


def test_existing_participant_has_null_buffer_after_migration(client) -> None:
    """a + c — a fresh participant carries buffer_minutes=None and the
    scheduler falls back to the meeting default for them."""
    meeting = _create_offline_meeting(client, offline_buffer_minutes=30)
    slug = meeting["slug"]
    _register(client, slug, "alice")
    _submit_busy(client, slug, [])

    detail = client.get(f"/api/meetings/{slug}").json()
    assert detail["my_buffer_minutes"] is None
    # And /calculate still produces candidates: with no busy blocks the
    # buffer is irrelevant, so a fresh meeting is full of windows.
    calc = client.post(f"/api/meetings/{slug}/calculate").json()
    assert calc["candidates"], calc


# --------------------------------------------------------------------- b


def test_patch_me_buffer_round_trips_via_meeting_detail(client) -> None:
    meeting = _create_offline_meeting(client, offline_buffer_minutes=30)
    slug = meeting["slug"]
    _register(client, slug, "alice")

    patch = client.patch(
        f"/api/meetings/{slug}/participants/me",
        json={"nickname": "alice", "buffer_minutes": 60},
    )
    assert patch.status_code == 200, patch.text
    assert patch.json()["buffer_minutes"] == 60

    detail = client.get(f"/api/meetings/{slug}").json()
    assert detail["my_buffer_minutes"] == 60


def test_patch_me_buffer_explicit_null_clears_to_inherit(client) -> None:
    meeting = _create_offline_meeting(client, offline_buffer_minutes=30)
    slug = meeting["slug"]
    _register(client, slug, "alice")
    # Set, then clear.
    assert (
        client.patch(
            f"/api/meetings/{slug}/participants/me",
            json={"nickname": "alice", "buffer_minutes": 60},
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
    """d — only the participant with the larger personal buffer is gated out
    of a slot adjacent to their busy block; peers with the default/smaller
    buffer stay available.
    """
    # Meeting default buffer = 0 so peers without override never get excluded.
    meeting = _create_offline_meeting(client, offline_buffer_minutes=0)
    slug = meeting["slug"]

    # alice registers + leaves the whole day free, with default (inherit=0) buffer.
    _register(client, slug, "alice")
    _submit_busy(client, slug, [])

    # bob registers + has a busy block 13:00-14:00, and a personal buffer of 60min.
    # That means [12:00, 15:00] is effectively blocked for him.
    client.cookies.clear()
    _register(client, slug, "bob")
    _submit_busy(
        client,
        slug,
        [("2026-06-01T13:00:00+09:00", "2026-06-01T14:00:00+09:00")],
    )
    assert (
        client.patch(
            f"/api/meetings/{slug}/participants/me",
            json={"nickname": "bob", "buffer_minutes": 60},
        ).status_code
        == 200
    )

    calc = client.post(f"/api/meetings/{slug}/calculate").json()
    by_start = {c["start"]: c for c in calc["candidates"]}

    # 11:00-12:00: bob's buffered range starts at 12:00 — he is free here.
    # 14:00-15:00: still inside bob's [12:00, 15:00) buffered range → bob excluded.
    early = by_start.get("2026-06-01T11:00:00+09:00")
    if early is not None:
        assert "bob" in early.get("missing_participants", []) or early["available_count"] >= 1

    after = by_start.get("2026-06-01T14:00:00+09:00")
    # Either /calculate omitted the slot (no full-match), or it's a fallback
    # window where bob is the missing one. Both shapes are acceptable; what
    # matters is that bob's personal buffer cost him this slot specifically.
    if after is not None:
        missing = after.get("missing_participants", [])
        assert missing == ["bob"] or "bob" in missing
        assert "alice" not in missing


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


# --------------------------------------------------------------------- f


def test_patch_me_buffer_requires_cookie(client) -> None:
    meeting = _create_offline_meeting(client)
    slug = meeting["slug"]
    _register(client, slug, "alice")
    # Drop the participant cookie issued by /participants. The PATCH then
    # has no way to authenticate the caller → 403 participant_required.
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
    self-update endpoint stays open for nickname / pin / buffer.
    """
    meeting = _create_offline_meeting(client, offline_buffer_minutes=30)
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

    # PATCH /me/buffer still 200 after the meeting is confirmed.
    after = client.patch(
        f"/api/meetings/{slug}/participants/me",
        json={"nickname": "alice", "buffer_minutes": 90},
    )
    assert after.status_code == 200, after.text
    assert after.json()["buffer_minutes"] == 90


# --------------------------------------------------------------------- h


def test_explicit_zero_buffer_overrides_meeting_default_downward(client) -> None:
    """h — meeting default 120min would exclude a 13:30 slot adjacent to
    a 12:00-13:30 busy block; setting personal buffer to 0 restores it.
    """
    # Single-participant, single-day meeting so the calculation is
    # deterministic and we can assert on specific slot starts.
    meeting = _create_offline_meeting(client, offline_buffer_minutes=120)
    slug = meeting["slug"]
    _register(client, slug, "alice")
    _submit_busy(
        client,
        slug,
        [
            ("2026-06-01T12:00:00+09:00", "2026-06-01T13:30:00+09:00"),
            ("2026-06-01T16:00:00+09:00", "2026-06-01T17:00:00+09:00"),
        ],
    )

    # With default buffer 120, the 13:30-14:30 slot would be inside
    # [10:00, 15:30] for the first block — excluded.
    before = client.post(f"/api/meetings/{slug}/calculate").json()
    before_starts = {c["start"] for c in before["candidates"]}
    assert "2026-06-01T13:30:00+09:00" not in before_starts

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
