"""Application settings loaded from environment + .env.

Per the coordination contract:
- pydantic-settings v2 BaseSettings, env_file=".env", extra="ignore".
- get_settings() is cached with lru_cache so a single instance is shared.
- Test runs override DATABASE_URL via env vars; we still read directly from
  os.environ for DATABASE_URL inside app.db.session, so settings here is for
  values that don't change per-test (URLs, LLM provider).

v3 cleanup:
- Google OAuth keys removed (Q3 — feature deleted, no env vars surface).
- Multi-LLM legacy keys (Gemini / Anthropic / OpenAI) removed; the only
  supported providers are `upstage` (real LLM) and `template` (deterministic).
"""
from __future__ import annotations

from functools import lru_cache
from typing import List

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
    CORS_EXTRA_ORIGINS: str = ""

    COOKIE_SAMESITE: str = "lax"
    COOKIE_SECURE: bool = False

    # LLM_PROVIDER defaults to `template` so a fresh clone runs end-to-end
    # without needing an UPSTAGE_API_KEY. README documents how to switch to
    # upstage for real recommendations.
    LLM_PROVIDER: str = "template"
    UPSTAGE_API_KEY: str = ""
    UPSTAGE_BASE_URL: str = "https://api.upstage.ai/v1"
    UPSTAGE_MODEL: str = "solar-pro3"
    UPSTAGE_TIMEOUT_SECONDS: int = 45

    @property
    def cors_allowed_origins(self) -> List[str]:
        origins = {self.APP_BASE_URL}
        extra = self.CORS_EXTRA_ORIGINS.strip()
        if extra:
            origins.update(o.strip() for o in extra.split(",") if o.strip())
        return sorted(origins)


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Singleton accessor. Tests can call get_settings.cache_clear() to refresh."""
    return Settings()
