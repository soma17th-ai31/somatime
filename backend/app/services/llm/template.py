"""Deterministic template adapter — used when no LLM key is available.

Produces stable, privacy-safe strings derived only from meeting metadata
and slot times. Useful as a default and for deterministic test runs.
"""
from __future__ import annotations

from typing import List

from app.db.models import Meeting
from app.schemas.candidate import Candidate
from app.services.llm.base import LLMAdapter, Slot


WEEKDAY_KO = ["월", "화", "수", "목", "금", "토", "일"]


class TemplateAdapter(LLMAdapter):
    def generate_recommendation_reasons(
        self, candidates: List[Candidate], meeting: Meeting
    ) -> List[str]:
        # build_recommendation_payload is intentionally invoked even though we
        # don't ship it anywhere — it asserts that no banned fields exist.
        _ = self.build_recommendation_payload(candidates, meeting)
        out: List[str] = []
        for c in candidates:
            weekday = WEEKDAY_KO[c.start.weekday()]
            base = (
                f"참여자 {c.available_count}명 가능, "
                f"{weekday}요일 {c.start.strftime('%H:%M')}, "
                f"길이 {meeting.duration_minutes}분"
            )
            if c.missing_participants:
                missing = ", ".join(c.missing_participants)
                base += f" (제외: {missing})"
            out.append(base)
        return out

    def generate_share_message(
        self, meeting: Meeting, confirmed_slot: Slot, nicknames: List[str]
    ) -> str:
        _ = self.build_share_payload(meeting, confirmed_slot, nicknames)
        date_part = confirmed_slot.start.strftime("%Y-%m-%d %H:%M")
        end_part = confirmed_slot.end.strftime("%H:%M")
        people = ", ".join(nicknames) if nicknames else "참여자"
        return (
            f"'{meeting.title}' 일정 확정 안내드립니다.\n"
            f"일시: {date_part} - {end_part}\n"
            f"참여자: {people}"
        )
