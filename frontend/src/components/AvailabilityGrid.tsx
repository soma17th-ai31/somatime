// When2Meet-style drag-paint availability grid (calendar/vertical variant).
// v3.4: rows = 30-min times, columns = dates (구글 캘린더 주간 뷰처럼).
// Default = unselected (white). Drag to mark cells available (primary).

import { useEffect, useRef, useState } from "react"
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
type DateSelectionState = "none" | "partial" | "all"

export function AvailabilityGrid({ meeting, value, onChange }: AvailabilityGridProps) {
  const dates = getMeetingDates(meeting)
  const times = getMeetingTimes(meeting)

  const containerRef = useRef<HTMLDivElement>(null)
  const paintModeRef = useRef<PaintMode>(null)
  const touchedRef = useRef<Set<string>>(new Set())
  const liveSelectedRef = useRef<Set<string>>(value)
  liveSelectedRef.current = value
  const [isScrolled, setIsScrolled] = useState(false)

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

  // #29/#31 — paint 중에만 vertical pan 차단. React 의 onTouchMove 는 root 에 passive 로
  // 등록되어 preventDefault() 가 무시되므로 native non-passive listener 로 직접 등록.
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const onTouchMove = (e: TouchEvent) => {
      if (paintModeRef.current) e.preventDefault()
    }
    el.addEventListener("touchmove", onTouchMove, { passive: false })
    return () => {
      el.removeEventListener("touchmove", onTouchMove)
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

  function handleScroll(e: React.UIEvent<HTMLDivElement>) {
    const next = e.currentTarget.scrollTop > 0
    setIsScrolled((current) => (current === next ? current : next))
  }

  function getDateKeys(date: string): string[] {
    return times.map((time) => makeCellKey(date, time))
  }

  function getDateSelectionState(date: string): DateSelectionState {
    const keys = getDateKeys(date)
    const selectedCount = keys.filter((key) => value.has(key)).length
    if (selectedCount === 0) return "none"
    if (selectedCount === keys.length) return "all"
    return "partial"
  }

  function toggleDate(date: string) {
    const keys = getDateKeys(date)
    const allSelected = keys.every((key) => liveSelectedRef.current.has(key))
    const next = new Set(liveSelectedRef.current)
    for (const key of keys) {
      if (allSelected) {
        next.delete(key)
      } else {
        next.add(key)
      }
    }
    liveSelectedRef.current = next
    onChange(next)
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
      ref={containerRef}
      data-testid="availability-grid"
      className="max-h-[520px] touch-pan-y overflow-auto overscroll-contain rounded-xl border border-border bg-card p-2"
      onScroll={handleScroll}
      onTouchMove={handleTouchMove}
    >
      <div
        className="grid select-none gap-1 tabular-nums text-xs"
        style={gridStyle}
        role="grid"
        aria-label="가용 시간 그리드"
      >
        {/* Header row: empty top-left corner + date labels (sticky top) */}
        <div className="sticky left-0 top-0 z-40 bg-card" />
        {dates.map((date) => {
          const state = getDateSelectionState(date)
          return (
            <button
              key={`th-${date}`}
              type="button"
              data-testid={`date-toggle-${date}`}
              aria-pressed={state === "partial" ? "mixed" : state === "all"}
              aria-label={`${formatDateLabel(date)} 전체 시간대 토글`}
              onClick={() => toggleDate(date)}
              style={
                state === "all"
                  ? {
                      backgroundColor: "color-mix(in srgb, var(--primary) 24%, var(--card))",
                      borderColor: "var(--primary)",
                    }
                  : state === "partial"
                    ? {
                        backgroundColor: "color-mix(in srgb, var(--primary) 14%, var(--card))",
                        borderColor: "color-mix(in srgb, var(--primary) 72%, var(--border))",
                      }
                    : undefined
              }
              className={cn(
                "sticky top-0 z-30 rounded-md border bg-card px-1 py-2 text-center text-[11px] font-semibold text-foreground transition-shadow transition-colors focus:outline-none focus:ring-2 focus:ring-ring/50",
                isScrolled && "shadow-[0_2px_8px_rgba(0,0,0,0.16)]",
                state === "all"
                  ? ""
                  : state === "partial"
                    ? "border-dashed"
                    : "border-border hover:border-primary/30",
              )}
            >
              {formatDateLabel(date)}
            </button>
          )
        })}

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
              "h-6 cursor-pointer touch-none rounded-sm transition-colors",
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
