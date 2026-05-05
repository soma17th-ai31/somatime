/**
 * Playwright globalTeardown.
 *
 * Removes the e2e SQLite DB after the test run so the next run gets a clean
 * slate. We only delete the file when not running in reuse mode.
 */
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const ROOT = path.resolve(__dirname, "..", "..", "..")
const E2E_DB = path.resolve(ROOT, "backend", "e2e.db")

export default async function globalTeardown() {
  if (process.env.SOMAMEET_E2E_REUSE) return
  // SQLite + WAL/SHM may leave companion files; sweep both.
  const candidates = [E2E_DB, `${E2E_DB}-journal`, `${E2E_DB}-wal`, `${E2E_DB}-shm`]
  for (const file of candidates) {
    try {
      if (fs.existsSync(file)) fs.rmSync(file, { force: true })
    } catch {
      // best-effort cleanup
    }
  }
}
