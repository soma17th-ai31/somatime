"""Availability inputs (manual + ICS upload + natural-language parse).

POST /api/meetings/{slug}/availability/manual
POST /api/meetings/{slug}/availability/ics
POST /api/meetings/{slug}/availability/ics/parse                (preview only)
POST /api/meetings/{slug}/availability/natural-language/parse   (preview only)

manual + ics persist (last-write-wins per spec §6 / S7). The two `parse`
routes are preview-only — the FE shows the result and the participant
confirms via the manual endpoint (with merge/overwrite chosen on the FE
side).

All endpoints require the participant cookie.
"""
from __future__ import annotations

import json
import logging
import re
from datetime import date, datetime, time, timedelta

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from sqlalchemy.orm import Session

from app.core.dependencies import get_current_meeting, get_db, get_participant
from app.db.models import Meeting, Participant
from app.schemas.manual import ManualAvailabilityInput
from app.schemas.natural_language import NaturalLanguageParseInput
from app.services.availability import replace_busy_blocks_for_participant
from app.services.ics_parser import parse_ics
from app.services.llm import get_llm_adapter
from app.services.timezones import now_kst_naive

logger = logging.getLogger("somameet.availability")

router = APIRouter(prefix="/api", tags=["availability"])


@router.post(
    "/meetings/{slug}/availability/manual",
    status_code=status.HTTP_200_OK,
)
def submit_manual(
    payload: ManualAvailabilityInput,
    participant: Participant = Depends(get_participant),
    db: Session = Depends(get_db),
) -> dict:
    blocks = [(b.start, b.end) for b in payload.busy_blocks]
    new_rows = replace_busy_blocks_for_participant(db, participant.id, blocks)

    participant.source_type = "manual"
    participant.confirmed_at = now_kst_naive()
    db.add(participant)
    db.commit()
    db.refresh(participant)

    return {
        "source_type": "manual",
        "blocks_count": len(new_rows),
    }


@router.post(
    "/meetings/{slug}/availability/ics",
    status_code=status.HTTP_200_OK,
)
def submit_ics(
    file: UploadFile = File(...),
    participant: Participant = Depends(get_participant),
    db: Session = Depends(get_db),
) -> dict:
    content = file.file.read()
    blocks = parse_ics(content)  # raises ICSParseError -> 400 via exception handler

    new_rows = replace_busy_blocks_for_participant(db, participant.id, blocks)

    participant.source_type = "ics"
    participant.confirmed_at = now_kst_naive()
    db.add(participant)
    db.commit()
    db.refresh(participant)

    return {
        "source_type": "ics",
        "blocks_count": len(new_rows),
    }


@router.post(
    "/meetings/{slug}/availability/ics/parse",
    status_code=status.HTTP_200_OK,
)
def parse_ics_preview(
    file: UploadFile = File(...),
    participant: Participant = Depends(get_participant),
) -> dict:
    """v3.24 — parse only, don't save.

    Returns the parsed busy_blocks so the frontend can pre-fill the manual
    grid for review/edit before the user clicks `가용 시간 저장`.
    """
    content = file.file.read()
    blocks = parse_ics(content)
    # Drop the `_` (participant) — endpoint requires the cookie just so we
    # don't expose ICS parsing as an open utility on the slug.
    _ = participant
    return {
        "busy_blocks": [
            {"start": s.isoformat(), "end": e.isoformat()} for s, e in blocks
        ],
    }


