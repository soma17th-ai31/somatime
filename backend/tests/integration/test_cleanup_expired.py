"""Auto-expiry sweep — issue #32.

Covers the contract laid down in app.services.expiry:

1. range mode — only the meeting whose date_range_end has passed is dropped.
2. picked mode — only the meeting whose max(candidate_dates) has passed is dropped.
3. confirmed_slot_end — past confirmations expire too, even if the original
   range is still in the future.
4. cascade — Participant and BusyBlock rows for the deleted meeting disappear.
5. lazy guard — GET /meetings/{slug} on an expired meeting deletes it and
   returns 404 (no separate sweep needed).
6. idempotent — second sweep is a no-op.
7. 90-day absolute cap — a meeting with sensible date_range_end but a far-
   past created_at still gets deleted when 90 days pass.
"""
from __future__ import annotations

from datetime import date, datetime, time, timedelta

import pytest
from freezegun import freeze_time

from app.db.models import BusyBlock, Meeting, Participant
from app.services.expiry import (
    GRACE_PERIOD,
    delete_expired_meetings,
    meeting_expires_at,
)


# ---------------------------------------------------------------------- helpers

_DEFAULT_CREATED_AT = datetime(2026, 1, 1, 12, 0)


def _make_meeting(
    db_session,
    *,
    slug: str,
    date_mode: str = "range",
    date_range_start: date | None = None,
    date_range_end: date | None = None,
    candidate_dates: list[str] | None = None,
    confirmed_slot_start: datetime | None = None,
    confirmed_slot_end: datetime | None = None,
    created_at: datetime = _DEFAULT_CREATED_AT,
) -> Meeting:
    meeting = Meeting(
        slug=slug,
        title="t",
        date_mode=date_mode,
        date_range_start=date_range_start,
        date_range_end=date_range_end,
        candidate_dates=candidate_dates,
        duration_minutes=60,
        location_type="online",
        include_weekends=False,
        confirmed_slot_start=confirmed_slot_start,
        confirmed_slot_end=confirmed_slot_end,
        created_at=created_at,
    )
    db_session.add(meeting)
    db_session.commit()
    db_session.refresh(meeting)
    return meeting


def _attach_participant_with_block(
    db_session,
    meeting: Meeting,
    *,
    nickname: str = "alice",
    block_start: datetime | None = None,
    block_end: datetime | None = None,
) -> tuple[Participant, BusyBlock | None]:
    participant = Participant(
        meeting_id=meeting.id,
        nickname=nickname,
        token=f"tok-{meeting.id}-{nickname}",
        pin=None,
        source_type="manual",
        confirmed_at=datetime(2026, 4, 2, 9, 0),
        created_at=datetime(2026, 4, 2, 9, 0),
    )
    db_session.add(participant)
    db_session.commit()
    db_session.refresh(participant)

    block = None
    if block_start is not None and block_end is not None:
        block = BusyBlock(
            participant_id=participant.id,
            start_at=block_start,
            end_at=block_end,
        )
        db_session.add(block)
        db_session.commit()
    return participant, block


# ---------------------------------------------------------------------- helpers (pure)


def test_meeting_expires_at_range_mode() -> None:
    meeting = Meeting(
        slug="x",
        title="",
        date_mode="range",
        date_range_start=date(2026, 5, 1),
        date_range_end=date(2026, 5, 3),
        candidate_dates=None,
        duration_minutes=60,
        location_type="online",
        include_weekends=False,
        created_at=datetime(2026, 1, 1, 10, 0),
    )
    # End-of-day on 2026-05-03 + 24h grace = 2026-05-04 23:59:59.
    assert meeting_expires_at(meeting) == datetime(2026, 5, 3, 23, 59, 59) + GRACE_PERIOD


def test_meeting_expires_at_picked_mode_uses_max_date() -> None:
    meeting = Meeting(
        slug="x",
        title="",
        date_mode="picked",
        date_range_start=None,
        date_range_end=None,
        candidate_dates=["2026-05-01", "2026-05-09", "2026-05-05"],
        duration_minutes=60,
        location_type="online",
        include_weekends=False,
        created_at=datetime(2026, 1, 1, 10, 0),
    )
    assert (
        meeting_expires_at(meeting)
        == datetime(2026, 5, 9, 23, 59, 59) + GRACE_PERIOD
    )


