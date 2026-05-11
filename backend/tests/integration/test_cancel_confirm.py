"""DELETE /api/meetings/{slug}/confirm — issue #24.

Covers:
1. Happy path: confirm → DELETE → confirmed_slot drops to null on subsequent GET.
2. Idempotent: DELETE on a never-confirmed meeting → 200, MeetingDetail unchanged.
3. Past confirmation refused: confirmed_slot_start in the past → 409
   cannot_cancel_after_meeting_start.
4. Unlocks settings: after DELETE, PATCH /settings is accepted again.
5. Re-confirm allowed: after DELETE, POST /confirm succeeds again.
"""
from __future__ import annotations

from datetime import date, datetime, time, timedelta


def _create_meeting(client) -> dict:
    # Pick a date range comfortably in the future so the first candidate
    # produced by /calculate is guaranteed to start after `now`. Otherwise
    # the cancel endpoint would (correctly) refuse with 409 on the happy path.
    body = {
        "title": "팀 회의",
        "date_range_start": "2026-06-01",
        "date_range_end": "2026-06-05",
        "duration_minutes": 60,
        "location_type": "online",
        "time_window_start": "09:00",
        "time_window_end": "22:00",
        "include_weekends": False,
    }
    resp = client.post("/api/meetings", json=body)
    assert resp.status_code == 201, resp.text
    return resp.json()


def _confirm_first_candidate(client, slug: str) -> dict:
    """Register one participant, submit availability, calculate, confirm."""
    client.post(
        f"/api/meetings/{slug}/participants",
        json={"nickname": "a", "buffer_minutes": 60},
    )
    client.post(
        f"/api/meetings/{slug}/availability/manual",
        json={"busy_blocks": []},
    )
    calc = client.post(f"/api/meetings/{slug}/calculate").json()
    first = calc["candidates"][0]
    body = {
        "slot_start": first["start"],
        "slot_end": first["end"],
        "share_message_draft": "팀 회의 일정 안내드립니다.",
    }
    resp = client.post(f"/api/meetings/{slug}/confirm", json=body)
    assert resp.status_code == 200, resp.text
    return first


def test_cancel_confirm_happy_path_clears_confirmed_slot(client) -> None:
    """confirm → DELETE → GET shows confirmed_slot=null and message=null."""
    data = _create_meeting(client)
    slug = data["slug"]
    _confirm_first_candidate(client, slug)

    # Sanity: meeting is now confirmed.
    pre = client.get(f"/api/meetings/{slug}").json()
    assert pre["confirmed_slot"] is not None
    assert pre["confirmed_share_message"]

    cancel = client.delete(f"/api/meetings/{slug}/confirm")
    assert cancel.status_code == 200, cancel.text
    body = cancel.json()
    assert body["confirmed_slot"] is None
    assert body["confirmed_share_message"] is None
    # Other meeting fields are preserved.
    assert body["slug"] == slug
    assert body["title"] == "팀 회의"

    after = client.get(f"/api/meetings/{slug}").json()
    assert after["confirmed_slot"] is None
    assert after["confirmed_share_message"] is None


def test_cancel_confirm_idempotent_when_never_confirmed(client) -> None:
    """DELETE on an unconfirmed meeting → 200, payload identical to GET."""
    data = _create_meeting(client)
    slug = data["slug"]

    pre = client.get(f"/api/meetings/{slug}").json()
    assert pre["confirmed_slot"] is None

    cancel = client.delete(f"/api/meetings/{slug}/confirm")
    assert cancel.status_code == 200, cancel.text
    body = cancel.json()
    assert body["confirmed_slot"] is None
    assert body["confirmed_share_message"] is None
    # Slug / title / scheduling fields unchanged.
    assert body["slug"] == pre["slug"]
    assert body["title"] == pre["title"]
    assert body["duration_minutes"] == pre["duration_minutes"]


def test_cancel_confirm_refuses_when_meeting_already_started(
    client, db_session
) -> None:
    """confirmed_slot_start in the past → 409 cannot_cancel_after_meeting_start."""
    from app.db.models import Meeting

    data = _create_meeting(client)
    slug = data["slug"]

    # Patch the meeting row directly to a past confirmed slot. Bypassing the
    # /confirm validator is intentional — we need a meeting whose confirmed
    # slot pre-dates `now` (the validator would reject that on the way in).
    meeting = db_session.query(Meeting).filter(Meeting.slug == slug).first()
    assert meeting is not None
    past_start = datetime(2020, 1, 1, 9, 0)
    meeting.confirmed_slot_start = past_start
    meeting.confirmed_slot_end = past_start + timedelta(hours=1)
    meeting.confirmed_share_message = "이미 시작된 회의."
    db_session.add(meeting)
    db_session.commit()

    cancel = client.delete(f"/api/meetings/{slug}/confirm")
    assert cancel.status_code == 409, cancel.text
    err = cancel.json()
    assert err["error_code"] == "cannot_cancel_after_meeting_start"
    assert "confirmed_slot" in err
    assert err["confirmed_slot"]["start"].startswith("2020-01-01")

    # State is preserved on rejection.
    detail = client.get(f"/api/meetings/{slug}").json()
    assert detail["confirmed_slot"] is not None
    assert detail["confirmed_share_message"] == "이미 시작된 회의."


def test_cancel_confirm_unlocks_settings_patch(client) -> None:
    """confirm → DELETE → PATCH /settings is accepted again."""
    data = _create_meeting(client)
    slug = data["slug"]
    _confirm_first_candidate(client, slug)

    # Confirmed → PATCH should be 409.
    settings_body = {
        "date_mode": "range",
        "date_range_start": "2026-06-01",
        "date_range_end": "2026-06-06",  # widened by one day
        "candidate_dates": None,
        "duration_minutes": 60,
        "location_type": "online",
        "time_window_start": "09:00",
        "time_window_end": "22:00",
        "include_weekends": False,
    }
    blocked = client.patch(f"/api/meetings/{slug}/settings", json=settings_body)
    assert blocked.status_code == 409
    assert blocked.json()["error_code"] == "already_confirmed"

    # Cancel.
    assert client.delete(f"/api/meetings/{slug}/confirm").status_code == 200

    # Now PATCH succeeds.
    ok = client.patch(f"/api/meetings/{slug}/settings", json=settings_body)
    assert ok.status_code == 200, ok.text
    assert ok.json()["date_range_end"] == "2026-06-06"


def test_cancel_confirm_allows_re_confirm(client) -> None:
    """confirm → DELETE → POST /confirm again succeeds with a fresh slot."""
    data = _create_meeting(client)
    slug = data["slug"]
    first = _confirm_first_candidate(client, slug)

    # Cancel the first confirmation.
    assert client.delete(f"/api/meetings/{slug}/confirm").status_code == 200

    # Re-confirm with the same candidate.
    body = {
        "slot_start": first["start"],
        "slot_end": first["end"],
        "share_message_draft": "다시 확정합니다.",
    }
    redo = client.post(f"/api/meetings/{slug}/confirm", json=body)
    assert redo.status_code == 200, redo.text
    assert redo.json()["share_message_draft"] == "다시 확정합니다."

    detail = client.get(f"/api/meetings/{slug}").json()
    assert detail["confirmed_slot"] is not None
    assert detail["confirmed_share_message"] == "다시 확정합니다."