@router.post(
    "/meetings/{slug}/availability/natural-language/parse",
    status_code=status.HTTP_200_OK,
)
def parse_natural_language_availability(
    payload: NaturalLanguageParseInput,
    participant: Participant = Depends(get_participant),
    meeting: Meeting = Depends(get_current_meeting),
) -> dict:
    """v3.28 — parse only, don't save.

    Takes free-text Korean availability input (e.g. "월요일 9-12 수업 있음")
    and returns the LLM-parsed busy_blocks. The FE displays the result as a
    preview; the participant chooses merge-with-existing or overwrite via
    the normal manual endpoint.
    """
    # The cookie is required so this isn't an open utility — discard the
    # participant object itself.
    _ = participant

    try:
        adapter = get_llm_adapter()
    except RuntimeError as exc:
        logger.warning("LLM adapter unavailable for NL parse: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={
                "error_code": "llm_unavailable",
                "message": "자연어 파싱 엔진을 호출할 수 없습니다.",
                "suggestion": "수동 입력 또는 ICS 업로드를 사용해주세요.",
            },
        ) from exc

    # Agentic validator + retry: extract weekdays the user actually mentioned,
    # then verify the LLM didn't place busy_blocks on weekdays outside that
    # whitelist. If it did, feed the violations back to the LLM and retry up
    # to NL_PARSE_MAX_RETRIES times. Final fallback: deterministic drop of
    # offending busy_blocks (defense in depth, regardless of retry outcome).
    user_weekdays = _extract_user_weekdays(payload.text)
    feedback: str | None = None
    busy_blocks: list[dict] = []
    summary: str = ""
    recognized_phrases: list[str] = []

    for attempt in range(NL_PARSE_MAX_RETRIES + 1):
        text_for_llm = payload.text if feedback is None else f"{payload.text}\n\n{feedback}"
        try:
            raw = adapter.parse_availability(text_for_llm, meeting)
        except (ValueError, json.JSONDecodeError) as exc:
            logger.exception("NL parse: LLM returned unparseable output: %s", exc)
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail={
                    "error_code": "llm_parse_failed",
                    "message": "자연어 응답을 해석하지 못했습니다.",
                    "suggestion": "조금 더 명확한 표현으로 다시 시도해주세요.",
                },
            ) from exc
        except Exception as exc:
            logger.exception("NL parse: LLM network/SDK error: %s", exc)
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail={
                    "error_code": "llm_unavailable",
                    "message": "자연어 파싱 엔진 호출에 실패했습니다.",
                    "suggestion": "잠시 후 다시 시도해주세요.",
                },
            ) from exc

        busy_blocks, summary, recognized_phrases = _normalize_nl_parse_output(raw, meeting)

        weekday_violations = _find_weekday_violations(busy_blocks, user_weekdays)
        chip_intent = _extract_chip_intent(recognized_phrases)
        text_intent = _extract_text_intent(payload.text)
        # Chip intent wins on conflict — the chips are the LLM's own
        # summary so we treat them as the more "considered" reading. Text
        # intent fills gaps where the chips missed the weekday entirely.
        combined_intent = {**text_intent, **chip_intent}
        intent_violations = _find_intent_violations(busy_blocks, combined_intent, meeting)

        if not weekday_violations and not intent_violations:
            break

        if attempt == NL_PARSE_MAX_RETRIES:
            logger.info(
                "NL parse: retry budget exhausted, weekday=%d intent=%d violations",
                len(weekday_violations),
                len(intent_violations),
            )
            busy_blocks, summary = _apply_intent_repair(
                busy_blocks, summary, combined_intent, meeting
            )
            busy_blocks = [b for b in busy_blocks if b not in weekday_violations]
            break

        feedback_parts: list[str] = []
        if weekday_violations:
            feedback_parts.append(
                _format_weekday_feedback(weekday_violations, user_weekdays)
            )
        if intent_violations:
            feedback_parts.append(_format_intent_feedback(intent_violations, combined_intent))
        feedback = "\n".join(feedback_parts)
        logger.info(
            "NL parse: attempt %d hit weekday=%d intent=%d violations, retrying",
            attempt + 1,
            len(weekday_violations),
            len(intent_violations),
        )

    return {
        "busy_blocks": busy_blocks,
        "summary": summary,
        "recognized_phrases": recognized_phrases,
    }


# Agentic retry budget: 1 first try + N retries with feedback. Conservative
# default keeps the average latency / cost close to one round-trip — most
# inputs pass on the first attempt thanks to the strengthened prompt.
NL_PARSE_MAX_RETRIES = 2


