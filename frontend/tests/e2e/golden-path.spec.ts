/**
 * E1 — Browser Golden Path (Playwright).
 *
 * Source: 기획서/구현_위임_스펙.md section 9 / E1.
 *   1. `/` 접속 → 회의 생성 → 결과 화면에 두 URL 표시
 *   2. 공유 링크를 시크릿 창에서 열기 → "확정" 버튼 미노출
 *   3. 닉네임 등록 → manual 입력 → 제출
 *   4. 주최자 창으로 돌아가 calculate → 후보 3개 표시
 *   5. 첫 후보 선택 → 메시지 초안 모달 → 복사 버튼
 *
 * Determinism notes:
 *  - LLM_PROVIDER is forced to `template` for the backend webServer (see
 *    playwright.config.ts) so the share message format is stable.
 *  - We schedule the meeting in the next Mon..Fri window relative to the
 *    test run. The slot calculator works on KST naive datetimes so this is
 *    safe regardless of the runner's local TZ.
 *  - Clipboard: we install a stub on `navigator.clipboard` because headless
 *    Chromium often blocks real clipboard access.
 */
import { test, expect } from "@playwright/test"

// --------------------------------------------------------------------------- helpers

function pad(n: number): string {
  return n < 10 ? `0${n}` : `${n}`
}

function fmtDate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function nextMonday(today: Date = new Date()): Date {
  const d = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  // Day 0 is Sunday in JS. We want the strictly-next Monday so the meeting
  // does not collide with a partially-elapsed today.
  const day = d.getDay()
  const offset = ((1 - day + 7) % 7) || 7
  d.setDate(d.getDate() + offset)
  return d
}

function plusDays(d: Date, days: number): Date {
  const out = new Date(d)
  out.setDate(out.getDate() + days)
  return out
}

// --------------------------------------------------------------------------- test

test.describe.configure({ mode: "serial" })

