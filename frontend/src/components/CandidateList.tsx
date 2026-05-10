// Candidate list. Spec §5.1 / §6:
//   - Each candidate shows time + available_count + (optional) reason + (optional) share_message_draft.
//   - [복사] copies share_message_draft to clipboard.
//   - [선택] lets any visitor pick this candidate for confirmation.
//
// v3.2 (Path B): organizer gate removed. The pick action is always rendered
// when an onPick callback is supplied; the ShareMessageDialog 2-step
// confirm is the accident safeguard.

import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { useToast } from "@/components/ui/toast"
import type { Candidate } from "@/lib/types"
import { formatKstTime, kstDateKey } from "@/lib/datetime"
import { formatDateLabel } from "@/lib/availabilityCells"
import { cn } from "@/lib/cn"

function formatCandidateRange(startIso: string, endIso: string): string {
  const dateLabel = formatDateLabel(kstDateKey(startIso))
  const startTime = formatKstTime(startIso)
  const endTime = formatKstTime(endIso)
  return `${dateLabel} ${startTime} - ${endTime}`
}

interface CandidateListProps {
  candidates: Candidate[]
  onPick?: (candidate: Candidate) => void
  pickedKey?: string | null
  // Loading state per candidate (e.g. "confirming this one"). Passed-through key.
  busyKey?: string | null
}

function candidateKey(c: Candidate): string {
  return `${c.start}-${c.end}`
}

export function CandidateList({
  candidates,
  onPick,
  pickedKey,
  busyKey,
}: CandidateListProps) {
  const { toast } = useToast()

  if (candidates.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        후보 시간을 계산하면 이 영역에 결과가 표시됩니다.
      </p>
    )
  }

  async function copyDraft(draft: string) {
    try {
      await navigator.clipboard.writeText(draft)
      toast("메시지가 복사되었습니다.", "success")
    } catch {
      toast("복사에 실패했습니다. 직접 선택해 주세요.", "error")
    }
  }

  return (
    <ol className="flex flex-col gap-3">
      {candidates.map((c, idx) => {
        const key = candidateKey(c)
        const isBusy = busyKey === key
        const isPicked = pickedKey === key
        return (
          <li key={key}>
            <Card
              data-testid={`candidate-${idx}`}
              className={cn(
                "surface-edge",
                isPicked ? "ring-2 ring-primary/60" : undefined,
              )}
            >
              <CardContent className="flex flex-col gap-3 pt-6">
                <div className="flex flex-col gap-1">
                  <div className="text-xs font-semibold uppercase tracking-wide text-primary">
                    후보 {idx + 1}
                  </div>
                  <div className="font-display text-lg font-medium tracking-[-0.3px] text-foreground">
                    {formatCandidateRange(c.start, c.end)}
                  </div>
                  <div className="text-sm text-muted-foreground">
                    가능 인원 {c.available_count}명
                    {c.missing_participants.length > 0
                      ? ` · 빠진 참여자: ${c.missing_participants.join(", ")}`
                      : ""}
                  </div>
                  {c.reason ? (
                    <div className="text-sm text-foreground">이유: {c.reason}</div>
                  ) : null}
                  {c.note ? (
                    <div className="text-xs text-muted-foreground">{c.note}</div>
                  ) : null}
                </div>

                {c.share_message_draft ? (
                  <div className="rounded-md border border-border bg-background/60 p-3 text-xs text-foreground">
                    <div className="mb-1 font-semibold uppercase tracking-wide text-muted-foreground">
                      공지 메시지 초안
                    </div>
                    <p className="whitespace-pre-wrap">{c.share_message_draft}</p>
                  </div>
                ) : null}

                <div className="flex flex-wrap items-center justify-end gap-2">
                  {c.share_message_draft ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      data-testid={`candidate-${idx}-copy`}
                      onClick={() => copyDraft(c.share_message_draft as string)}
                    >
                      복사
                    </Button>
                  ) : null}
                  {onPick ? (
                    <Button
                      type="button"
                      size="sm"
                      data-testid={`candidate-${idx}-pick`}
                      disabled={isBusy}
                      onClick={() => onPick(c)}
                    >
                      {isBusy ? "처리 중..." : isPicked ? "선택됨" : "선택"}
                    </Button>
                  ) : null}
                </div>
              </CardContent>
            </Card>
          </li>
        )
      })}
    </ol>
  )
}
