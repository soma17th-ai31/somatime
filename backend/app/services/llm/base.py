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
        required_participants: Sequence[str] = (),
    ) -> dict:
        """One-call recommendation.

        ``required_participants`` carries the meeting's mandatory attendee
        nicknames (issue #38). Adapters surface this list to the model so
        the LLM can both double-gate the deterministic filter and shape its
        reason copy. Order is the caller's responsibility — recommend.py
        sorts the set before passing it through.

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
        required_participants: Sequence[str] = (),
    ) -> dict:
        """Privacy-safe payload. ONLY the fields below may be sent.

        Asserted by the upstage privacy spy + acceptance test S11.

        Issue #38 — ``required_participants`` is included as a top-level
        list so the LLM knows which nicknames must appear in
        ``available_participants`` for a candidate to be valid. The list
        is always present (empty list when nobody is required) so the
        model can rely on the key existing.
        """
        return {
            "meeting": {
                "title": meeting.title,
                "location_type": meeting.location_type,
                "duration_minutes": meeting.duration_minutes,
            },
            "rules": {
                "slot_unit_minutes": 30,
                "max_candidates": max_candidates,
            },
            "required_participants": list(required_participants),
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


_WEEKDAY_KO = ["월", "화", "수", "목", "금", "토", "일"]


def _format_date_label(dt) -> str:
    """``M/D (요일)`` — month/day are not zero-padded, weekday in 한글."""
    return f"{dt.month}/{dt.day} ({_WEEKDAY_KO[dt.weekday()]})"


def render_template_share_message(meeting: Meeting, candidate) -> str:
    """Deterministic share_message_draft used by /recommend's fallback path
    (when all 4 LLM attempts fail) and by the TemplateAdapter.

    Privacy: derives only from meeting.title and the candidate's slot times.

    Format (issue #26 + bracket-title follow-up):
    - 1st line: ``[<title>] 일정 안내드립니다.`` — title wrapped in square
      brackets. Empty/whitespace-only title drops the prefix and brackets
      entirely (``일정 안내드립니다.``).
    - blank line separating header from body.
    - ``날짜:`` line — single date ``M/D (요일)`` when start/end are on the
      same date, or ``M/D (요일) - M/D (요일)`` when the slot crosses midnight.
    - ``시간:`` line — ``HH:MM - HH:MM`` (24h, zero-padded, spaces around the
      hyphen).
    - ``장소:`` line — Korean location label.
    """
    location_label = {
        "online": "온라인",
        "offline": "오프라인",
        "any": "온라인/오프라인 상관없음",
    }.get(meeting.location_type, meeting.location_type)

    start = candidate.start
    end = candidate.end

    if start.date() == end.date():
        date_line = f"날짜: {_format_date_label(start)}"
    else:
        date_line = (
            f"날짜: {_format_date_label(start)} - {_format_date_label(end)}"
        )

    time_line = f"시간: {start.strftime('%H:%M')} - {end.strftime('%H:%M')}"

    title = (meeting.title or "").strip()
    header = f"[{title}] 일정 안내드립니다." if title else "일정 안내드립니다."

    return (
        f"{header}\n"
        f"\n"
        f"{date_line}\n"
        f"{time_line}\n"
        f"장소: {location_label}"
    )
