"""Gemini adapter (default provider).

Privacy: this adapter only ever sends `build_recommendation_payload` /
`build_share_payload` JSON to the model. It must never touch a busy_block.

If the SDK is unavailable, or if no GEMINI_API_KEY is configured, we fall
back to template output rather than raising.
"""
from __future__ import annotations

import json
import os
from typing import List

from app.db.models import Meeting
from app.schemas.candidate import Candidate
from app.services.llm.base import LLMAdapter, Slot
from app.services.llm.template import TemplateAdapter


class GeminiAdapter(LLMAdapter):
    def __init__(self) -> None:
        self._template = TemplateAdapter()
        self._model_name = os.environ.get("LLM_MODEL", "gemini-2.5-flash")
        self._api_key = os.environ.get("GEMINI_API_KEY", "")
        self._sdk_ready = False
        self._model = None
        if self._api_key:
            try:
                import google.generativeai as genai

                genai.configure(api_key=self._api_key)
                self._model = genai.GenerativeModel(self._model_name)
                self._sdk_ready = True
            except Exception:
                self._sdk_ready = False

    # -------------------------------------------------------------- recommendations

    def generate_recommendation_reasons(
        self, candidates: List[Candidate], meeting: Meeting
    ) -> List[str]:
        payload = self.build_recommendation_payload(candidates, meeting)
        if not self._sdk_ready or not candidates:
            return self._template.generate_recommendation_reasons(candidates, meeting)
        prompt = self._build_recommendation_prompt(payload)
        try:
            response = self._model.generate_content(prompt)  # type: ignore[union-attr]
            text = (response.text or "").strip()
        except Exception:
            return self._template.generate_recommendation_reasons(candidates, meeting)
        reasons = self._parse_reason_lines(text, expected=len(candidates))
        if reasons is None:
            return self._template.generate_recommendation_reasons(candidates, meeting)
        return reasons

    @staticmethod
    def _build_recommendation_prompt(payload: dict) -> str:
        return (
            "다음 회의 후보 슬롯들에 대해 자연스러운 한국어 추천 이유를 한 줄씩 만들어 주세요.\n"
            "응답은 candidates 길이만큼의 줄을 가진 평문이어야 하며 각 줄은 한 후보에 대응합니다.\n"
            "회의 제목/설명/장소를 추측해서 만들지 말고, 주어진 메타데이터만 사용하세요.\n"
            "어떤 일정의 구체 내용도 추정하지 마세요.\n\n"
            f"INPUT_JSON:\n{json.dumps(payload, ensure_ascii=False)}"
        )

    @staticmethod
    def _parse_reason_lines(text: str, expected: int) -> List[str] | None:
        lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
        if len(lines) < expected:
            return None
        return lines[:expected]

    # -------------------------------------------------------------- share message

    def generate_share_message(
        self, meeting: Meeting, confirmed_slot: Slot, nicknames: List[str]
    ) -> str:
        payload = self.build_share_payload(meeting, confirmed_slot, nicknames)
        if not self._sdk_ready:
            return self._template.generate_share_message(meeting, confirmed_slot, nicknames)
        prompt = self._build_share_prompt(payload)
        try:
            response = self._model.generate_content(prompt)  # type: ignore[union-attr]
            text = (response.text or "").strip()
        except Exception:
            return self._template.generate_share_message(meeting, confirmed_slot, nicknames)
        if not text:
            return self._template.generate_share_message(meeting, confirmed_slot, nicknames)
        return text

    @staticmethod
    def _build_share_prompt(payload: dict) -> str:
        return (
            "다음 정보를 기반으로 회의 확정 공유용 한국어 메시지 초안을 만들어 주세요.\n"
            "주어진 필드만 사용하고, 일정의 구체 내용/위치 상세를 추측하지 마세요.\n"
            "1~3문장 이내로 작성하세요.\n\n"
            f"INPUT_JSON:\n{json.dumps(payload, ensure_ascii=False)}"
        )
