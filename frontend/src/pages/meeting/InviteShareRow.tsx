// Compact share-row: small QR thumbnail (popover-expanded) + URL pill + copy.
// Embedded in the new Soma MeetingSummary right under the title. Replaces the
// big CopyableUrl card on /m/{slug}. Stays a row even on desktop so the rest
// of the summary information has room to breathe.

import { useState } from "react"
import { Copy, Link as LinkIcon } from "lucide-react"
import { QRCodeSVG } from "qrcode.react"
import { Button } from "@/components/ui/button"
import { useToast } from "@/components/ui/toast"

interface Props {
  url: string
}

export function InviteShareRow({ url }: Props) {
  const { toast } = useToast()
  const [qrOpen, setQrOpen] = useState(false)

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(url)
      toast("링크가 복사되었습니다.", "success")
    } catch {
      toast("복사에 실패했습니다. 직접 선택해 주세요.", "error")
    }
  }

  return (
    <div
      data-testid="invite-share-row"
      className="flex w-full items-center gap-2.5 rounded-xl border border-border bg-background px-3 py-2.5"
    >
      <div className="relative shrink-0">
        <button
          type="button"
          onClick={() => setQrOpen((v) => !v)}
          aria-pressed={qrOpen}
          aria-label="QR 코드 보기"
          data-testid="qr-toggle"
          className="flex h-10 w-10 items-center justify-center rounded-md border border-border bg-background p-1 transition-colors hover:bg-card"
        >
          <QRCodeSVG value={url} size={28} level="M" bgColor="#ffffff" fgColor="#0f172a" />
        </button>
        {qrOpen ? (
          <div
            data-testid="qr-panel"
            className="absolute left-0 top-[calc(100%+0.5rem)] z-50 rounded-xl border border-border bg-background p-3 shadow-lg"
          >
            <QRCodeSVG
              value={url}
              size={132}
              level="M"
              bgColor="#ffffff"
              fgColor="#0f172a"
              aria-label="공유 링크 QR 코드"
            />
            <div className="mt-2 text-center text-[11.5px] font-medium text-muted-foreground">
              스캔으로 참여하기
            </div>
          </div>
        ) : null}
      </div>

      <div className="flex min-w-0 flex-1 items-center gap-1.5 text-primary">
        <LinkIcon className="h-3 w-3 shrink-0" aria-hidden="true" />
        <code
          className="min-w-0 flex-1 truncate font-mono text-[12.5px] font-semibold tracking-tight text-primary"
          title={url}
        >
          {url}
        </code>
      </div>

      <Button
        type="button"
        variant="secondary"
        size="sm"
        onClick={handleCopy}
        aria-label="초대 링크 복사"
        data-testid="invite-copy"
      >
        <Copy className="h-3.5 w-3.5" />
        복사
      </Button>
    </div>
  )
}
