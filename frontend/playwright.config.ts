/**
 * Playwright configuration for SomaMeet E1 (browser golden path) test.
 *
 * Test ownership: qa-security agent.
 *
 * Strategy
 *  - testDir   : ./tests/e2e (kept inside the frontend workspace so that
 *                `pnpm test:e2e` runs from here without extra setup).
 *  - baseURL   : http://localhost:5173 (Vite dev server).
 *  - webServer : array form, launching BOTH the backend (FastAPI / uvicorn)
 *                and the frontend (Vite dev). Backend is started against a
 *                disposable SQLite file (e2e.db). LLM_PROVIDER is forced to
 *                `template` so the assertion text is deterministic.
 *  - reuseExistingServer: true when not in CI so a developer who has the
 *                servers running locally can iterate fast without rebooting
 *                them on every run.
 *  - globalSetup runs `alembic upgrade head` against the test DB BEFORE the
 *    backend webServer boots.
 *  - globalTeardown deletes the test DB after the run.
 *
 * Windows note
 *  - On Windows we shell out to `python -m uvicorn` and `pnpm dev` directly.
 *  - If the host machine cannot launch the backend automatically (rare —
 *    typically due to Python not being on PATH inside the spawned shell),
 *    set the env var SOMAMEET_E2E_REUSE=1 and start the backend manually
 *    before running `pnpm test:e2e`. The webServer entry will then re-use
 *    the existing 8000-port server.
 */
import { defineConfig } from "@playwright/test"
import path from "node:path"
import { fileURLToPath } from "node:url"

// Frontend tsconfig has "module": "ESNext"; Playwright loads this config as
// ESM, so __dirname is not defined. Reconstruct it from import.meta.url.
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const ROOT = path.resolve(__dirname, "..")
const BACKEND_DIR = path.resolve(ROOT, "backend")
const E2E_DB_PATH = path.resolve(BACKEND_DIR, "e2e.db")

// On Windows the SQLAlchemy URL needs forward slashes; relative path keeps it portable.
// We pass `sqlite:///./e2e.db` and run uvicorn with cwd=BACKEND_DIR so the .db lives in backend/.
const BACKEND_DATABASE_URL = "sqlite:///./e2e.db"

const reuseExistingServer = !!process.env.SOMAMEET_E2E_REUSE || !process.env.CI

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: /.*\.spec\.ts$/,
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: [["list"]],

  globalSetup: path.resolve(__dirname, "./tests/e2e/global-setup.ts"),
  globalTeardown: path.resolve(__dirname, "./tests/e2e/global-teardown.ts"),

  use: {
    baseURL: "http://localhost:5173",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },

  projects: [
    {
      name: "chromium",
      use: {
        // Bundled chromium (or headless shell) — installed via `pnpm exec playwright install chromium`.
        browserName: "chromium",
      },
    },
  ],

  webServer: [
    {
      // Backend (FastAPI). Fresh DB via globalSetup; LLM forced to template for determinism.
      command: "python -m uvicorn app.main:app --host 127.0.0.1 --port 8000",
      cwd: BACKEND_DIR,
      url: "http://127.0.0.1:8000/api/health",
      timeout: 120_000,
      reuseExistingServer,
      stdout: "pipe",
      stderr: "pipe",
      env: {
        DATABASE_URL: BACKEND_DATABASE_URL,
        LLM_PROVIDER: "template",
        APP_BASE_URL: "http://localhost:5173",
        SESSION_SECRET: "e2e-session-secret-32-chars-long-string",
        // Force these blank so /availability/google/oauth-url returns 503 (we don't exercise OAuth in E1).
        GOOGLE_CLIENT_ID: "",
        GOOGLE_CLIENT_SECRET: "",
        // Make sure the `e2e.db` resolves predictably regardless of caller cwd.
        E2E_DB_PATH,
      },
    },
    {
      // Frontend (Vite dev). Proxies /api -> http://localhost:8000.
      command: "pnpm dev",
      cwd: __dirname,
      url: "http://localhost:5173",
      timeout: 120_000,
      reuseExistingServer,
      stdout: "pipe",
      stderr: "pipe",
    },
  ],
})
