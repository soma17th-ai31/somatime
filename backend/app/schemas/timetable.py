"""Timetable schemas (S10)."""
from __future__ import annotations

from datetime import datetime
from typing import List

from pydantic import BaseModel, Field


class TimetableSlot(BaseModel):
    start: datetime
    end: datetime
    available_count: int
    available_nicknames: List[str] = Field(default_factory=list)


class TimetableResponse(BaseModel):
    slots: List[TimetableSlot]
