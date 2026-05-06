from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from uuid import uuid4
from zoneinfo import ZoneInfo

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware

from app.database import get_connection, init_db, row_to_dict
from app.ics_parser import parse_ics_busy_blocks
from app.llm_recommender import LLMRecommendationError, MissingLLMKey, recommend_with_llm
from app.schemas import (
    CandidateSelection,
    IcsParseResponse,
    ManualSubmission,
    MeetingCreate,
    MeetingResponse,
    MessageDraftResponse,
    ResultsResponse,
)


app = FastAPI(title="SomaMeet API", version="0.1.0")
init_db()

allowed_origins = [
    origin.strip()
    for origin in os.getenv("ALLOWED_ORIGINS", "*").split(",")
    if origin.strip()
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def on_startup() -> None:
    init_db()


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _validate_meeting_create(payload: MeetingCreate) -> None:
    if payload.start_date > payload.end_date:
        raise HTTPException(status_code=400, detail="후보 시작 날짜는 종료 날짜보다 늦을 수 없습니다.")
    if payload.daily_start_time >= payload.daily_end_time:
        raise HTTPException(status_code=400, detail="하루 탐색 시작 시간은 종료 시간보다 빨라야 합니다.")


def _load_meeting(connection, meeting_id: str) -> dict:
    meeting = row_to_dict(connection.execute("SELECT * FROM meetings WHERE id = ?", (meeting_id,)).fetchone())
    if meeting is None:
        raise HTTPException(status_code=404, detail="회의를 찾을 수 없습니다.")
    if meeting.get("selected_candidate"):
        meeting["selected_candidate"] = json.loads(meeting["selected_candidate"])
    return meeting


def _meeting_response(connection, meeting_id: str) -> MeetingResponse:
    meeting = _load_meeting(connection, meeting_id)
    rows = connection.execute(
        """
        SELECT p.id, p.nickname, p.source_type, p.created_at, COUNT(b.id) AS block_count
        FROM participants p
        LEFT JOIN availability_blocks b ON b.participant_id = p.id
        WHERE p.meeting_id = ?
        GROUP BY p.id
        ORDER BY p.created_at ASC
        """,
        (meeting_id,),
    ).fetchall()
    participants = [
        {
            "id": row["id"],
            "nickname": row["nickname"],
            "source_type": row["source_type"],
            "block_count": row["block_count"],
            "submitted_at": row["created_at"],
        }
        for row in rows
    ]
    submitted = len(participants)
    return MeetingResponse(
        id=meeting["id"],
        title=meeting["title"],
        start_date=meeting["start_date"],
        end_date=meeting["end_date"],
        daily_start_time=meeting["daily_start_time"],
        daily_end_time=meeting["daily_end_time"],
        duration_minutes=meeting["duration_minutes"],
        target_participants=meeting["target_participants"],
        location_type=meeting["location_type"],
        submitted_participants=submitted,
        is_ready_for_results=submitted >= meeting["target_participants"],
        participants=participants,
        selected_candidate=meeting.get("selected_candidate"),
    )


def _upsert_participant(connection, meeting_id: str, nickname: str, source_type: str) -> str:
    participant_id = str(uuid4())
    created_at = _now()
    connection.execute(
        """
        INSERT INTO participants (id, meeting_id, nickname, source_type, confirmed, created_at)
        VALUES (?, ?, ?, ?, 1, ?)
        ON CONFLICT(meeting_id, nickname)
        DO UPDATE SET source_type = excluded.source_type, confirmed = 1, created_at = excluded.created_at
        """,
        (participant_id, meeting_id, nickname.strip(), source_type, created_at),
    )
    row = connection.execute(
        "SELECT id FROM participants WHERE meeting_id = ? AND nickname = ?",
        (meeting_id, nickname.strip()),
    ).fetchone()
    return row["id"]


def _replace_blocks(connection, meeting_id: str, participant_id: str, blocks: list[dict], block_type: str, source_type: str) -> None:
    connection.execute("DELETE FROM availability_blocks WHERE participant_id = ?", (participant_id,))
    created_at = _now()
    for block in blocks:
        start = block["start"]
        end = block["end"]
        if isinstance(start, datetime):
            start = start.isoformat()
        if isinstance(end, datetime):
            end = end.isoformat()
        if datetime.fromisoformat(str(end).replace("Z", "+00:00")) <= datetime.fromisoformat(str(start).replace("Z", "+00:00")):
            raise HTTPException(status_code=400, detail="일정 블록의 종료 시간은 시작 시간보다 늦어야 합니다.")
        connection.execute(
            """
            INSERT INTO availability_blocks (id, meeting_id, participant_id, block_type, start, end, source_type, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (str(uuid4()), meeting_id, participant_id, block_type, str(start), str(end), source_type, created_at),
        )


def _load_participants_with_blocks(connection, meeting_id: str) -> list[dict]:
    participants = [dict(row) for row in connection.execute("SELECT * FROM participants WHERE meeting_id = ? ORDER BY created_at", (meeting_id,)).fetchall()]
    for participant in participants:
        rows = connection.execute(
            "SELECT block_type, start, end, source_type FROM availability_blocks WHERE participant_id = ? ORDER BY start",
            (participant["id"],),
        ).fetchall()
        participant["blocks"] = [dict(row) for row in rows]
    return participants


async def _parse_uploaded_ics(file: UploadFile) -> list[dict[str, str]]:
    if not (file.filename or "").lower().endswith(".ics"):
        raise HTTPException(status_code=400, detail=".ics 파일만 업로드할 수 있습니다.")
    content = await file.read()
    try:
        return parse_ics_busy_blocks(content)
    except Exception as exc:
        raise HTTPException(status_code=400, detail="ICS 파일을 파싱하지 못했습니다.") from exc


@app.get("/health")
def health() -> dict:
    return {"ok": True}


@app.post("/meetings", response_model=MeetingResponse)
def create_meeting(payload: MeetingCreate) -> MeetingResponse:
    _validate_meeting_create(payload)
    meeting_id = str(uuid4())
    with get_connection() as connection:
        connection.execute(
            """
            INSERT INTO meetings (
                id, title, start_date, end_date, daily_start_time, daily_end_time,
                duration_minutes, target_participants, location_type, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                meeting_id,
                payload.title.strip(),
                payload.start_date.isoformat(),
                payload.end_date.isoformat(),
                payload.daily_start_time.isoformat(timespec="minutes"),
                payload.daily_end_time.isoformat(timespec="minutes"),
                payload.duration_minutes,
                payload.target_participants,
                payload.location_type,
                _now(),
            ),
        )
        connection.commit()
        return _meeting_response(connection, meeting_id)


@app.get("/meetings/{meeting_id}", response_model=MeetingResponse)
def get_meeting(meeting_id: str) -> MeetingResponse:
    with get_connection() as connection:
        return _meeting_response(connection, meeting_id)


@app.post("/meetings/{meeting_id}/submissions/manual", response_model=MeetingResponse)
def submit_manual(meeting_id: str, payload: ManualSubmission) -> MeetingResponse:
    with get_connection() as connection:
        _load_meeting(connection, meeting_id)
        participant_id = _upsert_participant(connection, meeting_id, payload.nickname, "manual")
        _replace_blocks(
            connection,
            meeting_id,
            participant_id,
            [block.model_dump() for block in payload.blocks],
            payload.block_type,
            "manual",
        )
        connection.commit()
        return _meeting_response(connection, meeting_id)


@app.post("/meetings/{meeting_id}/submissions/ics", response_model=MeetingResponse)
async def submit_ics(meeting_id: str, nickname: str = Form(...), file: UploadFile = File(...)) -> MeetingResponse:
    blocks = await _parse_uploaded_ics(file)
    if not blocks:
        raise HTTPException(status_code=400, detail="ICS 파일에서 유효한 일정 시간을 찾지 못했습니다.")

    with get_connection() as connection:
        _load_meeting(connection, meeting_id)
        participant_id = _upsert_participant(connection, meeting_id, nickname, "ics")
        _replace_blocks(connection, meeting_id, participant_id, blocks, "busy", "ics")
        connection.commit()
        return _meeting_response(connection, meeting_id)


@app.post("/meetings/{meeting_id}/parse-ics", response_model=IcsParseResponse)
async def parse_ics(meeting_id: str, file: UploadFile = File(...)) -> IcsParseResponse:
    with get_connection() as connection:
        _load_meeting(connection, meeting_id)
    return IcsParseResponse(busy_blocks=await _parse_uploaded_ics(file))


@app.get("/meetings/{meeting_id}/results", response_model=ResultsResponse)
def get_results(meeting_id: str) -> ResultsResponse:
    with get_connection() as connection:
        meeting = _load_meeting(connection, meeting_id)
        response = _meeting_response(connection, meeting_id)
        if not response.is_ready_for_results:
            raise HTTPException(status_code=400, detail="목표 참여 인원이 모두 입력을 완료해야 결과를 생성할 수 있습니다.")
        participants = _load_participants_with_blocks(connection, meeting_id)

    try:
        result = recommend_with_llm(meeting, participants)
    except MissingLLMKey as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    except LLMRecommendationError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    return ResultsResponse(meeting_id=meeting_id, **result)


@app.post("/meetings/{meeting_id}/select", response_model=MessageDraftResponse)
def select_candidate(meeting_id: str, payload: CandidateSelection) -> MessageDraftResponse:
    selected = {
        "start": payload.start.isoformat(),
        "end": payload.end.isoformat(),
        "reason": payload.reason,
    }
    with get_connection() as connection:
        meeting = _load_meeting(connection, meeting_id)
        connection.execute(
            "UPDATE meetings SET selected_candidate = ? WHERE id = ?",
            (json.dumps(selected, ensure_ascii=False), meeting_id),
        )
        connection.commit()

    location_label = {"online": "온라인", "offline": "오프라인", "either": "상관없음"}.get(meeting["location_type"], meeting["location_type"])
    start = payload.start.astimezone(ZoneInfo("Asia/Seoul"))
    end = payload.end.astimezone(ZoneInfo("Asia/Seoul"))
    weekdays = ["월", "화", "수", "목", "금", "토", "일"]
    date_text = f"{start.year}년 {start.month}월 {start.day}일({weekdays[start.weekday()]})"
    time_text = f"{start.strftime('%H:%M')}-{end.strftime('%H:%M')}"
    reason_text = payload.reason.strip() or "참석 가능한 시간이 가장 잘 맞는 후보입니다."
    message = (
        f"안녕하세요.\n"
        f"{meeting['title']} 일정이 아래와 같이 확정되었습니다.\n\n"
        f"일시: {date_text} {time_text}\n"
        f"방식: {location_label}\n"
        f"선정 이유: {reason_text}\n\n"
        f"개인 일정의 제목이나 세부 내용은 공유하지 않고, 제출된 가능 시간만 기준으로 조율했습니다.\n"
        f"시간 확인 부탁드립니다."
    )
    return MessageDraftResponse(meeting_id=meeting_id, message=message, selected_candidate=selected)