# Phase D — chip phrases are short Korean strings (e.g. "월 9-12시 불가").
# We cap them at 24 chars (≈12 Korean chars) and clip the list to 6 to keep
# the FE preview readable.
_MAX_PHRASE_LEN = 24
_MAX_PHRASES = 6


def _normalize_nl_parse_output(
    raw: dict,
    meeting: Meeting,
) -> tuple[list[dict], str, list[str]]:
    """Defensive parser around the LLM's natural-language output.

    Drops anything malformed silently (the FE shows what we kept; users can
    edit the grid before saving). Returns
    ``(busy_blocks, summary, recognized_phrases)`` where busy_blocks is a list
    of {"start": ISO str, "end": ISO str} (KST-naive, matching
    parse_ics_preview) and recognized_phrases is a list of short Korean
    strings used as preview chips on the FE.
    """
    if not isinstance(raw, dict):
        return [], "응답을 해석하지 못했습니다.", []

    summary_raw = raw.get("summary")
    summary = (
        summary_raw.strip()
        if isinstance(summary_raw, str) and summary_raw.strip()
        else "자연어 입력을 불가능 시간으로 변환했습니다."
    )
    summary = _strip_wrong_weekday_labels(summary)

    recognized_phrases = _normalize_recognized_phrases(raw.get("recognized_phrases"))

    raw_blocks = raw.get("busy_blocks")
    if not isinstance(raw_blocks, list):
        return [], summary, recognized_phrases

    normalized: list[dict] = []
    for block in raw_blocks:
        if not isinstance(block, dict):
            continue
        start_iso = block.get("start")
        end_iso = block.get("end")
        if not isinstance(start_iso, str) or not isinstance(end_iso, str):
            continue
        try:
            start_dt = datetime.fromisoformat(start_iso)
            end_dt = datetime.fromisoformat(end_iso)
        except ValueError:
            logger.info("NL parse: dropping unparseable block %r-%r", start_iso, end_iso)
            continue
        # Strip any tz so we stay in the project's KST-naive convention.
        if start_dt.tzinfo is not None:
            start_dt = start_dt.replace(tzinfo=None)
        if end_dt.tzinfo is not None:
            end_dt = end_dt.replace(tzinfo=None)
        if end_dt <= start_dt:
            continue
        if not _block_intersects_meeting_dates(start_dt, end_dt, meeting):
            continue
        normalized.append(
            {"start": start_dt.isoformat(), "end": end_dt.isoformat()}
        )
    return normalized, summary, recognized_phrases


_WEEKDAY_KO_FULL = ["월", "화", "수", "목", "금", "토", "일"]
_SUMMARY_WEEKDAY_RE = re.compile(
    r"(?P<label>월|화|수|목|금|토|일)요일\s*\(?\s*(?P<date>\d{4}-\d{2}-\d{2})\s*\)?"
)

# Patterns for extracting user-mentioned weekdays from free text. We
# require either '월요일' / '화요일' / ... (unambiguous) or grouped
# tokens like '평일' / '주말' / '매일'. A bare '월' is *not* matched
# because it commonly appears inside "5월", "월말", etc.
_USER_WEEKDAY_FULL_FORMS = {
    0: "월요일",
    1: "화요일",
    2: "수요일",
    3: "목요일",
    4: "금요일",
    5: "토요일",
    6: "일요일",
}
_USER_WEEKDAY_ALL_MARKERS = ("매일", "모든 요일", "전부", "항상", "온종일", "내내")
_USER_WEEKDAY_WEEKDAY_MARKERS = ("평일", "주중")  # 월~금
_USER_WEEKDAY_WEEKEND_MARKERS = ("주말",)  # 토, 일


