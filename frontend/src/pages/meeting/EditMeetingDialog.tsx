// Edit-meeting-settings dialog (v3.19).
// Lets anyone with the share URL change date / duration / location / buffer /
// time window / weekends. Title is not editable here. Confirmed meetings are
// locked server-side (409 already_confirmed).

import { useEffect, useState } from "react"
import { Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogFooter, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select } from "@/components/ui/select"
import { useToast } from "@/components/ui/toast"
import { DateRangeOrPicker } from "@/components/DateRangeOrPicker"
import { api } from "@/lib/api"
import {
  ApiError,
  type DateMode,
  type LocationType,
  type MeetingDetail,
  type MeetingSettingsUpdate,
} from "@/lib/types"
import { cn } from "@/lib/cn"

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  slug: string
  meeting: MeetingDetail
  onSaved: () => void
}

const dateRegex = /^\d{4}-\d{2}-\d{2}$/
const timeRegex = /^\d{2}:\d{2}$/
const LOCATION_OPTIONS: Array<{ value: LocationType; label: string }> = [
  { value: "online", label: "온라인" },
  { value: "offline", label: "오프라인" },
  { value: "any", label: "상관없음" },
]

function trimTime(t: string): string {
  return t.length >= 5 ? t.slice(0, 5) : t
}

