// Meeting summary header. Spec §5.1 — show date_mode, submitted_count, location,
// confirmed slot + message (when present).
//
// v4 (2026-05-13) — Soma redesign. Layout follows soma-meeting.jsx MeetingSummary:
//   row 1: '참여 중' badge + AutoDeleteBadge
//   row 2: h1 title + SettingsButton (pencil icon)
//   row 3: 정보 metadata (CalendarIcon date | ClockIcon duration | MapPin location)
//   row 4: InviteShareRow (QR + URL + 복사)
//   row 5: 제출 현황 (count + progressbar + Participants chips externally)
//   row 6: confirmed_slot block (when present, includes 취소 button)
//
// Participants chips (submitted_nicknames + required-pending) live in the
// sibling Participants card now — see ./Participants.tsx.

import { useState } from "react"
import { Calendar as CalendarIcon, Clock, MapPin, Pencil } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogDescription, DialogFooter, DialogTitle } from "@/components/ui/dialog"
import type { MeetingDetail } from "@/lib/types"
import { formatKstRange } from "@/lib/datetime"
import { formatMeetingTitle } from "@/lib/meetingTitle"
import { cn } from "@/lib/cn"
import { EditMeetingDialog } from "./EditMeetingDialog"
import { InviteShareRow } from "./InviteShareRow"
import { AutoDeleteBadge } from "./AutoDeleteBadge"

const LOCATION_LABEL: Record<MeetingDetail["location_type"], string> = {
  online: "온라인",
  offline: "오프라인",
  any: "온라인/오프라인 모두 가능",
}

interface Props {
  slug: string
  meeting: MeetingDetail
  onSettingsSaved: () => void
  // #24 — 확정 취소 액션. 부모에서 cancelConfirm + reload + refreshKey + dialog close + toast 처리.
  onCancelConfirm?: () => Promise<void>
}

function formatDateScope(meeting: MeetingDetail): string {
  if (meeting.date_mode === "range") {
    if (!meeting.date_range_start || !meeting.date_range_end) return "-"
    return `${formatDateShort(meeting.date_range_start)} – ${formatDateShort(meeting.date_range_end)}`
  }
  const dates = meeting.candidate_dates ?? []
  if (dates.length === 0) return "-"
  if (dates.length <= 2) return dates.map(formatDateShort).join(", ")
  return `${formatDateShort(dates[0])} 외 ${dates.length - 1}일`
}

function formatDateShort(iso: string): string {
  const [, m, d] = iso.split("-")
  if (!m || !d) return iso
  return `${Number.parseInt(m, 10)}월 ${Number.parseInt(d, 10)}일`
}