def _extract_user_weekdays(text: str) -> set[int] | None:
    """Return the set of weekday integers (0=월 ... 6=일) the user
    explicitly mentioned, or ``None`` if the text implies all weekdays
    (either through "매일"-class markers or by not naming any weekday
    at all).

    Used by the validator to gate which weekdays the LLM is allowed to
    place busy_blocks on. Conservative: only obvious '월요일' /
    '평일' / '주말' / '매일' tokens are recognized — short forms like
    bare '월' are skipped so dates like '5월' don't false-positive.
    """
    if not text:
        return None
    if any(marker in text for marker in _USER_WEEKDAY_ALL_MARKERS):
        return None

    weekdays: set[int] = set()
    for marker in _USER_WEEKDAY_WEEKDAY_MARKERS:
        if marker in text:
            weekdays.update({0, 1, 2, 3, 4})
    for marker in _USER_WEEKDAY_WEEKEND_MARKERS:
        if marker in text:
            weekdays.update({5, 6})
    for wd, form in _USER_WEEKDAY_FULL_FORMS.items():
        if form in text:
            weekdays.add(wd)

    return weekdays or None


def _find_weekday_violations(
    busy_blocks: list[dict],
    user_weekdays: set[int] | None,
) -> list[dict]:
    """Return the subset of ``busy_blocks`` whose start date falls on
    a weekday the user never mentioned. Empty list when the user
    implies all weekdays (``user_weekdays is None``).
    """
    if user_weekdays is None:
        return []
    violations: list[dict] = []
    for block in busy_blocks:
        try:
            start_dt = datetime.fromisoformat(block["start"])
        except (KeyError, ValueError):
            continue
        if start_dt.weekday() not in user_weekdays:
            violations.append(block)
    return violations


def _format_weekday_feedback(
    violations: list[dict],
    user_weekdays: set[int] | None,
) -> str:
    """Build a short Korean feedback note for the LLM retry. Lists the
    busy_blocks that landed on weekdays the user never mentioned and
    states what the allowed weekdays are.
    """
    allowed = (
        ", ".join(_WEEKDAY_KO_FULL[w] for w in sorted(user_weekdays))
        if user_weekdays
        else "(없음)"
    )
    examples: list[str] = []
    for block in violations[:3]:
        try:
            start_dt = datetime.fromisoformat(block["start"])
        except (KeyError, ValueError):
            continue
        examples.append(
            f"{start_dt.date().isoformat()} ({_WEEKDAY_KO_FULL[start_dt.weekday()]})"
        )
    examples_str = ", ".join(examples) if examples else "(샘플 없음)"
    return (
        "[자동 검증 피드백] 이전 응답에서 busy_blocks 가 사용자가 명시하지 않은 요일에 들어갔습니다. "
        f"사용자가 언급한 요일: {allowed}. 문제 블록 예: {examples_str}. "
        "다시 응답을 생성하되 사용자가 언급한 요일에만 busy_blocks 를 두세요."
    )


# Intent validator: cross-check the LLM's busy_blocks against the chip
# phrases it generated. Chips are the LLM's own summary of what it
# understood, so a mismatch between chip ("토 전체 가능") and busy_blocks
# (5/16 토 entirely busy) is a self-contradiction we can catch.

_CHIP_AVAILABLE_MARKERS = ("가능", "있음", "비어")
_CHIP_BUSY_MARKERS = ("불가", "안 됨", "안돼", "안되", "없음", "수업", "약속", "회의")
_CHIP_WEEKDAY_TOKENS = {
    0: ("월요일", "월"),
    1: ("화요일", "화"),
    2: ("수요일", "수"),
    3: ("목요일", "목"),
    4: ("금요일", "금"),
    5: ("토요일", "토"),
    6: ("일요일", "일"),
}


def _chip_has_weekday(chip: str, wd: int) -> bool:
    """Match '월' but not inside '5월', '월말', or '수업'. The short form
    is allowed because chips and short user phrasings are consistent,
    but we require strict boundaries on both sides:

    - Left:  must not be a digit (rules out "5월") or another hangul
             syllable (rules out compound words).
    - Right: must not be "요" (would be the full form, handled above)
             and must not be another hangul syllable (rules out
             "수업", "월말", "토양" etc).
    """
    full, short = _CHIP_WEEKDAY_TOKENS[wd]
    if full in chip:
        return True
    pattern = re.compile(rf"(?<![0-9가-힣]){short}(?![요가-힣])")
    return bool(pattern.search(chip))


