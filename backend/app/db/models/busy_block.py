"""BusyBlock ORM model.

Schema source of truth: 구현_위임_스펙.md section 3.3.
Privacy invariant: this table has NO title/description/location columns.
Only time ranges are stored.
"""
from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import DateTime, ForeignKey, Index, Integer
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base

if TYPE_CHECKING:
    from app.db.models.participant import Participant


class BusyBlock(Base):
    __tablename__ = "busy_blocks"
    __table_args__ = (
        Index("ix_busy_blocks_participant_start", "participant_id", "start_at"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    participant_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("participants.id", ondelete="CASCADE"),
        nullable=False,
    )
    start_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    end_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)

    participant: Mapped["Participant"] = relationship("Participant", back_populates="busy_blocks")

    def __repr__(self) -> str:
        return f"<BusyBlock id={self.id} pid={self.participant_id} {self.start_at}-{self.end_at}>"
