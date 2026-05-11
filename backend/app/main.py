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

import asyncio
import logging
from contextlib import asynccontextmanager

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
from app.db.session import SessionLocal
from app.services.expiry import delete_expired_meetings

logger = logging.getLogger("somameet")


# Issue #32 — hourly background sweep that hard-deletes meetings whose
# ``meeting_expires_at`` has passed. The lazy guard in GET /meetings/{slug}
# covers the gap between container startup and the first tick.
EXPIRY_SWEEP_INTERVAL_SECONDS = 60 * 60  # 1 hour


def _run_expiry_sweep() -> None:
    """Single sweep — one short-lived DB session, exceptions swallowed."""
    session = SessionLocal()
    try:
        delete_expired_meetings(session)
    except Exception:  # noqa: BLE001 — keep the loop alive on transient errors
        logger.exception("expiry sweep failed; will retry next tick")
    finally:
        session.close()


@asynccontextmanager
async def _lifespan(app: FastAPI):
    # One sweep at startup so a freshly-booted container is consistent with
    # the cron schedule even if it was down for hours.
    _run_expiry_sweep()

    async def _periodic_sweep() -> None:
        while True:
            try:
                await asyncio.sleep(EXPIRY_SWEEP_INTERVAL_SECONDS)
            except asyncio.CancelledError:
                raise
            _run_expiry_sweep()

    task = asyncio.create_task(_periodic_sweep(), name="somameet-expiry-sweep")
    try:
        yield
    finally:
        task.cancel()
        try:
            await task
        except (asyncio.CancelledError, Exception):  # noqa: BLE001
            pass


def create_app() -> FastAPI:
    settings = get_settings()

    app = FastAPI(title="SomaMeet API", version="0.3.0", lifespan=_lifespan)

    # v3.22 — Vercel preview/production URLs change per deploy (e.g.
    # `soma-meet-<hash>-<scope>.vercel.app`). Allow any subdomain of
    # vercel.app via regex AND keep explicit allow_origins for any custom
    # domains the user has set in CORS_EXTRA_ORIGINS.
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_allowed_origins,
        allow_origin_regex=r"^https://[^/]*\.vercel\.app$",
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
