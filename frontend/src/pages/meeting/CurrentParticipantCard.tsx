// Inline participant identity widget for the meeting page header.
// v3.6 — read mode = compact pill (nickname + 수정 + 다른 사용자로 전환).
//          edit mode = inline form (nickname + optional PIN, 4-digit).
// v3.11 — edit mode also exposes a "필수 참여자" checkbox so a mentor /
//          required attendee can self-mark; recommend.py promotes any
//          window where every required nickname is present.
//
// PATCH /api/meetings/{slug}/participants/me 호출.
//   pin field semantics: omit = 변경 없음 / "" = PIN 제거 / "1234" = 새로 설정.
//   is_required: omit = 변경 없음 / true|false = 명시적 설정.

import { useEffect, useState } from "react"
import { Pencil, X, Check, Loader2, LogIn, Star } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useToast } from "@/components/ui/toast"
import { api } from "@/lib/api"
import { ApiError } from "@/lib/types"

interface Props {
  slug: string
  nickname: string
  isRequired: boolean
  onRenamed: (newNickname: string) => void
  onSwitchUser: () => void
}

const PIN_REGEX = /^\d{4}$/

export function CurrentParticipantCard({
  slug,
  nickname,
  isRequired,
  onRenamed,
  onSwitchUser,
}: Props) {
  const { toast } = useToast()
  const [editing, setEditing] = useState(false)
  const [draftNickname, setDraftNickname] = useState(nickname)
  const [draftPin, setDraftPin] = useState("")
  const [pendingClearPin, setPendingClearPin] = useState(false)
  const [draftIsRequired, setDraftIsRequired] = useState(isRequired)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Keep the draft checkbox in sync with the latest server-known value when
  // not editing (e.g. another tab toggled it).
  useEffect(() => {
    if (!editing) setDraftIsRequired(isRequired)
  }, [isRequired, editing])

  function startEdit() {
    setDraftNickname(nickname)
    setDraftPin("")
    setPendingClearPin(false)
    setDraftIsRequired(isRequired)
    setError(null)
    setEditing(true)
  }

  function cancelEdit() {
    setEditing(false)
    setError(null)
    setDraftNickname(nickname)
    setDraftPin("")
    setPendingClearPin(false)
    setDraftIsRequired(isRequired)
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    const trimmed = draftNickname.trim()
    if (trimmed.length === 0) {
      setError("닉네임을 입력하세요.")
      return
    }
    if (trimmed.length > 50) {
      setError("닉네임은 50자 이내여야 합니다.")
      return
    }

    const body: { nickname: string; pin?: string; is_required?: boolean } = {
      nickname: trimmed,
    }
    if (pendingClearPin) {
      body.pin = ""
    } else if (draftPin.length > 0) {
      if (!PIN_REGEX.test(draftPin)) {
        setError("PIN은 4자리 숫자입니다.")
        return
      }
      body.pin = draftPin
    }
    if (draftIsRequired !== isRequired) {
      body.is_required = draftIsRequired
    }

    if (
      body.nickname === nickname &&
      body.pin === undefined &&
      body.is_required === undefined
    ) {
      setEditing(false)
      return
    }

    setSubmitting(true)
    try {
      const res = await api.updateSelf(slug, body)
      const pinMessage = pendingClearPin
        ? " PIN도 제거되었습니다."
        : draftPin.length > 0
          ? " PIN도 설정되었습니다."
          : ""
      const requiredMessage =
        body.is_required !== undefined
          ? body.is_required
            ? " 필수 참여자로 표시되었습니다."
            : " 필수 참여자 표시가 해제되었습니다."
          : ""
      toast(
        `닉네임이 ${res.nickname}(으)로 변경되었습니다.${pinMessage}${requiredMessage}`,
        "success",
      )
      onRenamed(res.nickname)
      setEditing(false)
      setDraftPin("")
      setPendingClearPin(false)
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "수정에 실패했습니다."
      setError(msg)
      toast(msg, "error")
    } finally {
      setSubmitting(false)
    }
  }

  if (!editing) {
    return (
      <div
        data-testid="current-participant-card"
        className="flex flex-wrap items-center gap-2 text-sm"
      >
        <span
          className={
            isRequired
              ? "inline-flex items-center gap-1.5 rounded-full border border-primary/40 bg-primary/15 px-3 py-1 font-medium text-primary"
              : "inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1 font-medium text-foreground"
          }
          title={isRequired ? "필수 참여자로 표시됨" : undefined}
        >
          <span aria-hidden="true">{isRequired ? "★" : "👤"}</span>
          <span>{nickname}</span>
        </span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={startEdit}
          aria-label="닉네임/PIN 수정"
          data-testid="rename-toggle"
        >
          <Pencil className="h-3.5 w-3.5" />
          이름/PIN 수정
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onSwitchUser}
          aria-label="다른 사용자로 전환"
          data-testid="switch-user"
        >
          <LogIn className="h-3.5 w-3.5" />
          다른 사용자
        </Button>
      </div>
    )
  }

  return (
    <form
      onSubmit={handleSave}
      data-testid="current-participant-card"
      className="flex w-full flex-col gap-3 rounded-md border border-border bg-card p-3"
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="rename-nickname" className="text-xs">
            닉네임
          </Label>
          <Input
            id="rename-nickname"
            value={draftNickname}
            onChange={(e) => setDraftNickname(e.target.value)}
            maxLength={50}
            autoComplete="off"
            autoFocus
            className="h-9 text-sm font-medium"
            data-testid="rename-input"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="rename-pin" className="text-xs">
            PIN (선택, 4자리 숫자)
          </Label>
          <Input
            id="rename-pin"
            value={draftPin}
            onChange={(e) => {
              setDraftPin(e.target.value.replace(/\D/g, "").slice(0, 4))
              setPendingClearPin(false)
            }}
            placeholder={pendingClearPin ? "(PIN 제거 예정)" : "비우면 변경 안 됨"}
            inputMode="numeric"
            maxLength={4}
            autoComplete="off"
            className="h-9 text-sm font-medium"
            data-testid="rename-pin-input"
            disabled={pendingClearPin}
          />
          <button
            type="button"
            className="self-start text-xs text-muted-foreground underline-offset-2 hover:text-destructive hover:underline"
            onClick={() => {
              setPendingClearPin((v) => !v)
              if (!pendingClearPin) setDraftPin("")
            }}
            data-testid="rename-pin-clear"
          >
            {pendingClearPin ? "PIN 제거 취소" : "PIN 제거"}
          </button>
        </div>
      </div>
      <label className="flex flex-wrap items-center gap-2 text-sm text-foreground">
        <input
          type="checkbox"
          checked={draftIsRequired}
          onChange={(e) => setDraftIsRequired(e.target.checked)}
          className="h-4 w-4 rounded border-border accent-primary"
          data-testid="rename-required-checkbox"
        />
        <Star className={draftIsRequired ? "h-3.5 w-3.5 text-primary" : "h-3.5 w-3.5 text-muted-foreground"} />
        <span>필수 참여자 (이 분이 빠지면 안 되는 회의)</span>
      </label>
      <p className="-mt-1 text-xs text-muted-foreground">
        체크 시: 추천 결과가 본인 가능 시간 안에서만 잡힙니다. 다른 참여자 일부가 빠진
        후보도 허용됩니다.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" size="sm" disabled={submitting} data-testid="rename-save">
          {submitting ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Check className="h-3.5 w-3.5" />
          )}
          저장
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={cancelEdit}
          disabled={submitting}
          data-testid="rename-cancel"
        >
          <X className="h-3.5 w-3.5" />
          취소
        </Button>
      </div>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </form>
  )
}