def _extract_chip_intent(phrases: list[str]) -> dict[int, str]:
    """Return ``{weekday: "available" | "busy"}`` for every chip that
    names a single weekday with an unambiguous intent verb. Chips
    naming multiple weekdays or no clear verb are skipped.
    """
    intent: dict[int, str] = {}
    for chip in phrases:
        is_available = any(m in chip for m in _CHIP_AVAILABLE_MARKERS)
        is_busy = any(m in chip for m in _CHIP_BUSY_MARKERS)
        # Need exactly one direction
        if is_available == is_busy:
            continue
        verb = "available" if is_available else "busy"
        # Special case: "전부 가능", "전체 가능" with no weekday → skip
        weekdays_in_chip = [wd for wd in range(7) if _chip_has_weekday(chip, wd)]
        if len(weekdays_in_chip) != 1:
            continue
        wd = weekdays_in_chip[0]
        # If two chips conflict on the same weekday, drop both
        prior = intent.get(wd)
        if prior is not None and prior != verb:
            intent.pop(wd, None)
            continue
        intent[wd] = verb
    return intent


_TEXT_CLAUSE_SPLIT_RE = re.compile(r"[,.;\n]|(?:고\s)|(?:며\s)|(?:이고\s)|(?:이며\s)")


def _extract_text_intent(text: str) -> dict[int, str]:
    """Pull weekday → intent (available / busy) directly from the user's
    free text. Used as a fallback layer alongside _extract_chip_intent —
    when the LLM's chips skip a weekday or use ambiguous wording, the
    user's original phrasing usually disambiguates.

    Split heuristic: break the text into clauses on conjunctions
    (",", "고", "며", ".", ";", newline). Each clause is expected to
    name a single weekday + a single intent verb. Clauses that pair
    both intents or no clear intent are skipped.
    """
    if not text:
        return {}
    intent: dict[int, str] = {}
    for clause in _TEXT_CLAUSE_SPLIT_RE.split(text):
        clause = clause.strip()
        if not clause:
            continue
        is_available = any(m in clause for m in _CHIP_AVAILABLE_MARKERS)
        is_busy = any(m in clause for m in _CHIP_BUSY_MARKERS) or "불가능" in clause
        # Need exactly one direction in this clause
        if is_available == is_busy:
            continue
        verb = "available" if is_available else "busy"
        for wd in range(7):
            if _chip_has_weekday(clause, wd):
                # First clause to mention this weekday wins
                intent.setdefault(wd, verb)
    return intent


def _block_covers_full_day(start_dt: datetime, end_dt: datetime) -> bool:
    """Heuristic: a busy block that spans most of one day (>= 8 hours)
    is treated as a 'full day' block. Used to detect intent collisions
    where the LLM marked a 'available' weekday as wholly busy.
    """
    if start_dt.date() != end_dt.date() and end_dt - start_dt < timedelta(hours=24):
        # Cross-midnight short block — not a full day
        return False
    duration = end_dt - start_dt
    return duration >= timedelta(hours=8)


