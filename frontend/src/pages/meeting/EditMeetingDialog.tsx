// SettingsModal — Phase E redesign of the meeting-settings dialog.
// Renamed visually to "방 설정 수정" with the Soma layout; kept the
// EditMeetingDialog filename + exported name so MeetingSummary's existing
// import + e2e edit-meeting-toggle path remain unchanged.
//
// Changes vs v3.19:
//   - Native select / unstyled segmented are replaced with full-width Segmented
//     controls for 회의 길이 + 진행 방식 (parity with CreateMeetingPage).
//   - Duration limited to 30/60/90/120 to match schema & soma mockup.
//   - Danger zone with delete-meeting button + 2-step confirm dialog →
//     api.deleteMeeting(slug) → navigate("/").

import { useEffect, useState } from "react"
import { Loader2, Trash2, X } from "lucide-react"
import { useNavigate } from "react-router-dom"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
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

const DURATION_OPTIONS: Array<{ value: 30 | 60 | 90 | 120; label: string }> = [
  { value: 30, label: "30분" },
  { value: 60, label: "60분" },
  { value: 90, label: "90분" },
  { value: 120, label: "120분" },
]

const LOCATION_OPTIONS: Array<{ value: LocationType; label: string }> = [
  { value: "online", label: "온라인" },
  { value: "offline", label: "오프라인" },
  { value: "any", label: "상관없음" },
]

