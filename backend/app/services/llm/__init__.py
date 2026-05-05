"""LLM adapter factory.

Provider is selected from environment LLM_PROVIDER. The factory imports the
concrete adapter lazily so that missing optional SDKs (e.g. anthropic, openai)
do not break the default 'gemini' or 'template' paths.
"""
from __future__ import annotations

import os
from typing import Optional

from app.services.llm.base import LLMAdapter


def get_llm_adapter(provider: Optional[str] = None) -> LLMAdapter:
    name = (provider or os.environ.get("LLM_PROVIDER", "template")).strip().lower()
    if name == "gemini":
        from app.services.llm.gemini import GeminiAdapter

        return GeminiAdapter()
    if name == "anthropic":
        from app.services.llm.anthropic import AnthropicAdapter

        return AnthropicAdapter()
    if name == "openai":
        from app.services.llm.openai import OpenAIAdapter

        return OpenAIAdapter()
    if name == "template":
        from app.services.llm.template import TemplateAdapter

        return TemplateAdapter()
    raise ValueError(f"Unknown LLM_PROVIDER: {name!r}")


__all__ = ["LLMAdapter", "get_llm_adapter"]
