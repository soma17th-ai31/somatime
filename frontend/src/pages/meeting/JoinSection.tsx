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
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useToast } from "@/components/ui/toast"
import { api } from "@/lib/api"
import { ApiError } from "@/lib/types"

interface Props {
  slug: string
  onJoined: (nickname: string) => void
}

const PIN_REGEX = /^\d{4}$/

export function JoinSection({ slug, onJoined }: Props) {
  const { toast } = useToast()
  const [nickname, setNickname] = useState("")
  const [pin, setPin] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

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

    setSubmitting(true)
    try {
      const res = await api.joinMeeting(slug, {
        nickname: trimmed,
        pin: pin.length > 0 ? pin : undefined,
      })
      toast(`${res.nickname}님으로 진입했습니다.`, "success")
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