export function EditMeetingDialog({ open, onOpenChange, slug, meeting, onSaved }: Props) {
  const { toast } = useToast()

  const [dateMode, setDateMode] = useState<DateMode>(meeting.date_mode)
  const [rangeStart, setRangeStart] = useState<string | null>(meeting.date_range_start)
  const [rangeEnd, setRangeEnd] = useState<string | null>(meeting.date_range_end)
  const [pickedDates, setPickedDates] = useState<string[]>(meeting.candidate_dates ?? [])
  const [duration, setDuration] = useState<number>(meeting.duration_minutes)
  const [locationType, setLocationType] = useState<LocationType>(meeting.location_type)
  const [bufferMin, setBufferMin] = useState<number>(meeting.offline_buffer_minutes)
  const [timeStart, setTimeStart] = useState<string>(trimTime(meeting.time_window_start))
  const [timeEnd, setTimeEnd] = useState<string>(trimTime(meeting.time_window_end))
  const [includeWeekends, setIncludeWeekends] = useState<boolean>(meeting.include_weekends)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Reload defaults when the dialog (re)opens.
  useEffect(() => {
    if (!open) return
    setDateMode(meeting.date_mode)
    setRangeStart(meeting.date_range_start)
    setRangeEnd(meeting.date_range_end)
    setPickedDates(meeting.candidate_dates ?? [])
    setDuration(meeting.duration_minutes)
    setLocationType(meeting.location_type)
    setBufferMin(meeting.offline_buffer_minutes)
    setTimeStart(trimTime(meeting.time_window_start))
    setTimeEnd(trimTime(meeting.time_window_end))
    setIncludeWeekends(meeting.include_weekends)
    setError(null)
  }, [open, meeting])

  const showBuffer = locationType !== "online"

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    if (![30, 60, 90, 120, 150, 180].includes(duration)) {
      setError("회의 길이를 다시 선택하세요.")
      return
    }
    if (!timeRegex.test(timeStart) || !timeRegex.test(timeEnd)) {
      setError("시간은 HH:MM 형식입니다.")
      return
    }
    if (timeEnd <= timeStart) {
      setError("종료 시간은 시작 시간보다 이후여야 합니다.")
      return
    }
    if (dateMode === "range") {
      if (!rangeStart || !dateRegex.test(rangeStart)) {
        setError("시작일을 선택하세요.")
        return
      }
      if (!rangeEnd || !dateRegex.test(rangeEnd)) {
        setError("종료일을 선택하세요.")
        return
      }
      if (rangeEnd < rangeStart) {
        setError("종료일은 시작일 이후여야 합니다.")
        return
      }
    } else {
      if (pickedDates.length === 0) {
        setError("날짜를 1개 이상 선택하세요.")
        return
      }
    }
    if (![0, 30, 60, 90, 120].includes(bufferMin)) {
      setError("이동 버퍼 값이 올바르지 않습니다.")
      return
    }

    const payload: MeetingSettingsUpdate =
      dateMode === "range"
        ? {
            date_mode: "range",
            date_range_start: rangeStart,
            date_range_end: rangeEnd,
            candidate_dates: null,
            duration_minutes: duration,
            location_type: locationType,
            offline_buffer_minutes: locationType === "online" ? 0 : bufferMin,
            time_window_start: timeStart,
            time_window_end: timeEnd,
            include_weekends: includeWeekends,
          }
        : {
            date_mode: "picked",
            date_range_start: null,
            date_range_end: null,
            candidate_dates: pickedDates,
            duration_minutes: duration,
            location_type: locationType,
            offline_buffer_minutes: locationType === "online" ? 0 : bufferMin,
            time_window_start: timeStart,
            time_window_end: timeEnd,
            include_weekends: includeWeekends,
          }

    setSubmitting(true)
    try {
      await api.updateMeetingSettings(slug, payload)
      toast("회의 설정이 저장되었습니다.", "success")
      onSaved()
      onOpenChange(false)
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "저장에 실패했습니다."
      setError(msg)
      toast(msg, "error")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      labelledBy="edit-meeting-title"
      className="max-w-2xl"
    >
      <DialogTitle id="edit-meeting-title">회의 설정 수정</DialogTitle>
      <div className="mt-4 max-h-[70vh] overflow-y-auto pr-1">
        <form onSubmit={handleSubmit} className="flex flex-col gap-5">
          <div className="flex flex-col gap-2">
            <Label>날짜</Label>
            <DateRangeOrPicker
              mode={dateMode}
              onModeChange={(m) => {
                setDateMode(m)
                if (m === "range") {
                  setPickedDates([])
                } else {
                  setRangeStart(null)
                  setRangeEnd(null)
                }
              }}
              rangeStart={rangeStart}
              rangeEnd={rangeEnd}
              pickedDates={pickedDates}
              onRangeChange={(s, e) => {
                setRangeStart(s)
                setRangeEnd(e)
              }}
              onPickedChange={(arr) => setPickedDates(arr)}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Label htmlFor="edit-duration">회의 길이</Label>
              <Select
                id="edit-duration"
                value={duration}
                onChange={(e) => setDuration(Number(e.target.value))}
              >
                <option value={30}>30분</option>
                <option value={60}>60분</option>
                <option value={90}>90분</option>
                <option value={120}>120분</option>
                <option value={150}>150분</option>
                <option value={180}>180분</option>
              </Select>
            </div>
            <fieldset className="flex flex-col gap-2">
              <legend className="text-sm font-medium text-foreground">진행 방식</legend>
              <div
                role="radiogroup"
                aria-label="진행 방식"
                className="inline-flex w-fit gap-1 rounded-md border border-border bg-card p-1"
              >
                {LOCATION_OPTIONS.map((opt) => {
                  const active = locationType === opt.value
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      onClick={() => {
                        setLocationType(opt.value)
                        if (opt.value === "online") setBufferMin(0)
                        else if (bufferMin === 0) setBufferMin(60)
                      }}
                      className={cn(
                        "rounded-sm px-3 py-1.5 text-sm font-medium transition-colors",
                        active
                          ? "bg-secondary text-foreground shadow-sm"
                          : "text-muted-foreground hover:text-foreground",
                      )}
                    >
                      {opt.label}
                    </button>
                  )
                })}
              </div>
            </fieldset>
          </div>

          {showBuffer ? (
            <div className="flex flex-col gap-2">
              <Label htmlFor="edit-buffer">이동 버퍼</Label>
              <Select
                id="edit-buffer"
                value={bufferMin}
                onChange={(e) => setBufferMin(Number(e.target.value))}
              >
                <option value={30}>30분</option>
                <option value={60}>60분</option>
                <option value={90}>90분</option>
                <option value={120}>120분</option>
              </Select>
              <p className="text-xs text-muted-foreground">
                후보 시간 앞뒤로 비워둘 시간입니다. 오프라인/상관없음 일 때만 적용됩니다.
              </p>
            </div>
          ) : null}

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Label htmlFor="edit-time-start">시작 시간</Label>
              <Input
                id="edit-time-start"
                type="time"
                value={timeStart}
                onChange={(e) => setTimeStart(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="edit-time-end">종료 시간</Label>
              <Input
                id="edit-time-end"
                type="time"
                value={timeEnd}
                onChange={(e) => setTimeEnd(e.target.value)}
              />
            </div>
          </div>

          <label className="inline-flex items-center gap-2 text-sm text-foreground">
            <Checkbox
              checked={includeWeekends}
              onChange={(e) => setIncludeWeekends((e.target as HTMLInputElement).checked)}
            />
            주말도 포함
          </label>

          {error ? <p className="text-sm text-destructive">{error}</p> : null}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={submitting}
            >
              취소
            </Button>
            <Button type="submit" disabled={submitting} data-testid="edit-meeting-save">
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              저장
            </Button>
          </DialogFooter>
        </form>
      </div>
    </Dialog>
  )
}