export function EditMeetingDialog({ open, onOpenChange, slug, meeting, onSaved }: Props) {
  const { toast } = useToast()
  const navigate = useNavigate()

  const [dateMode, setDateMode] = useState<DateMode>(meeting.date_mode)
  const [rangeStart, setRangeStart] = useState<string | null>(meeting.date_range_start)
  const [rangeEnd, setRangeEnd] = useState<string | null>(meeting.date_range_end)
  const [pickedDates, setPickedDates] = useState<string[]>(meeting.candidate_dates ?? [])
  const [duration, setDuration] = useState<number>(meeting.duration_minutes)
  const [locationType, setLocationType] = useState<LocationType>(meeting.location_type)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Two-step delete confirm.
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleteBusy, setDeleteBusy] = useState(false)

  useEffect(() => {
    if (!open) return
    setDateMode(meeting.date_mode)
    setRangeStart(meeting.date_range_start)
    setRangeEnd(meeting.date_range_end)
    setPickedDates(meeting.candidate_dates ?? [])
    setDuration(meeting.duration_minutes)
    setLocationType(meeting.location_type)
    setError(null)
    setDeleteOpen(false)
  }, [open, meeting])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    if (![30, 60, 90, 120].includes(duration)) {
      setError("회의 길이를 다시 선택하세요.")
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
    const payload: MeetingSettingsUpdate =
      dateMode === "range"
        ? {
            date_mode: "range",
            date_range_start: rangeStart,
            date_range_end: rangeEnd,
            candidate_dates: null,
            duration_minutes: duration,
            location_type: locationType,
            include_weekends: meeting.include_weekends,
          }
        : {
            date_mode: "picked",
            date_range_start: null,
            date_range_end: null,
            candidate_dates: pickedDates,
            duration_minutes: duration,
            location_type: locationType,
            include_weekends: meeting.include_weekends,
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

  async function handleDelete() {
    setDeleteBusy(true)
    try {
      await api.deleteMeeting(slug)
      toast("회의가 삭제되었습니다.", "success")
      // Navigate away — the slug is now a 404. Settings + outer dialogs unmount
      // together with the page.
      navigate("/", { replace: true })
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "삭제에 실패했습니다."
      toast(msg, "error")
      setDeleteBusy(false)
    }
  }

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(o) => {
          if (submitting) return
          onOpenChange(o)
        }}
        labelledBy="edit-meeting-title"
        className="max-w-lg p-0"
      >
        <div className="flex items-start justify-between gap-3 border-b border-border px-5 pb-3.5 pt-4">
          <div>
            <DialogTitle id="edit-meeting-title">방 설정 수정</DialogTitle>
            <DialogDescription>
              변경 사항은 참여자에게 자동으로 반영됩니다.
            </DialogDescription>
          </div>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
            aria-label="설정 창 닫기"
            className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-card hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form
          onSubmit={handleSubmit}
          className="max-h-[70vh] overflow-y-auto px-5 py-5"
        >
          <div className="flex flex-col gap-5">
            <fieldset className="flex flex-col gap-2">
              <Label>회의 기간</Label>
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
            </fieldset>

            <fieldset className="flex flex-col gap-2">
              <legend className="text-sm font-medium text-foreground">회의 길이</legend>
              <SegmentedRow
                value={duration}
                options={DURATION_OPTIONS}
                onChange={(v) => setDuration(v as number)}
                ariaLabel="회의 길이"
                testIdPrefix="settings-duration"
              />
            </fieldset>

            <fieldset className="flex flex-col gap-2">
              <legend className="text-sm font-medium text-foreground">진행 방식</legend>
              <SegmentedRow
                value={locationType}
                options={LOCATION_OPTIONS}
                onChange={(v) => setLocationType(v as LocationType)}
                ariaLabel="진행 방식"
                testIdPrefix="settings-location"
              />
            </fieldset>

            <div className="mt-1 flex items-start justify-between gap-3 border-t border-dashed border-border pt-4">
              <div className="min-w-0">
                <div className="text-[13.5px] font-bold tracking-tight text-foreground">
                  회의 삭제
                </div>
                <p className="mt-1 text-xs leading-snug text-muted-foreground">
                  삭제하면 참여자의 응답도 함께 사라집니다. 되돌릴 수 없어요.
                </p>
              </div>
              <Button
                type="button"
                variant="destructive"
                size="sm"
                disabled={submitting}
                onClick={() => setDeleteOpen(true)}
                data-testid="meeting-delete-toggle"
              >
                <Trash2 className="h-3.5 w-3.5" />
                삭제
              </Button>
            </div>

            {error ? <p className="text-sm text-destructive">{error}</p> : null}
          </div>

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
      </Dialog>

      <Dialog
        open={deleteOpen}
        onOpenChange={(o) => {
          if (deleteBusy) return
          setDeleteOpen(o)
        }}
        labelledBy="delete-meeting-title"
      >
        <div data-testid="meeting-delete-dialog">
          <DialogTitle id="delete-meeting-title">회의 삭제</DialogTitle>
          <DialogDescription>
            정말 삭제하시겠어요? 이 회의의 참여자 응답과 확정 정보가 모두 사라지고 되돌릴 수
            없습니다.
          </DialogDescription>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setDeleteOpen(false)}
              disabled={deleteBusy}
            >
              취소
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={handleDelete}
              disabled={deleteBusy}
              data-testid="meeting-delete-confirm"
            >
              {deleteBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
              {deleteBusy ? "삭제 중..." : "정말 삭제"}
            </Button>
          </DialogFooter>
        </div>
      </Dialog>
    </>
  )
}

interface SegmentedOption<T> {
  value: T
  label: string
}

interface SegmentedRowProps<T extends string | number> {
  value: T
  options: SegmentedOption<T>[]
  onChange: (next: T) => void
  ariaLabel: string
  testIdPrefix: string
}

function SegmentedRow<T extends string | number>({
  value,
  options,
  onChange,
  ariaLabel,
  testIdPrefix,
}: SegmentedRowProps<T>) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className="inline-flex w-full gap-1 rounded-md border border-border bg-card p-1"
    >
      {options.map((opt) => {
        const active = value === opt.value
        return (
          <button
            key={String(opt.value)}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(opt.value)}
            data-testid={`${testIdPrefix}-${opt.value}`}
            className={cn(
              "flex-1 rounded-sm px-3 py-1.5 text-sm font-medium transition-all",
              active
                ? "bg-secondary text-foreground shadow-sm ring-2 ring-primary ring-inset"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {opt.label}
          </button>
        )
      })}
    </div>
  )
}
