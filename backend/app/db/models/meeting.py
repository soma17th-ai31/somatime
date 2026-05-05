"""Meeting ORM model.

Schema source of truth: 구현_위임_스펙.md section 3.1.
All datetimes are stored as KST naive datetimes (Asia/Seoul fixed).
"""
from __future__ import annotations

from datetime import date, datetime, time
from typing import TYPE_CHECKING, Optional

from sqlalchemy import Boolean, Date, DateTime, Integer, String, Time
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base

if TYPE_CHECKING:
    from app.db.models.participant import Participant


class Meeting(Base):
    __tablename__ = "meetings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    slug: Mapped[str] = mapped_column(String(8), unique=True, nullable=False, index=True)
    organizer_token: Mapped[str] = mapped_column(String(64), nullable=False)

    title: Mapped[str] = mapped_column(String(200), nullable=False)
    date_range_start: Mapped[date] = mapped_column(Date, nullable=False)
    date_range_end: Mapped[date] = mapped_column(Date, nullable=False)
    duration_minutes: Mapped[int] = mapped_column(Integer, nullable=False)
    participant_count: Mapped[int] = mapped_column(Integer, nullable=False)
    location_type: Mapped[str] = mapped_column(String(10), nullable=False)
    time_window_start: Mapped[time] = mapped_column(Time, nullable=False)
    time_window_end: Mapped[time] = mapped_column(Time, nullable=False)
    include_weekends: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    confirmed_slot_start: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    confirmed_slot_end: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)

    participants: Mapped[list["Participant"]] = relationship(
        "Participant",
        back_populates="meeting",
        cascade="all, delete-orphan",
    )

    def __repr__(self) -> str:
        return f"<Meeting id={self.id} slug={self.slug!r} title={self.title!r}>"
