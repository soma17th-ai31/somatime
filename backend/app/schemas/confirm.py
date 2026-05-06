"""Confirm endpoint schemas (v3).

v3 changes (Q9):
- Request body now MUST include share_message_draft (frontend-supplied,
  copied from /recommend response). Backend stores verbatim — NO LLM call.
"""
from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field, model_validator


class ConfirmRequest(BaseModel):
    slot_start: datetime
    slot_end: datetime
    share_message_draft: str = Field(min_length=1, max_length=4000)

    @model_validator(mode="after")
    def _check(self) -> "ConfirmRequest":
        if self.slot_end <= self.slot_start:
            raise ValueError("slot_end must be > slot_start")
        return self


class ConfirmedSlot(BaseModel):
    start: datetime
    end: datetime


class ConfirmResponse(BaseModel):
    confirmed_slot: ConfirmedSlot
    share_message_draft: str
