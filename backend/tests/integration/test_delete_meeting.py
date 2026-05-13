"""Integration tests for DELETE /api/meetings/{slug} (Phase E).

SettingsModal "회의 삭제" calls this. v3.2 Path B: anyone with the slug
may delete; the FE 2-step dialog is the only accident safeguard.

Cascade chain: Meeting -> Participant -> BusyBlock. We assert that
deletion clears every row tied to the meeting.
"""
from __future__ import annotations


def _create_meeting(client) -> dict:
    body = {
        "title": "팀 회의",
        "date_range_start": "2026-05-11",
        "date_range_end": "2026-05-15",
        "duration_minutes": 60,
        "location_type": "online",
        "include_weekends": False,
    }
    resp = client.post("/api/meetings", json=body)
    assert resp.status_code == 201, resp.text
    return resp.json()


def _register_and_submit(client, slug: str, nickname: str, blocks: list[dict]) -> None:
    r = client.post(
        f"/api/meetings/{slug}/participants",
        json={"nickname": nickname, "buffer_minutes": 60},
    )
    assert r.status_code in (200, 201), r.text
    r = client.post(
        f"/api/meetings/{slug}/availability/manual",
        json={"busy_blocks": blocks},
    )
    assert r.status_code in (200, 201), r.text


def test_delete_meeting_returns_204_with_no_body(client) -> None:
    data = _create_meeting(client)
    slug = data["slug"]

    resp = client.delete(f"/api/meetings/{slug}")
    assert resp.status_code == 204, resp.text
    assert resp.content == b""


def test_delete_then_get_returns_404(client) -> None:
    data = _create_meeting(client)
    slug = data["slug"]

    delete_resp = client.delete(f"/api/meetings/{slug}")
    assert delete_resp.status_code == 204

    get_resp = client.get(f"/api/meetings/{slug}")
    assert get_resp.status_code == 404
    assert get_resp.json()["error_code"] == "meeting_not_found"


def test_delete_unknown_slug_returns_404(client) -> None:
    """No row to delete → get_current_meeting dependency 404s before we
    reach the handler body, matching every other slug-bound endpoint."""
    resp = client.delete("/api/meetings/no-such-x")
    assert resp.status_code == 404
    assert resp.json()["error_code"] == "meeting_not_found"


def test_delete_cascades_participants_and_busy_blocks(client, db_session) -> None:
    """ORM cascade + FK ondelete=CASCADE should clear participants and
    busy_blocks tied to the deleted meeting."""
    from app.db.models import BusyBlock, Meeting, Participant

    data = _create_meeting(client)
    slug = data["slug"]

    # Submit two participants so we exercise the cascade end-to-end.
    _register_and_submit(
        client,
        slug,
        "alice",
        [{"start": "2026-05-12T09:00:00+09:00", "end": "2026-05-12T12:00:00+09:00"}],
    )
    # client cookies are slug-scoped, so registering a second nickname is fine.
    _register_and_submit(
        client,
        slug,
        "bob",
        [{"start": "2026-05-13T14:00:00+09:00", "end": "2026-05-13T15:00:00+09:00"}],
    )

    # Capture the meeting id before deletion so we can check the side tables
    # after the row is gone.
    meeting = db_session.query(Meeting).filter(Meeting.slug == slug).first()
    assert meeting is not None
    meeting_id = meeting.id

    participant_ids = [
        p.id
        for p in db_session.query(Participant)
        .filter(Participant.meeting_id == meeting_id)
        .all()
    ]
    assert len(participant_ids) == 2

    busy_count_before = (
        db_session.query(BusyBlock)
        .filter(BusyBlock.participant_id.in_(participant_ids))
        .count()
    )
    assert busy_count_before == 2

    resp = client.delete(f"/api/meetings/{slug}")
    assert resp.status_code == 204

    # New session view of the same SQLite file — expire the cached objects
    # the fixture session was holding so we re-read state from disk.
    db_session.expire_all()

    assert (
        db_session.query(Meeting).filter(Meeting.id == meeting_id).first() is None
    )
    assert (
        db_session.query(Participant)
        .filter(Participant.meeting_id == meeting_id)
        .count()
        == 0
    )
    assert (
        db_session.query(BusyBlock)
        .filter(BusyBlock.participant_id.in_(participant_ids))
        .count()
        == 0
    )


def test_delete_does_not_require_participant_cookie(client) -> None:
    """v3.2 Path B — no organizer token, no participant cookie required.
    The FE 2-step dialog is the accident safeguard, not BE auth."""
    data = _create_meeting(client)
    slug = data["slug"]

    client.cookies.clear()
    resp = client.delete(f"/api/meetings/{slug}")
    assert resp.status_code == 204
