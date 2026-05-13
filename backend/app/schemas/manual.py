"""Manual availability input.

Decision: input shape is BUSY blocks (not free blocks). Rationale:
- Aligns with ICS / Google free-busy semantics (we record what is occupied).
- Trivially enables last-write-wins by replacing all rows for the participant.

Each block is {start, end} in KST ISO 8601. The scheduler floors/ceils to 30-min boundaries.
"""
from __future__ import annotations

import re
from datetime import date, datetime, timedelta
from typing import List

from pydantic import BaseModel, Field, field_validator, model_validator


_END_OF_DAY_RE = re.compile(
    r"^(\d{4}-\d{2}-\d{2})T24:00(?::00(?:\.0+)?)?(Z|[+-]\d{2}:\d{2})?$"
)


def _normalize_end_of_day(value: object) -> object:
    if not isinstance(value, str):
        return value
    match = _END_OF_DAY_RE.match(value)
    if not match:
        return value
    next_day = date.fromisoformat(match.group(1)) + timedelta(days=1)
    offset = match.group(2) or ""
    return f"{next_day.isoformat()}T00:00:00{offset}"


class ManualBlock(BaseModel):
    start: datetime
    end: datetime

    @field_validator("start", "end", mode="before")
    @classmethod
    def _normalize_24_hour_boundary(cls, value: object) -> object:
        return _normalize_end_of_day(value)

    @model_validator(mode="after")
    def _check(self) -> "ManualBlock":
        if self.end <= self.start:
            raise ValueError("end must be > start")
        return self


class ManualAvailabilityInput(BaseModel):
    """List of BUSY (occupied) blocks for the participant."""

    busy_blocks: List[ManualBlock] = Field(default_factory=list)