test("E1: golden path from creation to confirm", async ({ browser }) => {
  // -------- date math --------
  const monday = nextMonday()
  const friday = plusDays(monday, 4)
  const startDate = fmtDate(monday)
  const endDate = fmtDate(friday)

  // -------- 1. Create meeting (organizer context) --------
  const organizerContext = await browser.newContext()
  // Install the clipboard stub on the CONTEXT so all pages opened after it
  // pick up the stub before any user code runs.
  await organizerContext.addInitScript(() => {
    const w = window as unknown as { __lastClipboardWrite?: string }
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (text: string) => {
          w.__lastClipboardWrite = text
        },
      },
    })
  })
  const organizer = await organizerContext.newPage()

  await organizer.goto("/")
  await expect(organizer.getByRole("heading", { name: "SomaMeet" })).toBeVisible()

  await organizer.locator("#title").fill("팀 회의")
  await organizer.locator("#date_range_start").fill(startDate)
  await organizer.locator("#date_range_end").fill(endDate)
  // duration_minutes default 60, location_type default offline. Spec asks for
  // online + 60min so override.
  await organizer.locator("#duration_minutes").selectOption("60")
  await organizer.locator("#participant_count").fill("3")
  await organizer.locator('input[type="radio"][value="online"]').check()

  await organizer.getByRole("button", { name: "회의 만들기" }).click()

  // After success: result card shows two CopyableUrl boxes.
  await expect(organizer.getByRole("heading", { name: "회의가 생성되었습니다" })).toBeVisible({
    timeout: 15_000,
  })
  await expect(organizer.getByText("내 관리용 링크 — 공유 금지")).toBeVisible()
  await expect(organizer.getByText("팀원에게 공유할 링크")).toBeVisible()

  // Capture both URLs from the rendered <code> blocks.
  const codeBlocks = organizer.locator("code")
  await expect(codeBlocks).toHaveCount(2)
  const organizerUrl = (await codeBlocks.nth(0).innerText()).trim()
  const shareUrl = (await codeBlocks.nth(1).innerText()).trim()
  expect(organizerUrl).toContain("?org=")
  expect(shareUrl).not.toContain("?org=")

  // Slug is the segment after /m/.
  const slugMatch = shareUrl.match(/\/m\/([^?\/]+)/)
  expect(slugMatch).not.toBeNull()
  const slug = slugMatch![1]

  // Navigate organizer to the organizer page (it currently sits on the result
  // card; clicking the inline link is faster than waiting for full SPA route).
  await organizer.getByRole("link", { name: "주최자 페이지로 이동" }).click()
  await expect(organizer.getByText("주최자 모드", { exact: true })).toBeVisible()

  // -------- 2. Share URL in incognito -> no confirm button --------
  // We do this BEFORE participants register so the page is in a deterministic
  // state (no candidate cards, no confirm). We re-check after candidates exist
  // too.
  const peekContext = await browser.newContext()
  const peekPage = await peekContext.newPage()
  await peekPage.goto(shareUrl)
  await expect(peekPage.getByText("참여자 모드", { exact: true })).toBeVisible()
  await expect(peekPage.getByRole("button", { name: /확정/ })).toHaveCount(0)
  await peekContext.close()

  // -------- 3. Participants register + manual input --------
  // Three independent contexts so cookies don't bleed across participants.
  // The manual-input UI is a When2Meet-style drag-paint grid: every cell
  // defaults to unselected (= busy). Helpers are "전체 가능" (select all) and
  // "전체 초기화" (clear). To express busy time we click "전체 가능" then
  // toggle off the cells we want to mark as busy.
  async function registerAndSubmit(
    nickname: string,
    deselectKeys: string[] = [],
  ): Promise<void> {
    const ctx = await browser.newContext()
    const p = await ctx.newPage()
    await p.goto(shareUrl)

    // Nickname form lives in JoinSection; the visible label is "닉네임".
    await p.locator("#nickname").fill(nickname)
    await p.getByRole("button", { name: "등록", exact: true }).click()

    // After register the AvailabilitySection appears with tabs.
    await expect(p.getByRole("tab", { name: "직접 입력" })).toBeVisible({ timeout: 10_000 })
    // Default tab is "직접 입력" / manual; assert + click defensively.
    await p.getByRole("tab", { name: "직접 입력" }).click()

    // Mode toggle defaults to timeline; switch to chip grid for deterministic test flow.
    await p.locator('[data-testid="mode-toggle-grid"]').click()
    await expect(p.locator('[data-testid="availability-grid"]')).toBeVisible({ timeout: 10_000 })
    await p.getByRole("button", { name: "전체 가능" }).click()
    for (const key of deselectKeys) {
      await p.locator(`[data-slot-key="${key}"]`).click()
    }

    await p.getByRole("button", { name: /가용 시간 저장/ }).click()
    await expect(p.getByText("가용 시간이 저장되었습니다.")).toBeVisible({ timeout: 10_000 })
    await ctx.close()
  }

  // 참여자A: one busy block on Monday 09:00-10:00 (two 30-min cells deselected)
  await registerAndSubmit("참여자A", [`${startDate}|09:00`, `${startDate}|09:30`])
  // 참여자B + C: fully available (no deselects)
  await registerAndSubmit("참여자B")
  await registerAndSubmit("참여자C")

  // -------- 4. Organizer calculates --------
  // Reload the organizer page so timetable refresh happens and stale state
  // doesn't bite us.
  await organizer.reload()
  await expect(organizer.getByText("주최자 모드", { exact: true })).toBeVisible()

  await organizer.getByRole("button", { name: /후보 시간 계산/ }).click()
  // At least one candidate card should render. Spec expects up to 3.
  // CandidateList sets aria-label="후보 N 확정" on each button (visible text
  // is "이 시간으로 확정"). Match the aria-label pattern.
  const candidateConfirmButtons = organizer.getByRole("button", {
    name: /^후보 \d+ 확정$/,
  })
  await expect(candidateConfirmButtons.first()).toBeVisible({ timeout: 15_000 })
  const candidateCount = await candidateConfirmButtons.count()
  expect(candidateCount).toBeGreaterThan(0)
  expect(candidateCount).toBeLessThanOrEqual(3)

  // Sanity: share-mode page (no organizer token) must NOT render the confirm
  // button even AFTER candidates exist.
  const peek2Ctx = await browser.newContext()
  const peek2 = await peek2Ctx.newPage()
  await peek2.goto(shareUrl)
  await peek2.getByRole("button", { name: /후보 시간 계산/ }).click()
  await peek2.waitForTimeout(1500)
  await expect(peek2.getByRole("button", { name: /^후보 \d+ 확정$/ })).toHaveCount(0)
  await peek2Ctx.close()

  // -------- 5. Confirm first candidate -> share message dialog --------
  // Clipboard stub already installed via context.addInitScript.
  await candidateConfirmButtons.first().click()

  // Dialog appears.
  const dialogTitle = organizer.locator("#share-message-title")
  await expect(dialogTitle).toBeVisible({ timeout: 15_000 })
  await expect(dialogTitle).toHaveText("확정 안내 메시지 초안")
  // Textarea contains the share_message_draft. With LLM_PROVIDER=template
  // we expect a deterministic format starting with the meeting title.
  const textarea = organizer.locator('textarea[readonly]')
  await expect(textarea).toBeVisible()
  const message = await textarea.inputValue()
  expect(message.trim().length).toBeGreaterThan(0)
  expect(message).toContain("팀 회의")
  // Privacy guard mirror of S11 — no event content words from busy_blocks.
  // Our manual blocks have no titles, but assert the expected vocabulary
  // is absent for safety.
  expect(message).not.toMatch(/병원|진료|데이트|secret/i)

  // Click copy button -> clipboard stub should receive the message.
  await organizer.getByRole("button", { name: "메시지 복사" }).click()
  // Either the success toast appears OR the stub captured the message.
  await expect(
    organizer.locator("text=메시지가 복사되었습니다."),
  ).toBeVisible({ timeout: 5_000 })
  const copied = await organizer.evaluate(
    () => (window as unknown as { __lastClipboardWrite?: string }).__lastClipboardWrite,
  )
  expect(copied ?? "").toContain("팀 회의")

  // Close dialog.
  await organizer.getByRole("button", { name: "닫기" }).click()

  // Bookkeeping: slug should appear on the page header.
  await expect(organizer.getByText(`slug: ${slug}`)).toBeVisible()

  await organizerContext.close()
})
