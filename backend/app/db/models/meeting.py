"""Meeting ORM model.

Schema source of truth: 구현_위임_스펙.md v3 section 4.1 +
구현_위임_스펙_추가.md §12.

All datetimes are stored as KST naive datetimes (Asia/Seoul fixed).

v3 additions (2026-05-06):
- date_mode: "range" | "picked"
- candidate_dates: JSON list of ISO date strings (picked mode only)
- offline_buffer_minutes: 30 / 60 / 90 / 120
- confirmed_share_message: TEXT, the share_message_draft sent at /confirm
- date_range_start / date_range_end: now NULLABLE (only required for range mode)

v3.1 (2026-05-06 simplify pass):
- participant_count column removed; readiness is now derived from
  submitted_count >= 1.

v3.2 (2026-05-06 organizer gate removed, Path B):
- organizer_token column removed. Anyone with the share URL can run
  calculate / recommend / confirm. The 2-step ShareMessageDialog gate is the
  sole accident-prevention safeguard.
"""
from __future__ import annotations

from datetime import date, datetime
from typing import TYPE_CHECKING, Any, Optional

from sqlalchemy import JSON, Boolean, Date, DateTime, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base

if TYPE_CHECKING:
    from app.db.models.participant import Participant


class Meeting(Base):
    __tablename__ = "meetings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    slug: Mapped[str] = mapped_column(String(8), unique=True, nullable=False, index=True)

    title: Mapped[str] = mapped_column(
        String(200), nullable=False, server_default="", default=""
    )

    # v3 — date_mode + nullable range + picked dates list (Q5).
    date_mode: Mapped[str] = mapped_column(
        String(8), nullable=False, server_default="range", default="range"
    )
    date_range_start: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    date_range_end: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    candidate_dates: Mapped[Optional[Any]] = mapped_column(JSON, nullable=True)

    duration_minutes: Mapped[int] = mapped_column(Integer, nullable=False)
    location_type: Mapped[str] = mapped_column(String(10), nullable=False)

    # Issue #13 follow-up — meeting-level offline_buffer_minutes was dropped.
    # Buffer is now strictly per-participant (Participant.buffer_minutes), with
    # a hard-coded default in app.services.scheduler.DEFAULT_BUFFER_MINUTES.

    # Issue #57 — time_window_start / time_window_end columns dropped.
    # All meetings now share a fixed 06:00-24:00 search window defined by
    # MEETING_WINDOW_START / MEETING_WINDOW_END in app.services.scheduler.

    include_weekends: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    confirmed_slot_start: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    confirmed_slot_end: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)

    # v3 — confirmed share message stored verbatim from POST /confirm body (Q9).
    confirmed_share_message: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)

    participants: Mapped[list["Participant"]] = relationship(
        "Participant",
        back_populates="meeting",
        cascade="all, delete-orphan",
    )

    def __repr__(self) -> str:
        return f"<Meeting id={self.id} slug={self.slug!r} title={self.title!r}>"
