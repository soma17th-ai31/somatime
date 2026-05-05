"""Pydantic v2 request/response schemas."""

from app.schemas.candidate import Candidate, CalculateResponse
from app.schemas.confirm import ConfirmRequest, ConfirmResponse, ConfirmedSlot
from app.schemas.error import ErrorResponse
from app.schemas.manual import ManualAvailabilityInput, ManualBlock
from app.schemas.meeting import (
    MeetingCreate,
    MeetingCreateResponse,
    MeetingDetail,
    LocationType,
)
from app.schemas.participant import ParticipantCreate, ParticipantResponse
from app.schemas.timetable import TimetableResponse, TimetableSlot

__all__ = [
    "CalculateResponse",
    "Candidate",
    "ConfirmRequest",
    "ConfirmResponse",
    "ConfirmedSlot",
    "ErrorResponse",
    "LocationType",
    "ManualAvailabilityInput",
    "ManualBlock",
    "MeetingCreate",
    "MeetingCreateResponse",
    "MeetingDetail",
    "ParticipantCreate",
    "ParticipantResponse",
    "TimetableResponse",
    "TimetableSlot",
]
