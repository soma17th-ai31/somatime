from __future__ import annotations

from datetime import date, datetime, time
from typing import Literal

from pydantic import BaseModel, Field


LocationType = Literal["online", "offline", "either"]
BlockType = Literal["busy", "free"]
SourceType = Literal["manual", "ics"]


class MeetingCreate(BaseModel):
    title: str = Field(..., min_length=1, max_length=80)
    start_date: date
    end_date: date
    daily_start_time: time
    daily_end_time: time
    duration_minutes: int = Field(..., ge=15, le=480)
    target_participants: int = Field(..., ge=1, le=20)
    location_type: LocationType = "online"


class ParticipantResponse(BaseModel):
    id: str
    nickname: str
    source_type: SourceType
    block_count: int
    submitted_at: str


class MeetingResponse(BaseModel):
    id: str
    title: str
    start_date: date
    end_date: date
    daily_start_time: time
    daily_end_time: time
    duration_minutes: int
    target_participants: int
    location_type: LocationType
    submitted_participants: int
    is_ready_for_results: bool
    participants: list[ParticipantResponse]
    selected_candidate: dict | None = None


class ManualTimeBlock(BaseModel):
    start: datetime
    end: datetime


class IcsParseResponse(BaseModel):
    busy_blocks: list[ManualTimeBlock]


class ManualSubmission(BaseModel):
    nickname: str = Field(..., min_length=1, max_length=32)
    block_type: BlockType
    blocks: list[ManualTimeBlock] = Field(..., min_length=1, max_length=80)


class Candidate(BaseModel):
    start: datetime
    end: datetime
    available_participants: list[str]
    unavailable_participants: list[str]
    available_count: int
    is_full_match: bool
    reason: str


class TimetableSlot(BaseModel):
    start: datetime
    end: datetime
    available_count: int
    available_participants: list[str]
    unavailable_participants: list[str]


class ResultsResponse(BaseModel):
    meeting_id: str
    summary: str
    best_available_count: int
    total_participants: int
    candidates: list[Candidate]
    timetable: list[TimetableSlot]


class CandidateSelection(BaseModel):
    start: datetime
    end: datetime
    reason: str = ""


class MessageDraftResponse(BaseModel):
    meeting_id: str
    message: str
    selected_candidate: dict