def _find_intent_violations(
    busy_blocks: list[dict],
    chip_intent: dict[int, str],
    meeting: Meeting,
) -> list[dict]:
    """Detect blocks that contradict the chip intent.

    Two rules:
    1. A weekday the chips marked 'available' should not carry a
       "full-day" busy block. Smaller busy blocks (e.g. lunch) are
       allowed because they could co-exist with 'available' in the
       user's wording.
    2. A weekday the chips marked 'busy' should appear in busy_blocks
       on at least one of that weekday's dates within the meeting. If
       it's missing entirely we synthesize a violation (using a phantom
       block describing the missing weekday) so the LLM can be told to
       add it on retry.
    """
    from app.services.scheduler import enumerate_search_dates

    violations: list[dict] = []

    # Rule 1 — available weekday must not be wholly busy
    available_wds = {wd for wd, verb in chip_intent.items() if verb == "available"}
    for block in busy_blocks:
        try:
            start_dt = datetime.fromisoformat(block["start"])
            end_dt = datetime.fromisoformat(block["end"])
        except (KeyError, ValueError):
            continue
        if start_dt.weekday() in available_wds and _block_covers_full_day(start_dt, end_dt):
            violations.append(block)

    # Rule 2 — busy weekday must have at least one busy_block somewhere
    busy_wds = {wd for wd, verb in chip_intent.items() if verb == "busy"}
    covered_busy_wds: set[int] = set()
    for block in busy_blocks:
        try:
            start_dt = datetime.fromisoformat(block["start"])
        except (KeyError, ValueError):
            continue
        if start_dt.weekday() in busy_wds:
            covered_busy_wds.add(start_dt.weekday())

    missing_busy_wds = busy_wds - covered_busy_wds
    if missing_busy_wds:
        # Add a sentinel violation so the retry feedback can mention them.
        meeting_dates = list(enumerate_search_dates(meeting))
        for wd in missing_busy_wds:
            target = next((d for d in meeting_dates if d.weekday() == wd), None)
            if target is None:
                continue
            violations.append(
                {
                    "_missing_busy_for_weekday": wd,
                    "_target_date": target.isoformat(),
                }
            )

    return violations


def _format_intent_feedback(
    violations: list[dict],
    chip_intent: dict[int, str],
) -> str:
    """Build a feedback note describing chip-vs-busy-blocks contradictions."""
    full_day_wrong: list[str] = []
    missing_busy: list[str] = []
    for v in violations:
        if "_missing_busy_for_weekday" in v:
            wd = v["_missing_busy_for_weekday"]
            target = v["_target_date"]
            missing_busy.append(f"{_WEEKDAY_KO_FULL[wd]}요일 ({target})")
        else:
            try:
                start_dt = datetime.fromisoformat(v["start"])
            except (KeyError, ValueError):
                continue
            full_day_wrong.append(
                f"{start_dt.date().isoformat()} ({_WEEKDAY_KO_FULL[start_dt.weekday()]})"
            )

    parts: list[str] = ["[자동 검증 피드백 — 의도 불일치]"]
    if full_day_wrong:
        avail_wds = ", ".join(
            _WEEKDAY_KO_FULL[wd] for wd, verb in chip_intent.items() if verb == "available"
        )
        parts.append(
            f"chip 에는 '{avail_wds}요일 가능' 으로 기록했지만 busy_blocks 가 "
            f"해당 요일 전체에 들어갔습니다 (예: {', '.join(full_day_wrong)}). "
            "가능한 요일은 busy_blocks 에서 제거하세요."
        )
    if missing_busy:
        busy_wds_str = ", ".join(
            _WEEKDAY_KO_FULL[wd] for wd, verb in chip_intent.items() if verb == "busy"
        )
        parts.append(
            f"chip 에는 '{busy_wds_str}요일 불가' 로 기록했지만 busy_blocks 에 "
            f"해당 요일이 누락되었습니다 (대상: {', '.join(missing_busy)}). "
            "해당 요일 전체 (06:00~24:00) 를 busy_blocks 에 추가하세요."
        )
    return " ".join(parts)


