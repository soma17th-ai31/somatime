// ShareMessageDialog — Phase E redesign (ConfirmModal in the Soma mockup).
// Spec §5.1 / §6:
//   - Pre-confirm: receives the picked candidate's share_message_draft (editable
//     textarea), 메시지 복사 / 확정 buttons. Confirming triggers /confirm via
//     the supplied onConfirm callback.
//   - Post-confirm (readOnly): same dialog id but switches to a read-only
//     announcement view; only 닫기 / 메시지 복사 remain.
//
// v3.2 (Path B): this is the sole accident safeguard now — organizer_token
// gating was retired and anyone with the share URL can reach this point. The
// 2-step (open + 확정) gate must remain intact.

import { useEffect, useState } from "react"
import { Check, Copy, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import { useToast } from "@/components/ui/toast"

interface ShareMessageDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  // The draft text to seed the textarea with. Resets on every open.
  initialDraft: string
  confirmedRange: string
  // When provided, the dialog is in pre-confirm mode (editable textarea + 확정 button).
  onConfirm?: (draft: string) => Promise<void> | void
  // When set true after confirmation succeeds, switches to read-only "복사" mode.
  readOnly?: boolean
  busy?: boolean
}

export function ShareMessageDialog({
  open,
  onOpenChange,
  initialDraft,
  confirmedRange,
  onConfirm,
  readOnly = false,
  busy = false,
}: ShareMessageDialogProps) {
  const { toast } = useToast()
  const [draft, setDraft] = useState(initialDraft)

  useEffect(() => {
    if (open) setDraft(initialDraft)
  }, [open, initialDraft])

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(draft)
      toast("메시지가 복사되었습니다.", "success")
    } catch {
      toast("복사에 실패했습니다. 직접 선택해 주세요.", "error")
    }
  }

  async function handleConfirm() {
    if (!onConfirm) return
    await onConfirm(draft)
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (busy) return
        onOpenChange(o)
      }}
      labelledBy="share-message-title"
      className="max-w-lg p-0"
    >
      <div className="flex items-start justify-between gap-3 px-5 pb-1 pt-5">
        <div className="min-w-0">
          {readOnly ? (
            <span className="mb-2 inline-flex items-center gap-1 rounded-full bg-[var(--soma-success-soft)] px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wider text-success">
              <Check className="h-3 w-3" />
              확정 완료
            </span>
          ) : (
            <span className="mb-2 inline-flex items-center gap-1 rounded-full bg-[var(--soma-primary-soft)] px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wider text-primary">
              확정 직전
            </span>
          )}
          <DialogTitle id="share-message-title">
            {readOnly ? "확정 안내 메시지" : "메시지 확인 후 확정해 주세요"}
          </DialogTitle>
          <DialogDescription>
            {readOnly
              ? `${confirmedRange} 회의가 확정되었습니다. 메시지를 복사해 팀원에게 공유해주세요.`
              : "확정하면 가용 시간 입력이 종료됩니다."}
          </DialogDescription>
        </div>
        <button
          type="button"
          onClick={() => onOpenChange(false)}
          disabled={busy}
          aria-label="메시지 창 닫기"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-card hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="px-5 py-4">
        <div className="mb-2 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
          공지 메시지 초안
        </div>
        <textarea
          readOnly={readOnly}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={8}
          data-testid="share-draft-textarea"
          className="w-full resize-none rounded-xl border border-border bg-card p-3.5 font-mono text-[13px] leading-relaxed text-foreground outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[2px] focus-visible:ring-ring/50"
        />
      </div>

      <div className="flex justify-end gap-2 border-t border-border bg-card/40 px-5 py-3.5">
        <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
          닫기
        </Button>
        <Button onClick={handleCopy} variant="secondary">
          <Copy className="h-3.5 w-3.5" />
          공지 복사
        </Button>
        {!readOnly && onConfirm ? (
          <Button
            onClick={handleConfirm}
            disabled={busy}
            data-testid="share-confirm"
            className="bg-success text-white shadow-[0_1px_2px_rgba(15,23,42,0.05),_0_8px_18px_rgba(22,163,74,0.22)] hover:bg-success/90"
          >
            <Check className="h-3.5 w-3.5" />
            {busy ? "확정 중..." : "확정"}
          </Button>
        ) : null}
      </div>

    </Dialog>
  )
}
