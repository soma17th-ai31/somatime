"""Candidate slot and calculate / recommend response schemas (v3).

v3 changes:
- Candidate.reason now Optional[str] — null on /calculate (deterministic).
- Candidate.share_message_draft Optional[str] — populated only by /recommend.
- CalculateResponse adds source / summary fields per spec §5.1.
"""
from __future__ import annotations

from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel, Field


class Candidate(BaseModel):
    start: datetime
    end: datetime
    available_count: int
    missing_participants: List[str] = Field(default_factory=list)
    reason: Optional[str] = None
    note: Optional[str] = None
    share_message_draft: Optional[str] = None


class CalculateResponse(BaseModel):
    """POST /api/meetings/{slug}/calculate response (deterministic)."""

    summary: Optional[str] = None
    candidates: List[Candidate]
    source: str = "deterministic"
    best_available_count: Optional[int] = None
    total_participants: Optional[int] = None
    suggestion: Optional[str] = None
