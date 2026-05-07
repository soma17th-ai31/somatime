"""Recommendation endpoint (v3 — Q9 single-call LLM).

POST /api/meetings/{slug}/recommend
- Gated by the calculate gate (submitted_count >= 1, v3.1 simplify pass).
- Calls LLMAdapter.recommend() once. On validation failure, retries
  up to 3 more times (total cap = 4).
- Network/SDK errors -> immediate fallback (no retry, llm_call_count=0).
- Falls back to deterministic_top_candidates with a template share_message
  if all 4 LLM attempts fail.
"""
from __future__ import annotations

import json
import logging

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.dependencies import count_submitted, get_current_meeting, get_db
from app.db.models import Meeting
from app.schemas.candidate import Candidate
from app.schemas.recommendation import RecommendResponse
from app.services.llm import get_llm_adapter, render_template_share_message
from app.services.scheduler import (
    CandidateValidationError,
    deterministic_top_candidates,
    generate_candidate_windows,
)
from app.services.timezones import from_kst_naive

from app.api.meetings import _enforce_responses_gate, _load_participants_with_busy

logger = logging.getLogger("somameet.recommend")

router = APIRouter(prefix="/api", tags=["recommend"])

MAX_LLM_ATTEMPTS = 4  # Q9 cap (1 initial + 3 retries)


@router.post(
    "/meetings/{slug}/recommend",
    response_model=RecommendResponse,
)
def recommend(
    meeting: Meeting = Depends(get_current_meeting),
    db: Session = Depends(get_db),
) -> RecommendResponse:
    submitted = count_submitted(db, meeting.id)
    _enforce_responses_gate(submitted)

    participants, busy_by_pid = _load_participants_with_busy(db, meeting.id)
    windows = generate_candidate_windows(
        meeting,
        busy_by_pid,
        participants=participants,
    )

    if not windows:
        return RecommendResponse(
            summary=None,
            candidates=[],
            source="deterministic_fallback",
            llm_call_count=0,
            suggestion=(
                "회의 길이를 줄이거나 날짜 범위를 넓혀보세요."
            ),
        )

    # v3.9 / v3.11 / v3.12 — windows priority for the LLM:
    #   1. Full match (everyone available)            → full_match_windows
    #   2. Else: required-match (all required attendees in)
    #            → required_match_windows, then narrowed to best available_count
    #              so the LLM cannot drop other attendees gratuitously.
    #   3. Else: all windows narrowed to best available_count (spec §7).
    #
    # Within each tier, we also restrict the LLM input to the windows tied for
    # the highest available_count. This mirrors deterministic_top_candidates
    # and prevents the model from picking, e.g., a "mentor only" window when a
    # "mentor + 2 students" window also exists.
    full_match_windows = [w for w in windows if w.is_full_match]
    required_nicks = {p.nickname for p in participants if getattr(p, "is_required", False)}
    if required_nicks:
        required_match_windows = [
            w for w in windows if required_nicks.issubset(set(w.available_nicknames))
        ]
    else:
        required_match_windows = []

    def _narrow_to_best(pool):
        if not pool:
            return pool
        best = max(w.available_count for w in pool)
        return [w for w in pool if w.available_count == best]

    if full_match_windows:
        windows_for_llm = full_match_windows  # already homogeneous available_count
    elif required_match_windows:
        windows_for_llm = _narrow_to_best(required_match_windows)
    else:
        windows_for_llm = _narrow_to_best(windows)

    try:
        adapter = get_llm_adapter()
    except RuntimeError as exc:
        logger.warning("LLM adapter unavailable, using fallback: %s", exc)
        return _build_fallback_response(meeting, windows, llm_call_count=0)
    except ValueError as exc:
        logger.error("invalid LLM_PROVIDER configured: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={
                "error_code": "llm_unavailable",
                "message": "추천 엔진을 호출할 수 없습니다.",
                "suggestion": "LLM_PROVIDER=template로 전환하세요.",
            },
        ) from exc

    last_error: str = ""
    network_error_attempts = 0

    for attempt in range(1, MAX_LLM_ATTEMPTS + 1):
        try:
            llm_output = adapter.recommend(windows_for_llm, meeting, max_candidates=3)
        except (CandidateValidationError, ValueError, json.JSONDecodeError) as exc:
            # validation/parse fault — eligible for retry
            last_error = str(exc)
            logger.info("LLM recommend attempt %d validation failure: %s", attempt, exc)
            continue
        except Exception as exc:
            # network/SDK failure — bail out immediately, no retry, count=0
            logger.warning("LLM recommend network/SDK error: %s", exc)
            network_error_attempts = 0
            return _build_fallback_response(
                meeting, windows, llm_call_count=network_error_attempts
            )

        if not isinstance(llm_output, dict):
            last_error = f"LLM returned non-dict: {type(llm_output)!r}"
            continue

        try:
            validated = _validate_llm_output(llm_output, windows_for_llm, meeting)
        except CandidateValidationError as exc:
            last_error = str(exc)
            logger.info("LLM recommend attempt %d validation failure: %s", attempt, exc)
            continue

        return RecommendResponse(
            summary=_extract_summary(llm_output),
            candidates=validated,
            source="llm",
            llm_call_count=attempt,
            suggestion=None,
        )

    logger.warning(
        "LLM recommend exhausted %d attempts, falling back: %s",
        MAX_LLM_ATTEMPTS,
        last_error,
    )
    return _build_fallback_response(
        meeting, windows, llm_call_count=MAX_LLM_ATTEMPTS
    )


