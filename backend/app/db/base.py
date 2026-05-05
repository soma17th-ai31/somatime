"""SQLAlchemy declarative base.

Models live in app.db.models. Alembic discovers metadata via Base.metadata.
"""
from __future__ import annotations

from sqlalchemy.orm import DeclarativeBase


class Base(DeclarativeBase):
    """Project-wide declarative base."""

    pass
