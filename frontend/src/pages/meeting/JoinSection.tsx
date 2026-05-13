// Participant register / re-entry — Soma redesign of ParticipantEntry.
//   - 1st visit: capture nickname + PIN + 필수 참여자 flag
//   - Re-entry: same form re-uses the same endpoint; matching nickname+PIN
//     re-issues the participant cookie (see Spec §5.1 / §6 — Q7)
//
// v4 (Phase F):
//   - Soma layout — header + meeting context card + identity form + footer
//     privacy notice
//   - Buffer UI is REMOVED from join. The page now sends a sensible default
//     (online → 0, offline/any → 60) and the user adjusts it inline from
//     the SelfCard BufferChips after joining (Phase E flow).
//   - PIN is now required (4-digit). The old "PIN optional" copy retired.

import { useState } from "react"
import {
  AlertCircle,
  ArrowRight,
  Calendar as CalendarIcon,
  Clock,
  MapPin,
  Star,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useToast } from "@/components/ui/toast"
import { api } from "@/lib/api"
import { ApiError, type LocationType, type MeetingDetail } from "@/lib/types"
import { cn } from "@/lib/cn"

const PIN_REGEX = /^\d{4}$/

const LOCATION_LABEL: Record<LocationType, string> = {
  online: "온라인",
  offline: "오프라인",
  any: "온라인/오프라인 모두 가능",
}

interface Props {
  slug: string
  meeting: MeetingDetail
  locationType: LocationType
  onJoined: (nickname: string, token?: string) => void
}

export function JoinSection({ slug, meeting, locationType, onJoined }: Props) {
  const { toast } = useToast()
  const [nickname, setNickname] = useState("")
  const [pin, setPin] = useState("")
  const [isRequired, setIsRequired] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [touched, setTouched] = useState(false)
  const [serverError, setServerError] = useState<string | null>(null)

  const trimmedNickname = nickname.trim()
  const nicknameError =
    touched && trimmedNickname.length === 0
      ? "이름을 입력해 주세요."
      : touched && trimmedNickname.length > 50
        ? "이름은 50자 이내여야 합니다."
        : null
  const pinError =
    touched && !PIN_REGEX.test(pin)
      ? "PIN은 숫자 4자리입니다."
      : null

  async function handleJoin(e: React.FormEvent) {
    e.preventDefault()
    setTouched(true)
    setServerError(null)

    if (trimmedNickname.length === 0 || trimmedNickname.length > 50) return
    if (!PIN_REGEX.test(pin)) return

    // Buffer default — online meetings don't need a buffer, others get 60 min.
    // Editable from SelfCard inline BufferChips once joined.
    const buffer_minutes = locationType === "online" ? 0 : 60

    setSubmitting(true)
    try {
      const res = await api.joinMeeting(slug, {
        nickname: trimmedNickname,
        pin,
        is_required: isRequired || undefined,
        buffer_minutes,
      })
      toast(
        isRequired
          ? `${res.nickname}님으로 진입했습니다. 필수 참여자로 표시되었습니다.`
          : `${res.nickname}님으로 진입했습니다.`,
        "success",
      )
      onJoined(res.nickname, res.token)
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "등록에 실패했습니다."
      setServerError(msg)
      toast(msg, "error")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <section className="flex flex-col gap-6">
      <header className="text-center sm:text-left">
        <h1 className="text-[22px] font-extrabold leading-tight tracking-[-0.5px] text-foreground lg:text-[26px]">
          회의에 참여하기
        </h1>
        <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
          이름과 PIN을 입력하면 가용 시간을 입력할 수 있어요.
        </p>
      </header>

      <div className="mx-auto w-full max-w-[480px]">
        <div className="flex flex-col gap-5">
          {/* Meeting context card */}
          <div
            data-testid="join-meeting-context"
            className="rounded-2xl border border-border bg-card p-4 sm:p-5"
          >
            <div className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
              참여 요청
            </div>
            <h2 className="mt-2 text-[18px] font-extrabold leading-tight tracking-[-0.4px] text-foreground lg:text-[20px]">
              {meeting.title}
            </h2>
            <div className="mt-2.5 flex flex-wrap gap-3 text-[12.5px] font-medium text-muted-foreground">
              <span className="inline-flex items-center gap-1.5">
                <CalendarIcon className="h-3.5 w-3.5" aria-hidden="true" />
                {formatDateScope(meeting)}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <Clock className="h-3.5 w-3.5" aria-hidden="true" />
                {meeting.duration_minutes}분
              </span>
              <span className="inline-flex items-center gap-1.5">
                <MapPin className="h-3.5 w-3.5" aria-hidden="true" />
                {LOCATION_LABEL[locationType]}
              </span>
            </div>
          </div>

          {/* Form */}
          <form
            onSubmit={handleJoin}
            data-testid="join-form"
            className="flex flex-col gap-4"
            noValidate
          >
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="join-nickname-input">
                이름 <span className="text-destructive">*</span>
              </Label>
              <Input
                id="join-nickname-input"
                value={nickname}
                onChange={(e) => setNickname(e.target.value)}
                placeholder="예: 김지윤"
                maxLength={50}
                autoComplete="off"
                aria-invalid={nicknameError ? "true" : undefined}
                data-testid="join-nickname"
                className={cn(
                  nicknameError && "border-destructive focus-visible:border-destructive",
                )}
              />
              {nicknameError ? (
                <FieldError message={nicknameError} />
              ) : null}
            </div>

            <div className="flex flex-col gap-1.5">
              <div className="flex items-baseline justify-between gap-2">
                <Label htmlFor="join-pin-input">
                  PIN (숫자 4자리) <span className="text-destructive">*</span>
                </Label>
                <span className="text-[11px] text-muted-foreground">
                  다음 진입 시 본인 확인에 사용됩니다
                </span>
              </div>
              <Input
                id="join-pin-input"
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 4))}
                placeholder="4자리 숫자"
                inputMode="numeric"
                maxLength={4}
                autoComplete="off"
                aria-invalid={pinError ? "true" : undefined}
                data-testid="join-pin"
                className={cn(
                  "font-mono tracking-[0.4em]",
                  pinError && "border-destructive focus-visible:border-destructive",
                )}
              />
              {pinError ? <FieldError message={pinError} /> : null}
            </div>

            <div className="flex flex-col gap-1.5">
              <Label>필수 참여자 설정</Label>
              <p className="-mt-0.5 text-[11px] text-muted-foreground">
                필수로 설정하면 이 사람이 가능한 시간만 추천에 포함됩니다.
              </p>
              <ToggleRow
                checked={isRequired}
                onChange={setIsRequired}
                title="필수 참여자입니다"
                description="내가 참여할 수 있는 시간대 중에서만 추천이 만들어집니다."
                testId="join-required-checkbox"
              />
            </div>

            {serverError ? (
              <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-2.5 text-sm text-destructive">
                <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <span>{serverError}</span>
              </div>
            ) : null}

            <Button
              type="submit"
              size="lg"
              disabled={submitting}
              data-testid="join-submit"
              className="h-13 w-full"
            >
              {submitting ? "확인 중..." : "참여하기"}
              {!submitting ? <ArrowRight className="h-4 w-4" /> : null}
            </Button>
          </form>

          <p className="text-center text-[11.5px] leading-relaxed text-[color:var(--soma-faint)]">
            SomaMeet은 캘린더 정보를 저장하지 않습니다.
            <br />
            입력한 가용 시간은 90일 후 자동 삭제됩니다.
          </p>
        </div>
      </div>
    </section>
  )
}

