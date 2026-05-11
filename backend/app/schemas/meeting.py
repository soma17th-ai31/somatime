"""Meeting create/detail schemas (v3).

v3 additions:
- date_mode: "range" | "picked" (Q5)
- candidate_dates: list of ISO date strings, picked mode only (Q5)
- offline_buffer_minutes: 30 / 60 / 90 / 120 (Q8)
- submitted_count / is_ready_to_calculate (Q2)
- share_url + confirmed_share_message in detail response (Q9)

v3.1 (2026-05-06 simplify pass):
- participant_count / target_count fields removed from product surface.
- is_ready_to_calculate now flips to True as soon as submitted_count >= 1.

v3.2 (2026-05-06 organizer gate removed, Path B):
- MeetingCreateResponse.organizer_token / organizer_url removed. Only
  slug + share_url remain. See 구현_위임_스펙_추가.md §12.
"""
from __future__ import annotations

from datetime import date, datetime, time
from enum import Enum
from typing import List, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


class LocationType(str, Enum):
    online = "online"
    offline = "offline"
    any = "any"


class DateMode(str, Enum):
    range = "range"
    picked = "picked"


_ALLOWED_BUFFER_MINUTES = {0, 30, 60, 90, 120}


class MeetingCreate(BaseModel):
    """Body of POST /api/meetings (v3)."""

    title: str = Field(default="", max_length=200)
    date_mode: DateMode = DateMode.range
    date_range_start: Optional[date] = None
    date_range_end: Optional[date] = None
    candidate_dates: Optional[List[date]] = None
    duration_minutes: int = Field(ge=30, le=24 * 60)
    location_type: LocationType
    offline_buffer_minutes: int = 30
    time_window_start: time = Field(default=time(9, 0))
    time_window_end: time = Field(default=time(22, 0))
    include_weekends: bool = False

    @field_validator("duration_minutes")
    @classmethod
    def _duration_must_be_30_multiple(cls, v: int) -> int:
        if v % 30 != 0:
            raise ValueError("duration_minutes must be a multiple of 30")
        return v

    @field_validator("offline_buffer_minutes")
    @classmethod
    def _buffer_choice(cls, v: int) -> int:
        if v not in _ALLOWED_BUFFER_MINUTES:
            raise ValueError(
                "offline_buffer_minutes must be one of 0/30/60/90/120"
            )
        return v

    @model_validator(mode="after")
    def _check_consistency(self) -> "MeetingCreate":
        if self.time_window_end <= self.time_window_start:
            raise ValueError("time_window_end must be > time_window_start")

        if self.date_mode == DateMode.range:
            if self.date_range_start is None or self.date_range_end is None:
                raise ValueError(
                    "range mode requires date_range_start and date_range_end"
                )
            if self.date_range_end < self.date_range_start:
                raise ValueError("date_range_end must be >= date_range_start")
            if self.candidate_dates is not None:
                raise ValueError(
                    "candidate_dates must be null in range mode"
                )
        else:  # picked
            if not self.candidate_dates:
                raise ValueError(
                    "picked mode requires candidate_dates (length >= 1)"
                )
            if self.date_range_start is not None or self.date_range_end is not None:
                raise ValueError(
                    "date_range_start/end must be null in picked mode"
                )
        return self


class MeetingCreateResponse(BaseModel):
    slug: str
    share_url: str


class MeetingSettingsUpdate(BaseModel):
    """Body of PATCH /api/meetings/{slug}/settings (v3.19).

    Replaces the editable scheduling fields wholesale (PUT-like semantics).
    Title is intentionally not editable here. Confirmed meetings are locked.
    """

    date_mode: DateMode
    date_range_start: Optional[date] = None
    date_range_end: Optional[date] = None
    candidate_dates: Optional[List[date]] = None
    duration_minutes: int = Field(ge=30, le=24 * 60)
    location_type: LocationType
    offline_buffer_minutes: int
    time_window_start: time
    time_window_end: time
    include_weekends: bool

    @field_validator("duration_minutes")
    @classmethod
    def _duration_must_be_30_multiple(cls, v: int) -> int:
        if v % 30 != 0:
            raise ValueError("duration_minutes must be a multiple of 30")
        return v

    @field_validator("offline_buffer_minutes")
    @classmethod
    def _buffer_choice(cls, v: int) -> int:
        if v not in _ALLOWED_BUFFER_MINUTES:
            raise ValueError(
                "offline_buffer_minutes must be one of 0/30/60/90/120"
            )
        return v

    @model_validator(mode="after")
    def _check_consistency(self) -> "MeetingSettingsUpdate":
        if self.time_window_end <= self.time_window_start:
            raise ValueError("time_window_end must be > time_window_start")

        if self.date_mode == DateMode.range:
            if self.date_range_start is None or self.date_range_end is None:
                raise ValueError(
                    "range mode requires date_range_start and date_range_end"
                )
            if self.date_range_end < self.date_range_start:
                raise ValueError("date_range_end must be >= date_range_start")
            if self.candidate_dates is not None:
                raise ValueError(
                    "candidate_dates must be null in range mode"
                )
        else:
            if not self.candidate_dates:
                raise ValueError(
                    "picked mode requires candidate_dates (length >= 1)"
                )
            if self.date_range_start is not None or self.date_range_end is not None:
                raise ValueError(
                    "date_range_start/end must be null in picked mode"
                )
        return self


class ConfirmedSlotInfo(BaseModel):
    start: datetime
    end: datetime


class MeetingDetail(BaseModel):
    """Body of GET /api/meetings/{slug}.

    Anyone with the slug can read this. v3.2: there is no organizer_token
    anymore — share-URL holders have full access (calculate / recommend /
    confirm).
    """

    model_config = ConfigDict(from_attributes=True)

    slug: str
    title: str
    date_mode: DateMode
    date_range_start: Optional[date] = None
    date_range_end: Optional[date] = None
    candidate_dates: Optional[List[date]] = None
    duration_minutes: int
    submitted_count: int
    submitted_nicknames: List[str] = Field(default_factory=list)
    # v3.11 — nicknames of participants who self-marked as required attendees.
    # Subset of all participants (regardless of submission status).
    required_nicknames: List[str] = Field(default_factory=list)
    is_ready_to_calculate: bool
    location_type: LocationType
    offline_buffer_minutes: int
    time_window_start: time
    time_window_end: time
    include_weekends: bool
    share_url: str
    # Issue #32 — KST timestamp at/after which the room is auto-deleted.
    # Computed server-side from the meeting's own date fields + grace period;
    # FE can surface it as a "X일 후 자동 삭제" hint.
    expires_at: datetime
    confirmed_slot: Optional[ConfirmedSlotInfo] = None
    confirmed_share_message: Optional[str] = None
    # v3.6: present (and possibly empty []) when caller has a participant cookie;
    # null otherwise. Allows the manual form to pre-fill the prior submission.
    my_busy_blocks: Optional[List[ConfirmedSlotInfo]] = None
    # Issue #13 — calling participant's personal buffer override.
    # None when caller has no cookie OR the participant left it as
    # "inherit the meeting's offline_buffer_minutes".
    my_buffer_minutes: Optional[int] = None
    created_at: datetime
