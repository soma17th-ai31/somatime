"""Participant ORM model.

Schema source of truth: 구현_위임_스펙.md v3 section 4.2.

v3 additions (2026-05-06):
- pin: VARCHAR(8) NULLABLE — plain-text PIN for re-entry (Q7).
  WARNING: stored in plaintext per MVP decision. Operations must rotate
  to bcrypt before any production deployment. README must call this out.
"""
from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING, Optional

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base

if TYPE_CHECKING:
    from app.db.models.busy_block import BusyBlock
    from app.db.models.meeting import Meeting


class Participant(Base):
    __tablename__ = "participants"
    __table_args__ = (
        UniqueConstraint("meeting_id", "nickname", name="uq_participant_meeting_nickname"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    meeting_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("meetings.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    nickname: Mapped[str] = mapped_column(String(50), nullable=False)
    token: Mapped[str] = mapped_column(String(64), nullable=False, unique=True, index=True)

    # v3 — plaintext PIN. Q7. NULLABLE.
    pin: Mapped[Optional[str]] = mapped_column(String(8), nullable=True)

    # v3.11 — required attendee flag (e.g. mentor for a special lecture).
    # /recommend promotes windows where all required participants are present.
    is_required: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=False,
        server_default="0",
    )

    source_type: Mapped[Optional[str]] = mapped_column(String(10), nullable=True)
    confirmed_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)

    meeting: Mapped["Meeting"] = relationship("Meeting", back_populates="participants")
    busy_blocks: Mapped[list["BusyBlock"]] = relationship(
        "BusyBlock",
        back_populates="participant",
        cascade="all, delete-orphan",
    )

    def __repr__(self) -> str:
        return f"<Participant id={self.id} meeting_id={self.meeting_id} nickname={self.nickname!r}>"