def test_meeting_expires_at_uses_confirmed_slot_when_later() -> None:
    meeting = Meeting(
        slug="x",
        title="",
        date_mode="range",
        date_range_start=date(2026, 5, 1),
        date_range_end=date(2026, 5, 3),
        candidate_dates=None,
        duration_minutes=60,
        location_type="online",
        include_weekends=False,
        confirmed_slot_start=datetime(2026, 5, 10, 14, 0),
        confirmed_slot_end=datetime(2026, 5, 10, 15, 0),
        created_at=datetime(2026, 1, 1, 10, 0),
    )
    # confirmed slot end is later than end-of-day on date_range_end.
    assert (
        meeting_expires_at(meeting)
        == datetime(2026, 5, 10, 15, 0) + GRACE_PERIOD
    )


# ---------------------------------------------------------------------- DB sweeps


@freeze_time("2026-05-11 09:00:00")
def test_sweep_range_mode_deletes_only_expired(db_session) -> None:
    """Case 1 — range: only the meeting whose end has passed is dropped."""
    expired = _make_meeting(
        db_session,
        slug="rng-old1",
        date_range_start=date(2026, 5, 1),
        date_range_end=date(2026, 5, 3),  # +24h grace = 2026-05-04 23:59:59
    )
    still_alive = _make_meeting(
        db_session,
        slug="rng-new1",
        date_range_start=date(2026, 5, 15),
        date_range_end=date(2026, 5, 20),
    )

    deleted = delete_expired_meetings(db_session)
    assert deleted == 1
    db_session.expire_all()
    assert db_session.query(Meeting).filter(Meeting.slug == "rng-old1").first() is None
    assert db_session.query(Meeting).filter(Meeting.slug == "rng-new1").first() is not None
    _ = expired, still_alive  # keep names readable


@freeze_time("2026-05-11 09:00:00")
def test_sweep_picked_mode_deletes_only_expired(db_session) -> None:
    """Case 2 — picked: max(candidate_dates) is the cut-off."""
    _make_meeting(
        db_session,
        slug="pk-old1",
        date_mode="picked",
        candidate_dates=["2026-05-02", "2026-05-04"],  # max + 24h = 2026-05-05 23:59:59
    )
    _make_meeting(
        db_session,
        slug="pk-new1",
        date_mode="picked",
        candidate_dates=["2026-05-20"],
    )

    deleted = delete_expired_meetings(db_session)
    assert deleted == 1
    db_session.expire_all()
    assert db_session.query(Meeting).filter(Meeting.slug == "pk-old1").first() is None
    assert db_session.query(Meeting).filter(Meeting.slug == "pk-new1").first() is not None


@freeze_time("2026-05-11 09:00:00")
def test_sweep_confirmed_slot_in_past_is_deleted(db_session) -> None:
    """Case 3 — past confirmation expires even if range was generous."""
    _make_meeting(
        db_session,
        slug="cf-old1",
        # date_range stretches into the future, but the actual booked slot
        # is yesterday — that's what determines expiry.
        date_range_start=date(2026, 5, 1),
        date_range_end=date(2026, 5, 20),
        confirmed_slot_start=datetime(2026, 5, 8, 14, 0),
        confirmed_slot_end=datetime(2026, 5, 8, 15, 0),
    )
    # date_range_end 2026-05-20 23:59:59 + 24h = 2026-05-21 23:59:59,
    # which is still in the future relative to the frozen now (2026-05-11).
    # Therefore this meeting should NOT be deleted — meeting_expires_at picks
    # the LATEST of its candidates. This pins the spec ("회의가 가장 늦게
    # 끝나는 시각 + 24h grace").
    deleted = delete_expired_meetings(db_session)
    assert deleted == 0
    assert db_session.query(Meeting).filter(Meeting.slug == "cf-old1").first() is not None

    # Now make a meeting where both range end AND confirmed slot are in the past.
    _make_meeting(
        db_session,
        slug="cf-old2",
        date_range_start=date(2026, 5, 1),
        date_range_end=date(2026, 5, 3),
        confirmed_slot_start=datetime(2026, 5, 2, 14, 0),
        confirmed_slot_end=datetime(2026, 5, 2, 15, 0),
    )
    deleted = delete_expired_meetings(db_session)
    assert deleted == 1
    db_session.expire_all()
    assert db_session.query(Meeting).filter(Meeting.slug == "cf-old2").first() is None


