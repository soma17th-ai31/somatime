/**
 * E1 — Browser Golden Path (Playwright). v3.2 (2026-05-06 Path B).
 *
 * Source: 기획서/구현_위임_스펙.md §10 "E1. 브라우저 골든패스" — 13 numbered steps,
 * adapted for the v3.2 product simplification:
 *
 *   - "참여 인원 (target)" 입력 폼에서 제거 — step "fill #participant_count" 삭제.
 *   - "주최자 모드 / 참여자 모드" pill UI 제거 — 해당 텍스트 단언 제거.
 *   - v3.2 Path B: organizer_token / organizer URL 자체가 제거됨. 결과 화면에는
 *     share URL 하나만 표시되고, 시크릿 창에서도 "확정" 버튼이 노출됨 (사고
 *     방지는 ShareMessageDialog 의 2단계 게이트가 흡수).
 *   - 게이팅: submitted_count >= 1 일 때 활성화. step 8 = 0명 disabled,
 *     step 9 = 첫 1명 제출 직후 "결과 보기" 활성 검증.
 *
 *   1.  / 접속 -> 회의 생성 폼
 *   2.  날짜 선택: "범위" / "개별 선택" 두 모드 동작 (Q5)
 *   3.  장소: online / offline / 상관없음 segmented control (Q6),
 *       offline/any 선택 시 버퍼 30/60/90/120 select 노출 (Q8)
 *   4.  생성 -> 결과 화면에 share URL 하나 + QR
 *   5.  공유 링크 시크릿 창 -> 정상 노출 (v3.2 Path B: 확정 버튼은 항상 노출)
 *   6.  닉네임 등록 시 PIN 4자리 optional 입력 (Q7)
 *   7.  manual 입력 -> 제출
 *   8.  0명 제출 상태 -> "결과 보기"/"추천받기" disabled
 *   9.  첫 1명 제출 직후 -> "결과 보기" 활성 -> 클릭 -> deterministic 후보 (LLM 호출 X)
 *   10. "추천받기" -> LLM 호출 1회 -> 후보별 reason + share_message_draft 표시
 *   11. 첫 후보 선택 -> 메시지 초안 모달 -> 복사 버튼
 *   12. 확정 -> /confirm 호출 (LLM 호출 X)
 *   13. 타임테이블 가로 레이아웃 검증 — 날짜 row, 시간 column
 *
 * Determinism notes
 * - LLM_PROVIDER is forced to `template` for the backend webServer
 *   (see playwright.config.ts) so the share message format is stable AND no
 *   external API is called.
 * - Meeting dates are scheduled into the next Mon..Fri window relative to the
 *   test run. The slot calculator works on KST-naive datetimes so this is
 *   safe regardless of the runner's local TZ.
 * - The new CreateMeetingPage uses react-day-picker (not <input type="date">),
 *   so we click day buttons by their Korean aria-label and advance months via
 *   "Next month" until the target month is rendered.
 * - Clipboard: stub on `navigator.clipboard` because headless Chromium often
 *   blocks real clipboard access.
 */
import { test, expect, type Page } from "@playwright/test"

// --------------------------------------------------------------------------- helpers

function pad(n: number): string {
  return n < 10 ? `0${n}` : `${n}`
}

