"""Manual availability input.

Decision: input shape is BUSY blocks (not free blocks). Rationale:
- Aligns with ICS / Google free-busy semantics (we record what is occupied).
- Trivially enables last-write-wins by replacing all rows for the participant.

Each block is {start, end} in KST ISO 8601. The scheduler floors/ceils to 30-min boundaries.
"""
from __future__ import annotations

from datetime import datetime
from typing import List

from pydantic import BaseModel, Field, model_validator


class ManualBlock(BaseModel):
    start: datetime
    end: datetime

    @model_validator(mode="after")
    def _check(self) -> "ManualBlock":
        if self.end <= self.start:
            raise ValueError("end must be > start")
        return self


class ManualAvailabilityInput(BaseModel):
    """List of BUSY (occupied) blocks for the participant."""

    busy_blocks: List[ManualBlock] = Field(default_factory=list)
