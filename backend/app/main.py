"""SomaMeet FastAPI application entry-point.

Exports `app` so tests can `from app.main import app`.
"""
from __future__ import annotations

import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import availability, meetings, oauth, participants, timetable
from app.core.config import get_settings
from app.core.errors import register_exception_handlers

logger = logging.getLogger("somameet")


def create_app() -> FastAPI:
    settings = get_settings()

    app = FastAPI(title="SomaMeet API", version="0.1.0")

    app.add_middleware(
        CORSMiddleware,
        allow_origins=[settings.APP_BASE_URL],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    register_exception_handlers(app)

    app.include_router(meetings.router)
    app.include_router(participants.router)
    app.include_router(availability.router)
    app.include_router(oauth.router)
    app.include_router(timetable.router)

    @app.get("/api/health")
    def health() -> dict:
        return {"ok": True}

    logger.info(
        "SomaMeet started provider=%s base=%s google_oauth=%s",
        settings.LLM_PROVIDER,
        settings.APP_BASE_URL,
        settings.google_oauth_configured,
    )
    return app


app = create_app()
