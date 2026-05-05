"""Application settings loaded from environment + .env.

Per the coordination contract:
- pydantic-settings v2 BaseSettings, env_file=".env", extra="ignore".
- get_settings() is cached with lru_cache so a single instance is shared.
- Test runs override DATABASE_URL via env vars; we still read directly from
  os.environ for DATABASE_URL inside app.db.session, so settings here is for
  values that don't change per-test (URLs, OAuth, LLM).
"""
from __future__ import annotations

from functools import lru_cache
from typing import List

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Runtime configuration.

    The .env in backend/ is the development source of truth. Tests do NOT
    rely on settings.DATABASE_URL — they monkeypatch the env var directly
    and the engine factory in app.db.session reads it lazily.
    """

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=True,
    )

    DATABASE_URL: str = "sqlite:///./somameet.db"
    SESSION_SECRET: str = "dev-session-secret-change-me-32chars-minimum"
    APP_BASE_URL: str = "http://localhost:5173"

    GOOGLE_CLIENT_ID: str = ""
    GOOGLE_CLIENT_SECRET: str = ""
    GOOGLE_REDIRECT_URI: str = "http://localhost:8000/api/auth/google/callback"
    GOOGLE_OAUTH_SCOPES: str = "https://www.googleapis.com/auth/calendar.freebusy"

    LLM_PROVIDER: str = "template"
    LLM_MODEL: str = "gemini-2.5-flash"
    GEMINI_API_KEY: str = ""
    ANTHROPIC_API_KEY: str = ""
    OPENAI_API_KEY: str = ""

    @property
    def google_oauth_scope_list(self) -> List[str]:
        scopes = self.GOOGLE_OAUTH_SCOPES.strip()
        if not scopes:
            return []
        if " " in scopes:
            return [s for s in scopes.split() if s]
        return [scopes]

    @property
    def google_oauth_configured(self) -> bool:
        return bool(self.GOOGLE_CLIENT_ID and self.GOOGLE_CLIENT_SECRET)


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Singleton accessor. Tests can call get_settings.cache_clear() to refresh."""
    return Settings()
