"""OpenAI adapter — minimal stub.

Falls back to TemplateAdapter when the optional openai SDK is missing.
"""
from __future__ import annotations

import json
import os
from typing import List

from app.db.models import Meeting
from app.schemas.candidate import Candidate
from app.services.llm.base import LLMAdapter, Slot
from app.services.llm.template import TemplateAdapter


class OpenAIAdapter(LLMAdapter):
    def __init__(self) -> None:
        self._template = TemplateAdapter()
        self._api_key = os.environ.get("OPENAI_API_KEY", "")
        self._client = None
        self._sdk_ready = False
        if self._api_key:
            try:
                from openai import OpenAI

                self._client = OpenAI(api_key=self._api_key)
                self._sdk_ready = True
            except Exception:
                self._sdk_ready = False

    def generate_recommendation_reasons(
        self, candidates: List[Candidate], meeting: Meeting
    ) -> List[str]:
        payload = self.build_recommendation_payload(candidates, meeting)
        if not self._sdk_ready or not candidates:
            return self._template.generate_recommendation_reasons(candidates, meeting)
        try:
            prompt = (
                "Generate one concise Korean recommendation reason per candidate, one per line.\n"
                f"INPUT_JSON:\n{json.dumps(payload, ensure_ascii=False)}"
            )
            resp = self._client.chat.completions.create(  # type: ignore[union-attr]
                model=os.environ.get("LLM_MODEL", "gpt-4o-mini"),
                messages=[{"role": "user", "content": prompt}],
                max_tokens=512,
            )
            text = (resp.choices[0].message.content or "").strip()
        except Exception:
            return self._template.generate_recommendation_reasons(candidates, meeting)
        lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
        if len(lines) < len(candidates):
            return self._template.generate_recommendation_reasons(candidates, meeting)
        return lines[: len(candidates)]

    def generate_share_message(
        self, meeting: Meeting, confirmed_slot: Slot, nicknames: List[str]
    ) -> str:
        payload = self.build_share_payload(meeting, confirmed_slot, nicknames)
        if not self._sdk_ready:
            return self._template.generate_share_message(meeting, confirmed_slot, nicknames)
        try:
            prompt = (
                "Draft a short Korean meeting confirmation message from the JSON below. "
                "Do not invent agenda or location details.\n"
                f"INPUT_JSON:\n{json.dumps(payload, ensure_ascii=False)}"
            )
            resp = self._client.chat.completions.create(  # type: ignore[union-attr]
                model=os.environ.get("LLM_MODEL", "gpt-4o-mini"),
                messages=[{"role": "user", "content": prompt}],
                max_tokens=512,
            )
            text = (resp.choices[0].message.content or "").strip()
        except Exception:
            return self._template.generate_share_message(meeting, confirmed_slot, nicknames)
        return text or self._template.generate_share_message(meeting, confirmed_slot, nicknames)
