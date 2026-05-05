import { Button } from "@/components/ui/button"
import { Dialog, DialogDescription, DialogFooter, DialogTitle } from "@/components/ui/dialog"
import { useToast } from "@/components/ui/toast"

interface ShareMessageDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  message: string
  confirmedRange: string
}

export function ShareMessageDialog({
  open,
  onOpenChange,
  message,
  confirmedRange,
}: ShareMessageDialogProps) {
  const { toast } = useToast()

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(message)
      toast("메시지가 복사되었습니다.", "success")
    } catch {
      toast("복사에 실패했습니다. 직접 선택해 주세요.", "error")
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange} labelledBy="share-message-title">
      <DialogTitle id="share-message-title">확정 안내 메시지 초안</DialogTitle>
      <DialogDescription>
        확정 시각: {confirmedRange}. 아래 메시지를 복사해 팀원에게 공유하세요.
      </DialogDescription>
      <textarea
        readOnly
        value={message}
        rows={8}
        className="mt-4 w-full resize-none rounded-md border border-surface-border bg-surface-muted p-3 text-sm text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      />
      <DialogFooter>
        <Button variant="outline" onClick={() => onOpenChange(false)}>
          닫기
        </Button>
        <Button onClick={handleCopy}>메시지 복사</Button>
      </DialogFooter>
    </Dialog>
  )
}
