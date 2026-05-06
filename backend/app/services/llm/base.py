"""Abstract base for LLM adapters (v3 — Q9 single-call recommend()).

Privacy contract:
- ONLY meeting metadata + deterministic candidate_windows go into the LLM.
- NEVER include busy_block titles / descriptions / locations.
- NEVER include attendee identities beyond nicknames.

The single recommend() method per adapter returns
    {"summary": str, "candidates": [{start, end, reason, share_message_draft}]}
- reason and share_message_draft are written by the LLM in the same call.
- /calculate does NOT call the LLM (deterministic only).
- /confirm does NOT call the LLM (frontend supplies share_message_draft).
"""
from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass
from datetime import datetime
from typing import List, Sequence, TYPE_CHECKING

from app.db.models import Meeting

if TYPE_CHECKING:
    from app.services.scheduler import CandidateWindow


@dataclass(frozen=True)
class Slot:
    start: datetime
    end: datetime


class LLMAdapter(ABC):
    @abstractmethod
    def recommend(
        self,
        candidate_windows: "Sequence[CandidateWindow]",
        meeting: Meeting,
        max_candidates: int = 3,
    ) -> dict:
        """One-call recommendation.

        Returns:
            {
              "summary": str,
              "candidates": [
                {
                  "start": ISO datetime str,
                  "end": ISO datetime str,
                  "reason": str,
                  "share_message_draft": str
                }, ...
              ]
            }
        """

    # ------------------------------------------------------------------ shared

    def build_recommendation_payload(
        self,
        candidate_windows: "Sequence[CandidateWindow]",
        meeting: Meeting,
        max_candidates: int = 3,
    ) -> dict:
        """Privacy-safe payload. ONLY the fields below may be sent.

        Asserted by the upstage privacy spy + acceptance test S11.
        """
        return {
            "meeting": {
                "title": meeting.title,
                "location_type": meeting.location_type,
                "duration_minutes": meeting.duration_minutes,
                "offline_buffer_minutes": int(
                    getattr(meeting, "offline_buffer_minutes", 30) or 30
                ),
            },
            "rules": {
                "slot_unit_minutes": 30,
                "max_candidates": max_candidates,
            },
            "candidate_windows": [
                {
                    "start": w.start.isoformat(),
                    "end": w.end.isoformat(),
                    "available_count": w.available_count,
                    "is_full_match": w.is_full_match,
                    "available_participants": list(w.available_nicknames),
                    "unavailable_participants": list(w.missing_participants),
                }
                for w in candidate_windows
            ],
        }


def render_template_share_message(meeting: Meeting, candidate) -> str:
    """Deterministic share_message_draft used by /recommend's fallback path
    (when all 4 LLM attempts fail) and by the TemplateAdapter.

    Privacy: derives only from meeting.title and the candidate's slot times.
    """
    location_label = {
        "online": "온라인",
        "offline": "오프라인",
        "any": "온라인/오프라인 상관없음",
    }.get(meeting.location_type, meeting.location_type)
    start = candidate.start
    end = candidate.end
    date_part = start.strftime("%Y-%m-%d")
    time_range = f"{start.strftime('%H:%M')}-{end.strftime('%H:%M')}"
    return (
        f"'{meeting.title}' 일정 안내드립니다.\n"
        f"일시: {date_part} {time_range}\n"
        f"장소: {location_label}"
    )
