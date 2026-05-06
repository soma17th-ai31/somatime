// Timeline-style availability picker.
// One horizontal bar per day; drag to create a rounded green range block.
// Click a block to delete it. Snaps to 30-min slot boundaries.
//
// State contract: same Set<string> of cell keys ("YYYY-MM-DD|HH:MM") as
// AvailabilityGrid, so users can swap modes mid-input without losing work.

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import type { MeetingDetail } from "@/lib/types"
import {
  cellsToRanges,
  formatDateLabelTwoLine,
  getMeetingDates,
  minutesToTime,
  rangeToCellKeys,
  timeToMinutes,
  type DayRange,
} from "@/lib/availabilityCells"
import { cn } from "@/lib/cn"

interface AvailabilityTimelineProps {
  meeting: MeetingDetail
  value: Set<string>
  onChange: (next: Set<string>) => void
}

const SLOT_MINUTES = 30
const BAR_HEIGHT_PX = 48
const BLOCK_HEIGHT_PX = 36

// Snap a minute value to the nearest 30-min slot boundary.
function snapMinutes(min: number): number {
  return Math.round(min / SLOT_MINUTES) * SLOT_MINUTES
}

interface DragState {
  date: string
  anchorMin: number
  currentMin: number
}

export function AvailabilityTimeline({ meeting, value, onChange }: AvailabilityTimelineProps) {
  const dates = getMeetingDates(meeting)
  const startMin = timeToMinutes(meeting.time_window_start)
  const endMin = timeToMinutes(meeting.time_window_end)
  const totalMinutes = Math.max(0, endMin - startMin)

  const liveValueRef = useRef<Set<string>>(value)
  liveValueRef.current = value

  const [drag, setDrag] = useState<DragState | null>(null)
  const dragRef = useRef<DragState | null>(null)
  dragRef.current = drag

  const ranges = useMemo(() => cellsToRanges(value), [value])
  const rangesByDate = useMemo(() => {
    const map = new Map<string, DayRange[]>()
    for (const r of ranges) {
      const list = map.get(r.date) ?? []
      list.push(r)
      map.set(r.date, list)
    }
    return map
  }, [ranges])

  // Hour ticks: integer hours within [startMin, endMin] inclusive at boundaries.
  const hourTicks = useMemo(() => {
    const ticks: number[] = []
    const firstHour = Math.ceil(startMin / 60) * 60
    for (let m = firstHour; m <= endMin; m += 60) {
      ticks.push(m)
    }
    return ticks
  }, [startMin, endMin])

  // Track per-bar widths via ref-callbacks + ResizeObserver. Each bar has its
  // own DOMRect so drag math works on the bar the pointer started on.
  const barRefs = useRef<Map<string, HTMLDivElement>>(new Map())
  const [barWidths, setBarWidths] = useState<Map<string, number>>(new Map())

  useLayoutEffect(() => {
    const observer = new ResizeObserver((entries) => {
      setBarWidths((prev) => {
        const next = new Map(prev)
        for (const entry of entries) {
          const date = entry.target.getAttribute("data-bar-date")
          if (!date) continue
          next.set(date, entry.contentRect.width)
        }
        return next
      })
    })
    for (const el of barRefs.current.values()) observer.observe(el)
    return () => observer.disconnect()
  }, [dates.length])

  function registerBar(date: string, el: HTMLDivElement | null) {
    const map = barRefs.current
    const prev = map.get(date)
    if (prev && prev !== el) {
      // The element was unmounted or replaced; nothing to do for prev because
      // ResizeObserver auto-cleans on disconnect.
    }
    if (el) {
      map.set(date, el)
      // Seed an initial width so first paint has correct geometry.
      const w = el.getBoundingClientRect().width
      setBarWidths((cur) => {
        if (cur.get(date) === w) return cur
        const next = new Map(cur)
        next.set(date, w)
        return next
      })
    } else {
      map.delete(date)
    }
  }

  function clientXToMinutes(date: string, clientX: number): number | null {
    const el = barRefs.current.get(date)
    if (!el) return null
    const rect = el.getBoundingClientRect()
    if (rect.width <= 0) return null
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))
    return startMin + ratio * totalMinutes
  }

  function pointInExistingRange(date: string, minute: number): boolean {
    const list = rangesByDate.get(date) ?? []
    for (const r of list) {
      if (minute >= r.startMin && minute < r.endMin) return true
    }
    return false
  }

  function handlePointerDown(e: React.PointerEvent<HTMLDivElement>, date: string) {
    if (e.button !== 0 && e.pointerType === "mouse") return
    const min = clientXToMinutes(date, e.clientX)
    if (min === null) return
    // If the pointer is over an existing block, do nothing (deletion is handled
    // by the block's own click handler).
    if (pointInExistingRange(date, min)) return
    e.preventDefault()
    document.body.style.userSelect = "none"
    setDrag({ date, anchorMin: min, currentMin: min })
  }

  function handlePointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const cur = dragRef.current
    if (!cur) return
    const min = clientXToMinutes(cur.date, e.clientX)
    if (min === null) return
    setDrag({ ...cur, currentMin: min })
  }

  function commitDrag() {
    const cur = dragRef.current
    document.body.style.userSelect = ""
    setDrag(null)
    if (!cur) return
    const lo = Math.min(cur.anchorMin, cur.currentMin)
    const hi = Math.max(cur.anchorMin, cur.currentMin)
    let snappedStart = snapMinutes(lo)
    let snappedEnd = snapMinutes(hi)
    // Minimum 1 cell (30 min). If the user just clicked, expand right by one slot.
    if (snappedEnd <= snappedStart) snappedEnd = snappedStart + SLOT_MINUTES
    // Clamp to meeting window.
    snappedStart = Math.max(startMin, snappedStart)
    snappedEnd = Math.min(endMin, snappedEnd)
    if (snappedEnd <= snappedStart) return
    const keys = rangeToCellKeys(cur.date, snappedStart, snappedEnd)
    const next = new Set(liveValueRef.current)
    for (const k of keys) next.add(k)
    onChange(next)
  }

  // Global listeners so a drag started on one bar still ends if the pointer
  // leaves the bar before release.
  useEffect(() => {
    function onUp() {
      if (dragRef.current) commitDrag()
    }
    function onCancel() {
      document.body.style.userSelect = ""
      setDrag(null)
    }
    window.addEventListener("pointerup", onUp)
    window.addEventListener("pointercancel", onCancel)
    return () => {
      window.removeEventListener("pointerup", onUp)
      window.removeEventListener("pointercancel", onCancel)
      document.body.style.userSelect = ""
    }
    // commitDrag closes over onChange via liveValueRef; safe to omit deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onChange])

  function deleteRange(r: DayRange) {
    const keys = rangeToCellKeys(r.date, r.startMin, r.endMin)
    const next = new Set(liveValueRef.current)
    for (const k of keys) next.delete(k)
    onChange(next)
  }

  if (dates.length === 0 || totalMinutes <= 0) {
    return (
      <div className="rounded-md border border-border bg-card p-4 text-sm text-muted-foreground">
        표시할 날짜 또는 시간 범위가 없습니다.
      </div>
    )
  }

  function minToPercent(min: number): number {
    if (totalMinutes <= 0) return 0
    return ((min - startMin) / totalMinutes) * 100
  }

  return (
    <div data-testid="availability-timeline" className="flex flex-col gap-3">
      {dates.map((date) => {
        const label = formatDateLabelTwoLine(date)
        const dayRanges = rangesByDate.get(date) ?? []
        const isDragging = drag?.date === date
        const previewLo = isDragging ? Math.min(drag.anchorMin, drag.currentMin) : 0
        const previewHi = isDragging ? Math.max(drag.anchorMin, drag.currentMin) : 0
        const barWidth = barWidths.get(date) ?? 0

        return (
          <div
            key={date}
            className="surface-edge flex items-stretch gap-3 rounded-xl border border-border bg-card p-4"
          >
            <div className="flex w-16 shrink-0 flex-col justify-center text-foreground">
              <span className="text-base font-semibold">{label.dayMonth}</span>
              <span className="text-xs text-muted-foreground">{label.weekday}</span>
            </div>

            <div className="flex min-w-0 flex-1 flex-col gap-1">
              {/* Hour tick labels above the bar */}
              <div className="relative h-4 select-none text-[10px] tabular-nums text-muted-foreground/70">
                {hourTicks.map((tickMin) => {
                  const left = minToPercent(tickMin)
                  const hour = Math.floor(tickMin / 60)
                  return (
                    <span
                      key={tickMin}
                      className="absolute -translate-x-1/2"
                      style={{ left: `${left}%` }}
                    >
                      {String(hour).padStart(2, "0")}
                    </span>
                  )
                })}
              </div>

              {/* The bar itself */}
              <div
                ref={(el) => registerBar(date, el)}
                data-bar-date={date}
                data-testid={`timeline-bar-${date}`}
                className="relative w-full cursor-crosshair touch-none rounded-lg border border-border bg-background"
                style={{ height: BAR_HEIGHT_PX }}
                onPointerDown={(e) => handlePointerDown(e, date)}
                onPointerMove={handlePointerMove}
                role="presentation"
              >
                {/* Hour gridline marks (subtle) */}
                {hourTicks.map((tickMin) => {
                  const left = minToPercent(tickMin)
                  return (
                    <span
                      key={`tick-${tickMin}`}
                      aria-hidden
                      className="absolute top-1/2 h-2 w-px -translate-y-1/2 bg-border"
                      style={{ left: `${left}%` }}
                    />
                  )
                })}

                {/* Committed range blocks */}
                {dayRanges.map((r) => {
                  const left = minToPercent(r.startMin)
                  const width = minToPercent(r.endMin) - left
                  if (width <= 0 || barWidth <= 0) return null
                  const startLabel = minutesToTime(r.startMin)
                  const endLabel = minutesToTime(r.endMin)
                  return (
                    <button
                      key={`${r.date}-${r.startMin}-${r.endMin}`}
                      type="button"
                      data-testid={`range-${r.date}-${startLabel}-${endLabel}`}
                      className={cn(
                        "absolute top-1/2 flex -translate-y-1/2 items-center justify-center",
                        "rounded-md bg-primary text-[11px] font-medium text-primary-foreground shadow-[inset_0_0_0_1px_rgba(255,255,255,0.18)]",
                        "hover:bg-primary/85 focus:outline-none focus:ring-2 focus:ring-ring/50",
                      )}
                      style={{
                        left: `${left}%`,
                        width: `${width}%`,
                        height: BLOCK_HEIGHT_PX,
                      }}
                      onPointerDown={(e) => {
                        // Block drag-start from bubbling to the bar so we don't
                        // start a new range when the user is trying to delete.
                        e.stopPropagation()
                      }}
                      onClick={(e) => {
                        e.stopPropagation()
                        deleteRange(r)
                      }}
                      aria-label={`${date} ${startLabel} - ${endLabel} 삭제`}
                    >
                      <span className="truncate px-2">
                        {startLabel} - {endLabel}
                      </span>
                    </button>
                  )
                })}

                {/* Drag preview */}
                {isDragging ? (
                  <span
                    aria-hidden
                    className="pointer-events-none absolute top-1/2 -translate-y-1/2 rounded-md bg-primary/55 ring-1 ring-primary/40"
                    style={{
                      left: `${minToPercent(Math.max(startMin, previewLo))}%`,
                      width: `${
                        minToPercent(Math.min(endMin, previewHi)) -
                        minToPercent(Math.max(startMin, previewLo))
                      }%`,
                      height: BLOCK_HEIGHT_PX,
                    }}
                  />
                ) : null}
              </div>
            </div>
          </div>
        )
      })}

      <p className="text-xs text-muted-foreground">
        시간대를 드래그해서 가능한 시간을 추가하세요. 블록을 클릭하면 삭제됩니다.
      </p>
    </div>
  )
}
