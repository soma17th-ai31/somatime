// Read-only heatmap (calendar/vertical variant).
// v3.4: rows = 30-min times, columns = dates (구글 캘린더 주간 뷰처럼).
// v3.17: contiguous same-count cells render as a single grid item that spans
//        N rows via `grid-row: ... / span N`. Empty (count=0) and missing cells
//        are 1-row items. The CSS-Grid `gap-y-1` puts a 4 px gap between any
//        two adjacent items but is consumed inside multi-row spans, so a merged
//        run reads as one solid block with no internal gaps. No margin tricks.
//
// #25 — hover/click 시 styled Popover. 한 번에 하나의 셀만 열림. click 은
//       sticky (셀 떠나도 유지), outside click / Esc / 다른 셀 클릭 → 닫힘.

import { useMemo, useState } from "react"
import type { TimetableSlot } from "@/lib/types"
import { formatKstTime, kstDateKey } from "@/lib/datetime"
import { formatDateLabel, isOnHour } from "@/lib/availabilityCells"
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover"
import { cn } from "@/lib/cn"

interface TimetableProps {
  slots: TimetableSlot[]
  participantCount: number
  // #25 — 미응답자 계산용. 회의에 닉네임으로 제출한 모든 참여자 목록.
  // (그 시간 미응답자 = submittedNicknames - run.nicknames)
  submittedNicknames?: string[]
  // v4 — 본인 닉네임이 있으면 run.nicknames 에 포함된 셀에 흰 점 (MyDot) 표시.
  currentNickname?: string | null
}

// Day-of-week color matching soma-meeting.jsx Heatmap header strip.
// Saturday → primary (소마 인디고), Sunday → destructive (red), 평일 → ink-soft.
function dayOfWeekClass(dateIso: string): string {
  // Treat dateIso as a plain calendar date — anchor at UTC midnight so the
  // resulting weekday is stable regardless of the runner's local TZ.
  const dow = new Date(`${dateIso}T00:00:00Z`).getUTCDay()
  if (dow === 0) return "text-destructive"
  if (dow === 6) return "text-primary"
  return "text-[color:var(--soma-ink-soft)]"
}

// v4 — Soma 5-step heat ramp via `--soma-heat-0..5` CSS variables.
//   heat-0 = nobody available (count <= 0)
//   heat-1..5 = bucketed share of total submitted participants
// The lower buckets stay light enough that black text remains legible without
// needing to flip to white; we only switch text color from heat-3 upwards.
function intensityStyle(count: number, total: number): React.CSSProperties {
  if (count <= 0) return { backgroundColor: "var(--soma-heat-0)" }
  const ratio = total > 0 ? Math.min(count / total, 1) : 1
  const idx = Math.min(5, Math.max(1, Math.round(ratio * 5)))
  return { backgroundColor: `var(--soma-heat-${idx})` }
}

