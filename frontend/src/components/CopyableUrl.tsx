import { useState } from "react"
import { QrCode } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useToast } from "@/components/ui/toast"
import { QrPanel } from "./QrPanel"

interface CopyableUrlProps {
  label: string
  url: string
  warning?: string
  // Spec §6 UX rule: only the share_url may show a QR. Organizer URL must NOT.
  showQr?: boolean
}

export function CopyableUrl({ label, url, warning, showQr = false }: CopyableUrlProps) {
  const { toast } = useToast()
  const [copied, setCopied] = useState(false)
  const [qrOpen, setQrOpen] = useState(false)

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      toast("링크가 복사되었습니다.", "success")
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      toast("복사에 실패했습니다. 직접 선택해 주세요.", "error")
    }
  }

  return (
    <div className="surface-edge rounded-lg border border-border bg-card p-4">
      <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      {warning ? <div className="mt-1 text-xs text-destructive">{warning}</div> : null}
      <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
        <code
          className="flex-1 truncate rounded bg-background px-3 py-2 font-mono text-sm text-foreground"
          title={url}
        >
          {url}
        </code>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={handleCopy} aria-label={`${label} 복사`}>
            {copied ? "복사됨" : "복사"}
          </Button>
          {showQr ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setQrOpen((v) => !v)}
              aria-pressed={qrOpen}
              aria-label="QR 코드 펼치기"
              data-testid="qr-toggle"
            >
              <QrCode className="h-4 w-4" />
              QR
            </Button>
          ) : null}
        </div>
      </div>
      {showQr && qrOpen ? (
        <div className="mt-3 flex justify-center">
          <QrPanel url={url} label={`${label} QR 코드`} />
        </div>
      ) : null}
    </div>
  )
}
