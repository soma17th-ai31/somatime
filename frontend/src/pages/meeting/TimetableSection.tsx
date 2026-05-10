// Timetable + result section. Spec §5.1 / §6 (Q9):
//   - [결과 보기] -> POST /calculate (deterministic, no LLM).
//   - [추천받기]  -> POST /recommend (LLM 1 call + up to 3 retries; returns reason + share_message_draft).
//   - Both buttons disabled while !meeting.is_ready_to_calculate.
//   - Anyone picks a candidate -> ShareMessageDialog opens with that candidate's draft.
//   - 확정 -> POST /confirm with current (possibly edited) draft text.
//
// v3.1 simplify pass (2026-05-06): is_ready_to_calculate flips on
// submitted_count >= 1, so a single submission unlocks the buttons.
//
// v3.2 (2026-05-06 Path B): organizer gate removed. The pick / 확정 action is
// available to everyone with the slug. The 2-step ShareMessageDialog +
// confirmed-message round-trip absorbs the accident risk.

import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { useToast } from "@/components/ui/toast"
import { CandidateList } from "@/components/CandidateList"
import { Timetable } from "@/components/Timetable"
import { RecommendButton } from "./RecommendButton"
import { ShareMessageDialog } from "@/components/ShareMessageDialog"
import { api } from "@/lib/api"
import {
  ApiError,
  type Candidate,
  type CalculateResponse,
  type ConfirmResponse,
  type MeetingDetail,
  type RecommendResponse,
  type TimetableResponse,
} from "@/lib/types"
import { formatKstRange } from "@/lib/datetime"

interface Props {
  slug: string
  meeting: MeetingDetail
  refreshKey: number
  onConfirmed: (response: ConfirmResponse, candidate: Candidate) => void
}

type ResultState =
  | { kind: "idle" }
  | { kind: "calculate"; response: CalculateResponse }
  | { kind: "recommend"; response: RecommendResponse }

function candidateKey(c: Candidate): string {
  return `${c.start}-${c.end}`
}

