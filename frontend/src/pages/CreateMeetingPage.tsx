// Create-meeting form. Spec §5.1 / §6 / §10.E1 — date_mode tabs, segmented
// location + duration, react-day-picker for both range and picked modes.
//
// v3.1 simplify pass (2026-05-06):
//   - "참여 인원 (target)" input removed entirely.
// v4 (2026-05-13) — Soma redesign:
//   - Single-column centered form (max 680px). The earlier 2-column
//     layout with a sticky SharePreviewCard on the right was dropped
//     in favor of a focused form view — the share preview was a
//     placeholder anyway (real URL/QR only exist after submit), and
//     the page navigates straight to the meeting detail on success.
//   - Duration switched from <select> to segmented testid buttons
//     (duration-30/60/90/120) for visual consistency with location.
//   - TopBar reduced to the SomaMeet wordmark; "도움말" removed.
//   - Header text moves to h1 "회의 만들기" + subtitle; the standalone
//     "SomaMeet" display heading is now the TopBar wordmark only.

import { useState } from "react"
import { useNavigate } from "react-router-dom"
import {
  useForm,
  Controller,
  useWatch,
  type Control,
  type FieldErrors,
} from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { ArrowRight, Loader2 } from "lucide-react"
import { z } from "zod"
import { api } from "@/lib/api"
import {
  ApiError,
  type DateMode,
  type LocationType,
  type MeetingCreateRequest,
} from "@/lib/types"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { DateRangeOrPicker } from "@/components/DateRangeOrPicker"
import { useToast } from "@/components/ui/toast"
import { cn } from "@/lib/cn"

const dateRegex = /^\d{4}-\d{2}-\d{2}$/
const TITLE_MAX = 60

const schema = z
  .object({
    title: z.string().max(TITLE_MAX, `제목은 ${TITLE_MAX}자 이내여야 합니다`),
    date_mode: z.enum(["range", "picked"]),
    date_range_start: z.string().nullable(),
    date_range_end: z.string().nullable(),
    candidate_dates: z.array(z.string()).nullable(),
    duration_minutes: z.coerce.number().int().refine(
      (v) => [30, 60, 90, 120].includes(v),
      "30/60/90/120 중에서 선택하세요",
    ),
    location_type: z.enum(["online", "offline", "any"]),
    include_weekends: z.boolean(),
  })
  .superRefine((v, ctx) => {
    if (v.date_mode === "range") {
      if (!v.date_range_start || !dateRegex.test(v.date_range_start)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["date_range_start"],
          message: "시작일을 선택하세요",
        })
      }
      if (!v.date_range_end || !dateRegex.test(v.date_range_end)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["date_range_end"],
          message: "종료일을 선택하세요",
        })
      }
      if (
        v.date_range_start &&
        v.date_range_end &&
        v.date_range_end < v.date_range_start
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["date_range_end"],
          message: "종료일은 시작일과 같거나 이후여야 합니다",
        })
      }
    } else {
      if (!v.candidate_dates || v.candidate_dates.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["candidate_dates"],
          message: "날짜를 1개 이상 선택하세요",
        })
      }
    }
  })

type FormValues = z.infer<typeof schema>

const defaultValues: FormValues = {
  title: "",
  date_mode: "range" satisfies DateMode,
  date_range_start: null,
  date_range_end: null,
  candidate_dates: null,
  duration_minutes: 60,
  location_type: "offline" satisfies LocationType,
  // v3.21 — "주말도 포함" 체크박스 UI 가 제거되어 항상 true 로 시작합니다.
  // 주말 제외 회의를 만들고 싶으면 picked 모드에서 평일만 골라 주세요.
  include_weekends: true,
}

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

