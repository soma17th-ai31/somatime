"""End-to-end DB flow against the FastAPI app (skipped until backend-api lands).

Covers the happy path: create meeting -> get -> register participants ->
manual availability -> calculate -> confirm.
"""
from __future__ import annotations


def _create_meeting(client) -> dict:
    body = {
        "title": "팀 회의",
        "date_range_start": "2026-05-11",
        "date_range_end": "2026-05-15",
        "duration_minutes": 60,
        "participant_count": 3,
        "location_type": "online",
        "time_window_start": "09:00",
        "time_window_end": "22:00",
        "include_weekends": False,
    }
    resp = client.post("/api/meetings", json=body)
    assert resp.status_code == 201, resp.text
    return resp.json()


def test_create_returns_slug_and_token(client) -> None:
    data = _create_meeting(client)
    assert len(data["slug"]) == 8
    assert len(data["organizer_token"]) >= 32
    assert data["slug"] in data["share_url"]
    assert "org=" in data["organizer_url"]


def test_get_meeting_by_slug(client) -> None:
    data = _create_meeting(client)
    resp = client.get(f"/api/meetings/{data['slug']}")
    assert resp.status_code == 200
    body = resp.json()
    assert body["slug"] == data["slug"]
    assert body["title"] == "팀 회의"
    assert "organizer_token" not in body


def test_register_participant_then_submit_manual(client) -> None:
    data = _create_meeting(client)
    slug = data["slug"]

    p_resp = client.post(f"/api/meetings/{slug}/participants", json={"nickname": "alice"})
    assert p_resp.status_code in (200, 201)

    avail_resp = client.post(
        f"/api/meetings/{slug}/availability/manual",
        json={
            "busy_blocks": [
                {"start": "2026-05-12T09:00:00+09:00", "end": "2026-05-12T12:00:00+09:00"},
            ]
        },
    )
    assert avail_resp.status_code in (200, 201), avail_resp.text


def test_full_flow_calculate_and_confirm(client) -> None:
    data = _create_meeting(client)
    slug = data["slug"]
    organizer_token = data["organizer_token"]

    # 3 participants, all with no busy blocks -> entire window is free.
    nicks = ["a", "b", "c"]
    for nick in nicks:
        client.post(f"/api/meetings/{slug}/participants", json={"nickname": nick})
        client.post(
            f"/api/meetings/{slug}/availability/manual",
            json={"busy_blocks": []},
        )

    calc = client.post(f"/api/meetings/{slug}/calculate")
    assert calc.status_code == 200
    body = calc.json()
    assert body["candidates"], body
    assert len(body["candidates"]) <= 3

    first = body["candidates"][0]
    confirm = client.post(
        f"/api/meetings/{slug}/confirm",
        json={"slot_start": first["start"], "slot_end": first["end"]},
        headers={"X-Organizer-Token": organizer_token},
    )
    assert confirm.status_code == 200
    body = confirm.json()
    assert body["confirmed_slot"]["start"] == first["start"]
    assert "share_message_draft" in body
