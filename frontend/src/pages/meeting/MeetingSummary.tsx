// Meeting summary card. Spec §5.1 — show date_mode, submitted_count, location + buffer,
// confirmed slot + message (when present).
//
// v3.1 simplify pass (2026-05-06):
//   - target_count / N/M progress retired. Show "제출자 N명" only.
//   - "주최자 모드 / 참여자 모드" caption retired.
//   - is_ready_to_calculate flips on submitted_count >= 1.
//
// v3.2 (Path B): organizer split removed entirely — no isOrganizer prop.

import { useState } from "react"
import { Pencil } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Dialog, DialogDescription, DialogFooter, DialogTitle } from "@/components/ui/dialog"
import { CopyableUrl } from "@/components/CopyableUrl"
import type { MeetingDetail } from "@/lib/types"
import { formatKstRange } from "@/lib/datetime"
import { cn } from "@/lib/cn"
import { EditMeetingDialog } from "./EditMeetingDialog"

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
    return `${meeting.date_range_start} ~ ${meeting.date_range_end} (범위)`
  }
  const dates = meeting.candidate_dates ?? []
  if (dates.length === 0) return "-"
  return `${dates.join(", ")} (개별 ${dates.length}일)`
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
    <Card data-testid="meeting-summary" className="surface-edge">
      <CardHeader className="flex flex-row items-start justify-between gap-3">
        <div>
          <CardTitle>{meeting.title}</CardTitle>
          <CardDescription>모든 시간은 KST 기준입니다.</CardDescription>
        </div>
        {!isLocked ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setEditing(true)}
            aria-label="회의 설정 수정"
            data-testid="edit-meeting-toggle"
          >
            <Pencil className="h-3.5 w-3.5" />
            설정 수정
          </Button>
        ) : null}
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        <CopyableUrl label="초대 링크" url={meeting.share_url} showQr />
        <dl className="grid gap-4 text-sm sm:grid-cols-2">
          <div className="sm:col-span-2">
            <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              날짜
            </dt>
            <dd className="mt-1 text-foreground">{formatDateScope(meeting)}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              시간대
            </dt>
            <dd className="mt-1 text-foreground">
              매일 {meeting.time_window_start} ~ {meeting.time_window_end}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              회의 길이
            </dt>
            <dd className="mt-1 text-foreground">{meeting.duration_minutes}분</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              진행 방식
            </dt>
            <dd className="mt-1 text-foreground">
              {LOCATION_LABEL[meeting.location_type]}
              {meeting.location_type !== "online"
                ? ` · 버퍼 ${meeting.offline_buffer_minutes}분`
                : ""}
            </dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              제출 현황
            </dt>
            <dd className="mt-1 text-foreground" data-testid="progress-text">
              {submitted}명 제출 완료
            </dd>
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
            {(meeting.submitted_nicknames ?? []).length > 0 ? (
              <ul
                className="mt-3 flex flex-wrap gap-1.5"
                aria-label="제출 완료한 참여자"
                data-testid="submitted-nicknames"
              >
                {(meeting.submitted_nicknames ?? []).map((nickname) => {
                  const required = (meeting.required_nicknames ?? []).includes(nickname)
                  return (
                  <li
                    key={nickname}
                    className={
                      required
                        ? "inline-flex items-center gap-1 rounded-full border border-primary/40 bg-primary/15 px-2.5 py-0.5 text-xs font-medium text-primary"
                        : "inline-flex items-center gap-1 rounded-full border border-success/30 bg-success/10 px-2.5 py-0.5 text-xs font-medium text-success"
                    }
                    title={required ? "필수 참여자" : undefined}
                  >
                    <span aria-hidden="true">{required ? "★" : "✓"}</span>
                    <span>{nickname}</span>
                  </li>
                  )
                })}
              </ul>
            ) : null}
            {/* v3.11 — required-but-not-yet-submitted callout */}
            {(() => {
              const submitted = new Set(meeting.submitted_nicknames ?? [])
              const requiredPending = (meeting.required_nicknames ?? []).filter(
                (n) => !submitted.has(n),
              )
              if (requiredPending.length === 0) return null
              return (
                <p
                  className="mt-3 rounded-md border border-primary/30 bg-primary/10 px-2.5 py-1.5 text-xs text-primary"
                  data-testid="required-pending"
                >
                  ★ 필수 참여자 미제출: {requiredPending.join(", ")}
                </p>
              )
            })()}
          </div>

          {meeting.confirmed_slot ? (
            <div className="sm:col-span-2 rounded-md border border-primary/30 bg-primary/10 p-3 text-primary">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <dt className="text-xs font-semibold uppercase tracking-wide">확정된 시각</dt>
                  <dd className="mt-1 font-medium">
                    {formatKstRange(meeting.confirmed_slot.start, meeting.confirmed_slot.end)}
                  </dd>
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
                <dd className="mt-2 whitespace-pre-wrap rounded bg-background/80 p-2 text-xs text-foreground">
                  {meeting.confirmed_share_message}
                </dd>
              ) : null}
            </div>
          ) : null}
        </dl>
      </CardContent>
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
    </Card>
  )
}