export function MeetingSummary({
  slug,
  meeting,
  onSettingsSaved,
  onCancelConfirm,
}: Props) {
  const submitted = meeting.submitted_count ?? 0
  const ready = meeting.is_ready_to_calculate ?? submitted >= 1
  const [editing, setEditing] = useState(false)
  const isLocked = Boolean(meeting.confirmed_slot)

  // #24 — 확정 취소 다이얼로그 상태.
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false)
  const [cancelBusy, setCancelBusy] = useState(false)

  // 회의 시작 시각이 이미 지났으면 취소 비활성화. BE 도 409 로 막지만 미리 차단해 UX 개선.
  const startInPast = Boolean(
    meeting.confirmed_slot && new Date(meeting.confirmed_slot.start).getTime() <= Date.now(),
  )

  async function handleCancelConfirm() {
    if (!onCancelConfirm) return
    setCancelBusy(true)
    try {
      await onCancelConfirm()
      setCancelDialogOpen(false)
    } catch {
      // 부모(MeetingPage)에서 토스트로 사용자에게 알리고 throw 함. 여기선 다이얼로그를
      // 열어두기만 하고 unhandled rejection 만 막는다.
    } finally {
      setCancelBusy(false)
    }
  }

  return (
    <section data-testid="meeting-summary" className="flex flex-col gap-3.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex h-[22px] items-center gap-1 rounded-md border border-success/30 bg-[var(--soma-success-soft)] px-2 text-[11.5px] font-semibold tracking-tight text-success">
          {isLocked ? "확정됨" : "참여 중"}
        </span>
        <AutoDeleteBadge expiresAt={meeting.expires_at} />
      </div>

      <div className="flex items-start gap-3">
        <h1 className="flex-1 min-w-0 text-2xl font-extrabold leading-tight tracking-[-0.6px] text-foreground lg:text-[28px]">
          {formatMeetingTitle(meeting.title)}
        </h1>
        {!isLocked ? (
          <button
            type="button"
            onClick={() => setEditing(true)}
            aria-label="회의 설정 수정"
            data-testid="edit-meeting-toggle"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-border bg-background text-[color:var(--soma-ink-soft)] transition-colors hover:bg-card"
          >
            <Pencil className="h-4 w-4" />
          </button>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-3 text-[13.5px] font-medium text-muted-foreground lg:gap-5">
        <span className="inline-flex items-center gap-1.5">
          <CalendarIcon className="h-3.5 w-3.5" aria-hidden="true" />
          {formatDateScope(meeting)}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Clock className="h-3.5 w-3.5" aria-hidden="true" />
          {meeting.duration_minutes}분
        </span>
        <span className="inline-flex items-center gap-1.5">
          <MapPin className="h-3.5 w-3.5" aria-hidden="true" />
          {LOCATION_LABEL[meeting.location_type]}
        </span>
      </div>

      <InviteShareRow url={meeting.share_url} />

      <div className="mt-1">
        <div className="flex items-baseline justify-between gap-3">
          <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            제출 현황
          </div>
          <div className="text-sm font-medium text-foreground" data-testid="progress-text">
            {submitted}명 제출 완료
          </div>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          {ready
            ? "결과를 확인할 준비가 됐습니다."
            : "최소 1명이 제출하면 결과를 볼 수 있습니다."}
        </p>
        <div
          role="progressbar"
          aria-valuemin={0}
          aria-valuenow={submitted}
          className="mt-2 h-2 overflow-hidden rounded-full bg-secondary"
        >
          <div
            className={cn(
              "h-full transition-all",
              ready ? "bg-success" : "bg-primary",
            )}
            style={{ width: ready ? "100%" : "0%" }}
            data-testid="progress-bar-fill"
          />
        </div>
      </div>

      {meeting.confirmed_slot ? (
        <div className="rounded-xl border border-primary/30 bg-[var(--soma-primary-soft)] p-4 text-primary">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-xs font-semibold uppercase tracking-wider">확정된 시각</div>
              <div className="mt-1 font-semibold">
                {formatKstRange(meeting.confirmed_slot.start, meeting.confirmed_slot.end)}
              </div>
            </div>
            {onCancelConfirm ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setCancelDialogOpen(true)}
                disabled={startInPast}
                aria-label="회의 확정 취소"
                data-testid="cancel-confirm"
                className="text-destructive hover:bg-destructive/10 hover:text-destructive"
              >
                확정 취소
              </Button>
            ) : null}
          </div>
          {startInPast ? (
            <p className="mt-2 text-xs text-muted-foreground">
              회의 시작 시각이 지나 취소할 수 없습니다.
            </p>
          ) : null}
          {meeting.confirmed_share_message ? (
            <div className="mt-2 whitespace-pre-wrap rounded bg-background/80 p-2 text-xs text-foreground">
              {meeting.confirmed_share_message}
            </div>
          ) : null}
        </div>
      ) : null}

      <EditMeetingDialog
        open={editing}
        onOpenChange={setEditing}
        slug={slug}
        meeting={meeting}
        onSaved={onSettingsSaved}
      />
      {meeting.confirmed_slot ? (
        <Dialog
          open={cancelDialogOpen}
          onOpenChange={(open) => {
            if (!cancelBusy) setCancelDialogOpen(open)
          }}
          labelledBy="cancel-confirm-title"
        >
          <div data-testid="cancel-confirm-dialog">
            <DialogTitle id="cancel-confirm-title">회의 확정 취소</DialogTitle>
            <DialogDescription>이 회의의 확정을 취소합니다.</DialogDescription>
            <div className="mt-4 space-y-2 text-sm">
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  확정된 시각
                </div>
                <div className="mt-1 font-medium text-foreground">
                  {formatKstRange(meeting.confirmed_slot.start, meeting.confirmed_slot.end)}
                </div>
              </div>
              <p className="text-muted-foreground">
                취소하면 후보 시간을 다시 선택해야 합니다.
                {meeting.confirmed_share_message
                  ? " 저장된 공유 메시지도 함께 삭제됩니다."
                  : ""}
              </p>
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setCancelDialogOpen(false)}
                disabled={cancelBusy}
              >
                취소
              </Button>
              <Button
                type="button"
                variant="destructive"
                onClick={handleCancelConfirm}
                disabled={cancelBusy}
                data-testid="cancel-confirm-submit"
              >
                {cancelBusy ? "취소 중..." : "확정 취소"}
              </Button>
            </DialogFooter>
          </div>
        </Dialog>
      ) : null}
    </section>
  )
}
