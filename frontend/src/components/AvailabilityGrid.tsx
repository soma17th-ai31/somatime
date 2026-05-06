// When2Meet-style drag-paint availability grid (calendar/vertical variant).
// v3.4: rows = 30-min times, columns = dates (구글 캘린더 주간 뷰처럼).
// Default = unselected (white). Drag to mark cells available (primary).

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
  const touchedRef = useRef<Set<string>>(new Set())
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

  // Calendar-style: 64px time label column + N date columns.
  const gridStyle = {
    gridTemplateColumns: `64px repeat(${dates.length}, minmax(64px, 1fr))`,
  }

  if (dates.length === 0 || times.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-card p-4 text-sm text-muted-foreground">
        표시할 날짜 또는 시간 범위가 없습니다.
      </div>
    )
  }

  return (
    <div
      data-testid="availability-grid"
      className="max-h-[520px] overflow-auto rounded-xl border border-border bg-card p-2"
      onTouchMove={handleTouchMove}
    >
      <div
        className="grid select-none gap-1 tabular-nums text-xs"
        style={gridStyle}
        role="grid"
        aria-label="가용 시간 그리드"
      >
        {/* Header row: empty top-left corner + date labels (sticky top) */}
        <div className="sticky left-0 top-0 z-20 bg-card" />
        {dates.map((date) => (
          <div
            key={`th-${date}`}
            className="sticky top-0 z-10 bg-card px-1 py-2 text-center text-[11px] font-semibold text-foreground"
          >
            {formatDateLabel(date)}
          </div>
        ))}

        {/* Body rows: time label (sticky left) + cells per date */}
        {times.map((time) => (
          <TimeRow
            key={time}
            time={time}
            dates={dates}
            value={value}
            onMouseDown={handleMouseDown}
            onMouseEnter={handleMouseEnter}
            onTouchStart={handleTouchStart}
          />
        ))}
      </div>
    </div>
  )
}

interface TimeRowProps {
  time: string
  dates: string[]
  value: Set<string>
  onMouseDown: (e: React.MouseEvent<HTMLButtonElement>, key: string) => void
  onMouseEnter: (key: string) => void
  onTouchStart: (e: React.TouchEvent<HTMLButtonElement>, key: string) => void
}

function TimeRow({ time, dates, value, onMouseDown, onMouseEnter, onTouchStart }: TimeRowProps) {
  return (
    <>
      <div
        className={cn(
          "sticky left-0 z-10 flex h-6 items-center justify-end bg-card pr-2 text-[11px] tabular-nums",
          isOnHour(time)
            ? "font-semibold text-foreground"
            : "text-muted-foreground/60",
        )}
      >
        {isOnHour(time) ? time : ""}
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
              "h-6 cursor-pointer rounded-sm transition-colors",
              selected
                ? "bg-primary shadow-[inset_0_0_0_1px_rgba(255,255,255,0.18)] hover:bg-primary/85"
                : "border border-border bg-background hover:bg-primary/15",
            )}
          />
        )
      })}
    </>
  )
}
