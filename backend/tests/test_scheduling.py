from app.scheduling_validator import availability_for_window, build_best_candidate_fallback, compute_best_available_count, parse_datetime


def test_busy_block_blocks_candidate() -> None:
    participant = {
        "nickname": "중곤",
        "blocks": [{"block_type": "busy", "start": "2026-05-07T13:00:00+09:00", "end": "2026-05-07T14:00:00+09:00"}],
    }
    result = availability_for_window(
        [participant],
        parse_datetime("2026-05-07T13:30:00+09:00"),
        parse_datetime("2026-05-07T14:30:00+09:00"),
        "online",
    )
    assert result["available_count"] == 0


def test_offline_buffer_is_applied() -> None:
    participant = {
        "nickname": "수빈",
        "blocks": [{"block_type": "busy", "start": "2026-05-07T13:00:00+09:00", "end": "2026-05-07T14:00:00+09:00"}],
    }
    result = availability_for_window(
        [participant],
        parse_datetime("2026-05-07T14:00:00+09:00"),
        parse_datetime("2026-05-07T15:00:00+09:00"),
        "offline",
    )
    assert result["available_count"] == 0


def test_best_available_count_uses_free_blocks() -> None:
    meeting = {
        "start_date": "2026-05-07",
        "end_date": "2026-05-07",
        "daily_start_time": "10:00",
        "daily_end_time": "12:00",
        "duration_minutes": 60,
        "location_type": "online",
    }
    participants = [
        {
            "nickname": "세종",
            "blocks": [{"block_type": "free", "start": "2026-05-07T10:00:00+09:00", "end": "2026-05-07T12:00:00+09:00"}],
        },
        {
            "nickname": "상근",
            "blocks": [{"block_type": "free", "start": "2026-05-07T10:30:00+09:00", "end": "2026-05-07T11:30:00+09:00"}],
        },
    ]
    assert compute_best_available_count(meeting, participants) == 2


def test_fallback_returns_best_windows() -> None:
    meeting = {
        "start_date": "2026-05-07",
        "end_date": "2026-05-07",
        "daily_start_time": "10:00",
        "daily_end_time": "12:00",
        "duration_minutes": 60,
        "location_type": "online",
    }
    participants = [
        {
            "nickname": "세종",
            "blocks": [{"block_type": "free", "start": "2026-05-07T10:00:00+09:00", "end": "2026-05-07T12:00:00+09:00"}],
        },
        {
            "nickname": "상근",
            "blocks": [{"block_type": "free", "start": "2026-05-07T10:30:00+09:00", "end": "2026-05-07T11:30:00+09:00"}],
        },
    ]

    fallback = build_best_candidate_fallback(meeting, participants)

    assert fallback == [
        {
            "start": "2026-05-07T10:30:00+09:00",
            "end": "2026-05-07T11:30:00+09:00",
            "reason": "참여자 가용 시간이 가장 많이 겹치는 검증 가능한 후보입니다.",
            "available_participants": ["세종", "상근"],
            "unavailable_participants": [],
            "available_count": 2,
            "is_full_match": True,
        }
    ]