// ---------- helpers ----------

function FieldError({ message }: { message: string }) {
  return (
    <div className="flex items-center gap-1.5 text-xs font-medium text-destructive">
      <span
        aria-hidden="true"
        className="inline-block h-1 w-1 rounded-full bg-destructive"
      />
      {message}
    </div>
  )
}

interface ToggleRowProps {
  checked: boolean
  onChange: (next: boolean) => void
  title: string
  description: string
  testId?: string
}

function ToggleRow({ checked, onChange, title, description, testId }: ToggleRowProps) {
  return (
    <label
      className={cn(
        "flex cursor-pointer items-start gap-3 rounded-xl border bg-background p-3 transition-colors",
        checked
          ? "border-primary bg-[var(--soma-primary-soft)]"
          : "border-border hover:bg-card",
      )}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-1 h-4 w-4 rounded border-border accent-primary"
        data-testid={testId}
      />
      <div className="flex-1">
        <div className="flex items-center gap-1.5 text-sm font-bold text-foreground">
          <Star
            className={cn(
              "h-3.5 w-3.5",
              checked ? "text-primary" : "text-muted-foreground",
            )}
            aria-hidden="true"
          />
          {title}
        </div>
        <div className="mt-0.5 text-xs leading-snug text-muted-foreground">
          {description}
        </div>
      </div>
    </label>
  )
}

function formatDateScope(meeting: MeetingDetail): string {
  if (meeting.date_mode === "range") {
    if (!meeting.date_range_start || !meeting.date_range_end) return "-"
    return `${formatDateShort(meeting.date_range_start)} – ${formatDateShort(meeting.date_range_end)}`
  }
  const dates = meeting.candidate_dates ?? []
  if (dates.length === 0) return "-"
  if (dates.length <= 2) return dates.map(formatDateShort).join(", ")
  return `${formatDateShort(dates[0])} 외 ${dates.length - 1}일`
}

function formatDateShort(iso: string): string {
  const [, m, d] = iso.split("-")
  if (!m || !d) return iso
  return `${Number.parseInt(m, 10)}월 ${Number.parseInt(d, 10)}일`
}
