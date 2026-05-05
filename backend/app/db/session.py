"""SQLAlchemy engine and session factory.

The engine is built lazily on first access so tests can override DATABASE_URL
via environment variables before the engine is materialized.
"""
from __future__ import annotations

import os
from collections.abc import Generator
from typing import Optional

from sqlalchemy import create_engine
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker

_engine: Optional[Engine] = None
_SessionFactory: Optional[sessionmaker] = None


def _build_engine(url: str) -> Engine:
    connect_args: dict = {}
    if url.startswith("sqlite"):
        connect_args["check_same_thread"] = False
    return create_engine(url, future=True, connect_args=connect_args)


def get_engine() -> Engine:
    global _engine, _SessionFactory
    if _engine is None:
        url = os.environ.get("DATABASE_URL", "sqlite:///./somameet.db")
        _engine = _build_engine(url)
        _SessionFactory = sessionmaker(
            bind=_engine,
            autoflush=False,
            autocommit=False,
            expire_on_commit=False,
            class_=Session,
        )
    return _engine


def reset_engine() -> None:
    """Test helper: drop cached engine/session factory so a new DATABASE_URL takes effect."""
    global _engine, _SessionFactory
    if _engine is not None:
        _engine.dispose()
    _engine = None
    _SessionFactory = None


def SessionLocal() -> Session:
    """Return a new Session bound to the lazily-created engine."""
    if _SessionFactory is None:
        get_engine()
    assert _SessionFactory is not None
    return _SessionFactory()


def get_db() -> Generator[Session, None, None]:
    """FastAPI dependency: yields a session and closes it on exit."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
