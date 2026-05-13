// Small warning chip surfacing meeting.expires_at on the new MeetingSummary.
// Same data path as the previous inline "X일 후 자동 삭제" text — just styled
// as a pill so it can sit alongside the "참여 중" status badge.

import { AlertCircle, Clock } from "lucide-react"
import { formatExpiryNotice } from "@/lib/datetime"

interface Props {
  expiresAt: string | undefined
}

export function AutoDeleteBadge({ expiresAt }: Props) {
  if (!expiresAt) return null
  const { text, isUrgent } = formatExpiryNotice(expiresAt)
  if (!text) return null

  const Icon = isUrgent ? AlertCircle : Clock
  const className = isUrgent
    ? "border-destructive/30 bg-[var(--soma-destructive-soft)] text-destructive"
    : "border-[rgba(217,119,6,0.2)] bg-[var(--soma-warn-soft)] text-[color:var(--soma-warn)]"

  return (
    <span
      data-testid="expiry-notice"
      title={text}
      className={`inline-flex h-[22px] items-center gap-1 rounded-md border px-2 text-[11.5px] font-semibold tracking-tight ${className}`}
    >
      <Icon className="h-2.5 w-2.5" aria-hidden="true" />
      <span>{text}</span>
    </span>
  )
}
