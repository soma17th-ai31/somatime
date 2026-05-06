// Tabbed date selector — Spec §5.1 "date_mode": "range" | "picked".
//   - Tab "범위": react-day-picker mode="range" → emits {start, end} as YYYY-MM-DD ISO strings.
//   - Tab "개별 선택": mode="multiple" → emits string[] of YYYY-MM-DD ISO strings.

import { useMemo } from "react"
import { DayPicker, type DateRange } from "react-day-picker"
import { ko } from "date-fns/locale"
import "react-day-picker/dist/style.css"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import type { DateMode } from "@/lib/types"

interface DateRangeOrPickerProps {
  mode: DateMode
  onModeChange: (mode: DateMode) => void
  rangeStart: string | null
  rangeEnd: string | null
  pickedDates: string[]
  onRangeChange: (start: string | null, end: string | null) => void
  onPickedChange: (dates: string[]) => void
}

function isoFromDate(d: Date): string {
  // Anchor on local midnight to avoid TZ drift; we treat dates as plain calendar dates.
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${y}-${m}-${day}`
}

function dateFromIso(iso: string | null): Date | undefined {
  if (!iso) return undefined
  const [y, m, d] = iso.split("-").map((s) => Number.parseInt(s, 10))
  if (!y || !m || !d) return undefined
  return new Date(y, m - 1, d)
}

export function DateRangeOrPicker({
  mode,
  onModeChange,
  rangeStart,
  rangeEnd,
  pickedDates,
  onRangeChange,
  onPickedChange,
}: DateRangeOrPickerProps) {
  const selectedRange: DateRange | undefined = useMemo(() => {
    const from = dateFromIso(rangeStart)
    const to = dateFromIso(rangeEnd)
    if (!from && !to) return undefined
    return { from, to }
  }, [rangeStart, rangeEnd])

  const selectedPicked: Date[] = useMemo(
    () => pickedDates.map(dateFromIso).filter((d): d is Date => d instanceof Date),
    [pickedDates],
  )

  return (
    <Tabs value={mode} onValueChange={(v) => onModeChange(v as DateMode)}>
      <TabsList>
        <TabsTrigger value="range">범위</TabsTrigger>
        <TabsTrigger value="picked">개별 선택</TabsTrigger>
      </TabsList>

      <TabsContent value="range">
        <div data-testid="date-range-picker">
          <DayPicker
            mode="range"
            locale={ko}
            selected={selectedRange}
            onSelect={(r: DateRange | undefined) => {
              const from = r?.from ? isoFromDate(r.from) : null
              const to = r?.to ? isoFromDate(r.to) : null
              onRangeChange(from, to)
            }}
            numberOfMonths={1}
            showOutsideDays
          />
          <p className="mt-2 text-xs text-muted-foreground">
            연속된 날짜 범위를 선택합니다. 시작일과 종료일을 차례로 클릭하세요.
          </p>
        </div>
      </TabsContent>

      <TabsContent value="picked">
        <div data-testid="date-picked-picker">
          <DayPicker
            mode="multiple"
            locale={ko}
            selected={selectedPicked}
            onSelect={(dates: Date[] | undefined) => {
              const arr = (dates ?? [])
                .map(isoFromDate)
                .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
              onPickedChange(arr)
            }}
            numberOfMonths={1}
            showOutsideDays
          />
          <p className="mt-2 text-xs text-muted-foreground">
            비연속 날짜를 여러 개 선택할 수 있습니다.
          </p>
        </div>
      </TabsContent>
    </Tabs>
  )
}
