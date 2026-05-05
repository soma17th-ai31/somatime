// When2Meet-style drag-paint availability grid (chip variant).
// Default = unselected (white pill). Drag to mark cells available (emerald pill).
// Selectors and aria-pressed are unchanged from the prior border-grid version
// so existing Playwright tests keep working — only the visuals are softened.

import { useEffect, useRef } from "react"
import type { MeetingDetail } from "@/lib/types"
import {
  formatDateLabel,
  getMeetingDates,
  getMeetingTimes,
  isOnHour,
  makeCellKey,
} from "@/lib/availabilityCells"
import { cn } from "@/lib/cn"

interface AvailabilityGridProps {
  meeting: MeetingDetail
  value: Set<string>
  onChange: (next: Set<string>) => void
}

type PaintMode = "selecting" | "deselecting" | null

export function AvailabilityGrid({ meeting, value, onChange }: AvailabilityGridProps) {
  const dates = getMeetingDates(meeting)
  const times = getMeetingTimes(meeting)

  const paintModeRef = useRef<PaintMode>(null)
  // Track cells already touched in the current drag so we don't re-toggle endlessly.
  const touchedRef = useRef<Set<string>>(new Set())
  // Latest selection snapshot, kept fresh so mid-drag handlers see the in-progress Set.
  const liveSelectedRef = useRef<Set<string>>(value)
  liveSelectedRef.current = value

  useEffect(() => {
    function endPaint() {
      paintModeRef.current = null
      touchedRef.current = new Set()
      document.body.style.userSelect = ""
    }
    window.addEventListener("mouseup", endPaint)
    window.addEventListener("touchend", endPaint)
    window.addEventListener("touchcancel", endPaint)
    return () => {
      window.removeEventListener("mouseup", endPaint)
      window.removeEventListener("touchend", endPaint)
      window.removeEventListener("touchcancel", endPaint)
      document.body.style.userSelect = ""
    }
  }, [])

  function applyPaint(key: string, mode: PaintMode) {
    if (!mode) return
    if (touchedRef.current.has(key)) return
    touchedRef.current.add(key)
    const current = liveSelectedRef.current
    const next = new Set(current)
    if (mode === "selecting") {
      if (next.has(key)) return
      next.add(key)
    } else {
      if (!next.has(key)) return
      next.delete(key)
    }
    liveSelectedRef.current = next
    onChange(next)
  }

  function startPaint(key: string) {
    const wasSelected = liveSelectedRef.current.has(key)
    const mode: PaintMode = wasSelected ? "deselecting" : "selecting"
    paintModeRef.current = mode
    touchedRef.current = new Set()
    document.body.style.userSelect = "none"
    applyPaint(key, mode)
  }

  function handleMouseDown(e: React.MouseEvent<HTMLButtonElement>, key: string) {
    if (e.button !== 0) return
    e.preventDefault()
    startPaint(key)
  }

  function handleMouseEnter(key: string) {
    if (paintModeRef.current) {
      applyPaint(key, paintModeRef.current)
    }
  }

  function handleTouchStart(e: React.TouchEvent<HTMLButtonElement>, key: string) {
    e.preventDefault()
    startPaint(key)
  }

  function handleTouchMove(e: React.TouchEvent) {
    if (!paintModeRef.current) return
    const touch = e.touches[0]
    if (!touch) return
    const target = document.elementFromPoint(touch.clientX, touch.clientY)
    if (!target) return
    const cell = target instanceof Element ? target.closest("[data-slot-key]") : null
    if (!cell) return
    const key = cell.getAttribute("data-slot-key")
    if (key) applyPaint(key, paintModeRef.current)
  }

  // grid-template-columns: a header (time) col + N date columns.
  const gridStyle = {
    gridTemplateColumns: `64px repeat(${dates.length}, minmax(56px, 1fr))`,
  }

  if (dates.length === 0 || times.length === 0) {
    return (
      <div className="rounded-xl bg-slate-50 p-4 text-sm text-slate-500">
        표시할 날짜 또는 시간 범위가 없습니다.
      </div>
    )
  }

  return (
    <div
      data-testid="availability-grid"
      className="overflow-x-auto rounded-xl bg-slate-50 p-2"
      onTouchMove={handleTouchMove}
    >
      <div
        className="grid select-none gap-1 tabular-nums text-xs"
        style={gridStyle}
        role="grid"
        aria-label="가용 시간 그리드"
      >
        {/* Header row: empty corner + date labels */}
        <div className="sticky left-0 z-10 bg-slate-50" />
        {dates.map((date) => (
          <div
            key={`h-${date}`}
            className="px-2 py-2 text-center font-medium text-slate-700"
          >
            {formatDateLabel(date)}
          </div>
        ))}

        {/* Body rows */}
        {times.map((time) => {
          const onHour = isOnHour(time)
          return (
            <RowFragment
              key={time}
              time={time}
              onHour={onHour}
              dates={dates}
              value={value}
              onMouseDown={handleMouseDown}
              onMouseEnter={handleMouseEnter}
              onTouchStart={handleTouchStart}
            />
          )
        })}
      </div>
    </div>
  )
}

interface RowFragmentProps {
  time: string
  onHour: boolean
  dates: string[]
  value: Set<string>
  onMouseDown: (e: React.MouseEvent<HTMLButtonElement>, key: string) => void
  onMouseEnter: (key: string) => void
  onTouchStart: (e: React.TouchEvent<HTMLButtonElement>, key: string) => void
}

function RowFragment({
  time,
  onHour,
  dates,
  value,
  onMouseDown,
  onMouseEnter,
  onTouchStart,
}: RowFragmentProps) {
  // Add a little vertical breathing room above each on-hour row so users can
  // scan hour boundaries without us having to draw a heavy border.
  const rowSpacingClass = onHour ? "mt-1" : ""
  return (
    <>
      <div
        className={cn(
          "sticky left-0 z-10 flex h-6 items-center justify-end bg-slate-50 pr-2 text-[11px]",
          onHour ? "font-semibold text-slate-700" : "text-slate-400",
          rowSpacingClass,
        )}
      >
        {onHour ? time : ""}
      </div>
      {dates.map((date) => {
        const key = makeCellKey(date, time)
        const selected = value.has(key)
        return (
          <button
            key={key}
            type="button"
            data-testid={`slot-${date}-${time}`}
            data-slot-key={key}
            aria-pressed={selected}
            aria-label={`${date} ${time}`}
            onMouseDown={(e) => onMouseDown(e, key)}
            onMouseEnter={() => onMouseEnter(key)}
            onTouchStart={(e) => onTouchStart(e, key)}
            className={cn(
              "h-6 cursor-pointer rounded-md transition-colors",
              rowSpacingClass,
              selected
                ? "bg-emerald-500 shadow-sm ring-1 ring-emerald-600/30 hover:bg-emerald-600"
                : "border border-slate-200 bg-white hover:bg-slate-100",
            )}
          />
        )
      })}
    </>
  )
}
