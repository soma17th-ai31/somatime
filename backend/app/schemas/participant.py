"""Participant register schemas."""
from __future__ import annotations

from datetime import datetime
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field


class ParticipantCreate(BaseModel):
    nickname: str = Field(min_length=1, max_length=50)


class ParticipantResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    nickname: str
    source_type: Optional[str] = None
    confirmed_at: Optional[datetime] = None
