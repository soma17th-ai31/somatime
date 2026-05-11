"""Upstage solar-pro3 adapter via OpenAI-compatible SDK (v3 — Q9).

Reads UPSTAGE_API_KEY / UPSTAGE_BASE_URL / UPSTAGE_MODEL / UPSTAGE_TIMEOUT_SECONDS
from env. Privacy: only meeting metadata + candidate_windows are sent
(see LLMAdapter.build_recommendation_payload).

If UPSTAGE_API_KEY is missing, the constructor raises RuntimeError. Callers
should fall back to TemplateAdapter via the factory.
"""
from __future__ import annotations

import json
import os
from typing import Sequence, TYPE_CHECKING

from app.db.models import Meeting
from app.services.llm.base import LLMAdapter
from app.services.llm.prompts import (
    SYSTEM_PROMPT_RECOMMEND,
    build_recommendation_user_prompt,
)

if TYPE_CHECKING:
    from app.services.scheduler import CandidateWindow


class UpstageAdapter(LLMAdapter):
    def __init__(self):
        api_key = os.environ.get("UPSTAGE_API_KEY", "").strip()
        if not api_key:
            raise RuntimeError(
                "UPSTAGE_API_KEY not set; set LLM_PROVIDER=template to bypass "
                "the LLM, or provide a real key."
            )
        try:
            from openai import OpenAI  # type: ignore
        except ImportError as exc:  # pragma: no cover
            raise RuntimeError(
                "openai package is required for UpstageAdapter; pip install openai>=1.57"
            ) from exc

        self._client = OpenAI(
            api_key=api_key,
            base_url=os.environ.get("UPSTAGE_BASE_URL", "https://api.upstage.ai/v1"),
            timeout=float(os.environ.get("UPSTAGE_TIMEOUT_SECONDS", "45")),
        )
        self._model = os.environ.get("UPSTAGE_MODEL", "solar-pro3")

    def recommend(
        self,
        candidate_windows: "Sequence[CandidateWindow]",
        meeting: Meeting,
        max_candidates: int = 3,
        required_participants: Sequence[str] = (),
    ) -> dict:
        payload = self.build_recommendation_payload(
            candidate_windows, meeting, max_candidates, required_participants
        )
        user_prompt = build_recommendation_user_prompt(payload)

        response = self._client.chat.completions.create(
            model=self._model,
            temperature=0.2,
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT_RECOMMEND},
                {"role": "user", "content": user_prompt},
            ],
        )
        content = response.choices[0].message.content or "{}"
        return json.loads(content)
