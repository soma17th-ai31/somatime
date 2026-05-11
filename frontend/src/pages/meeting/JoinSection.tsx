// Participant register / re-entry — single combined form (Spec §5.1, §6 — Q7).
// v3.7: register endpoint also handles re-entry when nickname matches an existing
// submitted participant whose PIN matches the supplied one.
//   - new nickname            → create
//   - existing, no submission → refresh cookie (optional PIN update)
//   - existing, submitted     → PIN must match → re-issue cookie
//   - existing, submitted, no/wrong PIN → 409 nickname_conflict / 401 invalid_pin
// The dedicated `/participants/login` endpoint still exists in the API surface
// (kept for compatibility / future explicit-login flows) but the UI no longer
// exposes a separate login form.

import { useState } from "react"
import { Star } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select } from "@/components/ui/select"
import { useToast } from "@/components/ui/toast"
import { api } from "@/lib/api"
import { ApiError, type LocationType } from "@/lib/types"

interface Props {
  slug: string
  // #13 — online 회의면 buffer Select 미렌더 (payload 는 0 하드코딩).
  locationType: LocationType
  onJoined: (nickname: string) => void
}

const PIN_REGEX = /^\d{4}$/
const BUFFER_PLACEHOLDER = ""
const VALID_BUFFERS = new Set([0, 30, 60, 90, 120])

export function JoinSection({ slug, locationType, onJoined }: Props) {
  const { toast } = useToast()
  const [nickname, setNickname] = useState("")
  const [pin, setPin] = useState("")
  const [isRequired, setIsRequired] = useState(false)
  const [bufferDraft, setBufferDraft] = useState<string>(BUFFER_PLACEHOLDER)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const showBuffer = locationType !== "online"

  async function handleJoin(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    const trimmed = nickname.trim()
    if (trimmed.length === 0) {
      setError("닉네임을 입력하세요.")
      return
    }
    if (trimmed.length > 50) {
      setError("닉네임은 50자 이내여야 합니다.")
      return
    }
    if (pin.length > 0 && !PIN_REGEX.test(pin)) {
      setError("PIN은 4자리 숫자입니다.")
      return
    }

    let bufferMinutes: number
    if (showBuffer) {
      if (bufferDraft === BUFFER_PLACEHOLDER) {
        setError("이동 버퍼를 선택하세요.")
        return
      }
      const parsed = Number.parseInt(bufferDraft, 10)
      if (!Number.isFinite(parsed) || !VALID_BUFFERS.has(parsed)) {
        setError("이동 버퍼 값이 올바르지 않습니다.")
        return
      }
      bufferMinutes = parsed
    } else {
      bufferMinutes = 0
    }

    setSubmitting(true)
    try {
      const res = await api.joinMeeting(slug, {
        nickname: trimmed,
        pin: pin.length > 0 ? pin : undefined,
        is_required: isRequired || undefined,
        buffer_minutes: bufferMinutes,
      })
      toast(
        isRequired
          ? `${res.nickname}님으로 진입했습니다. 필수 참여자로 표시되었습니다.`
          : `${res.nickname}님으로 진입했습니다.`,
        "success",
      )
      onJoined(res.nickname)
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "등록에 실패했습니다."
      setError(msg)
      toast(msg, "error")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>참여자 등록 / 재진입</CardTitle>
        <CardDescription>
          처음이라면 닉네임을 입력해 등록하세요. 이미 등록한 닉네임이라면 동일 PIN을 함께
          입력하면 다시 진입할 수 있습니다.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form className="flex flex-col gap-3" onSubmit={handleJoin} data-testid="join-form">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Label htmlFor="nickname">닉네임</Label>
              <Input
                id="nickname"
                value={nickname}
                onChange={(e) => setNickname(e.target.value)}
                placeholder="팀에서 알아볼 수 있는 이름"
                maxLength={50}
                autoComplete="off"
                data-testid="join-nickname"
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="pin">PIN (선택, 4자리 숫자)</Label>
              <Input
                id="pin"
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 4))}
                placeholder="예: 1234"
                inputMode="numeric"
                maxLength={4}
                autoComplete="off"
                data-testid="join-pin"
              />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            처음 등록 시 PIN을 함께 설정해두면 다른 기기에서도 같은 닉네임으로 다시 진입할 수
            있습니다.
          </p>
          <label className="inline-flex items-center gap-2 text-sm text-foreground">
            <input
              type="checkbox"
              checked={isRequired}
              onChange={(e) => setIsRequired(e.target.checked)}
              className="h-4 w-4 rounded border-border accent-primary"
              data-testid="join-required-checkbox"
            />
            <Star
              className={
                isRequired
                  ? "h-3.5 w-3.5 text-primary"
                  : "h-3.5 w-3.5 text-muted-foreground"
              }
            />
            <span>필수 참여자 (예: 멘토 — 빠지면 안 되는 회의)</span>
          </label>
          {showBuffer ? (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="join-buffer">이동 버퍼 (필수)</Label>
              <Select
                id="join-buffer"
                value={bufferDraft}
                onChange={(e) => setBufferDraft(e.target.value)}
                data-testid="join-buffer-select"
              >
                <option value={BUFFER_PLACEHOLDER}>이동 버퍼를 선택하세요</option>
                <option value="0">0분 (버퍼 없음)</option>
                <option value="30">30분</option>
                <option value="60">60분</option>
                <option value="90">90분</option>
                <option value="120">120분</option>
              </Select>
              <p className="text-xs text-muted-foreground">
                본인의 이동시간 등을 반영해 후보 시간 앞뒤로 비워둘 시간입니다. 나중에
                개인 설정에서 수정할 수 있습니다.
              </p>
            </div>
          ) : null}
          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" disabled={submitting} data-testid="join-submit">
              {submitting ? "확인 중..." : "로그인"}
            </Button>
          </div>
          {error ? <p className="mt-1 text-sm text-destructive">{error}</p> : null}
        </form>
      </CardContent>
    </Card>
  )
}
