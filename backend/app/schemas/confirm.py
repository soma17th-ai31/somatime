"""Confirm endpoint schemas."""
from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, model_validator


class ConfirmRequest(BaseModel):
    slot_start: datetime
    slot_end: datetime

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
