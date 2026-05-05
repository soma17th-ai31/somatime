"""KST helpers (Asia/Seoul fixed)."""
from __future__ import annotations

from datetime import datetime, timezone, tzinfo
from zoneinfo import ZoneInfo

KST: tzinfo = ZoneInfo("Asia/Seoul")


def to_kst(dt: datetime) -> datetime:
    """Return dt converted to KST.

    - aware: convert to KST.
    - naive: assume KST.
    """
    if dt.tzinfo is None:
        return dt.replace(tzinfo=KST)
    return dt.astimezone(KST)


def to_kst_naive(dt: datetime) -> datetime:
    """Return KST-equivalent local time as a naive datetime (tzinfo stripped).

    DB stores naive KST datetimes per spec.
    """
    return to_kst(dt).replace(tzinfo=None)


def from_kst_naive(dt: datetime) -> datetime:
    """Re-attach KST tzinfo to a naive KST datetime read from the DB."""
    if dt.tzinfo is not None:
        return dt.astimezone(KST)
    return dt.replace(tzinfo=KST)


def now_kst_naive() -> datetime:
    return datetime.now(tz=timezone.utc).astimezone(KST).replace(tzinfo=None)
