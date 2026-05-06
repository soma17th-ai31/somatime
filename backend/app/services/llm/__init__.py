"""LLM adapter factory (v3).

Provider selection per LLM_PROVIDER env var. Only `upstage` and `template`
are supported in v3; gemini/anthropic/openai branches were removed.

If LLM_PROVIDER=upstage but UPSTAGE_API_KEY is missing, UpstageAdapter
raises RuntimeError. Callers may catch that and fall back to template.
"""
from __future__ import annotations

import os
from typing import Optional

from app.services.llm.base import LLMAdapter, render_template_share_message


def get_llm_adapter(provider: Optional[str] = None) -> LLMAdapter:
    name = (provider or os.environ.get("LLM_PROVIDER", "upstage")).strip().lower()
    if name == "upstage":
        from app.services.llm.upstage import UpstageAdapter

        return UpstageAdapter()
    if name == "template":
        from app.services.llm.template import TemplateAdapter

        return TemplateAdapter()
    raise ValueError(f"Unknown LLM_PROVIDER: {name!r}")


__all__ = ["LLMAdapter", "get_llm_adapter", "render_template_share_message"]
