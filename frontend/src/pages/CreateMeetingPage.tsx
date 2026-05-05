import { useState } from "react"
import { Link } from "react-router-dom"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { api } from "@/lib/api"
import { ApiError, type LocationType, type MeetingCreateResponse } from "@/lib/types"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select } from "@/components/ui/select"
import { CopyableUrl } from "@/components/CopyableUrl"
import { useToast } from "@/components/ui/toast"

const dateRegex = /^\d{4}-\d{2}-\d{2}$/
const timeRegex = /^\d{2}:\d{2}$/

const schema = z
  .object({
    title: z.string().min(1, "제목을 입력하세요").max(200, "제목은 200자 이내여야 합니다"),
    date_range_start: z.string().regex(dateRegex, "올바른 날짜 형식(YYYY-MM-DD)이 아닙니다"),
    date_range_end: z.string().regex(dateRegex, "올바른 날짜 형식(YYYY-MM-DD)이 아닙니다"),
    duration_minutes: z.coerce.number().int().refine(
      (v) => [30, 60, 90, 120].includes(v),
      "30/60/90/120 중에서 선택하세요",
    ),
    participant_count: z.coerce
      .number({ invalid_type_error: "숫자를 입력하세요" })
      .int("정수만 입력 가능합니다")
      .min(2, "최소 2명 이상이어야 합니다")
      .max(50, "최대 50명까지 지원합니다"),
    location_type: z.enum(["online", "offline", "any"]),
    time_window_start: z.string().regex(timeRegex, "HH:MM 형식으로 입력하세요"),
    time_window_end: z.string().regex(timeRegex, "HH:MM 형식으로 입력하세요"),
    include_weekends: z.boolean(),
  })
  .refine((v) => v.date_range_end >= v.date_range_start, {
    path: ["date_range_end"],
    message: "종료일은 시작일과 같거나 이후여야 합니다",
  })
  .refine((v) => v.time_window_end > v.time_window_start, {
    path: ["time_window_end"],
    message: "종료 시각은 시작 시각보다 이후여야 합니다",
  })

type FormValues = z.infer<typeof schema>

const defaultValues: FormValues = {
  title: "",
  date_range_start: "",
  date_range_end: "",
  duration_minutes: 60,
  participant_count: 4,
  location_type: "offline" satisfies LocationType,
  time_window_start: "09:00",
  time_window_end: "22:00",
  include_weekends: false,
}

