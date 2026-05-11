// Cell-math helpers for the When2Meet-style availability grid.
// Single source of truth: AvailabilityGrid and ManualAvailabilityForm both depend on these.
//
// Cell key format: "YYYY-MM-DD|HH:MM" — each cell represents a 30-min slot starting at that time.

import type { MeetingDetail } from "./types"
import { buildKstIso } from "./datetime"

const SLOT_MINUTES = 30

// #57 — time_window 입력이 제거되어 모든 회의의 가용 시간 축은 06:00 ~ 24:00 으로 고정.
// 마지막 슬롯은 23:30 시작 (end exclusive).
export const WINDOW_START = "06:00"
export const WINDOW_END = "24:00"

const KST_WEEKDAY_FORMATTER = new Intl.DateTimeFormat("ko-KR", {
  timeZone: "Asia/Seoul",
  weekday: "short",
})

// Trim "HH:MM:SS" -> "HH:MM" defensively. Backend may return either form.
function normalizeHHMM(time: string): string {
  if (!time) return ""
  return time.length >= 5 ? time.slice(0, 5) : time
}

function parseHHMMToMinutes(time: string): number {
  const t = normalizeHHMM(time)
  const [hh, mm] = t.split(":").map((s) => Number.parseInt(s, 10))
  return hh * 60 + mm
}