function intensityTextClass(count: number, total: number): string {
  if (count <= 0) return "text-muted-foreground/60"
  // heat-1/2 are pale enough that white text would be unreadable; switch to
  // light text only once the cell is dark (heat-3+).
  const ratio = total > 0 ? Math.min(count / total, 1) : 1
  const idx = Math.min(5, Math.max(1, Math.round(ratio * 5)))
  return idx >= 3 ? "text-primary-foreground" : "text-primary"
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

export function Timetable({
  slots,
  participantCount,
  submittedNicknames,
  currentNickname,
}: TimetableProps) {
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

  // #25 — 한 번에 하나의 Popover 만 열림. sticky=click 으로 열린 상태(셀 떠나도 유지).
  const [openCellId, setOpenCellId] = useState<string | null>(null)
  const [stickyCellId, setStickyCellId] = useState<string | null>(null)
  const [isScrolled, setIsScrolled] = useState(false)

  function openByHover(id: string) {
    // 다른 셀이 sticky 면 hover 무시 (사용자가 명시적으로 고정해둔 패널 보호).
    if (stickyCellId !== null && stickyCellId !== id) return
    setOpenCellId(id)
  }

  function closeByLeave(id: string) {
    if (stickyCellId === id) return
    if (openCellId === id) setOpenCellId(null)
  }

  function toggleByClick(id: string) {
    if (stickyCellId === id) {
      // 같은 셀 다시 클릭 → 닫힘 + sticky 해제.
      setOpenCellId(null)
      setStickyCellId(null)
      return
    }
    // 새 셀 클릭 (sticky 가 다른 셀이든 없든) → 그 셀로 sticky 옮김.
    setOpenCellId(id)
    setStickyCellId(id)
  }

  function handleOpenChange(id: string, open: boolean) {
    // Radix 가 outside-click / Esc 시 false 로 호출. true 로 부르는 경로(예: 키보드)는
    // 우리 controlled state 로 이미 동기화돼 있으므로 false 만 처리.
    if (!open && openCellId === id) {
      setOpenCellId(null)
      setStickyCellId(null)
    }
  }

  function handleScroll(e: React.UIEvent<HTMLDivElement>) {
    const next = e.currentTarget.scrollTop > 0
    setIsScrolled((current) => (current === next ? current : next))
  }

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

  const responseCount = submittedNicknames?.length ?? participantCount

  return (
    <div className="space-y-3">
      <div className="overflow-hidden rounded-xl border border-border bg-background">
        {/* Header strip — title + count + heat ramp legend (Soma mockup spec). */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-background px-4 py-3">
          <div className="flex items-baseline gap-2.5">
            <div className="text-[14px] font-bold tracking-tight text-foreground">
              전체 가용 시간
            </div>
            <div className="text-xs font-medium text-muted-foreground">
              {`응답 ${responseCount}명`}
            </div>
          </div>
          <HeatLegend max={participantCount} />
        </div>
      <div
        className="max-h-[520px] touch-pan-y overflow-auto overscroll-contain bg-card p-2"
        data-testid="timetable-horizontal"
        onScroll={handleScroll}
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
            className="sticky left-0 top-0 z-40 bg-card"
          />

          {/* Date headers (sticky top) — weekend colors per Soma spec. */}
          {dates.map((date, dIdx) => (
            <div
              key={`th-${date}`}
              style={{ gridColumn: dIdx + 2, gridRow: 1 }}
              className={cn(
                "sticky top-0 z-30 rounded-md border border-border bg-card px-1 py-2 text-center text-[11px] font-semibold transition-colors transition-shadow hover:border-primary/30",
                dayOfWeekClass(date),
                isScrolled && "shadow-[0_2px_8px_rgba(0,0,0,0.16)]",
              )}
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
            datesRuns[dIdx].map((run) => {
              const id = `${dIdx}-${run.startIdx}`
              const isMine = Boolean(
                currentNickname && run.nicknames.includes(currentNickname),
              )
              return (
                <CellBlock
                  key={`${date}-${run.startIdx}`}
                  cellId={id}
                  run={run}
                  dateColIdx={dIdx}
                  participantCount={participantCount}
                  submittedNicknames={submittedNicknames}
                  isMine={isMine}
                  isOpen={openCellId === id}
                  onHoverOpen={openByHover}
                  onHoverClose={closeByLeave}
                  onClickToggle={toggleByClick}
                  onOpenChange={handleOpenChange}
                />
              )
            }),
          )}
        </div>
      </div>
      </div>
      <p className="text-xs text-muted-foreground">
        셀의 색이 진할수록 더 많은 참여자가 가능한 시간입니다. 셀 위에 마우스를 올리거나 셀을 누르면
        가능 인원이 표시됩니다.
      </p>
    </div>
  )
}

interface HeatLegendProps {
  max: number
}

// 5-step ramp swatch — used in the header strip to teach the encoding.
function HeatLegend({ max }: HeatLegendProps) {
  return (
    <div className="flex items-center gap-2" aria-hidden="true">
      <span className="text-[11px] font-medium text-muted-foreground">0</span>
      <div className="flex gap-0.5">
        {[1, 2, 3, 4, 5].map((idx) => (
          <span
            key={idx}
            className="h-2.5 w-2.5 rounded-sm"
            style={{ backgroundColor: `var(--soma-heat-${idx})` }}
          />
        ))}
      </div>
      <span className="text-[11px] font-medium text-muted-foreground">
        {max}
      </span>
    </div>
  )
}

interface CellBlockProps {
  cellId: string
  run: Run
  dateColIdx: number
  participantCount: number
  submittedNicknames?: string[]
  // v4 — true when run.nicknames contains the viewer's nickname.
  isMine?: boolean
  isOpen: boolean
  onHoverOpen: (id: string) => void
  onHoverClose: (id: string) => void
  onClickToggle: (id: string) => void
  onOpenChange: (id: string, open: boolean) => void
}

function CellBlock({
  cellId,
  run,
  dateColIdx,
  participantCount,
  submittedNicknames,
  isMine = false,
  isOpen,
  onHoverOpen,
  onHoverClose,
  onClickToggle,
  onOpenChange,
}: CellBlockProps) {
  const isMissing = run.count < 0
  const isEmpty = run.count === 0

  // #25 follow-up — anchor Popover 를 마우스 진입 좌표로. mouseMove 추적은 안 함
  // (진입 시점 기록 후 popover 열려있는 동안엔 고정).
  const [anchorOffset, setAnchorOffset] = useState<{ x: number; y: number }>({
    x: 0,
    y: 0,
  })

  function recordAnchor(e: React.MouseEvent<HTMLDivElement>) {
    const rect = e.currentTarget.getBoundingClientRect()
    setAnchorOffset({ x: e.clientX - rect.left, y: e.clientY - rect.top })
  }

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

  // Empty cells (count=0) 는 Popover 비활성화: hover/click 무반응.
  if (isEmpty) {
    return (
      <div
        role="gridcell"
        aria-label={`${startLabel} 가능 0명`}
        style={{
          gridColumn: dateColIdx + 2,
          gridRow: `${run.startIdx + 2} / span ${run.length}`,
        }}
        className={cn(
          "flex items-center justify-center rounded-sm border border-border bg-background text-[10px] leading-none tabular-nums",
          intensityTextClass(0, participantCount),
        )}
      />
    )
  }

  // 미응답자 = submittedNicknames - run.nicknames.
  const missingNicknames =
    submittedNicknames && submittedNicknames.length > 0
      ? submittedNicknames.filter((n) => !run.nicknames.includes(n))
      : []
  const totalSubmitted = submittedNicknames?.length

  return (
    <Popover open={isOpen} onOpenChange={(o) => onOpenChange(cellId, o)}>
      <div
        role="gridcell"
        aria-label={`${startLabel} 가능 ${run.count}명`}
        style={{
          gridColumn: dateColIdx + 2,
          gridRow: `${run.startIdx + 2} / span ${run.length}`,
          ...intensityStyle(run.count, participantCount),
        }}
        className={cn(
          "relative flex cursor-pointer items-center justify-center rounded-sm text-[10px] leading-none tabular-nums",
          intensityTextClass(run.count, participantCount),
        )}
        onMouseEnter={(e) => {
          recordAnchor(e)
          onHoverOpen(cellId)
        }}
        onMouseLeave={() => onHoverClose(cellId)}
        onClick={(e) => {
          recordAnchor(e)
          onClickToggle(cellId)
        }}
      >
        <PopoverAnchor asChild>
          <div
            aria-hidden="true"
            className="pointer-events-none absolute"
            style={{
              left: anchorOffset.x,
              top: anchorOffset.y,
              width: 1,
              height: 1,
            }}
          />
        </PopoverAnchor>
        {run.count}
        {isMine ? (
          <span
            aria-hidden="true"
            data-testid="cell-mine-dot"
            className="pointer-events-none absolute right-0.5 top-0.5 h-1 w-1 rounded-full bg-white shadow-[0_0_0_1px_rgba(15,23,42,0.3)]"
          />
        ) : null}
      </div>
      <PopoverContent
        side="right"
        align="start"
        sideOffset={8}
        collisionPadding={16}
        className="w-64 p-3 text-xs"
        data-testid={`timetable-cell-popover-${cellId}`}
        // 외부 클릭 시 닫혀야 하므로 Radix 의 기본 onInteractOutside 사용.
      >
        <div className="space-y-2">
          <div className="font-semibold text-foreground tabular-nums">
            {startLabel} - {endLabel}
          </div>
          <div className="text-muted-foreground">
            가능 {run.count}명
            {typeof totalSubmitted === "number" && totalSubmitted > 0
              ? ` / 총 ${totalSubmitted}명`
              : ""}
          </div>
          <div>
            <div className="font-medium text-foreground">가능</div>
            <div className="mt-0.5 break-words text-muted-foreground">
              {run.nicknames.length > 0 ? run.nicknames.join(", ") : "-"}
            </div>
          </div>
          {submittedNicknames && submittedNicknames.length > 0 ? (
            <div>
              <div className="font-medium text-foreground">불가능</div>
              <div className="mt-0.5 break-words text-muted-foreground">
                {missingNicknames.length > 0 ? missingNicknames.join(", ") : "-"}
              </div>
            </div>
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  )
}
