// Read-only heatmap (calendar/vertical variant).
// v3.4: rows = 30-min times, columns = dates (구글 캘린더 주간 뷰처럼).
// v3.17: contiguous same-count cells render as a single grid item that spans
//        N rows via `grid-row: ... / span N`. Empty (count=0) and missing cells
//        are 1-row items. The CSS-Grid `gap-y-1` puts a 4 px gap between any
//        two adjacent items but is consumed inside multi-row spans, so a merged
//        run reads as one solid block with no internal gaps. No margin tricks.

import { useMemo } from "react"
import type { TimetableSlot } from "@/lib/types"
import { formatKstTime, kstDateKey } from "@/lib/datetime"
import { formatDateLabel, isOnHour } from "@/lib/availabilityCells"
import { cn } from "@/lib/cn"

interface TimetableProps {
  slots: TimetableSlot[]
  participantCount: number
}

// Tailwind v3 + hex CSS-var primary doesn't compose `bg-primary/<alpha>` reliably,
// so we drive the heatmap opacity via inline rgba (primary = #5e6ad2 = rgb(94,106,210)).
function intensityStyle(count: number, total: number): React.CSSProperties {
  if (count <= 0) return {}
  const ratio = total > 0 ? Math.min(count / total, 1) : 1
  let alpha: number
  if (ratio >= 1) alpha = 1
  else if (ratio >= 0.67) alpha = 0.85
  else if (ratio >= 0.34) alpha = 0.7
  else alpha = 0.55
  return { backgroundColor: `rgba(94, 106, 210, ${alpha})` }
}

function intensityTextClass(count: number): string {
  if (count <= 0) return "text-muted-foreground/60"
  return "text-primary-foreground"
}

function makeKey(date: string, time: string): string {
  return `${date}|${time}`
}

interface Run {
  startIdx: number
  length: number
  // count = -1 means "no slot data at all" (rendered as faint card-bg block).
  // count = 0 means "everyone busy" (empty pill with border).
  // count > 0 means N people available; merged across consecutive same counts.
  count: number
  startSlot: TimetableSlot | undefined
  endSlot: TimetableSlot | undefined
  // Union of nicknames across the run (same count usually → same set, but
  // taking union defends against edge cases where the set differs).
  nicknames: string[]
}

function computeRuns(
  date: string,
  times: string[],
  slotByKey: Map<string, TimetableSlot>,
): Run[] {
  const out: Run[] = []
  let i = 0
  while (i < times.length) {
    const slot = slotByKey.get(makeKey(date, times[i]))
    if (!slot) {
      out.push({
        startIdx: i,
        length: 1,
        count: -1,
        startSlot: undefined,
        endSlot: undefined,
        nicknames: [],
      })
      i++
      continue
    }
    if (slot.available_count <= 0) {
      out.push({
        startIdx: i,
        length: 1,
        count: 0,
        startSlot: slot,
        endSlot: slot,
        nicknames: [],
      })
      i++
      continue
    }
    const runCount = slot.available_count
    const nameSet = new Set<string>(slot.available_nicknames)
    let j = i + 1
    let endSlot: TimetableSlot = slot
    while (j < times.length) {
      const s = slotByKey.get(makeKey(date, times[j]))
      if (!s || s.available_count !== runCount) break
      for (const n of s.available_nicknames) nameSet.add(n)
      endSlot = s
      j++
    }
    out.push({
      startIdx: i,
      length: j - i,
      count: runCount,
      startSlot: slot,
      endSlot,
      nicknames: Array.from(nameSet).sort(),
    })
    i = j
  }
  return out
}