function minutesToHHMM(total: number): string {
  const hh = Math.floor(total / 60)
  const mm = total % 60
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`
}

// Iterate dates in [start, end] inclusive as YYYY-MM-DD strings.
// We treat the date strings as plain calendar dates (no timezone math) to avoid drift.
function enumerateDates(startIso: string, endIso: string): string[] {
  const out: string[] = []
  const start = new Date(`${startIso}T00:00:00Z`)
  const end = new Date(`${endIso}T00:00:00Z`)
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return out
  const cursor = new Date(start)
  while (cursor.getTime() <= end.getTime()) {
    const y = cursor.getUTCFullYear()
    const m = String(cursor.getUTCMonth() + 1).padStart(2, "0")
    const d = String(cursor.getUTCDate()).padStart(2, "0")
    out.push(`${y}-${m}-${d}`)
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }
  return out
}

// Day-of-week from a YYYY-MM-DD string. 0=Sun, 6=Sat. Anchored at UTC midnight to avoid TZ drift.
function getDayOfWeek(dateIso: string): number {
  return new Date(`${dateIso}T00:00:00Z`).getUTCDay()
}

export function getMeetingDates(meeting: MeetingDetail): string[] {
  // Spec §5.1 / §7: date_mode == "picked" -> use candidate_dates verbatim, ignore include_weekends.
  if (meeting.date_mode === "picked") {
    return [...(meeting.candidate_dates ?? [])].sort()
  }
  if (!meeting.date_range_start || !meeting.date_range_end) return []
  const all = enumerateDates(meeting.date_range_start, meeting.date_range_end)
  if (meeting.include_weekends) return all
  return all.filter((d) => {
    const dow = getDayOfWeek(d)
    return dow !== 0 && dow !== 6
  })
}

// #57 — 회의 가용 시간 축은 fixed window (WINDOW_START~WINDOW_END). meeting 파라미터는
// 호환을 위해 유지하지만 사용하지 않음.
export function getMeetingTimes(_meeting: MeetingDetail): string[] {
  const startMin = parseHHMMToMinutes(WINDOW_START)
  const endMin = parseHHMMToMinutes(WINDOW_END)
  const out: string[] = []
  for (let m = startMin; m < endMin; m += SLOT_MINUTES) {
    out.push(minutesToHHMM(m))
  }
  return out
}

export function makeCellKey(dateIso: string, time: string): string {
  return `${dateIso}|${normalizeHHMM(time)}`
}

export function enumerateAllCells(meeting: MeetingDetail): string[] {
  const dates = getMeetingDates(meeting)
  const times = getMeetingTimes(meeting)
  const out: string[] = []
  for (const date of dates) {
    for (const time of times) {
      out.push(makeCellKey(date, time))
    }
  }
  return out
}

interface BusyBlock {
  start: string
  end: string
}

// Group keys by date, sort by time, fold consecutive 30-min slots into ranges.
// End is the exclusive boundary (the next slot's start time).
export function mergeBusyBlocks(busyKeys: string[]): BusyBlock[] {
  if (busyKeys.length === 0) return []

  const byDate = new Map<string, number[]>()
  for (const key of busyKeys) {
    const [date, time] = key.split("|")
    if (!date || !time) continue
    const minutes = parseHHMMToMinutes(time)
    const bucket = byDate.get(date)
    if (bucket) {
      bucket.push(minutes)
    } else {
      byDate.set(date, [minutes])
    }
  }

  // Sort dates so output is deterministic.
  const sortedDates = Array.from(byDate.keys()).sort()

  const blocks: BusyBlock[] = []
  for (const date of sortedDates) {
    const minutes = (byDate.get(date) ?? []).slice().sort((a, b) => a - b)
    if (minutes.length === 0) continue

    let runStart = minutes[0]
    let prev = minutes[0]
    for (let i = 1; i < minutes.length; i += 1) {
      const cur = minutes[i]
      if (cur === prev + SLOT_MINUTES) {
        prev = cur
        continue
      }
      // Close the current run.
      const endMin = prev + SLOT_MINUTES
      blocks.push({
        start: buildKstIso(date, minutesToHHMM(runStart)),
        end: buildKstIso(date, minutesToHHMM(endMin)),
      })
      runStart = cur
      prev = cur
    }
    // Close the final run.
    const endMin = prev + SLOT_MINUTES
    blocks.push({
      start: buildKstIso(date, minutesToHHMM(runStart)),
      end: buildKstIso(date, minutesToHHMM(endMin)),
    })
  }

  return blocks
}

// "5/12 (화)"
export function formatDateLabel(dateIso: string): string {
  const d = new Date(`${dateIso}T00:00:00+09:00`)
  if (Number.isNaN(d.getTime())) return dateIso
  // Month/day from the original ISO string to avoid TZ drift.
  const [, m, day] = dateIso.split("-")
  const month = Number.parseInt(m, 10)
  const dayNum = Number.parseInt(day, 10)
  const weekday = KST_WEEKDAY_FORMATTER.format(d)
  return `${month}/${dayNum} (${weekday})`
}

// Helper for time-column labels. Returns true when this row sits on the hour mark.
export function isOnHour(time: string): boolean {
  const [, mm] = normalizeHHMM(time).split(":")
  return mm === "00"
}

// Range = continuous block of selected 30-min slots within a single date.
// startMin/endMin are minutes-since-midnight (in KST naive). End is exclusive.
export interface DayRange {
  date: string
  startMin: number
  endMin: number
}

// Convert "HH:MM" -> minutes since midnight.
export function timeToMinutes(time: string): number {
  return parseHHMMToMinutes(time)
}

// Convert minutes since midnight -> "HH:MM".
export function minutesToTime(total: number): string {
  return minutesToHHMM(total)
}

// Group selected cell keys into per-date contiguous ranges (start inclusive, end exclusive).
export function cellsToRanges(value: Set<string>): DayRange[] {
  if (value.size === 0) return []

  const byDate = new Map<string, number[]>()
  for (const key of value) {
    const [date, time] = key.split("|")
    if (!date || !time) continue
    const minutes = parseHHMMToMinutes(time)
    const bucket = byDate.get(date)
    if (bucket) {
      bucket.push(minutes)
    } else {
      byDate.set(date, [minutes])
    }
  }

  const ranges: DayRange[] = []
  const sortedDates = Array.from(byDate.keys()).sort()
  for (const date of sortedDates) {
    const minutes = (byDate.get(date) ?? []).slice().sort((a, b) => a - b)
    if (minutes.length === 0) continue
    let runStart = minutes[0]
    let prev = minutes[0]
    for (let i = 1; i < minutes.length; i += 1) {
      const cur = minutes[i]
      if (cur === prev + SLOT_MINUTES) {
        prev = cur
        continue
      }
      ranges.push({ date, startMin: runStart, endMin: prev + SLOT_MINUTES })
      runStart = cur
      prev = cur
    }
    ranges.push({ date, startMin: runStart, endMin: prev + SLOT_MINUTES })
  }
  return ranges
}

// Expand a [startMin, endMin) range into the set of 30-min slot cell keys it covers.
export function rangeToCellKeys(date: string, startMin: number, endMin: number): string[] {
  if (endMin <= startMin) return []
  const out: string[] = []
  const snappedStart = Math.floor(startMin / SLOT_MINUTES) * SLOT_MINUTES
  const snappedEnd = Math.ceil(endMin / SLOT_MINUTES) * SLOT_MINUTES
  for (let m = snappedStart; m < snappedEnd; m += SLOT_MINUTES) {
    out.push(makeCellKey(date, minutesToHHMM(m)))
  }
  return out
}

// v3.6 — derive the "selected (= available)" cell set from a participant's
// busy_blocks. selected = allCells - busyCells. Cells that fall partially outside
// any busy_block remain selected. Used to pre-fill ManualAvailabilityForm.
export function selectedFromBusyBlocks(
  meeting: MeetingDetail,
  blocks: { start: string; end: string }[],
): Set<string> {
  const all = enumerateAllCells(meeting)
  if (blocks.length === 0) return new Set(all)
  const busy = new Set<string>()
  for (const b of blocks) {
    // Backend returns KST ISO with "+09:00" or naive — both forms parse to a Date.
    const start = new Date(b.start)
    const end = new Date(b.end)
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) continue
    // Walk in 30-min steps and mark each KST date+time cell.
    const cursor = new Date(start)
    while (cursor.getTime() < end.getTime()) {
      const kstDate = cursor.toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" })
      // en-CA gives YYYY-MM-DD which is what we use as the cell-date key.
      const kstTime = cursor.toLocaleTimeString("en-GB", {
        timeZone: "Asia/Seoul",
        hour12: false,
        hour: "2-digit",
        minute: "2-digit",
      })
      busy.add(makeCellKey(kstDate, kstTime))
      cursor.setMinutes(cursor.getMinutes() + SLOT_MINUTES)
    }
  }
  const selected = new Set<string>()
  for (const k of all) {
    if (!busy.has(k)) selected.add(k)
  }
  return selected
}

// Compact two-line label: e.g. "5/12" + "화"
export function formatDateLabelTwoLine(dateIso: string): { dayMonth: string; weekday: string } {
  const [, m, day] = dateIso.split("-")
  const month = Number.parseInt(m, 10)
  const dayNum = Number.parseInt(day, 10)
  const d = new Date(`${dateIso}T00:00:00+09:00`)
  const weekday = Number.isNaN(d.getTime()) ? "" : KST_WEEKDAY_FORMATTER.format(d)
  return { dayMonth: `${month}/${dayNum}`, weekday }
}