def _apply_intent_repair(
    busy_blocks: list[dict],
    summary: str,
    chip_intent: dict[int, str],
    meeting: Meeting,
) -> tuple[list[dict], str]:
    """Last-resort deterministic repair when retries are exhausted.

    - Drop any full-day busy block on an 'available' weekday.
    - Add a full-day busy block (06:00~24:00) for any 'busy' weekday
      that's missing one. Uses the first meeting.date matching that
      weekday.
    """
    from app.services.scheduler import enumerate_search_dates

    available_wds = {wd for wd, verb in chip_intent.items() if verb == "available"}
    busy_wds = {wd for wd, verb in chip_intent.items() if verb == "busy"}

    # Rule 1 — drop full-day busy blocks on available weekdays
    repaired: list[dict] = []
    for block in busy_blocks:
        try:
            start_dt = datetime.fromisoformat(block["start"])
            end_dt = datetime.fromisoformat(block["end"])
        except (KeyError, ValueError):
            repaired.append(block)
            continue
        if start_dt.weekday() in available_wds and _block_covers_full_day(start_dt, end_dt):
            continue  # drop
        repaired.append(block)

    # Rule 2 — synthesize a missing busy block for each unmet busy weekday
    covered_busy_wds: set[int] = set()
    for block in repaired:
        try:
            start_dt = datetime.fromisoformat(block["start"])
        except (KeyError, ValueError):
            continue
        if start_dt.weekday() in busy_wds:
            covered_busy_wds.add(start_dt.weekday())

    missing_busy_wds = busy_wds - covered_busy_wds
    if missing_busy_wds:
        meeting_dates = list(enumerate_search_dates(meeting))
        added_dates: list[str] = []
        for wd in missing_busy_wds:
            target = next((d for d in meeting_dates if d.weekday() == wd), None)
            if target is None:
                continue
            repaired.append(
                {
                    "start": datetime.combine(target, time(6, 0)).isoformat(),
                    "end": datetime.combine(
                        target + timedelta(days=1), time(0, 0)
                    ).isoformat(),
                }
            )
            added_dates.append(target.isoformat())
        if added_dates:
            summary = (
                f"{summary} (자동 보정: {', '.join(added_dates)} 전체를 불가능으로 추가했습니다.)"
            )
    return repaired, summary


def _strip_wrong_weekday_labels(summary: str) -> str:
    """Drop weekday labels in the summary that disagree with the date
    they're attached to.

    The LLM occasionally hallucinates the weekday for an attached date
    (e.g. '월요일(2026-05-16)' when 2026-05-16 is actually a Saturday).
    The date itself is unambiguous, so we keep it and drop just the
    label: '월요일(2026-05-16) 전체를…' → '2026-05-16 전체를…'. If the
    label matches the date, leave the text alone.
    """

    def _check(match: "re.Match[str]") -> str:
        label = match.group("label")
        iso = match.group("date")
        try:
            d = date.fromisoformat(iso)
        except ValueError:
            return match.group(0)
        expected = _WEEKDAY_KO_FULL[d.weekday()]
        if label == expected:
            return match.group(0)
        return iso

    return _SUMMARY_WEEKDAY_RE.sub(_check, summary)


def _normalize_recognized_phrases(raw_phrases) -> list[str]:
    """Filter the LLM's recognized_phrases to a clean string list.

    - Missing / non-list -> [].
    - Non-string items, empty strings, blank-only strings -> dropped.
    - Each kept phrase is stripped and truncated to _MAX_PHRASE_LEN chars.
    - Whole list is capped at _MAX_PHRASES entries.
    """
    if not isinstance(raw_phrases, list):
        return []

    cleaned: list[str] = []
    for item in raw_phrases:
        if not isinstance(item, str):
            continue
        phrase = item.strip()
        if not phrase:
            continue
        if len(phrase) > _MAX_PHRASE_LEN:
            phrase = phrase[:_MAX_PHRASE_LEN]
        cleaned.append(phrase)
        if len(cleaned) >= _MAX_PHRASES:
            break
    return cleaned


def _block_intersects_meeting_dates(
    start: datetime, end: datetime, meeting: Meeting
) -> bool:
    """Return True iff the (start, end) block touches any meeting search date."""
    from app.services.scheduler import enumerate_search_dates

    dates = set(enumerate_search_dates(meeting))
    if not dates:
        return False
    # Walk every date the block spans (usually 1).
    current = start.date()
    end_date = end.date()
    while current <= end_date:
        if current in dates:
            return True
        # Move to next day.
        from datetime import timedelta

        current = current + timedelta(days=1)
    return False
