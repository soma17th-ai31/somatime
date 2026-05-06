// Confirmation dialog. Spec §5.1 / §6:
//   - Receives the picked candidate's share_message_draft (editable).
//   - On 확정 -> caller POSTs /confirm with the (possibly edited) draft text.
//   - On 닫기 -> dialog closes without confirming.
//
// v3.2 (Path B): this dialog is the sole accident safeguard now —
// organizer_token gating was retired and anyone with the share URL can
// reach this point. The 2-step (open + 확정) gate must remain intact.

import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogDescription, DialogFooter, DialogTitle } from "@/components/ui/dialog"
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

  // Reset draft each time the dialog re-opens with a new initialDraft.
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
    <Dialog open={open} onOpenChange={onOpenChange} labelledBy="share-message-title">
      <DialogTitle id="share-message-title">
        {readOnly ? "확정 안내 메시지" : "메시지 확인 후 확정"}
      </DialogTitle>
      <DialogDescription>
        {readOnly ? "팀원에게 공유할 메시지입니다." : "확정 시각:"} {confirmedRange}.
        {readOnly ? "" : " 메시지를 다듬고 확정 버튼을 눌러주세요."}
      </DialogDescription>
      <textarea
        readOnly={readOnly}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        rows={8}
        data-testid="share-draft-textarea"
        className="mt-4 w-full resize-none rounded-md border border-border bg-input p-3 font-mono text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[2px] focus-visible:ring-ring/50"
      />
      <DialogFooter>
        <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
          닫기
        </Button>
        <Button onClick={handleCopy} variant="outline">
          메시지 복사
        </Button>
        {!readOnly && onConfirm ? (
          <Button onClick={handleConfirm} disabled={busy} data-testid="share-confirm">
            {busy ? "확정 중..." : "확정"}
          </Button>
        ) : null}
      </DialogFooter>
    </Dialog>
  )
}
