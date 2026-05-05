"""Abstract base for LLM adapters.

Privacy contract for ALL adapters: the only inputs that may be passed to the
LLM are slot times, participant counts, and meeting metadata (title is OK
since it's the organizer's own input). NEVER pass busy_block titles,
descriptions, locations, or attendee identities.
"""
from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass
from datetime import datetime
from typing import List

from app.db.models import Meeting
from app.schemas.candidate import Candidate


@dataclass(frozen=True)
class Slot:
    start: datetime
    end: datetime


class LLMAdapter(ABC):
    @abstractmethod
    def generate_recommendation_reasons(
        self,
        candidates: List[Candidate],
        meeting: Meeting,
    ) -> List[str]:
        """Return one reason string per candidate, in the same order."""

    @abstractmethod
    def generate_share_message(
        self,
        meeting: Meeting,
        confirmed_slot: Slot,
        nicknames: List[str],
    ) -> str:
        """Return a shareable announcement draft."""

    # ------------------------------------------------------------------ shared

    def build_recommendation_payload(
        self, candidates: List[Candidate], meeting: Meeting
    ) -> dict:
        """Build a privacy-safe dict for prompt construction.

        ONLY the fields below may ever be sent to a provider:
        title (organizer-supplied), location_type, duration_minutes, and
        per-candidate (start_iso, end_iso, available_count, missing).
        """
        return {
            "title": meeting.title,
            "location_type": meeting.location_type,
            "duration_minutes": meeting.duration_minutes,
            "candidates": [
                {
                    "start_iso": c.start.isoformat(),
                    "end_iso": c.end.isoformat(),
                    "available_count": c.available_count,
                    "missing": list(c.missing_participants),
                }
                for c in candidates
            ],
        }

    def build_share_payload(
        self, meeting: Meeting, slot: Slot, nicknames: List[str]
    ) -> dict:
        return {
            "title": meeting.title,
            "location_type": meeting.location_type,
            "start_iso": slot.start.isoformat(),
            "end_iso": slot.end.isoformat(),
            "nicknames": list(nicknames),
        }
