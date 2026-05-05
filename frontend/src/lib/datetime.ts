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
  const safeTime = timeStr.length === 5 ? `${timeStr}:00` : timeStr
  return `${dateStr}T${safeTime}+09:00`
}