export function Timetable({ slots, participantCount }: TimetableProps) {
  const { dates, times, slotByKey } = useMemo(() => {
    const dateSet = new Set<string>()
    const timeSet = new Set<string>()
    const lookup = new Map<string, TimetableSlot>()
    for (const slot of slots) {
      const date = kstDateKey(slot.start)
      const time = formatKstTime(slot.start)
      dateSet.add(date)
      timeSet.add(time)
      lookup.set(makeKey(date, time), slot)
    }
    const datesSorted = Array.from(dateSet).sort()
    const timesSorted = Array.from(timeSet).sort()
    return { dates: datesSorted, times: timesSorted, slotByKey: lookup }
  }, [slots])

  const datesRuns = useMemo(
    () => dates.map((date) => computeRuns(date, times, slotByKey)),
    [dates, times, slotByKey],
  )

  if (slots.length === 0 || dates.length === 0 || times.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        아직 입력된 가용 정보가 없습니다. 참여자가 일정을 제출하면 여기에 표시됩니다.
      </p>
    )
  }

  // Calendar-style: 64px time label column + N date columns. Explicit row
  // template so spans align across all date columns + the time-label column.
  const gridStyle: React.CSSProperties = {
    gridTemplateColumns: `64px repeat(${dates.length}, minmax(64px, 1fr))`,
    gridTemplateRows: `auto repeat(${times.length}, 24px)`,
  }

  return (
    <div className="space-y-3">
      <div
        className="max-h-[520px] overflow-auto rounded-xl border border-border bg-card p-2"
        data-testid="timetable-horizontal"
      >
        <div
          className="grid gap-x-1 gap-y-1 tabular-nums text-xs"
          style={gridStyle}
          role="grid"
          aria-label="가용 시간 히트맵"
        >
          {/* Top-left corner */}
          <div
            style={{ gridColumn: 1, gridRow: 1 }}
            className="sticky left-0 top-0 z-20 bg-card"
          />

          {/* Date headers (sticky top) */}
          {dates.map((date, dIdx) => (
            <div
              key={`th-${date}`}
              style={{ gridColumn: dIdx + 2, gridRow: 1 }}
              className="sticky top-0 z-10 bg-card px-1 py-2 text-center text-[11px] font-semibold text-foreground"
            >
              {formatDateLabel(date)}
            </div>
          ))}

          {/* Time labels column (sticky left) — one per row, 1-row spans */}
          {times.map((time, tIdx) => (
            <div
              key={`tl-${time}`}
              style={{ gridColumn: 1, gridRow: tIdx + 2 }}
              className={cn(
                "sticky left-0 z-10 flex items-center justify-end bg-card pr-2 text-[11px] tabular-nums",
                isOnHour(time)
                  ? "font-semibold text-foreground"
                  : "text-muted-foreground/60",
              )}
            >
              {isOnHour(time) ? time : ""}
            </div>
          ))}

          {/* Body cells: each run is ONE grid item spanning `run.length` rows. */}
          {dates.map((date, dIdx) =>
            datesRuns[dIdx].map((run) => (
              <CellBlock
                key={`${date}-${run.startIdx}`}
                run={run}
                dateColIdx={dIdx}
                participantCount={participantCount}
              />
            )),
          )}
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        셀의 색이 진할수록 더 많은 참여자가 가능한 시간입니다. 마우스를 올리면 닉네임이 표시됩니다.
      </p>
    </div>
  )
}

interface CellBlockProps {
  run: Run
  dateColIdx: number
  participantCount: number
}

function CellBlock({ run, dateColIdx, participantCount }: CellBlockProps) {
  const isMissing = run.count < 0
  const isEmpty = run.count === 0

  if (isMissing) {
    return (
      <div
        aria-hidden="true"
        style={{
          gridColumn: dateColIdx + 2,
          gridRow: `${run.startIdx + 2} / span ${run.length}`,
        }}
        className="rounded-sm bg-card/50"
      />
    )
  }

  const startLabel = run.startSlot ? formatKstTime(run.startSlot.start) : ""
  const endLabel = run.endSlot ? formatKstTime(run.endSlot.end) : ""
  const tooltip = isEmpty
    ? `${startLabel} - ${endLabel}\n가능 0명`
    : `${startLabel} - ${endLabel}\n가능 ${run.count}명${
        run.nicknames.length > 0 ? `\n참여자: ${run.nicknames.join(", ")}` : ""
      }`

  return (
    <div
      title={tooltip}
      role="gridcell"
      aria-label={`${startLabel} 가능 ${run.count}명`}
      style={{
        gridColumn: dateColIdx + 2,
        gridRow: `${run.startIdx + 2} / span ${run.length}`,
        ...(isEmpty ? {} : intensityStyle(run.count, participantCount)),
      }}
      className={cn(
        "flex items-center justify-center rounded-sm text-[10px] leading-none tabular-nums",
        isEmpty ? "border border-border bg-background" : "",
        intensityTextClass(run.count),
      )}
    >
      {isEmpty ? "" : run.count}
    </div>
  )
}
