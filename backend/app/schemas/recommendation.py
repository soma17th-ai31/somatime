"""Recommendation response schemas (v3 — Q9).

POST /api/meetings/{slug}/recommend returns a single LLM-driven payload
with summary + per-candidate reason + share_message_draft. The backend
re-validates the LLM output against deterministic candidate_windows and
falls back to a deterministic top-3 if the LLM fails 4 times in a row.
"""
from __future__ import annotations

from typing import List, Optional

from pydantic import BaseModel

from app.schemas.candidate import Candidate


class RecommendResponse(BaseModel):
    summary: Optional[str] = None
    candidates: List[Candidate]
    source: str  # "llm" | "deterministic_fallback"
    llm_call_count: int = 0
    suggestion: Optional[str] = None
