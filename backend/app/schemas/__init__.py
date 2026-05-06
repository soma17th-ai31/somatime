"""Pydantic v2 request/response schemas (v3)."""

from app.schemas.candidate import Candidate, CalculateResponse
from app.schemas.confirm import ConfirmRequest, ConfirmResponse, ConfirmedSlot
from app.schemas.error import ErrorResponse
from app.schemas.manual import ManualAvailabilityInput, ManualBlock
from app.schemas.meeting import (
    DateMode,
    LocationType,
    MeetingCreate,
    MeetingCreateResponse,
    MeetingDetail,
)
from app.schemas.participant import (
    ParticipantCreate,
    ParticipantLogin,
    ParticipantResponse,
)
from app.schemas.recommendation import RecommendResponse
from app.schemas.timetable import TimetableResponse, TimetableSlot

__all__ = [
    "CalculateResponse",
    "Candidate",
    "ConfirmRequest",
    "ConfirmResponse",
    "ConfirmedSlot",
    "DateMode",
    "ErrorResponse",
    "LocationType",
    "ManualAvailabilityInput",
    "ManualBlock",
    "MeetingCreate",
    "MeetingCreateResponse",
    "MeetingDetail",
    "ParticipantCreate",
    "ParticipantLogin",
    "ParticipantResponse",
    "RecommendResponse",
    "TimetableResponse",
    "TimetableSlot",
]
