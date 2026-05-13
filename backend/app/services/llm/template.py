"""Deterministic template adapter (v3).

Used when LLM_PROVIDER=template OR when UPSTAGE_API_KEY is missing.
Produces stable, privacy-safe strings derived only from meeting metadata
and slot times. NO network call, NO randomness.
"""
from __future__ import annotations

from typing import Sequence, TYPE_CHECKING

from app.db.models import Meeting
from app.services.llm.base import LLMAdapter, render_template_share_message

if TYPE_CHECKING:
    from app.services.scheduler import CandidateWindow


WEEKDAY_KO = ["월", "화", "수", "목", "금", "토", "일"]


class TemplateAdapter(LLMAdapter):
    def recommend(
        self,
        candidate_windows: "Sequence[CandidateWindow]",
        meeting: Meeting,
        max_candidates: int = 3,
        required_participants: Sequence[str] = (),
    ) -> dict:
        # Build the payload to assert privacy invariants even on the no-op
        # path. Threading required_participants keeps the privacy spy +
        # payload-keys assertions accurate (issue #38).
        _ = self.build_recommendation_payload(
            candidate_windows, meeting, max_candidates, required_participants
        )

        chosen = list(candidate_windows[:max_candidates])
        return {
            "summary": "입력된 일정을 기준으로 가능한 후보를 추천했습니다.",
            "candidates": [
                {
                    "start": w.start.isoformat(),
                    "end": w.end.isoformat(),
                    "reason": (
                        f"참여자 {w.available_count}명 가능, "
                        f"{WEEKDAY_KO[w.start.weekday()]}요일 "
                        f"{w.start.strftime('%H:%M')}"
                    ),
                    "share_message_draft": render_template_share_message(meeting, w),
                }
                for w in chosen
            ],
        }

    def parse_availability(self, text: str, meeting: Meeting) -> dict:
        """Template fallback: natural-language parsing requires an LLM, so
        in template mode we return an empty busy_blocks list and a summary
        telling the user to switch input methods.

        Building the privacy-safe payload here keeps any future spy/test
        able to assert what *would* have been sent.
        """
        _ = self.build_availability_parse_payload(text, meeting)
        return {
            "busy_blocks": [],
            "summary": (
                "템플릿 모드에서는 자연어 파싱을 지원하지 않습니다. "
                "수동 입력 또는 ICS 업로드를 사용해주세요."
            ),
        }
