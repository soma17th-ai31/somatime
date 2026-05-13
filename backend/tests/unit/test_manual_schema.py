"""Unit tests for manual availability request parsing."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from app.schemas.manual import ManualAvailabilityInput


def test_manual_input_accepts_24_hour_boundary() -> None:
    payload = {
        "busy_blocks": [
            {
                "start": "2026-05-13T22:00:00+09:00",
                "end": "2026-05-13T24:00:00+09:00",
            }
        ]
    }

    parsed = ManualAvailabilityInput.model_validate(payload)

    assert parsed.busy_blocks[0].end == datetime(
        2026,
        5,
        14,
        0,
        0,
        tzinfo=timezone(timedelta(hours=9)),
    )
