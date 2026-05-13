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
import { AlertCircle, ArrowRight, User } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useToast } from "@/components/ui/toast"
import { api } from "@/lib/api"
import { ApiError, type LocationType } from "@/lib/types"
import { cn } from "@/lib/cn"

const PIN_REGEX = /^\d{4}$/

interface Props {
  slug: string
  locationType: LocationType
  onJoined: (nickname: string, token?: string) => void
}

export function JoinSection({ slug, locationType, onJoined }: Props) {
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
    <section className="rounded-2xl border border-border bg-background p-5 sm:p-6">
      <header className="mb-5 flex items-center gap-3">
        <div
          aria-hidden="true"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--soma-primary-soft)] text-primary"
        >
          <User className="h-4 w-4" />
        </div>
        <div className="min-w-0">
          <div className="text-[14.5px] font-bold tracking-tight text-foreground">
            회의에 참여하기
          </div>
          <div className="text-xs text-muted-foreground">
            이름과 PIN을 입력하면 가용 시간을 입력할 수 있어요
          </div>
        </div>
      </header>

      <div>
        <div className="flex flex-col gap-5">
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
                placeholder="1234"
                inputMode="numeric"
                maxLength={4}
                autoComplete="off"
                aria-invalid={pinError ? "true" : undefined}
                data-testid="join-pin"
                style={{
                  fontFamily:
                    "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace",
                  letterSpacing: "0.35em",
                }}
                className={cn(
                  "text-base md:text-base placeholder:text-muted-foreground/60",
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

// iOS-style toggle switch matching soma-meeting.jsx ToggleRow (L569). The
// previous version used a checkbox + Star icon; the mockup expects a real
// switch. data-testid is preserved on the outer button so e2e selectors that
// previously targeted the checkbox keep working as a click target.
function ToggleRow({ checked, onChange, title, description, testId }: ToggleRowProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      data-testid={testId}
      className={cn(
        "flex w-full items-center gap-3 rounded-xl border bg-background px-3.5 py-3 text-left transition-colors",
        checked
          ? "border-primary bg-[var(--soma-primary-soft)]"
          : "border-border hover:bg-card",
      )}
    >
      <div className="min-w-0 flex-1">
        <div className="text-[13.5px] font-bold tracking-tight text-foreground">
          {title}
        </div>
        <div className="mt-0.5 text-xs leading-snug text-muted-foreground">
          {description}
        </div>
      </div>
      <span
        aria-hidden="true"
        className={cn(
          "relative inline-block h-5 w-9 shrink-0 rounded-full transition-colors",
          checked ? "bg-primary" : "bg-border",
        )}
      >
        <span
          className={cn(
            "absolute top-0.5 h-4 w-4 rounded-full bg-white shadow-[0_1px_2px_rgba(15,23,42,0.18)] transition-all",
            checked ? "left-[18px]" : "left-0.5",
          )}
        />
      </span>
    </button>
  )
}

