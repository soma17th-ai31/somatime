// QR code rendering for share_url. v3.2: organizer_token is gone, so the QR
// just encodes the share URL — the only URL the system surfaces.

import { QRCodeSVG } from "qrcode.react"

interface QrPanelProps {
  url: string
  size?: number
  label?: string
}

export function QrPanel({ url, size = 192, label }: QrPanelProps) {
  return (
    <div
      className="flex flex-col items-center gap-2 rounded-md border border-border bg-background p-4"
      data-testid="qr-panel"
    >
      <QRCodeSVG
        value={url}
        size={size}
        level="M"
        bgColor="#ffffff"
        fgColor="#0f172a"
        includeMargin={false}
        aria-label={label ?? "공유 링크 QR 코드"}
      />
      <p className="text-xs text-muted-foreground">스마트폰 카메라로 스캔해 공유할 수 있어요.</p>
    </div>
  )
}
