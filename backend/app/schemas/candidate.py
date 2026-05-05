"""Candidate slot and calculate response schemas."""
from __future__ import annotations

from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel, Field


class Candidate(BaseModel):
    start: datetime
    end: datetime
    available_count: int
    missing_participants: List[str] = Field(default_factory=list)
    reason: str = ""
    note: Optional[str] = None


class CalculateResponse(BaseModel):
    candidates: List[Candidate]
    suggestion: Optional[str] = None
