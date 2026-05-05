"""Live Gemini verification script.

Purpose
-------
Manual / scripted check that the configured `gemini` LLM provider can actually
reach the Gemini API and produce non-empty, privacy-respecting strings via the
adapter layer.

This intentionally lives OUTSIDE the pytest suite because:
  - it costs API quota,
  - it requires a real network and a real key,
  - the rest of the test suite uses LLM_PROVIDER=template for determinism.

Run
---
    python tests/e2e/scripts/verify_gemini_live.py

Exit codes
----------
    0 on success (both adapter calls returned non-empty strings and passed the
      privacy-guard assertions)
    1 on any configuration / network / privacy failure (with diagnostic output)

Reads `backend/.env` to load LLM_PROVIDER + GEMINI_API_KEY. Adds backend/ to
sys.path so we can import the project's adapter (we go through
`get_llm_adapter()` rather than calling the SDK directly — this verifies the
real wiring path used in production code).

Privacy guards
--------------
We construct an input where:
  - meeting.title is benign ("팀 회의"),
  - busy_blocks have NO content (we only pass slot times to the adapter),
  - nicknames are simple labels.
The output is then scanned for words that should never appear unless the
prompt was leaking event content. S11 in the spec only protects against
LEAKAGE FROM busy_blocks, but as defense-in-depth we also check that the
model didn't hallucinate sensitive vocabulary.
"""
from __future__ import annotations

import os
import sys
from datetime import datetime
from pathlib import Path
from typing import List

# ---------------------------------------------------------------- path/env wiring

ROOT = Path(__file__).resolve().parents[3]  # somameet/
BACKEND = ROOT / "backend"
ENV_FILE = BACKEND / ".env"

if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))


def _load_env(path: Path) -> None:
    """Tiny .env loader so we don't pull python-dotenv as a runtime dep here."""
    if not path.exists():
        return
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        if "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        # Don't clobber existing real env vars (tests may override).
        os.environ.setdefault(key, value)


_load_env(ENV_FILE)


def _fail(reason: str) -> None:
    print(f"[verify_gemini_live] FAIL: {reason}", file=sys.stderr)
    sys.exit(1)


def _ok(msg: str) -> None:
    print(f"[verify_gemini_live] OK: {msg}")


# ---------------------------------------------------------------- preconditions

provider = os.environ.get("LLM_PROVIDER", "").strip().lower()
api_key = os.environ.get("GEMINI_API_KEY", "").strip()

if provider != "gemini":
    _fail(
        f"LLM_PROVIDER={provider!r} (expected 'gemini'). "
        f"Edit backend/.env or export LLM_PROVIDER=gemini."
    )
if not api_key:
    _fail("GEMINI_API_KEY is empty. Edit backend/.env to provide a real key.")

_ok(f"env: LLM_PROVIDER=gemini, GEMINI_API_KEY length={len(api_key)}")


# ---------------------------------------------------------------- imports (after env wired)

try:
    from app.db.models import Meeting  # type: ignore
    from app.schemas.candidate import Candidate  # type: ignore
    from app.services.llm import get_llm_adapter  # type: ignore
    from app.services.llm.base import Slot  # type: ignore
    from app.services.llm.gemini import GeminiAdapter  # type: ignore
except Exception as exc:  # pragma: no cover
    _fail(f"failed to import backend modules: {exc}")


# ---------------------------------------------------------------- fixtures

# Use unmanaged Meeting (not persisted to DB) — the adapter only reads attrs.
meeting = Meeting(
    slug="liveTest",
    organizer_token="x" * 32,
    title="팀 회의",  # benign organizer-supplied title
    date_range_start=datetime(2026, 5, 11).date(),
    date_range_end=datetime(2026, 5, 15).date(),
    duration_minutes=60,
    participant_count=3,
    location_type="online",
    time_window_start=datetime(2026, 5, 11, 9, 0).time(),
    time_window_end=datetime(2026, 5, 11, 22, 0).time(),
    include_weekends=False,
    created_at=datetime(2026, 5, 4, 0, 0),
)

candidates: List[Candidate] = [
    Candidate(
        start=datetime(2026, 5, 12, 14, 0),
        end=datetime(2026, 5, 12, 15, 0),
        available_count=3,
        missing_participants=[],
        reason="placeholder",
    ),
    Candidate(
        start=datetime(2026, 5, 13, 10, 0),
        end=datetime(2026, 5, 13, 11, 0),
        available_count=3,
        missing_participants=[],
        reason="placeholder",
    ),
    Candidate(
        start=datetime(2026, 5, 14, 16, 0),
        end=datetime(2026, 5, 14, 17, 0),
        available_count=2,
        missing_participants=["참여자C"],
        reason="placeholder",
    ),
]

slot = Slot(
    start=datetime(2026, 5, 12, 14, 0),
    end=datetime(2026, 5, 12, 15, 0),
)
nicknames = ["참여자A", "참여자B", "참여자C"]


# ---------------------------------------------------------------- exercise adapter

adapter = get_llm_adapter()
if not isinstance(adapter, GeminiAdapter):
    _fail(
        f"factory returned {type(adapter).__name__}, expected GeminiAdapter. "
        f"LLM_PROVIDER routing is broken."
    )

if not getattr(adapter, "_sdk_ready", False):
    _fail(
        "GeminiAdapter._sdk_ready is False — google-generativeai SDK could not "
        "initialize. Check that the package is installed and that the API key "
        "is valid."
    )
_ok("GeminiAdapter initialized with live SDK")


# 1) generate_recommendation_reasons
print("\n--- generate_recommendation_reasons ---")
reasons = adapter.generate_recommendation_reasons(candidates, meeting)
if not isinstance(reasons, list) or len(reasons) != len(candidates):
    _fail(f"reasons type/length wrong: {type(reasons)} len={len(reasons) if isinstance(reasons, list) else 'n/a'}")

for idx, r in enumerate(reasons, start=1):
    if not isinstance(r, str) or not r.strip():
        _fail(f"reason #{idx} is empty")
    if len(r) > 400:
        # spec hints "≤200 chars" — allow some slack but flag absurdly long.
        print(f"  [warn] reason #{idx} is unusually long ({len(r)} chars)")
    print(f"  reason #{idx}: {r}")

# Privacy guard mirror of S11 — these words have no business showing up.
banned_substrings = ["병원", "진료", "데이트", "secret"]
for r in reasons:
    for w in banned_substrings:
        if w in r:
            _fail(f"reason contains banned token {w!r}: {r!r}")
_ok("recommendation reasons produced and pass privacy guard")


# 2) generate_share_message
print("\n--- generate_share_message ---")
share_message = adapter.generate_share_message(meeting, slot, nicknames)
if not isinstance(share_message, str) or not share_message.strip():
    _fail("share_message empty")

print("share_message:")
for line in share_message.splitlines():
    print(f"  | {line}")

if "팀 회의" not in share_message:
    print("  [warn] share_message did not include the meeting title — is the prompt working?")
for w in banned_substrings:
    if w in share_message:
        _fail(f"share_message contains banned token {w!r}")

_ok("share message produced and passes privacy guard")

print("\n[verify_gemini_live] all checks passed.")
sys.exit(0)
