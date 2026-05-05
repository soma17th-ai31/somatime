"""Participant ORM model.

Schema source of truth: 구현_위임_스펙.md section 3.2.
"""
from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING, Optional

from sqlalchemy import DateTime, ForeignKey, Integer, String, UniqueConstraint
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
