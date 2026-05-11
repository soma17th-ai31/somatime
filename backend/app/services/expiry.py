"""Meeting auto-expiry helpers (issue #32).

Two concerns live here:

1. ``meeting_expires_at(meeting)`` — the cut-off after which a meeting row is
   considered stale and may be garbage-collected. Pure function of the
   meeting's own fields. Returned as a KST naive ``datetime`` so it can be
   compared directly against ``now_kst_naive()`` and against the
   confirmed_slot columns (also KST naive).

2. ``delete_expired_meetings(db, now=None)`` — single source of truth for the
   actual cleanup. Called from two sites:
   * the lifespan loop in ``app.main`` (background sweep, hourly)
   * the lazy guard in ``GET /api/meetings/{slug}`` (catches the gap between
     container startup and the first sweep, or any single slug being read
     before the next tick)

   Cascade on the ORM relationships drops the matching Participant +
   BusyBlock rows automatically, so this function only operates on
   ``Meeting``.

Privacy note: hard delete on purpose — busy_blocks are personal data and the
v3 spec keeps them out of LLM payloads and other surfaces. Letting them
linger on disk past the meeting's natural end would erode that promise.
"""
from __future__ import annotations

import logging
from datetime import date, datetime, time, timedelta
from typing import Iterable, List, Optional

from sqlalchemy.orm import Session

from app.db.models import Meeting
from app.services.timezones import now_kst_naive

logger = logging.getLogger("somameet.expiry")


GRACE_PERIOD = timedelta(hours=24)
ABSOLUTE_CAP = timedelta(days=90)
_END_OF_DAY = time(23, 59, 59)


def _candidate_dates_max(raw: Optional[Iterable]) -> Optional[date]:
    if not raw:
        return None
    out: List[date] = []
    for value in raw:
        if isinstance(value, date) and not isinstance(value, datetime):
            out.append(value)
        elif isinstance(value, str):
            out.append(date.fromisoformat(value))
    return max(out) if out else None


def meeting_expires_at(meeting: Meeting) -> datetime:
    """Return the KST naive cut-off at/after which ``meeting`` is expired.

    Definition (issue #32, "권장 한 세트"):

    Take the latest of:
      * ``confirmed_slot_end`` (if the meeting is confirmed)
      * end-of-day on ``date_range_end`` (range mode)
      * end-of-day on ``max(candidate_dates)`` (picked mode)
      * ``created_at + 90 days`` (absolute safety cap)

    Then add a 24h grace window. A meeting compares as expired when the
    returned ``datetime <= now``.
    """
    candidates: List[datetime] = []

    if meeting.confirmed_slot_end is not None:
        candidates.append(meeting.confirmed_slot_end)

    mode = (getattr(meeting, "date_mode", None) or "range").lower()
    if mode == "picked":
        picked_max = _candidate_dates_max(meeting.candidate_dates)
        if picked_max is not None:
            candidates.append(datetime.combine(picked_max, _END_OF_DAY))
    else:
        if meeting.date_range_end is not None:
            candidates.append(
                datetime.combine(meeting.date_range_end, _END_OF_DAY)
            )

    # Absolute safety cap so a year-long range still gets garbage-collected.
    candidates.append(meeting.created_at + ABSOLUTE_CAP)

    latest = max(candidates)
    return latest + GRACE_PERIOD


def delete_expired_meetings(
    db: Session, now: Optional[datetime] = None
) -> int:
    """Delete every Meeting whose ``meeting_expires_at <= now``.

    Cascade handles Participant / BusyBlock. Returns the number of rows
    actually deleted. Safe to call repeatedly (idempotent — a second call
    immediately afterwards finds nothing to do).
    """
    cutoff = now if now is not None else now_kst_naive()

    deleted = 0
    for meeting in db.query(Meeting).all():
        if meeting_expires_at(meeting) <= cutoff:
            db.delete(meeting)
            deleted += 1

    if deleted:
        db.commit()
        logger.info(
            "deleted %d expired meetings (cutoff=%s)", deleted, cutoff.isoformat()
        )
    return deleted