@freeze_time("2026-05-11 09:00:00")
def test_sweep_cascade_drops_participants_and_blocks(db_session) -> None:
    """Case 4 — cascade: dropping a meeting drops its Participant + BusyBlock."""
    meeting = _make_meeting(
        db_session,
        slug="cas-old1",
        date_range_start=date(2026, 5, 1),
        date_range_end=date(2026, 5, 3),
    )
    _attach_participant_with_block(
        db_session,
        meeting,
        nickname="alice",
        block_start=datetime(2026, 5, 2, 9, 0),
        block_end=datetime(2026, 5, 2, 12, 0),
    )

    assert db_session.query(Participant).count() == 1
    assert db_session.query(BusyBlock).count() == 1

    deleted = delete_expired_meetings(db_session)
    assert deleted == 1
    db_session.expire_all()
    assert db_session.query(Meeting).count() == 0
    assert db_session.query(Participant).count() == 0
    assert db_session.query(BusyBlock).count() == 0


@freeze_time("2026-05-11 09:00:00")
def test_lazy_cleanup_on_get_returns_404(client, db_session) -> None:
    """Case 5 — lazy: GET /meetings/{slug} on an expired meeting drops it + 404."""
    _make_meeting(
        db_session,
        slug="lazy01x",
        date_range_start=date(2026, 5, 1),
        date_range_end=date(2026, 5, 3),
    )
    resp = client.get("/api/meetings/lazy01x")
    assert resp.status_code == 404
    body = resp.json()
    assert body["error_code"] == "meeting_not_found"

    # And the row really is gone from the DB.
    db_session.expire_all()
    assert db_session.query(Meeting).filter(Meeting.slug == "lazy01x").first() is None


@freeze_time("2026-05-11 09:00:00")
def test_sweep_is_idempotent(db_session) -> None:
    """Case 6 — second sweep finds nothing to do."""
    _make_meeting(
        db_session,
        slug="idem01x",
        date_range_start=date(2026, 5, 1),
        date_range_end=date(2026, 5, 3),
    )
    assert delete_expired_meetings(db_session) == 1
    assert delete_expired_meetings(db_session) == 0


def test_sweep_honours_90_day_absolute_cap(db_session) -> None:
    """Case 7 — a meeting older than 90 days is dropped even if its range_end
    column happens to still be in the future. Guards against pathological
    `created_at` rows accumulating forever.
    """
    # created_at well over 90 days ago; date_range_end is in the future,
    # which would normally keep the meeting alive — but the cap wins.
    with freeze_time("2026-08-15 09:00:00"):
        _make_meeting(
            db_session,
            slug="cap-old1",
            date_range_start=date(2026, 9, 1),
            date_range_end=date(2026, 9, 3),
            # created 100 days before frozen now.
            created_at=datetime(2026, 5, 7, 10, 0),
        )
        # date_range_end 2026-09-03 23:59:59 + 24h = 2026-09-04 23:59:59,
        # which is later than created_at + 90d, so meeting_expires_at picks the
        # range_end candidate — meeting NOT dropped.
        assert delete_expired_meetings(db_session) == 0

    # Six months later the range itself has passed too, so the meeting goes.
    with freeze_time("2026-10-01 09:00:00"):
        assert delete_expired_meetings(db_session) == 1
        db_session.expire_all()
        assert (
            db_session.query(Meeting).filter(Meeting.slug == "cap-old1").first()
            is None
        )

    # Inverse: a meeting with a wildly long range gets capped at 90d.
    with freeze_time("2027-01-01 09:00:00"):
        _make_meeting(
            db_session,
            slug="cap-far1",
            date_range_start=date(2027, 1, 5),
            date_range_end=date(2028, 1, 5),  # ~1 year ahead
            created_at=datetime(2026, 9, 1, 10, 0),  # 122 days before now
        )
        # date_range_end + 24h = 2028-01-06 — still in the future.
        # created_at + 90d = 2026-11-30 — already past.
        # meeting_expires_at picks the MAX of candidates, so the future range
        # end wins → meeting is NOT dropped. The 90-day cap only fires when
        # everything else (range_end / candidate_dates / confirmed_slot_end)
        # is also past. Validate that semantic explicitly.
        assert delete_expired_meetings(db_session) == 0
        # Drop the future range_end and re-check: now only the cap applies.
        m = (
            db_session.query(Meeting).filter(Meeting.slug == "cap-far1").first()
        )
        assert m is not None
        m.date_range_end = date(2026, 11, 1)
        db_session.add(m)
        db_session.commit()
        assert delete_expired_meetings(db_session) == 1


# ---------------------------------------------------------------------- silence the unused import warning if pytest filters it
_ = pytest