function fmtIso(d: Date): string {
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

const KO_MONTHS = [
  "1월",
  "2월",
  "3월",
  "4월",
  "5월",
  "6월",
  "7월",
  "8월",
  "9월",
  "10월",
  "11월",
  "12월",
]

/**
 * Advance the day-picker (rdp) calendar inside `pickerLocator` until its
 * caption reflects the target year/month, then click the target day button.
 *
 * react-day-picker v9 (Korean locale, format "PPPP") renders day buttons
 * whose aria-label looks like "2026년 5월 11일 월요일". Outside-month days
 * carry the modifier class `rdp-outside` on their <td> ancestor.
 */
async function clickRdpDate(
  page: Page,
  pickerTestId: "date-range-picker" | "date-picked-picker",
  target: Date,
): Promise<void> {
  const picker = page.locator(`[data-testid="${pickerTestId}"]`)
  await expect(picker).toBeVisible({ timeout: 5_000 })

  const targetYear = target.getFullYear()
  const targetMonthLabel = `${targetYear}년 ${KO_MONTHS[target.getMonth()]}`

  // Advance calendar up to 18 months (well over any plausible window).
  // v4 — Calendar wrapper overrides react-day-picker's default `rdp-*` classes
  // so we read the caption via the live region (role="status") that v9 keeps
  // for screen readers, plus the grid's aria-label as a fallback.
  for (let i = 0; i < 18; i++) {
    const captionFromStatus = await picker
      .getByRole("status")
      .first()
      .innerText()
      .catch(() => "")
    const captionFromGrid = await picker
      .getByRole("grid")
      .first()
      .getAttribute("aria-label")
      .catch(() => null)
    const captionText = `${captionFromStatus} ${captionFromGrid ?? ""}`
    if (captionText.replace(/\s+/g, " ").includes(targetMonthLabel)) break

    const next = picker.getByRole("button", { name: /다음|Next/i }).first()
    await next.click()
  }

  // Match by the full Korean aria-label so we don't accidentally pick an
  // outside-month day with the same date number.
  const labelExact = `${targetYear}년 ${KO_MONTHS[target.getMonth()]} ${target.getDate()}일`
  const dayBtn = picker
    .getByRole("button", { name: new RegExp(labelExact.replace(/\s/g, "\\s+")) })
    .first()
  await expect(dayBtn).toBeVisible({ timeout: 5_000 })
  await dayBtn.click()
}

// --------------------------------------------------------------------------- test

test.describe.configure({ mode: "serial" })

test("E1: full flow from creation through confirm in template-LLM mode", async ({
  browser,
}) => {
  // -------- date math (next Monday..Friday) --------
  const monday = nextMonday()
  const friday = plusDays(monday, 4)
  const startDate = fmtIso(monday)
  const endDate = fmtIso(friday)

  // -------- step 1 + 2 + 3: load home, fill form, exercise date-mode tabs + location segmented + buffer --------
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
  // v4 redesign: page h1 is "회의 만들기"; "SomaMeet" lives in the TopBar wordmark.
  await expect(organizer.getByRole("heading", { name: "회의 만들기" })).toBeVisible()

  await organizer.locator("#title").fill("팀 회의")

  // Step 2 — exercise both date-mode tabs. Open "개별 선택" first to verify it
  // renders, then come back to "범위" before picking the actual range.
  await organizer.getByRole("tab", { name: "개별 선택" }).click()
  await expect(organizer.locator('[data-testid="date-picked-picker"]')).toBeVisible()
  await organizer.getByRole("tab", { name: "범위" }).click()
  await expect(organizer.locator('[data-testid="date-range-picker"]')).toBeVisible()

  // Pick start (Mon) then end (Fri) on the range picker.
  await clickRdpDate(organizer, "date-range-picker", monday)
  await clickRdpDate(organizer, "date-range-picker", friday)

  // duration: 60min via segmented testid (v4 redesign — native select replaced
  // by a segmented control for visual consistency with location/period-mode).
  await organizer.locator('[data-testid="duration-60"]').click()

  // Step 3 — segmented location control. v3 follow-up: 회의 전체 buffer 가
  // 제거되어 location 변경만 exercise. 개인 buffer 는 회의 페이지에서 따로 처리.
  await organizer.locator('[data-testid="location-online"]').click()
  await organizer.locator('[data-testid="location-any"]').click()
  await organizer.locator('[data-testid="location-offline"]').click()

  // Submit
  await organizer.locator('[data-testid="create-submit"]').click()

  // -------- step 4: v3.3 — submit redirects straight to /m/{slug} --------
  await organizer.waitForURL(/\/m\/[^?\/]+$/, { timeout: 15_000 })
  const currentUrl = organizer.url()
  // v3.2 Path B: URL has no ?org= organizer token query string.
  expect(currentUrl).not.toContain("?org=")
  const slugMatch = currentUrl.match(/\/m\/([^?\/]+)/)
  expect(slugMatch).not.toBeNull()
  const slug = slugMatch![1]
  // The share URL is the URL bar itself.
  const shareUrl = currentUrl
  // v4 Phase F follow-up: until joined, the page renders only JoinSection.
  // Verify the join form is presented (no MeetingSummary yet).
  await expect(organizer.locator('[data-testid="join-form"]')).toBeVisible()

  // Organizer registers themselves as a participant so the full meeting UI
  // (MeetingSummary + result buttons) is unlocked for the rest of the test.
  await organizer.locator('[data-testid="join-nickname"]').fill("주최자")
  await organizer.locator('[data-testid="join-pin"]').fill("9999")
  await organizer.locator('[data-testid="join-submit"]').click()
  await expect(organizer.locator('[data-testid="meeting-summary"]')).toBeVisible()

  // -------- step 5: shared URL in incognito context -> page loads (Path B) --------
  // v3.2 Path B: pick / 확정 buttons are intentionally available everywhere —
  // anyone with the share URL can confirm. The accident safeguard is the
  // 2-step ShareMessageDialog itself. In v4 Phase F, an unjoined visitor only
  // sees JoinSection (full UI gated), so we assert that here.
  const peekContext = await browser.newContext()
  const peek = await peekContext.newPage()
  await peek.goto(shareUrl)
  await expect(peek.locator('[data-testid="join-form"]')).toBeVisible()
  await peekContext.close()

  // -------- step 6 + 7: three participants register (with optional PIN) and submit manual --------
  // Three independent contexts so cookies don't bleed across participants.
  // Manual grid: every cell defaults to unselected (= busy). We use the helper
  // "전체 가능" to mark all available, then optionally toggle a cell off.
  async function registerAndSubmit(
    nickname: string,
    opts: { pin?: string; deselectKeys?: string[] } = {},
  ): Promise<void> {
    const ctx = await browser.newContext()
    const p = await ctx.newPage()
    await p.goto(shareUrl)

    // Step 6 — JoinSection. v4 Phase F: PIN is now required (4-digit).
    // Buffer dropdown removed — JoinSection sends a default (60min for
    // offline/any meetings) automatically; users adjust via SelfCard chips
    // after joining.
    await p.locator('[data-testid="join-nickname"]').fill(nickname)
    await p.locator('[data-testid="join-pin"]').fill(opts.pin ?? "1111")
    await p.locator('[data-testid="join-submit"]').click()

    // Step 7 — AvailabilitySection appears with tabs.
    await expect(p.getByRole("tab", { name: "직접 입력" })).toBeVisible({ timeout: 10_000 })
    await p.getByRole("tab", { name: "직접 입력" }).click()

    // Mode toggle defaults to timeline; switch to chip grid for deterministic flow.
    await p.locator('[data-testid="mode-toggle-grid"]').click()
    await expect(p.locator('[data-testid="availability-grid"]')).toBeVisible({ timeout: 10_000 })

    const firstDateToggle = p.locator(`[data-testid="date-toggle-${startDate}"]`)
    await firstDateToggle.click()
    await expect(firstDateToggle).toHaveAttribute("aria-pressed", "true")
    await expect(p.locator(`[data-slot-key="${startDate}|09:00"]`)).toHaveAttribute(
      "aria-pressed",
      "true",
    )
    await expect(p.locator(`[data-slot-key="${startDate}|21:30"]`)).toHaveAttribute(
      "aria-pressed",
      "true",
    )
    await firstDateToggle.click()
    await expect(firstDateToggle).toHaveAttribute("aria-pressed", "false")
    await expect(p.locator(`[data-slot-key="${startDate}|09:00"]`)).toHaveAttribute(
      "aria-pressed",
      "false",
    )

    await p.getByRole("button", { name: "전체 가능" }).click()
    for (const key of opts.deselectKeys ?? []) {
      await p.locator(`[data-slot-key="${key}"]`).click()
    }

    await p.locator('[data-testid="manual-submit"]').click()
    await expect(p.getByText("가용 시간이 저장되었습니다.")).toBeVisible({ timeout: 10_000 })
    await ctx.close()
  }

  // -------- step 8: zero submissions -> result buttons disabled --------
  // v3.1: gate flips on submitted_count >= 1, so the relevant disabled state
  // is "0명 제출 완료" (no submissions yet), NOT "1/3 disabled" as in v3.
  await organizer.reload()
  await expect(organizer.locator('[data-testid="meeting-summary"]')).toBeVisible()
  await expect(organizer.locator('[data-testid="progress-text"]')).toContainText("0")
  await expect(organizer.locator('[data-testid="progress-text"]')).toContainText("제출 완료")
  await expect(organizer.locator('[data-testid="calculate-button"]')).toBeDisabled()
  await expect(organizer.locator('[data-testid="recommend-button"]')).toBeDisabled()

  // Participant A — opt-in PIN 1234, one busy slot Mon 09:00-10:00 (two cells deselected).
  await registerAndSubmit("참여자A", {
    pin: "1234",
    deselectKeys: [`${startDate}|09:00`, `${startDate}|09:30`],
  })

  // -------- step 9: first submission -> result buttons unlocked --------
  // After the very first /availability/manual submit, is_ready_to_calculate
  // flips to true and "결과 보기" must enable. Submit B + C as well so the
  // heat map / deterministic ranking has multi-participant signal.
  await registerAndSubmit("참여자B")
  await registerAndSubmit("참여자C")

  await organizer.reload()
  await expect(organizer.locator('[data-testid="meeting-summary"]')).toBeVisible()
  await expect(organizer.locator('[data-testid="progress-text"]')).toContainText("3")
  await expect(organizer.locator('[data-testid="calculate-button"]')).toBeEnabled({
    timeout: 5_000,
  })

  await organizer.locator('[data-testid="calculate-button"]').click()

  // /calculate is deterministic: candidate cards appear, but with NO reason
  // (LLM doesn't run here in v3) and no draft preview block.
  const candidateConfirmButtons = organizer.locator(
    '[data-testid^="candidate-"][data-testid$="-pick"]',
  )
  await expect(candidateConfirmButtons.first()).toBeVisible({ timeout: 15_000 })
  const calcCount = await candidateConfirmButtons.count()
  expect(calcCount).toBeGreaterThan(0)
  expect(calcCount).toBeLessThanOrEqual(3)
  // No "이유:" line on the deterministic path.
  await expect(organizer.getByText(/^이유:/)).toHaveCount(0)

  // -------- step 10: recommend -> reasons + share_message_draft populated --------
  await organizer.locator('[data-testid="recommend-button"]').click()
  // After /recommend the candidates re-render WITH draft + reason.
  await expect(organizer.getByText("공지 메시지 초안").first()).toBeVisible({
    timeout: 15_000,
  })
  // At least one candidate has a non-empty reason.
  await expect(organizer.getByText(/이유:/).first()).toBeVisible()

  // -------- step 11: pick first candidate -> share dialog shows draft --------
  const recCandidateButtons = organizer.locator(
    '[data-testid^="candidate-"][data-testid$="-pick"]',
  )
  await recCandidateButtons.first().click()

  const dialogTitle = organizer.locator("#share-message-title")
  await expect(dialogTitle).toBeVisible({ timeout: 15_000 })
  // Pre-confirm dialog title — see ShareMessageDialog (readOnly=false).
  await expect(dialogTitle).toHaveText("메시지 확인 후 확정")

  const textarea = organizer.locator('[data-testid="share-draft-textarea"]')
  await expect(textarea).toBeVisible()
  const message = await textarea.inputValue()
  expect(message.trim().length).toBeGreaterThan(0)
  expect(message).toContain("팀 회의")
  // Privacy: the manual blocks have no titles, but assert the canonical
  // forbidden vocabulary is absent regardless.
  expect(message).not.toMatch(/병원|진료|데이트/)

  // Copy button -> clipboard stub captures the message.
  await organizer.getByRole("button", { name: "메시지 복사" }).click()
  await expect(organizer.locator("text=메시지가 복사되었습니다.")).toBeVisible({
    timeout: 5_000,
  })
  const copied = await organizer.evaluate(
    () => (window as unknown as { __lastClipboardWrite?: string }).__lastClipboardWrite,
  )
  expect(copied ?? "").toContain("팀 회의")

  // -------- step 12: 확정 button -> /confirm round-trip --------
  await organizer.locator('[data-testid="share-confirm"]').click()

  // Read-only dialog appears post-confirm with title "확정 안내 메시지".
  // ShareMessageDialog renders the same #share-message-title id; wait for the
  // text to flip from pre-confirm to post-confirm.
  await expect(dialogTitle).toHaveText("확정 안내 메시지", { timeout: 15_000 })

  // Close dialog. v4 Phase E — redesigned modals add an icon-only X button
  // with aria-label="<context> 창 닫기" alongside the footer "닫기" text
  // button, so we need exact-match to avoid strict-mode collisions.
  await organizer.getByRole("button", { name: "닫기", exact: true }).click()

  // -------- step 13: timetable horizontal layout — date row, time column --------
  // Timetable component renders with data-testid="timetable-horizontal".
  const timetable = organizer.locator('[data-testid="timetable-horizontal"]')
  await expect(timetable).toBeVisible()

  // v3.17 verification: at least one timetable cell should be a merged run
  // spanning >1 row (gridRow style contains "span N" where N > 1).
  const mergedCount = await organizer.evaluate(() => {
    const cells = document.querySelectorAll('[role="gridcell"]')
    let merged = 0
    for (const cell of cells) {
      const gr = (cell as HTMLElement).style.gridRow || ""
      const m = gr.match(/span\s+(\d+)/)
      if (m && Number(m[1]) > 1) merged++
    }
    return merged
  })
  expect(mergedCount).toBeGreaterThan(0)

  // Capture a visual screenshot of the timetable for human review.
  await timetable.screenshot({ path: "test-results/timetable-merged.png" })

  // Bookkeeping: slug visible on header for debug clarity.
  await expect(organizer.getByText(`slug: ${slug}`)).toBeVisible()

  await organizerContext.close()
})
