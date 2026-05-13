"""Natural-language availability parse input.

Used by POST /api/meetings/{slug}/availability/natural-language/parse.

Parse-only endpoint: the FE displays the resulting busy_blocks as a preview
and the participant chooses to merge/overwrite via the existing manual
availability endpoint. We never persist from this route.
"""
from __future__ import annotations

from pydantic import BaseModel, Field, field_validator


MAX_TEXT_LENGTH = 2000


class NaturalLanguageParseInput(BaseModel):
    text: str = Field(..., description="참여자가 입력한 자연어 가용/불가능 시간 텍스트")

    @field_validator("text")
    @classmethod
    def _check_text(cls, value: str) -> str:
        stripped = value.strip()
        if not stripped:
            raise ValueError("text must not be empty")
        if len(value) > MAX_TEXT_LENGTH:
            raise ValueError(
                f"text exceeds maximum length of {MAX_TEXT_LENGTH} characters"
            )
        return value
