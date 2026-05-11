"""Pytest configuration shared across unit / integration / acceptance suites.

- Forces deterministic LLM_PROVIDER=template
- Configures a per-test SQLite database under tmp_path
- Provides client / make_meeting / register_participant / submit_manual fixtures.

The FastAPI app under test is imported as `app.main:app`. Until backend-api
lands that module, any fixture that needs `client` will skip.
"""
from __future__ import annotations

import importlib
import os
import sys
from datetime import date, datetime, time, timezone
from pathlib import Path
from typing import Iterator

import pytest

# Make the backend/ directory importable as the project root.
BACKEND_ROOT = Path(__file__).parent
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

# Force deterministic LLM provider for tests; preserve any existing real envs
# but always override the provider.
os.environ.setdefault("SESSION_SECRET", "test-session-secret-32-chars-minimum-xxx")
os.environ["LLM_PROVIDER"] = "template"
# v3.22 — TestClient transports over http://, so cookies with Secure=true
# are dropped between requests. Force the test env to insecure-cookie so
# /participants → /availability/manual round-trips carry the cookie.
# Production .env can still set COOKIE_SECURE=true; load_dotenv() in
# app/main.py uses override=False (default), so these test presets win.
os.environ["COOKIE_SECURE"] = "false"
os.environ["COOKIE_SAMESITE"] = "lax"


# --------------------------------------------------------------------- DB plumbing


@pytest.fixture()
def db_url(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> str:
    db_path = tmp_path / "somameet_test.db"
    url = f"sqlite:///{db_path.as_posix()}"
    monkeypatch.setenv("DATABASE_URL", url)

    # Reset the cached engine so the new URL takes effect.
    from app.db import session as session_module

    session_module.reset_engine()

    # Create schema.
    from app.db.base import Base

    engine = session_module.get_engine()
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)

    yield url

    Base.metadata.drop_all(engine)
    session_module.reset_engine()


@pytest.fixture()
def db_session(db_url: str) -> Iterator:
    from app.db.session import SessionLocal

    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()


# --------------------------------------------------------------------- TestClient


@pytest.fixture()
def client(db_url: str) -> Iterator:
    """FastAPI TestClient. Skips if app.main is not yet implemented."""
    try:
        from fastapi.testclient import TestClient
    except ImportError:
        pytest.skip("fastapi not installed")

    try:
        main_module = importlib.import_module("app.main")
    except ModuleNotFoundError as exc:
        pytest.skip(f"app.main not available yet: {exc}")
    except Exception as exc:
        pytest.skip(f"app.main import failed: {exc}")

    app = getattr(main_module, "app", None)
    if app is None:
        pytest.skip("app.main has no `app` attribute yet")
    with TestClient(app) as c:
        yield c


# --------------------------------------------------------------------- helpers


@pytest.fixture()
def make_meeting(client):
    def _make(**overrides) -> dict:
        body = {
            "title": "팀 회의",
            "date_range_start": "2026-05-11",
            "date_range_end": "2026-05-15",
            "duration_minutes": 60,
            "location_type": "online",
            "time_window_start": "09:00",
            "time_window_end": "22:00",
            "include_weekends": False,
        }
        body.update(overrides)
        resp = client.post("/api/meetings", json=body)
        assert resp.status_code == 201, resp.text
        return resp.json()

    return _make


@pytest.fixture()
def register_participant(client):
    def _register(slug: str, nickname: str) -> dict:
        resp = client.post(
            f"/api/meetings/{slug}/participants",
            # buffer-on-join: required field. Tests that don't care pick 60.
            json={"nickname": nickname, "buffer_minutes": 60},
        )
        assert resp.status_code in (200, 201), resp.text
        return resp.json()

    return _register


@pytest.fixture()
def submit_manual(client):
    def _submit(slug: str, blocks: list[dict]) -> dict:
        resp = client.post(
            f"/api/meetings/{slug}/availability/manual",
            json={"busy_blocks": blocks},
        )
        assert resp.status_code in (200, 201), resp.text
        return resp.json()

    return _submit


# --------------------------------------------------------------------- shared data builders


@pytest.fixture()
def sample_meeting(db_session):
    """Create a Meeting row in the DB and return it (no HTTP)."""
    from app.db.models import Meeting

    meeting = Meeting(
        slug="aB3kF9xQ",
        title="팀 회의",
        date_range_start=date(2026, 5, 11),
        date_range_end=date(2026, 5, 15),
        duration_minutes=60,
        location_type="online",
        time_window_start=time(9, 0),
        time_window_end=time(22, 0),
        include_weekends=False,
        created_at=datetime(2026, 5, 4, tzinfo=timezone.utc).replace(tzinfo=None),
    )
    db_session.add(meeting)
    db_session.commit()
    db_session.refresh(meeting)
    return meeting
