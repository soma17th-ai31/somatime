"""Participant register / login schemas (v3).

v3 additions:
- pin: optional 4-digit numeric PIN (Q7). Plain text in DB.
- ParticipantLogin: nickname + pin to re-issue cookie when client lost it.
"""
from __future__ import annotations

import re
from datetime import datetime
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator

_PIN_PATTERN = re.compile(r"^\d{4}$")


def _validate_pin(value: Optional[str]) -> Optional[str]:
    if value is None or value == "":
        return None
    if not _PIN_PATTERN.match(value):
        raise ValueError("pin must be exactly 4 digits (0-9)")
    return value


class ParticipantCreate(BaseModel):
    """POST /api/meetings/{slug}/participants body.

    v3.26: `is_required` can be supplied at registration time so a mentor /
    required attendee marks themselves as 필수 in a single step (instead of
    register → edit → toggle). When omitted, defaults to False for the new
    participant; for the pre-submit re-register path the field is updated
    only when explicitly provided (None → leave existing value alone).
    """

    nickname: str = Field(min_length=1, max_length=50)
    pin: Optional[str] = Field(default=None, max_length=8)
    is_required: Optional[bool] = Field(default=None)

    @field_validator("pin", mode="before")
    @classmethod
    def _coerce_pin(cls, v):
        if v is None:
            return None
        if isinstance(v, int):
            v = str(v)
        return v

    @field_validator("pin")
    @classmethod
    def _check_pin(cls, v: Optional[str]) -> Optional[str]:
        return _validate_pin(v)


class ParticipantLogin(BaseModel):
    """POST /api/meetings/{slug}/participants/login body."""

    nickname: str = Field(min_length=1, max_length=50)
    pin: str = Field(min_length=4, max_length=8)

    @field_validator("pin", mode="before")
    @classmethod
    def _coerce_pin(cls, v):
        if isinstance(v, int):
            v = str(v)
        return v

    @field_validator("pin")
    @classmethod
    def _check_pin(cls, v: str) -> str:
        validated = _validate_pin(v)
        if validated is None:
            raise ValueError("pin is required for login")
        return validated


class ParticipantNicknameUpdate(BaseModel):
    """PATCH /api/meetings/{slug}/participants/me body.

    v3.5: nickname required, PIN optional with explicit semantics:
      - pin field absent (or `null`) → leave existing PIN unchanged.
      - pin field set to "" → clear existing PIN.
      - pin field set to "1234" → store new 4-digit PIN.
    v3.11: is_required optional with explicit semantics:
      - field absent → leave is_required unchanged.
      - field true / false → set accordingly.
    The endpoint distinguishes these via `model_dump(exclude_unset=True)`.
    """

    nickname: str = Field(min_length=1, max_length=50)
    pin: Optional[str] = Field(default=None, max_length=8)
    is_required: Optional[bool] = Field(default=None)

    @field_validator("pin", mode="before")
    @classmethod
    def _coerce_pin(cls, v):
        if v is None:
            return None
        if isinstance(v, int):
            v = str(v)
        return v

    @field_validator("pin")
    @classmethod
    def _check_pin(cls, v: Optional[str]) -> Optional[str]:
        if v is None or v == "":
            return v  # preserve "" so endpoint can distinguish clear from no-op
        if not _PIN_PATTERN.match(v):
            raise ValueError("pin must be exactly 4 digits (0-9)")
        return v


class ParticipantResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    nickname: str
    source_type: Optional[str] = None
    confirmed_at: Optional[datetime] = None
