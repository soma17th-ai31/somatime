"""Centralized exception handlers.

All API errors must be shaped as:
    {"error_code": str, "message": str, "suggestion": str | None}

The handlers below register against FastAPI for:
- ICSParseError (400)
- HTTPException (status as raised)
- pydantic ValidationError (422)
- generic Exception (500)
"""
from __future__ import annotations

import logging
from typing import Optional

from fastapi import FastAPI, HTTPException, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from app.services.ics_parser import ICSParseError

logger = logging.getLogger("somameet.errors")


def _envelope(error_code: str, message: str, suggestion: Optional[str] = None) -> dict:
    return {
        "error_code": error_code,
        "message": message,
        "suggestion": suggestion,
    }


# Spec §5.2 error code catalog. Used for documentation; routes raise
# HTTPException with detail={error_code: ...}.
KNOWN_ERROR_CODES = {
    "meeting_not_found",
    "participant_required",
    "invalid_pin",
    "pin_not_set",
    "nickname_conflict",
    "insufficient_responses",
    "already_confirmed",
    "ics_parse_failed",
    "validation_error",
    "candidate_not_in_windows",
    "llm_unavailable",
}


async def _ics_parse_handler(request: Request, exc: ICSParseError) -> JSONResponse:
    return JSONResponse(
        status_code=status.HTTP_400_BAD_REQUEST,
        content=_envelope(
            error_code="ics_parse_failed",
            message=str(exc) or "Failed to parse ICS file.",
            suggestion=(
                "유효한 .ics 파일인지 확인하거나 캘린더에서 다시 export 해보세요."
            ),
        ),
    )


def _classify_http_error(exc: HTTPException) -> tuple[str, Optional[str]]:
    """Map an HTTPException's status_code to an error_code + default suggestion."""
    if exc.status_code == status.HTTP_403_FORBIDDEN:
        return "forbidden", None
    if exc.status_code == status.HTTP_404_NOT_FOUND:
        return "not_found", None
    if exc.status_code == status.HTTP_400_BAD_REQUEST:
        return "bad_request", None
    if exc.status_code == status.HTTP_409_CONFLICT:
        return "conflict", None
    if exc.status_code == status.HTTP_422_UNPROCESSABLE_ENTITY:
        return "validation_error", None
    if exc.status_code == status.HTTP_503_SERVICE_UNAVAILABLE:
        return "service_unavailable", None
    return "http_error", None


async def _http_exception_handler(request: Request, exc: HTTPException) -> JSONResponse:
    """Handle HTTPException including ones raised with detail=dict.

    Extra flat fields (e.g., insufficient_responses.current/required) are
    preserved in the response object per spec §5.2.
    """
    detail = exc.detail
    if isinstance(detail, dict) and "error_code" in detail:
        body = _envelope(
            error_code=str(detail.get("error_code", "http_error")),
            message=str(detail.get("message", "")),
            suggestion=detail.get("suggestion"),
        )
        # Forward any extra flat fields the route added (current/required/...).
        for key, value in detail.items():
            if key not in {"error_code", "message", "suggestion"}:
                body[key] = value
        return JSONResponse(status_code=exc.status_code, content=body)

    error_code, suggestion = _classify_http_error(exc)
    message = detail if isinstance(detail, str) else "Request failed."
    return JSONResponse(
        status_code=exc.status_code,
        content=_envelope(error_code=error_code, message=message, suggestion=suggestion),
    )


async def _validation_handler(
    request: Request, exc: RequestValidationError
) -> JSONResponse:
    return JSONResponse(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        content=_envelope(
            error_code="validation_error",
            message="요청 본문 검증에 실패했습니다.",
            suggestion=str(exc.errors()),
        ),
    )


async def _generic_handler(request: Request, exc: Exception) -> JSONResponse:
    logger.exception("Unhandled exception in request: %s", request.url.path)
    return JSONResponse(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        content=_envelope(
            error_code="internal_error",
            message="서버 내부 오류가 발생했습니다.",
            suggestion="잠시 후 다시 시도해주세요.",
        ),
    )


def register_exception_handlers(app: FastAPI) -> None:
    """Register all the custom handlers on the given FastAPI app."""
    app.add_exception_handler(ICSParseError, _ics_parse_handler)
    app.add_exception_handler(HTTPException, _http_exception_handler)
    app.add_exception_handler(RequestValidationError, _validation_handler)
    app.add_exception_handler(Exception, _generic_handler)
