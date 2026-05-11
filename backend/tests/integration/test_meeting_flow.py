"""End-to-end DB flow against the FastAPI app.

Covers the happy path: create meeting -> get -> register participants ->
manual availability -> calculate -> confirm.

v3.2 (Path B): organizer_token / X-Organizer-Token gating retired entirely.
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


def test_create_returns_slug_and_share_url(client) -> None:
    data = _create_meeting(client)
    assert len(data["slug"]) == 8
    assert data["slug"] in data["share_url"]
    # v3.2: organizer_token / organizer_url removed from response.
    assert "organizer_token" not in data
    assert "organizer_url" not in data


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

    p_resp = client.post(
        f"/api/meetings/{slug}/participants",
        json={"nickname": "alice", "buffer_minutes": 60},
    )
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

    # 3 participants, all with no busy blocks -> entire window is free.
    nicks = ["a", "b", "c"]
    for nick in nicks:
        client.post(
            f"/api/meetings/{slug}/participants",
            json={"nickname": nick, "buffer_minutes": 60},
        )
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
    # v3 — POST /confirm body must include share_message_draft (Q9).
    # v3.2 — no X-Organizer-Token header.
    confirm = client.post(
        f"/api/meetings/{slug}/confirm",
        json={
            "slot_start": first["start"],
            "slot_end": first["end"],
            "share_message_draft": "'팀 회의' 일정 안내드립니다.",
        },
    )
    assert confirm.status_code == 200
    body = confirm.json()
    assert body["confirmed_slot"]["start"] == first["start"]
    assert body["share_message_draft"] == "'팀 회의' 일정 안내드립니다."
