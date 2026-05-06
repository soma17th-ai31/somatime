"""SomaMeet FastAPI application entry-point (v3).

Exports `app` so tests can `from app.main import app`.

v3 routers mounted:
- meetings (POST/GET/calculate/confirm)
- participants (POST register)
- auth (POST /participants/login — PIN re-entry)
- availability (manual + ICS)
- recommend (Q9 — single-call LLM recommendation with retry cap)
- timetable (GET)

v3 cleanup:
- Google OAuth router removed entirely (Q3). The `freebusy`-only scope is no
  longer offered; participants supply busy/free via manual input or ICS upload.
"""
from __future__ import annotations

import logging

# Load .env into os.environ at startup. pydantic-settings reads .env into the
# Settings model only — modules that read os.environ.get(...) directly (e.g.
# UpstageAdapter) need this explicit propagation so their values match Settings.
from dotenv import load_dotenv

load_dotenv()

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import auth, availability, meetings, participants, recommend, timetable
from app.core.config import get_settings
from app.core.errors import register_exception_handlers

logger = logging.getLogger("somameet")


def create_app() -> FastAPI:
    settings = get_settings()

    app = FastAPI(title="SomaMeet API", version="0.3.0")

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_allowed_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    register_exception_handlers(app)

    app.include_router(meetings.router)
    app.include_router(participants.router)
    app.include_router(auth.router)
    app.include_router(availability.router)
    app.include_router(recommend.router)
    app.include_router(timetable.router)

    @app.get("/api/health")
    def health() -> dict:
        return {"ok": True}

    logger.info(
        "SomaMeet started provider=%s base=%s",
        settings.LLM_PROVIDER,
        settings.APP_BASE_URL,
    )
    return app


app = create_app()
