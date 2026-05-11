// Create-meeting form. Spec §5.1 / §6 / §10.E1 — date_mode tabs, location segmented,
// buffer select (hidden when location=online), weekend toggle.
//
// v3.1 simplify pass (2026-05-06):
//   - "참여 인원 (target)" input removed entirely.
//   - Layout split: lg≥ → 2-col grid (calendar | controls), <lg → vertical stack.
//   - Title input stays in the common header above the grid.
//
// Visual: Joonggon-style card-in-card layout with the big "SomaMeet" display heading.

import { useState } from "react"
import { useNavigate } from "react-router-dom"
import { useForm, Controller } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { Loader2 } from "lucide-react"
import { z } from "zod"
import { api } from "@/lib/api"
import {
  ApiError,
  type DateMode,
  type LocationType,
  type MeetingCreateRequest,
} from "@/lib/types"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select } from "@/components/ui/select"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { DateRangeOrPicker } from "@/components/DateRangeOrPicker"
import { useToast } from "@/components/ui/toast"
import { cn } from "@/lib/cn"

const dateRegex = /^\d{4}-\d{2}-\d{2}$/

const schema = z
  .object({
    title: z.string().max(200, "제목은 200자 이내여야 합니다"),
    date_mode: z.enum(["range", "picked"]),
    date_range_start: z.string().nullable(),
    date_range_end: z.string().nullable(),
    candidate_dates: z.array(z.string()).nullable(),
    duration_minutes: z.coerce.number().int().refine(
      (v) => [30, 60, 90, 120, 150, 180].includes(v),
      "30/60/90/120/150/180 중에서 선택하세요",
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

  const {
    register,
    handleSubmit,
    control,
    watch,
    setValue,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues,
  })

  const dateMode = watch("date_mode")

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

  return (
    <main className="linear-container flex min-h-screen flex-col gap-6 py-10 sm:py-14">
      <Card className="surface-edge rounded-xl">
        <CardHeader className="border-b border-border">
          <h1 className="font-display text-[clamp(30px,4vw,48px)] font-semibold leading-[1.1] tracking-[-1.4px] text-foreground">
            SomaMeet
          </h1>
          <CardDescription className="text-base leading-7">
            팀의 공통 가능 시간을 빠르게 찾아드립니다. 회의 정보를 입력해 시작하세요.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-6 lg:p-8">
          <form className="flex flex-col gap-6" onSubmit={handleSubmit(onSubmit)} noValidate>
            {/* Common header — title sits above the 2-column grid. */}
            <div className="flex flex-col gap-2">
              <Label htmlFor="title">제목</Label>
              <Input
                id="title"
                placeholder="예: 1주차 스프린트 회고"
                className="h-12 text-lg font-semibold"
                {...register("title")}
              />
              {errors.title ? (
                <p className="text-xs text-destructive">{errors.title.message}</p>
              ) : null}
            </div>

            {/* lg≥: calendar (left, fixed 20rem so tab swaps don't jitter) + controls (right, 1fr). Below lg: vertical stack. */}
            <div className="grid gap-6 lg:grid-cols-[20rem_1fr] lg:items-start">
              {/* LEFT — calendar (no inner card; outer form card already provides surface) */}
              <section className="flex flex-col gap-2">
                <Label>날짜 선택</Label>
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
                                    // Clear the inactive mode's values so payload stays clean.
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
                {dateMode === "range" ? (
                  <>
                    {errors.date_range_start ? (
                      <p className="text-xs text-destructive">
                        {errors.date_range_start.message}
                      </p>
                    ) : null}
                    {errors.date_range_end ? (
                      <p className="text-xs text-destructive">
                        {errors.date_range_end.message}
                      </p>
                    ) : null}
                  </>
                ) : (
                  errors.candidate_dates ? (
                    <p className="text-xs text-destructive">
                      {errors.candidate_dates.message as string}
                    </p>
                  ) : null
                )}
              </section>

              {/* RIGHT — controls panel: duration, location, buffer (cond), time window, weekends */}
              <section className="flex flex-col gap-5">
                <div className="flex flex-col gap-2">
                  <Label htmlFor="duration_minutes">회의 길이</Label>
                  <Select id="duration_minutes" {...register("duration_minutes")}>
                    <option value={30}>30분</option>
                    <option value={60}>60분</option>
                    <option value={90}>90분</option>
                    <option value={120}>120분</option>
                    <option value={150}>150분</option>
                    <option value={180}>180분</option>
                  </Select>
                  {errors.duration_minutes ? (
                    <p className="text-xs text-destructive">
                      {errors.duration_minutes.message}
                    </p>
                  ) : null}
                </div>

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
                        className="inline-flex w-fit gap-1 rounded-md border border-border bg-card p-1"
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
                    )}
                  />
                  {errors.location_type ? (
                    <p className="text-xs text-destructive">{errors.location_type.message}</p>
                  ) : null}
                </fieldset>

              </section>
            </div>

            {submitError ? (
              <Alert variant="destructive">
                <AlertTitle>회의 생성 실패</AlertTitle>
                <AlertDescription>{submitError}</AlertDescription>
              </Alert>
            ) : null}

            <Button type="submit" size="lg" disabled={submitting} data-testid="create-submit">
              {submitting ? <Loader2 className="animate-spin" /> : null}
              {submitting ? "초대 링크 생성 중…" : "회의 만들기"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  )
}
