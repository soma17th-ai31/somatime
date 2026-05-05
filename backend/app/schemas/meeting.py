"""Meeting create/detail schemas."""
from __future__ import annotations

from datetime import date, datetime, time
from enum import Enum
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


class LocationType(str, Enum):
    online = "online"
    offline = "offline"
    any = "any"


class MeetingCreate(BaseModel):
    """Body of POST /api/meetings."""

    title: str = Field(min_length=1, max_length=200)
    date_range_start: date
    date_range_end: date
    duration_minutes: int = Field(ge=30, le=24 * 60)
    participant_count: int = Field(ge=1, le=100)
    location_type: LocationType
    time_window_start: time = Field(default=time(9, 0))
    time_window_end: time = Field(default=time(22, 0))
    include_weekends: bool = False

    @field_validator("duration_minutes")
    @classmethod
    def _duration_must_be_30_multiple(cls, v: int) -> int:
        if v % 30 != 0:
            raise ValueError("duration_minutes must be a multiple of 30")
        return v

    @model_validator(mode="after")
    def _check_ranges(self) -> "MeetingCreate":
        if self.date_range_end < self.date_range_start:
            raise ValueError("date_range_end must be >= date_range_start")
        if self.time_window_end <= self.time_window_start:
            raise ValueError("time_window_end must be > time_window_start")
        return self


class MeetingCreateResponse(BaseModel):
    slug: str
    organizer_token: str
    organizer_url: str
    share_url: str


class MeetingDetail(BaseModel):
    """Body of GET /api/meetings/{slug}.

    Note: organizer_token is intentionally NOT exposed here; URL-only access.
    """

    model_config = ConfigDict(from_attributes=True)

    slug: str
    title: str
    date_range_start: date
    date_range_end: date
    duration_minutes: int
    participant_count: int
    location_type: LocationType
    time_window_start: time
    time_window_end: time
    include_weekends: bool
    confirmed_slot_start: Optional[datetime] = None
    confirmed_slot_end: Optional[datetime] = None
    created_at: datetime
