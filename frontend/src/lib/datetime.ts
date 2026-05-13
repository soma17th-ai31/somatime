// Asia/Seoul timezone helpers. Backend returns ISO 8601 strings with +09:00 offset.

const KST_FORMATTER = new Intl.DateTimeFormat("ko-KR", {
  timeZone: "Asia/Seoul",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
})

const KST_DATE_FORMATTER = new Intl.DateTimeFormat("ko-KR", {
  timeZone: "Asia/Seoul",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
})

const KST_TIME_FORMATTER = new Intl.DateTimeFormat("ko-KR", {
  timeZone: "Asia/Seoul",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
})

const KST_WEEKDAY_FORMATTER = new Intl.DateTimeFormat("ko-KR", {
  timeZone: "Asia/Seoul",
  weekday: "short",
})

export function formatKstDateTime(iso: string): string {
  return KST_FORMATTER.format(new Date(iso))
}

export function formatKstDate(iso: string): string {
  return KST_DATE_FORMATTER.format(new Date(iso))
}

// Returns the KST calendar date of an ISO timestamp as "YYYY-MM-DD".
// Suitable as input to availabilityCells.formatDateLabel.
export function kstDateKey(iso: string): string {
  return new Date(iso).toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" })
}

export function formatKstTime(iso: string): string {
  return KST_TIME_FORMATTER.format(new Date(iso))
}

export function formatKstWeekday(iso: string): string {
  return KST_WEEKDAY_FORMATTER.format(new Date(iso))
}

export function formatKstRange(startIso: string, endIso: string): string {
  const startDate = formatKstDate(startIso)
  const startTime = formatKstTime(startIso)
  const endTime = formatKstTime(endIso)
  const weekday = formatKstWeekday(startIso)
  return `${startDate} (${weekday}) ${startTime} - ${endTime} KST`
}

// Build a KST-anchored ISO string from a YYYY-MM-DD date and HH:MM time entered by the user.
export function buildKstIso(dateStr: string, timeStr: string): string {
  if (!dateStr || !timeStr) return ""
  const parts = timeStr.split(":").map((part) => Number.parseInt(part, 10))
  const [hour, minute = 0, second = 0] = parts
  const fallbackTime = timeStr.length === 5 ? `${timeStr}:00` : timeStr
  if (hour === undefined || [hour, minute, second].some((part) => Number.isNaN(part))) {
    return `${dateStr}T${fallbackTime}+09:00`
  }

  const date = new Date(`${dateStr}T00:00:00Z`)
  if (Number.isNaN(date.getTime())) return `${dateStr}T${fallbackTime}+09:00`

  const totalSeconds = hour * 3600 + minute * 60 + second
  const dayOffset = Math.floor(totalSeconds / 86400)
  const secondsInDay = totalSeconds % 86400
  date.setUTCDate(date.getUTCDate() + dayOffset)

  const y = date.getUTCFullYear()
  const m = String(date.getUTCMonth() + 1).padStart(2, "0")
  const d = String(date.getUTCDate()).padStart(2, "0")
  const hh = String(Math.floor(secondsInDay / 3600)).padStart(2, "0")
  const mm = String(Math.floor((secondsInDay % 3600) / 60)).padStart(2, "0")
  const ss = String(secondsInDay % 60).padStart(2, "0")
  return `${y}-${m}-${d}T${hh}:${mm}:${ss}+09:00`
}

// #32 — 회의 자동 삭제 예정 안내 텍스트 생성.
// 결과 텍스트는 KST 캘린더 기준 월/일 + 남은 시간 단위 변환을 결합한다.
//   - 1일 이상: "5/15 자동 삭제 (3일 후)"
//   - 1~24시간: "5/12 자동 삭제 (5시간 후)" (isUrgent=true)
//   - 1~60분: "5/12 자동 삭제 (45분 후)" (isUrgent=true)
//   - 0~1분: "5/12 자동 삭제 (곧)" (isUrgent=true)
//   - 음수: "만료됨" (isUrgent=true)
// 두 번째 인자 `now` 는 단위 테스트 편의를 위한 주입점 (default Date.now()).
export function formatExpiryNotice(
  expiresAt: string | Date,
  now: Date = new Date(),
): { text: string; isUrgent: boolean } {
  const expiry = typeof expiresAt === "string" ? new Date(expiresAt) : expiresAt
  if (Number.isNaN(expiry.getTime())) {
    return { text: "", isUrgent: false }
  }
  const diffMs = expiry.getTime() - now.getTime()
  if (diffMs <= 0) {
    return { text: "만료됨", isUrgent: true }
  }
  // KST 캘린더 월/일 — "YYYY-MM-DD" 에서 month/day 추출.
  const expiryIso = typeof expiresAt === "string" ? expiresAt : expiry.toISOString()
  const [, mStr, dStr] = kstDateKey(expiryIso).split("-")
  const monthDay = `${Number.parseInt(mStr, 10)}/${Number.parseInt(dStr, 10)}`

  const diffMinutes = Math.floor(diffMs / 60_000)
  const diffHours = Math.floor(diffMs / 3_600_000)
  const diffDays = Math.floor(diffMs / 86_400_000)

  let remaining: string
  let isUrgent: boolean
  if (diffDays >= 1) {
    remaining = `${diffDays}일 후`
    isUrgent = false
  } else if (diffHours >= 1) {
    remaining = `${diffHours}시간 후`
    isUrgent = true
  } else if (diffMinutes >= 1) {
    remaining = `${diffMinutes}분 후`
    isUrgent = true
  } else {
    remaining = "곧"
    isUrgent = true
  }
  return { text: `${monthDay} 자동 삭제 (${remaining})`, isUrgent }
}
