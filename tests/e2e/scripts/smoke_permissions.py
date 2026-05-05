"""HTTP smoke test for the permission matrix (spec section 5).

Run against an isolated SQLite DB using FastAPI's TestClient (no live
server required). Asserts:

  - POST /api/meetings : public (201)
  - GET  /api/meetings/{slug} : public (200)
  - POST /api/meetings/{slug}/calculate : public (200)
  - POST /api/meetings/{slug}/confirm without X-Organizer-Token : 403
  - POST /api/meetings/{slug}/confirm with WRONG X-Organizer-Token : 403
  - POST /api/meetings/{slug}/availability/manual without cookie : 403
  - POST /api/meetings/{slug2}/availability/manual with meeting1's cookie : 403
    (cross-meeting cookie reuse must be rejected)

This is a defense-in-depth check on top of S5/S6 in the acceptance suite.
"""
from __future__ import annotations

import os
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
BACKEND = ROOT / "backend"
sys.path.insert(0, str(BACKEND))

# Use a temp SQLite DB that's deleted at the end. Set BEFORE importing the app
# so engine factory picks it up.
_tmpdir = tempfile.mkdtemp(prefix="somameet_smoke_")
_db_path = Path(_tmpdir) / "smoke.db"
os.environ["DATABASE_URL"] = f"sqlite:///{_db_path.as_posix()}"
os.environ["LLM_PROVIDER"] = "template"
os.environ.setdefault("APP_BASE_URL", "http://localhost:5173")
os.environ.setdefault("SESSION_SECRET", "smoke-secret-32-chars-long-padding")

# Run migrations into the temp DB.
import subprocess

subprocess.run(
    [sys.executable, "-m", "alembic", "upgrade", "head"],
    cwd=str(BACKEND),
    check=True,
    env={**os.environ},
)

from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402

client = TestClient(app)


def _fail(msg: str) -> None:
    print(f"[smoke] FAIL: {msg}")
    sys.exit(1)


def _ok(msg: str) -> None:
    print(f"[smoke] OK: {msg}")


# --- create meeting (public) -------------------------------------------------
m1_payload = {
    "title": "회의 1",
    "date_range_start": "2026-05-11",
    "date_range_end": "2026-05-15",
    "duration_minutes": 60,
    "participant_count": 3,
    "location_type": "online",
    "time_window_start": "09:00",
    "time_window_end": "22:00",
    "include_weekends": False,
}
r = client.post("/api/meetings", json=m1_payload)
if r.status_code != 201:
    _fail(f"POST /api/meetings (1) returned {r.status_code}: {r.text}")
m1 = r.json()
slug1 = m1["slug"]
org1 = m1["organizer_token"]
_ok(f"public meeting create -> 201 (slug={slug1})")

m2_payload = dict(m1_payload, title="회의 2")
r = client.post("/api/meetings", json=m2_payload)
if r.status_code != 201:
    _fail(f"POST /api/meetings (2) returned {r.status_code}")
m2 = r.json()
slug2 = m2["slug"]
_ok(f"public meeting create #2 -> 201 (slug={slug2})")

# --- get meeting (public) ----------------------------------------------------
r = client.get(f"/api/meetings/{slug1}")
if r.status_code != 200:
    _fail(f"GET /api/meetings/{{slug}} returned {r.status_code}")
_ok("public meeting GET -> 200")

# --- calculate (public) ------------------------------------------------------
r = client.post(f"/api/meetings/{slug1}/calculate")
if r.status_code != 200:
    _fail(f"POST /calculate returned {r.status_code}: {r.text}")
_ok("public calculate -> 200")

# --- confirm requires organizer token ---------------------------------------
confirm_payload = {
    "slot_start": "2026-05-12T14:00:00+09:00",
    "slot_end": "2026-05-12T15:00:00+09:00",
}
r = client.post(f"/api/meetings/{slug1}/confirm", json=confirm_payload)
if r.status_code != 403:
    _fail(f"confirm without header expected 403, got {r.status_code}: {r.text}")
_ok("confirm without X-Organizer-Token -> 403")

r = client.post(
    f"/api/meetings/{slug1}/confirm",
    json=confirm_payload,
    headers={"X-Organizer-Token": "definitely-not-the-right-token"},
)
if r.status_code != 403:
    _fail(f"confirm with wrong header expected 403, got {r.status_code}")
_ok("confirm with wrong X-Organizer-Token -> 403")

# Cross-meeting: org1's token must not authorize confirm on meeting2
r = client.post(
    f"/api/meetings/{slug2}/confirm",
    json=confirm_payload,
    headers={"X-Organizer-Token": org1},
)
if r.status_code != 403:
    _fail(f"cross-meeting organizer confirm expected 403, got {r.status_code}")
_ok("cross-meeting organizer token -> 403")

# --- manual availability requires participant cookie ------------------------
r = client.post(
    f"/api/meetings/{slug1}/availability/manual",
    json={"busy_blocks": []},
)
if r.status_code != 403:
    _fail(f"manual without cookie expected 403, got {r.status_code}")
_ok("manual without cookie -> 403")

# Register participant on meeting1 -> cookie set
r = client.post(
    f"/api/meetings/{slug1}/participants",
    json={"nickname": "참여자A"},
)
if r.status_code != 201:
    _fail(f"participant register expected 201, got {r.status_code}: {r.text}")
# TestClient persists cookies on `client` by default.

# Same client (cookies for meeting1) hits meeting2's manual endpoint -> 403
r2 = client.post(
    f"/api/meetings/{slug2}/availability/manual",
    json={"busy_blocks": []},
)
if r2.status_code != 403:
    _fail(
        f"cross-meeting participant cookie expected 403, got {r2.status_code}: {r2.text}"
    )
_ok("cross-meeting participant cookie -> 403")

# Same cookie on meeting1 should now work (200)
r3 = client.post(
    f"/api/meetings/{slug1}/availability/manual",
    json={"busy_blocks": []},
)
if r3.status_code != 200:
    _fail(f"own-meeting manual expected 200, got {r3.status_code}: {r3.text}")
_ok("own-meeting manual with cookie -> 200")

print("[smoke] all permission checks passed.")
sys.exit(0)
