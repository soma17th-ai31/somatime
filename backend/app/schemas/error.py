"""Standard error response shape."""
from __future__ import annotations

from typing import Optional

from pydantic import BaseModel


class ErrorResponse(BaseModel):
    error_code: str
    message: str
    suggestion: Optional[str] = None