# ============================================================================
# Helpers
# ============================================================================


def _validate_llm_output(
    llm_output: dict,
    windows,
    meeting: Meeting,
) -> list:
    """Validate + enrich LLM candidates against windows.

    Wraps scheduler.validate_and_enrich and serializes datetimes to KST-aware
    so the response includes +09:00 offsets. v3.27 — also enforces the
    spec §7 "후보 간 2시간+ 간격" rule on the LLM path so the model can't
    return adjacent or overlapping candidate windows (e.g. 11:00 + 11:30).
    """
    from app.services.scheduler import SPREAD_MIN_MINUTES, validate_and_enrich

    raw_candidates = llm_output.get("candidates")
    if not isinstance(raw_candidates, list):
        raise CandidateValidationError("LLM output missing 'candidates' list")

    enriched = validate_and_enrich(raw_candidates, windows, meeting)

    # Enforce 2h+ spread between candidate start times.
    for i in range(len(enriched)):
        for j in range(i + 1, len(enriched)):
            gap = abs(int((enriched[j].start - enriched[i].start).total_seconds() // 60))
            if gap < SPREAD_MIN_MINUTES:
                raise CandidateValidationError(
                    f"candidates {i} and {j} are only {gap}min apart "
                    f"(must be ≥ {SPREAD_MIN_MINUTES}min spread)"
                )

    return [
        c.model_copy(
            update={
                "start": from_kst_naive(c.start),
                "end": from_kst_naive(c.end),
            }
        )
        for c in enriched
    ]


def _extract_summary(llm_output: dict) -> str:
    """Pull out summary string, defending against missing/non-string values."""
    summary = llm_output.get("summary")
    if isinstance(summary, str) and summary.strip():
        return summary.strip()
    return "입력된 일정을 기준으로 가능한 후보를 추천했습니다."


def _build_fallback_response(
    meeting: Meeting,
    windows,
    llm_call_count: int,
) -> RecommendResponse:
    """Deterministic fallback: top 3 candidates with template share_message."""
    fallback = deterministic_top_candidates(windows, max_candidates=3)
    enriched: list[Candidate] = []
    for c in fallback:
        share = render_template_share_message(meeting, c)
        weekday = ["월", "화", "수", "목", "금", "토", "일"][c.start.weekday()]
        reason = (
            f"참여자 {c.available_count}명 가능, "
            f"{weekday}요일 {c.start.strftime('%H:%M')}"
        )
        enriched.append(
            c.model_copy(
                update={
                    "start": from_kst_naive(c.start),
                    "end": from_kst_naive(c.end),
                    "reason": reason,
                    "share_message_draft": share,
                }
            )
        )

    summary_text = (
        "LLM 추천 검증을 4회 시도해도 통과하지 못해 결정적 알고리즘으로 후보를 선정했습니다."
        if llm_call_count >= MAX_LLM_ATTEMPTS
        else "추천 엔진을 호출하지 못해 결정적 알고리즘으로 후보를 선정했습니다."
    )
    return RecommendResponse(
        summary=summary_text,
        candidates=enriched,
        source="deterministic_fallback",
        llm_call_count=llm_call_count,
        suggestion=None,
    )