export default function CreateMeetingPage() {
  const { toast } = useToast()
  const [submitting, setSubmitting] = useState(false)
  const [result, setResult] = useState<MeetingCreateResponse | null>(null)
  const [submitError, setSubmitError] = useState<string | null>(null)

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues,
  })

  async function onSubmit(values: FormValues) {
    setSubmitting(true)
    setSubmitError(null)
    try {
      const res = await api.createMeeting(values)
      setResult(res)
      toast("회의가 생성되었습니다.", "success")
      // Push organizer URL into history without forcing a navigation away from the success card.
      window.history.replaceState(null, "", `/m/${res.slug}?org=${encodeURIComponent(res.organizer_token)}`)
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "알 수 없는 오류가 발생했습니다."
      setSubmitError(message)
      toast(message, "error")
    } finally {
      setSubmitting(false)
    }
  }

  if (result) {
    return (
      <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-6 p-6 sm:py-12">
        <header>
          <h1 className="text-2xl font-semibold text-slate-900">회의가 생성되었습니다</h1>
          <p className="mt-1 text-sm text-slate-600">
            아래 두 링크는 용도가 다릅니다. 정확히 구분해 사용하세요.
          </p>
        </header>

        <div className="flex flex-col gap-3">
          <CopyableUrl
            label="내 관리용 링크 — 공유 금지"
            url={result.organizer_url}
            warning="이 링크는 주최자 전용입니다. 절대 팀원에게 공유하지 마세요."
          />
          <CopyableUrl label="팀원에게 공유할 링크" url={result.share_url} />
        </div>

        <Card>
          <CardContent className="flex flex-col gap-3">
            <p className="text-sm text-slate-600">
              주최자 페이지로 이동해 참여자 입력을 모니터링하고 후보를 계산하세요.
            </p>
            <Link
              to={`/m/${result.slug}?org=${encodeURIComponent(result.organizer_token)}`}
              className="inline-flex h-10 items-center justify-center rounded-md bg-accent px-4 text-sm font-medium text-accent-foreground hover:bg-blue-700"
            >
              주최자 페이지로 이동
            </Link>
          </CardContent>
        </Card>
      </main>
    )
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-6 p-6 sm:py-12">
      <header>
        <h1 className="text-2xl font-semibold text-slate-900">SomaMeet</h1>
        <p className="mt-1 text-sm text-slate-600">
          팀의 공통 가능 시간을 빠르게 찾아드립니다. 회의 정보를 입력해 시작하세요.
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>새 회의 만들기</CardTitle>
          <CardDescription>모든 시간은 한국 표준시(KST)로 처리됩니다.</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="flex flex-col gap-5" onSubmit={handleSubmit(onSubmit)} noValidate>
            <div className="flex flex-col gap-2">
              <Label htmlFor="title">제목</Label>
              <Input id="title" placeholder="예: 1주차 스프린트 회고" {...register("title")} />
              {errors.title ? (
                <p className="text-xs text-red-600">{errors.title.message}</p>
              ) : null}
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-2">
                <Label htmlFor="date_range_start">시작일</Label>
                <Input id="date_range_start" type="date" {...register("date_range_start")} />
                {errors.date_range_start ? (
                  <p className="text-xs text-red-600">{errors.date_range_start.message}</p>
                ) : null}
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="date_range_end">종료일</Label>
                <Input id="date_range_end" type="date" {...register("date_range_end")} />
                {errors.date_range_end ? (
                  <p className="text-xs text-red-600">{errors.date_range_end.message}</p>
                ) : null}
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-2">
                <Label htmlFor="duration_minutes">회의 길이</Label>
                <Select id="duration_minutes" {...register("duration_minutes")}>
                  <option value={30}>30분</option>
                  <option value={60}>60분</option>
                  <option value={90}>90분</option>
                  <option value={120}>120분</option>
                </Select>
                {errors.duration_minutes ? (
                  <p className="text-xs text-red-600">{errors.duration_minutes.message}</p>
                ) : null}
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="participant_count">참여 예상 인원</Label>
                <Input
                  id="participant_count"
                  type="number"
                  min={2}
                  step={1}
                  {...register("participant_count")}
                />
                {errors.participant_count ? (
                  <p className="text-xs text-red-600">{errors.participant_count.message}</p>
                ) : null}
              </div>
            </div>

            <fieldset className="flex flex-col gap-2">
              <legend className="text-sm font-medium text-slate-700">진행 방식</legend>
              <div className="flex flex-wrap gap-4">
                <label className="inline-flex items-center gap-2 text-sm text-slate-700">
                  <input type="radio" value="online" {...register("location_type")} /> 온라인
                </label>
                <label className="inline-flex items-center gap-2 text-sm text-slate-700">
                  <input type="radio" value="offline" {...register("location_type")} /> 오프라인
                </label>
                <label className="inline-flex items-center gap-2 text-sm text-slate-700">
                  <input type="radio" value="any" {...register("location_type")} /> 둘 다 가능
                </label>
              </div>
              {errors.location_type ? (
                <p className="text-xs text-red-600">{errors.location_type.message}</p>
              ) : null}
              <p className="text-xs text-slate-500">
                오프라인은 앞뒤 30분 버퍼를 자동 적용합니다.
              </p>
            </fieldset>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-2">
                <Label htmlFor="time_window_start">검색 시작 시각</Label>
                <Input id="time_window_start" type="time" {...register("time_window_start")} />
                {errors.time_window_start ? (
                  <p className="text-xs text-red-600">{errors.time_window_start.message}</p>
                ) : null}
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="time_window_end">검색 종료 시각</Label>
                <Input id="time_window_end" type="time" {...register("time_window_end")} />
                {errors.time_window_end ? (
                  <p className="text-xs text-red-600">{errors.time_window_end.message}</p>
                ) : null}
              </div>
            </div>

            <label className="inline-flex items-center gap-2 text-sm text-slate-700">
              <Checkbox {...register("include_weekends")} />
              주말도 포함
            </label>

            {submitError ? (
              <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
                {submitError}
              </div>
            ) : null}

            <Button type="submit" size="lg" disabled={submitting}>
              {submitting ? "생성 중..." : "회의 만들기"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  )
}
