// SelfEditModal — Phase E. Modal-only flow for changing the viewer's nickname,
// optional 4-digit PIN, and 필수 참여자 flag. Buffer minutes live INLINE on
// CurrentParticipantCard (see BufferChips there) and are NOT edited here.
//
// API: PATCH /api/meetings/{slug}/participants/me via api.updateSelf.
//   - pin: omit = unchanged, "" = clear, "1234" = set
//   - is_required: omit = unchanged, true/false = explicit
//
// Soma mockup source: /tmp/handoff/app-onboarding/project/soma-meeting.jsx
// L600 (SelfEditModal).

import { useEffect, useState } from "react"
import { Check, Loader2, X } from "lucide-react"
import { cn } from "@/lib/cn"
import { Button } from "@/components/ui/button"
import { Dialog, DialogFooter, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useToast } from "@/components/ui/toast"
import { api } from "@/lib/api"
import { ApiError } from "@/lib/types"

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  slug: string
  nickname: string
  isRequired: boolean
  onSaved: (updatedNickname: string) => void
}

const PIN_REGEX = /^\d{4}$/

export function SelfEditModal({
  open,
  onOpenChange,
  slug,
  nickname,
  isRequired,
  onSaved,
}: Props) {
  const { toast } = useToast()

  const [draftName, setDraftName] = useState(nickname)
  const [draftPin, setDraftPin] = useState("")
  const [pendingClearPin, setPendingClearPin] = useState(false)
  const [draftIsRequired, setDraftIsRequired] = useState(isRequired)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setDraftName(nickname)
    setDraftPin("")
    setPendingClearPin(false)
    setDraftIsRequired(isRequired)
    setError(null)
  }, [open, nickname, isRequired])

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    const trimmed = draftName.trim()
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
    } = { nickname: trimmed }
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
      onOpenChange(false)
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
      toast(`닉네임이 ${res.nickname}(으)로 변경되었습니다.${pinMessage}${requiredMessage}`, "success")
      onSaved(res.nickname)
      onOpenChange(false)
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "수정에 실패했습니다."
      setError(msg)
      toast(msg, "error")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (submitting) return
        onOpenChange(o)
      }}
      labelledBy="self-edit-title"
      className="max-w-md"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <DialogTitle id="self-edit-title">내 정보 재설정</DialogTitle>
          <p className="mt-1 text-xs text-muted-foreground">
            입력한 가용 시간은 유지됩니다.
          </p>
        </div>
        <button
          type="button"
          onClick={() => onOpenChange(false)}
          disabled={submitting}
          aria-label="재설정 창 닫기"
          className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-card hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <form
        onSubmit={handleSave}
        className="mt-4 flex flex-col gap-4"
        data-testid="self-edit-form"
      >
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="self-edit-nickname" className="text-xs">
            이름
          </Label>
          <Input
            id="self-edit-nickname"
            value={draftName}
            onChange={(e) => setDraftName(e.target.value)}
            maxLength={50}
            autoComplete="off"
            autoFocus
            data-testid="rename-input"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="self-edit-pin" className="text-xs">
            PIN (선택, 4자리 숫자)
          </Label>
          <Input
            id="self-edit-pin"
            value={draftPin}
            onChange={(e) => {
              setDraftPin(e.target.value.replace(/\D/g, "").slice(0, 4))
              setPendingClearPin(false)
            }}
            placeholder={pendingClearPin ? "(PIN 제거 예정)" : "비우면 변경 안 됨"}
            inputMode="numeric"
            maxLength={4}
            autoComplete="off"
            disabled={pendingClearPin}
            style={{
              fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
              letterSpacing: "6px",
            }}
            className="text-base placeholder:tracking-normal placeholder:font-sans placeholder:text-muted-foreground/60"
            data-testid="rename-pin-input"
          />
          <button
            type="button"
            onClick={() => {
              setPendingClearPin((v) => !v)
              if (!pendingClearPin) setDraftPin("")
            }}
            data-testid="rename-pin-clear"
            className="self-start text-xs text-muted-foreground underline-offset-2 hover:text-destructive hover:underline"
          >
            {pendingClearPin ? "PIN 제거 취소" : "PIN 제거"}
          </button>
        </div>

        <button
          type="button"
          role="switch"
          aria-checked={draftIsRequired}
          onClick={() => setDraftIsRequired((v) => !v)}
          data-testid="rename-required-checkbox"
          className="flex w-full items-center gap-3 rounded-xl border border-border bg-background px-3.5 py-3 text-left transition-colors hover:bg-card"
        >
          <div className="min-w-0 flex-1">
            <div className="text-[13.5px] font-bold text-foreground">필수 참여자</div>
            <div className="mt-0.5 text-xs leading-snug text-muted-foreground">
              체크 시 추천 결과가 본인 가능 시간 안에서만 잡힙니다.
            </div>
          </div>
          <div
            className={cn(
              "relative h-5 w-9 shrink-0 rounded-full transition-colors",
              draftIsRequired ? "bg-primary" : "bg-border",
            )}
          >
            <div
              className={cn(
                "absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all",
                draftIsRequired ? "left-[18px]" : "left-0.5",
              )}
            />
          </div>
        </button>

        {error ? <p className="text-xs text-destructive">{error}</p> : null}

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
            data-testid="rename-cancel"
          >
            취소
          </Button>
          <Button type="submit" disabled={submitting} data-testid="rename-save">
            {submitting ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Check className="h-3.5 w-3.5" />
            )}
            저장
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  )
}
