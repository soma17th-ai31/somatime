/**
 * Playwright globalSetup.
 *
 * Steps:
 *  1. Resolve the test DB path (backend/e2e.db).
 *  2. Delete it if it already exists (clean slate per run).
 *  3. Run `alembic upgrade head` against it BEFORE the backend webServer
 *     starts. The backend webServer reads DATABASE_URL=sqlite:///./e2e.db
 *     with cwd=backend, so the relative path resolves to the same file.
 *
 * No emojis. No source patches.
 */
import { spawnSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const ROOT = path.resolve(__dirname, "..", "..", "..")
const BACKEND_DIR = path.resolve(ROOT, "backend")
const E2E_DB = path.resolve(BACKEND_DIR, "e2e.db")

function log(msg: string) {
  // Plain prefix so it shows up in Playwright output without ambiguity.
  // eslint-disable-next-line no-console
  console.log(`[e2e:global-setup] ${msg}`)
}

export default async function globalSetup() {
  if (process.env.SOMAMEET_E2E_REUSE) {
    log("SOMAMEET_E2E_REUSE=1 set — skipping DB reset (assuming caller-managed backend).")
    return
  }

  if (fs.existsSync(E2E_DB)) {
    fs.rmSync(E2E_DB, { force: true })
    log(`removed stale ${E2E_DB}`)
  }

  log(`running alembic upgrade head against ${E2E_DB}`)
  // Backend's alembic/env.py reads DATABASE_URL from os.environ and
  // overrides the alembic.ini value when present. Setting the env var here
  // is the supported way to point migrations at the test DB.
  const result = spawnSync("python", ["-m", "alembic", "upgrade", "head"], {
    cwd: BACKEND_DIR,
    env: {
      ...process.env,
      DATABASE_URL: "sqlite:///./e2e.db",
    },
    encoding: "utf8",
    shell: false,
  })

  if (result.error) {
    log(`alembic spawn error: ${result.error.message}`)
    throw result.error
  }
  if (result.status !== 0) {
    log(`alembic stdout:\n${result.stdout}`)
    log(`alembic stderr:\n${result.stderr}`)
    throw new Error(`alembic upgrade head failed with exit code ${result.status}`)
  }
  log("alembic upgrade head completed")
}