export default function CreateMeetingPage() {
  const { toast } = useToast()
  const navigate = useNavigate()
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  // Top-level useForm — note we deliberately do NOT call `watch()` here.
  // Calling `watch()` at the component root makes every field change trigger
  // a re-render of the entire page (including the DayPicker subtree),
  // which causes the "calendar click feels laggy" report. Instead, individual
  // sub-fields read their own values via Controller render-props or useWatch.
  const {
    register,
    handleSubmit,
    control,
    setValue,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues,
  })

  async function onSubmit(values: FormValues) {
    setSubmitting(true)
    setSubmitError(null)
    try {
      // Spec §5.1: build payload that matches the union — null out the fields not relevant to the chosen mode.
      const payload: MeetingCreateRequest =
        values.date_mode === "range"
          ? {
              title: values.title,
              date_mode: "range",
              date_range_start: values.date_range_start,
              date_range_end: values.date_range_end,
              candidate_dates: null,
              duration_minutes: values.duration_minutes,
              location_type: values.location_type,
              include_weekends: values.include_weekends,
            }
          : {
              title: values.title,
              date_mode: "picked",
              date_range_start: null,
              date_range_end: null,
              candidate_dates: values.candidate_dates,
              duration_minutes: values.duration_minutes,
              location_type: values.location_type,
              include_weekends: values.include_weekends,
            }

      const res = await api.createMeeting(payload)
      toast("회의가 생성되었습니다.", "success")
      // v3.3: navigate straight to the meeting page (no success card stop).
      navigate(`/m/${res.slug}`, { replace: true })
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "알 수 없는 오류가 발생했습니다."
      setSubmitError(message)
      toast(message, "error")
    } finally {
      setSubmitting(false)
    }
  }

  const titleField = (
    <TitleField control={control} register={register} errors={errors} />
  )

  const durationField = (
    <fieldset className="flex flex-col gap-2">
      <legend className="text-sm font-medium text-foreground">진행 시간</legend>
      <Controller
        control={control}
        name="duration_minutes"
        render={({ field }) => (
          <div
            role="radiogroup"
            aria-label="진행 시간"
            data-testid="duration-segmented"
            className="inline-flex w-full gap-1 rounded-md border border-border bg-card p-1"
          >
            {DURATION_OPTIONS.map((opt) => {
              const active = Number(field.value) === opt.value
              return (
                <button
                  key={opt.value}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  data-testid={`duration-${opt.value}`}
                  onClick={() => field.onChange(opt.value)}
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
        )}
      />
      {errors.duration_minutes ? (
        <p className="text-xs text-destructive">{errors.duration_minutes.message}</p>
      ) : null}
    </fieldset>
  )

  const locationField = (
    <fieldset className="flex flex-col gap-2">
      <legend className="text-sm font-medium text-foreground">진행 방식</legend>
      <Controller
        control={control}
        name="location_type"
        render={({ field }) => (
          <div
            role="radiogroup"
            aria-label="진행 방식"
            data-testid="location-segmented"
            className="inline-flex w-full gap-1 rounded-md border border-border bg-card p-1"
          >
            {LOCATION_OPTIONS.map((opt) => {
              const active = field.value === opt.value
              return (
                <button
                  key={opt.value}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  data-testid={`location-${opt.value}`}
                  onClick={() => field.onChange(opt.value)}
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
        )}
      />
      {errors.location_type ? (
        <p className="text-xs text-destructive">{errors.location_type.message}</p>
      ) : null}
    </fieldset>
  )

  const periodField = (
    <fieldset className="flex flex-col gap-2">
      <legend className="text-sm font-medium text-foreground">회의 기간</legend>
      <Controller
        control={control}
        name="date_mode"
        render={({ field: modeField }) => (
          <Controller
            control={control}
            name="date_range_start"
            render={({ field: rangeStartField }) => (
              <Controller
                control={control}
                name="date_range_end"
                render={({ field: rangeEndField }) => (
                  <Controller
                    control={control}
                    name="candidate_dates"
                    render={({ field: pickedField }) => (
                      <DateRangeOrPicker
                        mode={modeField.value}
                        onModeChange={(m) => {
                          modeField.onChange(m)
                          if (m === "range") {
                            setValue("candidate_dates", null)
                          } else {
                            setValue("date_range_start", null)
                            setValue("date_range_end", null)
                          }
                        }}
                        rangeStart={rangeStartField.value}
                        rangeEnd={rangeEndField.value}
                        pickedDates={pickedField.value ?? []}
                        onRangeChange={(s, e) => {
                          rangeStartField.onChange(s)
                          rangeEndField.onChange(e)
                        }}
                        onPickedChange={(arr) => pickedField.onChange(arr)}
                      />
                    )}
                  />
                )}
              />
            )}
          />
        )}
      />
      <PeriodErrors control={control} errors={errors} />
    </fieldset>
  )

  const form = (
    <form
      className="flex flex-col gap-6"
      onSubmit={handleSubmit(onSubmit)}
      noValidate
    >
      {titleField}
      <div className="grid gap-5 lg:grid-cols-2">
        {durationField}
        {locationField}
      </div>
      {periodField}

      {submitError ? (
        <Alert variant="destructive">
          <AlertTitle>회의 생성 실패</AlertTitle>
          <AlertDescription>{submitError}</AlertDescription>
        </Alert>
      ) : null}

      <div className="flex flex-col items-stretch gap-2 lg:flex-row lg:items-center">
        <Button
          type="submit"
          size="lg"
          disabled={submitting}
          data-testid="create-submit"
          className="h-13 lg:h-13 lg:px-7"
        >
          {submitting ? <Loader2 className="animate-spin" /> : null}
          {submitting ? "초대 링크 생성 중…" : "회의 만들고 링크 받기"}
          {!submitting ? <ArrowRight className="h-4 w-4" /> : null}
        </Button>
        <span className="text-xs font-medium text-muted-foreground lg:ml-2">
          생성 직후 링크와 QR을 바로 복사할 수 있어요.
        </span>
      </div>
    </form>
  )

  return (
    <div className="min-h-screen bg-background text-foreground">
      <TopBar />
      <main className="linear-container px-5 py-6 sm:py-10 lg:px-10 lg:py-12">
        <header className="mb-7 lg:mb-9">
          <h1 className="text-2xl font-extrabold leading-tight tracking-[-0.5px] text-foreground lg:text-[30px]">
            회의 만들기
          </h1>
          <p className="mt-2 max-w-[540px] text-sm leading-relaxed text-muted-foreground lg:text-[15px]">
            2분이면 충분해요. 링크를 공유하면 팀원이 시간을 입력합니다.
          </p>
        </header>

        <div className="mx-auto w-full max-w-[680px]">{form}</div>
      </main>
    </div>
  )
}

interface TitleFieldProps {
  control: Control<FormValues>
  register: ReturnType<typeof useForm<FormValues>>["register"]
  errors: FieldErrors<FormValues>
}

// Isolated so keystroke-driven character-count updates don't re-render the
// page (and the DayPicker subtree) — only this fragment is reactive
// to the `title` field via useWatch's own subscription.
function TitleField({ control, register, errors }: TitleFieldProps) {
  const titleValue = useWatch({ control, name: "title" }) ?? ""
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <Label htmlFor="title">제목</Label>
        <span className="text-xs font-medium text-muted-foreground">
          {titleValue.length}/{TITLE_MAX}
        </span>
      </div>
      <Input
        id="title"
        placeholder="(선택) 회의 제목을 입력해 주세요"
        maxLength={TITLE_MAX}
        {...register("title")}
      />
      {errors.title ? (
        <p className="text-xs text-destructive">{errors.title.message}</p>
      ) : null}
    </div>
  )
}

interface PeriodErrorsProps {
  control: Control<FormValues>
  errors: FieldErrors<FormValues>
}

// Same isolation pattern for the date_mode-dependent error block. Previously
// the parent component called watch("date_mode") which made every Controller
// onChange (including each calendar cell click) re-render the entire page.
function PeriodErrors({ control, errors }: PeriodErrorsProps) {
  const dateMode = useWatch({ control, name: "date_mode" })
  if (dateMode === "range") {
    return (
      <>
        {errors.date_range_start ? (
          <p className="text-xs text-destructive">{errors.date_range_start.message}</p>
        ) : null}
        {errors.date_range_end ? (
          <p className="text-xs text-destructive">{errors.date_range_end.message}</p>
        ) : null}
      </>
    )
  }
  if (errors.candidate_dates) {
    return (
      <p className="text-xs text-destructive">
        {errors.candidate_dates.message as string}
      </p>
    )
  }
  return null
}

function TopBar() {
  return (
    <div className="sticky top-0 z-10 flex h-14 items-center border-b border-border bg-background px-5 lg:px-10">
      <div className="flex items-center gap-2.5">
        <div className="flex h-6.5 w-6.5 items-center justify-center rounded-md bg-primary">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <rect x="3" y="3" width="10" height="10" rx="2" stroke="#fff" strokeWidth="1.6" />
            <path
              d="M6 7l1.5 1.5L11 5"
              stroke="#fff"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>
        <div className="text-[15px] font-bold tracking-tight text-foreground">SomaMeet</div>
      </div>
    </div>
  )
}
