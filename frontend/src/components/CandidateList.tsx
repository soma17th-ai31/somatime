import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import type { Candidate } from "@/lib/types"
import { formatKstRange } from "@/lib/datetime"

interface CandidateListProps {
  candidates: Candidate[]
  isOrganizer: boolean
  onConfirm: (candidate: Candidate) => void
  confirmingKey: string | null
}

export function CandidateList({
  candidates,
  isOrganizer,
  onConfirm,
  confirmingKey,
}: CandidateListProps) {
  if (candidates.length === 0) {
    return (
      <p className="text-sm text-slate-600">
        후보 시간을 계산하면 이 영역에 결과가 표시됩니다.
      </p>
    )
  }

  return (
    <ol className="flex flex-col gap-3">
      {candidates.map((c, idx) => {
        const key = `${c.start}-${c.end}`
        const isConfirming = confirmingKey === key
        return (
          <li key={key}>
            <Card>
              <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="space-y-1">
                  <div className="text-xs font-semibold uppercase tracking-wide text-accent">
                    후보 {idx + 1}
                  </div>
                  <div className="text-base font-medium text-slate-900">
                    {formatKstRange(c.start, c.end)}
                  </div>
                  <div className="text-sm text-slate-600">
                    가능 인원 {c.available_count}명
                    {c.missing_participants.length > 0
                      ? ` · 빠진 참여자: ${c.missing_participants.join(", ")}`
                      : ""}
                  </div>
                  <div className="text-sm text-slate-700">이유: {c.reason}</div>
                  {c.note ? <div className="text-xs text-slate-500">{c.note}</div> : null}
                </div>
                {isOrganizer ? (
                  <Button
                    onClick={() => onConfirm(c)}
                    disabled={isConfirming}
                    aria-label={`후보 ${idx + 1} 확정`}
                  >
                    {isConfirming ? "확정 중..." : "이 시간으로 확정"}
                  </Button>
                ) : null}
              </CardContent>
            </Card>
          </li>
        )
      })}
    </ol>
  )
}
