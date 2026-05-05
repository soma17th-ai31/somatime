// Read-only heatmap of collective availability.
// Visual style mirrors AvailabilityGrid (Mode B chip grid):
//   - Rows = 30-min times, columns = dates.
//   - Outer container rounded-xl bg-slate-50 p-2.
//   - Cells rounded-md, no borders, gap-1, with mt-1 breathing room on hour rows.
//   - Color encodes available_count / participantCount ratio along an emerald scale.

import { useMemo } from "react"
import type { TimetableSlot } from "@/lib/types"
import { formatKstDate, formatKstTime } from "@/lib/datetime"
import { formatDateLabel, isOnHour } from "@/lib/availabilityCells"
import { cn } from "@/lib/cn"

interface TimetableProps {
  slots: TimetableSlot[]
  participantCount: number
}

// Map ratio of available participants to a chip-style class set.
function intensityClass(count: number, total: number): string {
  if (count <= 0) return "bg-white border border-slate-200 text-slate-400"
  const ratio = total > 0 ? Math.min(count / total, 1) : 1
  if (ratio >= 1) {
    return "bg-emerald-600 text-white shadow-sm ring-1 ring-emerald-700/30"
  }
  if (ratio >= 0.67) return "bg-emerald-400 text-white"
  if (ratio >= 0.34) return "bg-emerald-200 text-emerald-900"
  return "bg-emerald-100 text-emerald-900"
}

function makeKey(date: string, time: string): string {
  return `${date}|${time}`
}

export function Timetable({ slots, participantCount }: TimetableProps) {
  const { dates, times, slotByKey } = useMemo(() => {
    const dateSet = new Set<string>()
    const timeSet = new Set<string>()
    const lookup = new Map<string, TimetableSlot>()
    for (const slot of slots) {
      const date = formatKstDate(slot.start)
      const time = formatKstTime(slot.start)
      dateSet.add(date)
      timeSet.add(time)
      lookup.set(makeKey(date, time), slot)
    }
    const datesSorted = Array.from(dateSet).sort()
    const timesSorted = Array.from(timeSet).sort()
    return { dates: datesSorted, times: timesSorted, slotByKey: lookup }
  }, [slots])

  if (slots.length === 0 || dates.length === 0 || times.length === 0) {
    return (
      <p className="text-sm text-slate-600">
        아직 입력된 가용 정보가 없습니다. 참여자가 일정을 제출하면 여기에 표시됩니다.
      </p>
    )
  }

  const gridStyle = {
    gridTemplateColumns: `64px repeat(${dates.length}, minmax(56px, 1fr))`,
  }

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto rounded-xl bg-slate-50 p-2">
        <div
          className="grid gap-1 tabular-nums text-xs"
          style={gridStyle}
          role="grid"
          aria-label="가용 시간 히트맵"
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

          {/* Body rows: time label + heatmap cells */}
          {times.map((time) => {
            const onHour = isOnHour(time)
            const rowSpacingClass = onHour ? "mt-1" : ""
            return (
              <RowFragment
                key={time}
                time={time}
                onHour={onHour}
                rowSpacingClass={rowSpacingClass}
                dates={dates}
                slotByKey={slotByKey}
                participantCount={participantCount}
              />
            )
          })}
        </div>
      </div>
      <p className="text-xs text-slate-500">
        셀의 색이 진할수록 더 많은 참여자가 가능한 시간입니다. 마우스를 올리면 닉네임이 표시됩니다.
      </p>
    </div>
  )
}

interface RowFragmentProps {
  time: string
  onHour: boolean
  rowSpacingClass: string
  dates: string[]
  slotByKey: Map<string, TimetableSlot>
  participantCount: number
}

function RowFragment({
  time,
  onHour,
  rowSpacingClass,
  dates,
  slotByKey,
  participantCount,
}: RowFragmentProps) {
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
        const key = makeKey(date, time)
        const slot = slotByKey.get(key)
        return (
          <Cell
            key={key}
            slot={slot}
            participantCount={participantCount}
            rowSpacingClass={rowSpacingClass}
          />
        )
      })}
    </>
  )
}

interface CellProps {
  slot: TimetableSlot | undefined
  participantCount: number
  rowSpacingClass: string
}

function Cell({ slot, participantCount, rowSpacingClass }: CellProps) {
  // Disabled blank: this date+time pair isn't part of the meeting window.
  if (!slot) {
    return (
      <div
        aria-hidden="true"
        className={cn("h-6 rounded-md bg-slate-100/60", rowSpacingClass)}
      />
    )
  }

  const startLabel = formatKstTime(slot.start)
  const endLabel = formatKstTime(slot.end)
  const tooltip = `${startLabel} - ${endLabel}\n가능 ${slot.available_count}명${
    slot.available_nicknames.length > 0
      ? `\n참여자: ${slot.available_nicknames.join(", ")}`
      : ""
  }`

  return (
    <div
      title={tooltip}
      role="gridcell"
      aria-label={`${startLabel} 가능 ${slot.available_count}명`}
      className={cn(
        "flex h-6 items-center justify-center rounded-md text-[10px] leading-none tabular-nums",
        intensityClass(slot.available_count, participantCount),
        rowSpacingClass,
      )}
    >
      {slot.available_count > 0 ? slot.available_count : ""}
    </div>
  )
}
