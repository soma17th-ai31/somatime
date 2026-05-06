from __future__ import annotations

import json
import os
from pathlib import Path

from dotenv import load_dotenv
from openai import OpenAI, OpenAIError

from app.prompts import SYSTEM_PROMPT, build_user_prompt
from app.scheduling_validator import (
    availability_for_window,
    build_best_candidate_fallback,
    CandidateValidationError,
    build_timetable,
    compute_best_available_count,
    generate_candidate_windows,
    validate_and_enrich_candidates,
)


class MissingLLMKey(RuntimeError):
    pass


class LLMRecommendationError(RuntimeError):
    pass


def _load_client() -> OpenAI:
    env_path = Path(__file__).resolve().parents[1] / ".env"
    load_dotenv(env_path)
    api_key = os.getenv("UPSTAGE_API_KEY")
    if not api_key:
        raise MissingLLMKey("backend/.env 파일에 UPSTAGE_API_KEY를 설정해주세요.")
    base_url = os.getenv("UPSTAGE_BASE_URL", "https://api.upstage.ai/v1")
    timeout = float(os.getenv("UPSTAGE_TIMEOUT_SECONDS", "45"))
    return OpenAI(api_key=api_key, base_url=base_url, timeout=timeout)


def _serialize_participants(participants: list[dict]) -> list[dict]:
    serialized = []
    for participant in participants:
        busy_blocks = []
        free_blocks = []
        for block in participant.get("blocks", []):
            item = {"start": block["start"], "end": block["end"]}
            if block["block_type"] == "free":
                free_blocks.append(item)
            else:
                busy_blocks.append(item)
        serialized.append(
            {
                "nickname": participant["nickname"],
                "busy_blocks": busy_blocks,
                "free_blocks": free_blocks,
            }
        )
    return serialized


def _build_payload(meeting: dict, participants: list[dict]) -> dict:
    best_available_count = compute_best_available_count(meeting, participants)
    candidate_windows = []
    if best_available_count > 0:
        for start, end in generate_candidate_windows(meeting):
            availability = availability_for_window(participants, start, end, meeting["location_type"])
            if availability["available_count"] != best_available_count:
                continue
            candidate_windows.append(
                {
                    "start": start.isoformat(),
                    "end": end.isoformat(),
                    "available_count": availability["available_count"],
                    "is_full_match": availability["is_full_match"],
                    "available_participants": availability["available_participants"],
                    "unavailable_participants": availability["unavailable_participants"],
                }
            )
            if len(candidate_windows) == 40:
                break

    return {
        "meeting": {
            "title": meeting["title"],
            "start_date": meeting["start_date"],
            "end_date": meeting["end_date"],
            "daily_start_time": meeting["daily_start_time"],
            "daily_end_time": meeting["daily_end_time"],
            "duration_minutes": meeting["duration_minutes"],
            "target_participants": meeting["target_participants"],
            "location_type": meeting["location_type"],
        },
        "participants": _serialize_participants(participants),
        "rules": {
            "slot_unit_minutes": 30,
            "offline_buffer_minutes": 30,
            "max_candidates": 3,
            "best_available_count": best_available_count,
        },
        "candidate_windows": candidate_windows,
    }


def _request_json(client: OpenAI, payload: dict, previous_error: str | None = None) -> dict:
    model = os.getenv("UPSTAGE_MODEL", "solar-pro3")
    response = client.chat.completions.create(
        model=model,
        temperature=0.2,
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": build_user_prompt(payload, previous_error)},
        ],
    )
    content = response.choices[0].message.content or "{}"
    return json.loads(content)


def recommend_with_llm(meeting: dict, participants: list[dict]) -> dict:
    client = _load_client()
    payload = _build_payload(meeting, participants)
    best_available_count = payload["rules"]["best_available_count"]
    timetable = build_timetable(meeting, participants)

    previous_error = None
    for _ in range(2):
        try:
            llm_output = _request_json(client, payload, previous_error)
            raw_candidates = llm_output.get("candidates", [])
            candidates = validate_and_enrich_candidates(raw_candidates, meeting, participants)
            return {
                "summary": str(llm_output.get("summary") or "입력된 busy/free 정보를 기준으로 후보를 추천했습니다."),
                "best_available_count": best_available_count,
                "total_participants": len(participants),
                "candidates": candidates,
                "timetable": timetable,
            }
        except (json.JSONDecodeError, CandidateValidationError, KeyError, TypeError) as exc:
            previous_error = str(exc)
        except OpenAIError as exc:
            previous_error = f"{type(exc).__name__}: {exc}"
            break

    if best_available_count == 0:
        return {
            "summary": "입력된 범위 안에서 참석 가능한 인원이 있는 후보를 찾지 못했습니다. 날짜 범위를 넓히거나 회의 길이를 줄여보세요.",
            "best_available_count": 0,
            "total_participants": len(participants),
            "candidates": [],
            "timetable": timetable,
        }

    fallback_candidates = build_best_candidate_fallback(meeting, participants)
    if fallback_candidates:
        return {
            "summary": "LLM 추천 후보가 검증을 통과하지 못해, 입력된 busy/free 정보를 기준으로 백엔드가 검증 가능한 최적 후보를 추천했습니다.",
            "best_available_count": best_available_count,
            "total_participants": len(participants),
            "candidates": fallback_candidates,
            "timetable": timetable,
        }

    raise LLMRecommendationError(f"LLM 추천 결과 검증에 실패했습니다: {previous_error}")