export function TimetableSection({
  slug,
  meeting,
  refreshKey,
  onConfirmed,
}: Props) {
  const { toast } = useToast()

  const [timetable, setTimetable] = useState<TimetableResponse | null>(null)
  const [timetableError, setTimetableError] = useState<string | null>(null)

  const [result, setResult] = useState<ResultState>({ kind: "idle" })
  const [calculating, setCalculating] = useState(false)
  const [recommending, setRecommending] = useState(false)
  const [resultError, setResultError] = useState<string | null>(null)

  const [confirmDialog, setConfirmDialog] = useState<{
    open: boolean
    candidate: Candidate | null
    draft: string
    rangeLabel: string
    busy: boolean
  }>({ open: false, candidate: null, draft: "", rangeLabel: "", busy: false })

  const submitted = meeting.submitted_count ?? 0
  const ready = meeting.is_ready_to_calculate ?? submitted >= 1

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const res = await api.getTimetable(slug)
        if (!cancelled) {
          setTimetable(res)
          setTimetableError(null)
        }
      } catch (err) {
        if (!cancelled) {
          setTimetable({ slots: [] })
          setTimetableError(err instanceof ApiError ? err.message : "타임테이블 로딩 실패")
        }
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [slug, refreshKey])

  async function handleCalculate() {
    setCalculating(true)
    setResultError(null)
    try {
      const res = await api.calculate(slug)
      setResult({ kind: "calculate", response: res })
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "계산에 실패했습니다."
      setResultError(msg)
      toast(msg, "error")
    } finally {
      setCalculating(false)
    }
  }

  function handleRecommendResult(res: RecommendResponse) {
    setResult({ kind: "recommend", response: res })
    setResultError(null)
  }

  async function handlePick(candidate: Candidate) {
    // v3.2 (Path B): no organizer gate. Anyone with the slug can open the
    // pre-confirm dialog — the dialog itself is the accident safeguard.
    setConfirmDialog({
      open: true,
      candidate,
      draft: candidate.share_message_draft ?? "",
      rangeLabel: formatKstRange(candidate.start, candidate.end),
      busy: false,
    })
  }

  async function handleConfirm(draftText: string) {
    const candidate = confirmDialog.candidate
    if (!candidate) return
    setConfirmDialog((prev) => ({ ...prev, busy: true }))
    try {
      const res = await api.confirm(slug, {
        slot_start: candidate.start,
        slot_end: candidate.end,
        share_message_draft: draftText,
      })
      onConfirmed(res, candidate)
      setConfirmDialog((prev) => ({ ...prev, open: false, busy: false }))
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "확정에 실패했습니다."
      toast(msg, "error")
      setConfirmDialog((prev) => ({ ...prev, busy: false }))
    }
  }

  const candidates: Candidate[] =
    result.kind === "idle" ? [] : result.response.candidates ?? []
  const summary =
    result.kind === "idle" ? null : result.response.summary ?? null
  const suggestion =
    result.kind === "idle" ? null : result.response.suggestion ?? null

  return (
    <Card>
      <CardHeader>
        <CardTitle>후보 시간과 타임테이블</CardTitle>
        <CardDescription>
          참여자 입력이 모이면 결과를 확인할 수 있습니다. "결과 보기"는 즉시 계산되고,
          "추천받기"는 AI가 생활 리듬을 고려해 후보별 안내 메시지까지 만들어 줍니다.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        <section className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="text-sm font-semibold text-foreground">후보 시간</h3>
            <div className="flex flex-wrap gap-2">
              <Button
                onClick={handleCalculate}
                disabled={calculating || recommending || !ready}
                variant="outline"
                data-testid="calculate-button"
              >
                {calculating ? "계산 중..." : "결과 보기"}
              </Button>
              <RecommendButton
                slug={slug}
                disabled={calculating || !ready}
                loading={recommending}
                setLoading={setRecommending}
                onResult={handleRecommendResult}
              />
            </div>
          </div>

          {!ready ? (
            <p className="rounded-md border border-border bg-card p-3 text-xs text-muted-foreground">
              아직 제출된 일정이 없습니다 — 최소 1명이 제출하면 결과를 볼 수 있습니다.
            </p>
          ) : null}

          {resultError ? (
            <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
              {resultError}
            </div>
          ) : null}

          {summary ? (
            <p className="rounded-md border border-primary/30 bg-primary/10 px-3 py-2 text-sm text-primary">
              {summary}
            </p>
          ) : null}

          {result.kind !== "idle" ? (
            candidates.length > 0 ? (
              <CandidateList
                candidates={candidates}
                onPick={handlePick}
              />
            ) : (
              <div className="rounded-md border border-border bg-card p-3 text-sm text-foreground">
                <div className="font-medium">조건을 만족하는 후보가 없습니다.</div>
                {suggestion ? (
                  <p className="mt-1 text-muted-foreground">{suggestion}</p>
                ) : null}
              </div>
            )
          ) : (
            <p className="text-sm text-muted-foreground">
              아직 후보를 계산하지 않았습니다. 충분한 참여자가 입력을 마친 뒤 시도하세요.
            </p>
          )}
        </section>

        <section className="flex flex-col gap-3">
          <h3 className="text-sm font-semibold text-foreground">타임테이블 (가로)</h3>
          {timetableError ? (
            <p className="text-sm text-destructive">{timetableError}</p>
          ) : null}
          <Timetable
            slots={timetable?.slots ?? []}
            participantCount={Math.max(submitted, 1)}
            submittedNicknames={meeting.submitted_nicknames ?? []}
          />
        </section>

        <ShareMessageDialog
          open={confirmDialog.open}
          onOpenChange={(open) => setConfirmDialog((prev) => ({ ...prev, open }))}
          initialDraft={confirmDialog.draft}
          confirmedRange={confirmDialog.rangeLabel}
          busy={confirmDialog.busy}
          onConfirm={handleConfirm}
        />
      </CardContent>
    </Card>
  )
}

// Re-export helper to keep external imports happy if they referenced the prev module shape.
export { candidateKey }
