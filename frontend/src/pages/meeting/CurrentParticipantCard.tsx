// Inline participant identity widget for the meeting page header.
// v3.6 — read mode = compact pill (nickname + 수정 + 로그아웃).
//          edit mode = inline form (nickname + optional PIN, 4-digit).
// v3.11 — edit mode also exposes a "필수 참여자" checkbox so a mentor /
//          required attendee can self-mark; recommend.py promotes any
//          window where every required nickname is present.
//
// PATCH /api/meetings/{slug}/participants/me 호출.
//   pin field semantics: omit = 변경 없음 / "" = PIN 제거 / "1234" = 새로 설정.
//   is_required: omit = 변경 없음 / true|false = 명시적 설정.

import { useEffect, useState } from "react"
import { Pencil, X, Check, Loader2, LogOut, Star } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select } from "@/components/ui/select"
import { useToast } from "@/components/ui/toast"
import { api } from "@/lib/api"
import { ApiError, type LocationType } from "@/lib/types"

// #13 follow-up — 회의 전체 buffer 제거 후, 미설정 시 사용되는 시스템 기본값 (분).
const BUFFER_DEFAULT_MINUTES = 60

interface Props {
  slug: string
  nickname: string
  isRequired: boolean
  // #13 — 본인 개인 buffer (분). null = 시스템 기본값(60분) 사용.
  myBufferMinutes: number | null
  locationType: LocationType
  onRenamed: (newNickname: string) => void
  onSwitchUser: () => void
  onBufferChanged?: (newValue: number | null) => void
}

const PIN_REGEX = /^\d{4}$/

// "기본값" sentinel — Select 의 빈 value. (null 로 저장됨 → 시스템 기본 60분 사용.)
const BUFFER_INHERIT = ""

function bufferToFormValue(my: number | null): string {
  return my === null ? BUFFER_INHERIT : String(my)
}

function formValueToBuffer(v: string): number | null {
  if (v === BUFFER_INHERIT) return null
  const n = Number.parseInt(v, 10)
  return Number.isFinite(n) ? n : null
}

export function CurrentParticipantCard({
  slug,
  nickname,
  isRequired,
  myBufferMinutes,
  locationType,
  onRenamed,
  onSwitchUser,
  onBufferChanged,
}: Props) {
  const { toast } = useToast()
  const [editing, setEditing] = useState(false)
  const [draftNickname, setDraftNickname] = useState(nickname)
  const [draftPin, setDraftPin] = useState("")
  const [pendingClearPin, setPendingClearPin] = useState(false)
  const [draftIsRequired, setDraftIsRequired] = useState(isRequired)
  const [draftBuffer, setDraftBuffer] = useState<string>(bufferToFormValue(myBufferMinutes))
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const showBuffer = locationType !== "online"
  const effectiveBuffer = myBufferMinutes ?? BUFFER_DEFAULT_MINUTES

  // Keep the draft checkbox/buffer in sync with the latest server-known value when
  // not editing (e.g. another tab toggled it).
  useEffect(() => {
    if (!editing) setDraftIsRequired(isRequired)
  }, [isRequired, editing])
  useEffect(() => {
    if (!editing) setDraftBuffer(bufferToFormValue(myBufferMinutes))
  }, [myBufferMinutes, editing])

  function startEdit() {
    setDraftNickname(nickname)
    setDraftPin("")
    setPendingClearPin(false)
    setDraftIsRequired(isRequired)
    setDraftBuffer(bufferToFormValue(myBufferMinutes))
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
    setDraftBuffer(bufferToFormValue(myBufferMinutes))
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

    const body: {
      nickname: string
      pin?: string
      is_required?: boolean
      buffer_minutes?: number | null
    } = {
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
    // #13 — buffer_minutes 변경분만 포함. null 도 명시 변경(=clear)으로 취급.
    const nextBuffer = formValueToBuffer(draftBuffer)
    const bufferChanged = nextBuffer !== myBufferMinutes
    if (bufferChanged) {
      body.buffer_minutes = nextBuffer
    }

    if (
      body.nickname === nickname &&
      body.pin === undefined &&
      body.is_required === undefined &&
      body.buffer_minutes === undefined
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
      if (bufferChanged) {
        const effective = res.buffer_minutes ?? BUFFER_DEFAULT_MINUTES
        toast(
          `버퍼가 ${effective}분으로 변경되었습니다. 다음 결과 계산부터 적용됩니다.`,
          "success",
        )
        onBufferChanged?.(res.buffer_minutes)
      }
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
        className="rounded-2xl border border-border bg-background p-4"
      >
        <div className="flex items-center gap-3">
          <div
            aria-hidden="true"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--soma-primary-soft)] text-sm font-bold text-primary"
          >
            {nickname.slice(0, 1)}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[14.5px] font-bold tracking-tight text-foreground">
                {nickname}
              </span>
              <span className="inline-flex h-[20px] items-center rounded-md border border-success/30 bg-[var(--soma-success-soft)] px-1.5 text-[11px] font-semibold text-success">
                응답 완료
              </span>
              {isRequired ? (
                <span
                  title="필수 참여자로 표시됨"
                  className="inline-flex h-[20px] items-center gap-1 rounded-md border border-primary/30 bg-[var(--soma-primary-soft)] px-1.5 text-[11px] font-semibold text-primary"
                >
                  <Star className="h-2.5 w-2.5" aria-hidden="true" />
                  필수 참여자
                </span>
              ) : null}
            </div>
            <div className="mt-0.5 text-xs text-muted-foreground">본인 참여 정보</div>
          </div>
          <div className="flex shrink-0 gap-1.5">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={startEdit}
              aria-label="닉네임/PIN 수정"
              data-testid="rename-toggle"
            >
              <Pencil className="h-3.5 w-3.5" />
              재설정
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onSwitchUser}
              aria-label="로그아웃"
              data-testid="switch-user"
            >
              <LogOut className="h-3.5 w-3.5" />
              로그아웃
            </Button>
          </div>
        </div>
        {showBuffer ? (
          <>
            <div className="my-3 h-px bg-border" aria-hidden="true" />
            <div className="flex items-baseline justify-between gap-2">
              <div className="text-[13px] font-semibold text-muted-foreground">
                회의 전후 버퍼
              </div>
              <div
                className="text-[13px] font-bold text-primary"
                data-testid="buffer-readout"
              >
                {effectiveBuffer === 0 ? "없음" : `${effectiveBuffer}분`}
              </div>
            </div>
            <div className="mt-1 text-[11.5px] text-muted-foreground">
              이동·정리 시간을 추천 알고리즘에 반영합니다. 재설정에서 변경할 수 있어요.
            </div>
          </>
        ) : null}
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
      {showBuffer ? (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="rename-buffer" className="text-xs">
            이동 버퍼
          </Label>
          <Select
            id="rename-buffer"
            value={draftBuffer}
            onChange={(e) => setDraftBuffer(e.target.value)}
            className="h-9 text-sm"
            data-testid="participant-buffer-select"
          >
            <option value={BUFFER_INHERIT}>
              기본값 사용 ({BUFFER_DEFAULT_MINUTES}분)
            </option>
            <option value="0">0분 (버퍼 없음)</option>
            <option value="30">30분</option>
            <option value="60">60분</option>
            <option value="90">90분</option>
            <option value="120">120분</option>
          </Select>
          <p className="text-xs text-muted-foreground">
            본인의 이동시간 등을 반영해 후보 시간 앞뒤로 비워둘 시간입니다.
          </p>
        </div>
      ) : null}
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
