// Tabbed date selector — Spec §5.1 "date_mode": "range" | "picked".
//   - Tab "범위": react-day-picker mode="range" → emits {start, end} as YYYY-MM-DD ISO strings.
//   - Tab "개별 선택": mode="multiple" → emits string[] of YYYY-MM-DD ISO strings.
// v4 — Soma mockup matching: card wrapper + selection summary footer.

import { useMemo } from "react"
import { type DateRange } from "react-day-picker"
import { ko } from "date-fns/locale"
import "react-day-picker/dist/style.css"
import { Calendar as CalendarIcon } from "lucide-react"
import { Calendar } from "@/components/ui/calendar"
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

function formatKoDate(iso: string): string {
  const [, m, d] = iso.split("-")
  return `${Number.parseInt(m, 10)}월 ${Number.parseInt(d, 10)}일`
}

function daysBetween(startIso: string, endIso: string): number {
  const start = new Date(`${startIso}T00:00:00`)
  const end = new Date(`${endIso}T00:00:00`)
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return 0
  return Math.max(1, Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1)
}

function rangeSummary(start: string | null, end: string | null): string {
  if (!start) return "시작일을 선택해 주세요"
  if (!end) return `${formatKoDate(start)} 부터 ~ 종료일을 선택해 주세요`
  return `${formatKoDate(start)} – ${formatKoDate(end)} (${daysBetween(start, end)}일간)`
}

function pickedSummary(dates: string[]): string {
  if (dates.length === 0) return "날짜를 직접 선택해 주세요"
  const formatted = dates.map(formatKoDate).join(", ")
  return `${dates.length}일 선택됨 · ${formatted}`
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
        <div
          data-testid="date-range-picker"
          className="rounded-xl border border-border bg-background p-3.5"
        >
          <Calendar
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
          <SelectionSummary text={rangeSummary(rangeStart, rangeEnd)} />
        </div>
      </TabsContent>

      <TabsContent value="picked">
        <div
          data-testid="date-picked-picker"
          className="rounded-xl border border-border bg-background p-3.5"
        >
          <Calendar
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
          <SelectionSummary text={pickedSummary(pickedDates)} />
        </div>
      </TabsContent>
    </Tabs>
  )
}

function SelectionSummary({ text }: { text: string }) {
  return (
    <div className="mt-3 flex items-center gap-1.5 border-t border-dashed border-border pt-3 text-xs font-medium text-muted-foreground">
      <CalendarIcon className="h-3.5 w-3.5" aria-hidden="true" />
      <span>{text}</span>
    </div>
  )
}
