// RecommendCard — sidebar sticky card surfacing the result of `/calculate`,
// `/recommend`, and the confirmed slot. Replaces the previous inline
// `CandidateList` + `RecommendButton` layout in TimetableSection.
//
// Three states:
//   1. empty        — no result + not confirmed → buttons + idle copy
//   2. recommended  — calculate OR recommend result available → main pick + alts
//   3. confirmed    — meeting.confirmed_slot present → confirmed banner +
//                     share message (locked from picking another)
//
// Soma mockup source: /tmp/handoff/app-onboarding/project/soma-meeting.jsx
// L188~425 (RecommendCard). Adapted to:
//   - drive UI from real CalculateResponse / RecommendResponse data
//   - keep existing testids (calculate-button, recommend-button,
//     candidate-N-pick, candidate-N-copy) so E1 e2e is unaffected
//   - preserve ShareMessageDialog 2-step confirm flow (handled by parent)
//   - retain RecommendButton's 5-min cooldown via embedding the existing
//     component rather than re-implementing the localStorage logic

import { useEffect, useState } from "react"
import {
  Check,
  ChevronRight,
  Copy,
  Sparkles,
  X as XIcon,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { useToast } from "@/components/ui/toast"
import { formatKstRange, formatKstTime, kstDateKey } from "@/lib/datetime"
import { formatDateLabel } from "@/lib/availabilityCells"
import { cn } from "@/lib/cn"
import { RecommendButton } from "./RecommendButton"
import type {
  Candidate,
  CalculateResponse,
  ConfirmedSlot,
  MeetingDetail,
  RecommendResponse,
} from "@/lib/types"

export type RecommendCardResultState =
  | { kind: "idle" }
  | { kind: "calculate"; response: CalculateResponse }
  | { kind: "recommend"; response: RecommendResponse }

interface Props {
  slug: string
  meeting: MeetingDetail
  result: RecommendCardResultState
  calculating: boolean
  recommending: boolean
  ready: boolean
  resultError: string | null
  onCalculate: () => void
  onRecommendResult: (res: RecommendResponse) => void
  setRecommending: (v: boolean) => void
  onPick: (candidate: Candidate) => void
  // Cancel-confirm action (passed through to confirmed-state actions). Optional
  // because MeetingSummary already exposes "확정 취소", but the card surfaces
  // a secondary action for consistency with the mockup.
  onCancelConfirm?: () => void | Promise<void>
}

function formatCandidateLong(start: string, end: string): {
  day: string
  range: string
  duration: string
} {
  const day = formatDateLabel(kstDateKey(start))
  const range = `${formatKstTime(start)} – ${formatKstTime(end)}`
  const durationMs = new Date(end).getTime() - new Date(start).getTime()
  const minutes = Math.max(0, Math.round(durationMs / 60_000))
  return { day, range, duration: `${minutes}분` }
}

export function RecommendCard({
  slug,
  meeting,
  result,
  calculating,
  recommending,
  ready,
  resultError,
  onCalculate,
  onRecommendResult,
  setRecommending,
  onPick,
  onCancelConfirm,
}: Props) {
  const confirmedSlot: ConfirmedSlot | null = meeting.confirmed_slot
  const isLocked = Boolean(confirmedSlot)
  const candidates: Candidate[] =
    result.kind === "idle" ? [] : result.response.candidates ?? []
  const summary =
    result.kind === "idle" ? null : result.response.summary ?? null
  const suggestion =
    result.kind === "idle" ? null : result.response.suggestion ?? null

  // Selected candidate index — defaults to 0 (BE returns best-first).
  // Reset when a new result comes in so "추천받기" 후엔 첫 candidate 가 main.
  const [selectedIdx, setSelectedIdx] = useState(0)
  useEffect(() => {
    setSelectedIdx(0)
  }, [result])

  // ---------- Confirmed state ----------
  if (isLocked && confirmedSlot) {
    return (
      <ConfirmedCard
        confirmedSlot={confirmedSlot}
        confirmedShareMessage={meeting.confirmed_share_message ?? null}
        onCancelConfirm={onCancelConfirm}
      />
    )
  }

  // Non-confirmed: either empty or has a result.
  const hasResult = result.kind !== "idle"
  const safeIdx = Math.min(selectedIdx, Math.max(0, candidates.length - 1))
  const current = hasResult ? candidates[safeIdx] : null
  const alts = hasResult
    ? candidates.filter((_, i) => i !== safeIdx)
    : []

  return (
    <section
      data-testid="recommend-card"
      className="overflow-hidden rounded-2xl border border-primary/30 bg-background shadow-[0_1px_2px_rgba(15,23,42,0.04),_0_12px_40px_rgba(79,90,170,0.12)]"
    >
      <HeaderBand
        title="추천 시간"
        subtitle={`응답 ${meeting.submitted_count ?? 0}명 기준 · AI 분석`}
        badge={hasResult && candidates.length > 0 ? `${candidates.length}개 제안` : null}
        confirmed={false}
        action={
          result?.kind === "recommend" ? (
            <RecommendButton
              slug={slug}
              disabled={!ready || calculating}
              loading={recommending}
              setLoading={setRecommending}
              onResult={onRecommendResult}
              compact
            />
          ) : null
        }
      />

      <div className="flex flex-col gap-3 p-4">
        {!hasResult ? (
          <EmptyBody
            slug={slug}
            ready={ready}
            calculating={calculating}
            recommending={recommending}
            resultError={resultError}
            onCalculate={onCalculate}
            onRecommendResult={onRecommendResult}
            setRecommending={setRecommending}
          />
        ) : current ? (
          <PickedBody
            kind={result.kind}
            current={current}
            alts={alts}
            allCount={candidates.length}
            summary={summary}
            onAltClick={(altCandidate) => {
              const realIdx = candidates.findIndex(
                (c) => c.start === altCandidate.start && c.end === altCandidate.end,
              )
              if (realIdx >= 0) setSelectedIdx(realIdx)
            }}
            onPick={onPick}
            onRecalc={onCalculate}
            onRecommendResult={onRecommendResult}
            setRecommending={setRecommending}
            recommending={recommending}
            calculating={calculating}
            ready={ready}
            slug={slug}
          />
        ) : (
          <EmptyResultBody suggestion={suggestion} />
        )}
      </div>
    </section>
  )
}

// ---------- header band ----------

interface HeaderBandProps {
  title: string
  subtitle?: string
  badge?: string | null
  confirmed: boolean
  /** Optional inline action (e.g. compact 재추천 button) rendered to the
   *  left of the badge on the right side of the header band. */
  action?: React.ReactNode
}

function HeaderBand({ title, subtitle, badge, confirmed, action }: HeaderBandProps) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-border bg-gradient-to-b from-[var(--soma-primary-soft)] to-background px-4 py-3">
      <div className="flex items-center gap-2.5">
        <div
          className={cn(
            "flex h-8 w-8 items-center justify-center rounded-lg text-white",
            confirmed ? "bg-success" : "bg-primary",
          )}
          aria-hidden="true"
        >
          {confirmed ? <Check className="h-4 w-4" /> : <Sparkles className="h-4 w-4" />}
        </div>
        <div>
          <div className="text-[14.5px] font-bold tracking-tight text-foreground">
            {title}
          </div>
          {subtitle ? (
            <div className="text-xs font-medium text-muted-foreground">{subtitle}</div>
          ) : null}
        </div>
      </div>
      <div className="flex items-center gap-2">
        {action}
        {badge ? (
          <span className="rounded-md border border-primary/30 bg-[var(--soma-primary-soft)] px-2 py-0.5 text-[11px] font-semibold tracking-tight text-primary">
            {badge}
          </span>
        ) : null}
      </div>
    </div>
  )
}

// ---------- empty state body ----------

interface EmptyBodyProps {
  slug: string
  ready: boolean
  calculating: boolean
  recommending: boolean
  resultError: string | null
  onCalculate: () => void
  onRecommendResult: (res: RecommendResponse) => void
  setRecommending: (v: boolean) => void
}

function EmptyBody({
  slug,
  ready,
  calculating,
  recommending,
  resultError,
  onCalculate,
  onRecommendResult,
  setRecommending,
}: EmptyBodyProps) {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm leading-relaxed text-muted-foreground">
        {ready
          ? '"추천받기"로 AI가 가능 시간과 안내 메시지를 골라드립니다. "결과 보기"는 즉시 계산만 합니다.'
          : "아직 제출된 일정이 없습니다 — 최소 1명이 제출하면 결과를 볼 수 있습니다."}
      </p>
      {resultError ? (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 p-2.5 text-xs text-destructive">
          {resultError}
        </div>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={onCalculate}
          disabled={calculating || recommending || !ready}
          data-testid="calculate-button"
        >
          {calculating ? "계산 중..." : "결과 보기"}
        </Button>
        <RecommendButton
          slug={slug}
          disabled={calculating || !ready}
          loading={recommending}
          setLoading={setRecommending}
          onResult={onRecommendResult}
        />
      </div>
    </div>
  )
}

// ---------- empty result (calc/recommend ran but no candidates) ----------

function EmptyResultBody({ suggestion }: { suggestion: string | null }) {
  return (
    <div className="rounded-lg border border-border bg-card p-3 text-sm text-foreground">
      <div className="font-medium">조건을 만족하는 후보가 없습니다.</div>
      {suggestion ? (
        <p className="mt-1 text-xs text-muted-foreground">{suggestion}</p>
      ) : null}
    </div>
  )
}

// ---------- picked body (calc or recommend with candidates) ----------

interface PickedBodyProps {
  kind: "calculate" | "recommend"
  current: Candidate
  alts: Candidate[]
  allCount: number
  summary: string | null
  onAltClick: (alt: Candidate) => void
  onPick: (c: Candidate) => void
  onRecalc: () => void
  onRecommendResult: (res: RecommendResponse) => void
  setRecommending: (v: boolean) => void
  recommending: boolean
  calculating: boolean
  ready: boolean
  slug: string
}

function PickedBody({
  kind,
  current,
  alts,
  allCount,
  summary,
  onAltClick,
  onPick,
  onRecommendResult,
  setRecommending,
  recommending,
  calculating,
  ready,
  slug,
}: PickedBodyProps) {
  const { toast } = useToast()
  const { day, range, duration } = formatCandidateLong(current.start, current.end)
  const allAvailable =
    current.available_count > 0 &&
    current.missing_participants.length === 0

  const currentIdx = 0 // we treat `current` as candidate[0] within the picked body
  const pickTestId = `candidate-${currentIdx}-pick`
  const copyTestId = `candidate-${currentIdx}-copy`

  async function copyDraft(draft: string) {
    try {
      await navigator.clipboard.writeText(draft)
      toast("메시지가 복사되었습니다.", "success")
    } catch {
      toast("복사에 실패했습니다. 직접 선택해 주세요.", "error")
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {summary ? (
        <p className="rounded-md border border-primary/30 bg-[var(--soma-primary-soft)] px-3 py-1.5 text-xs text-primary">
          {summary}
        </p>
      ) : null}

      <div data-testid={`candidate-${currentIdx}`}>
        <div
          className={cn(
            "text-[11px] font-bold uppercase tracking-wider",
            allAvailable ? "text-[color:var(--soma-warn)]" : "text-primary",
          )}
        >
          {allAvailable
            ? "BEST · 모두 가능"
            : `${current.available_count}명 가능 · 1순위`}
        </div>
        <div className="mt-1 text-[18px] font-extrabold tracking-tight text-foreground">
          {day}
        </div>
        <div className="mt-0.5 flex items-baseline gap-2 flex-wrap">
          <span className="font-mono text-[24px] font-extrabold leading-tight tracking-tight text-foreground tabular-nums">
            {range}
          </span>
          <span className="text-[13px] font-semibold text-muted-foreground">
            {duration}
          </span>
        </div>

        {current.missing_participants.length > 0 ? (
          <p className="mt-2 text-xs text-muted-foreground">
            빠진 참여자: {current.missing_participants.join(", ")}
          </p>
        ) : null}

        {current.reason ? (
          <div className="mt-3 flex items-start gap-2.5 rounded-lg bg-[var(--soma-primary-soft)] px-3 py-2.5">
            <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />
            <p className="text-sm font-semibold leading-snug text-primary">
              이유: {current.reason}
            </p>
          </div>
        ) : null}

        {current.share_message_draft ? (
          <div className="mt-3 rounded-xl bg-card p-3 text-sm">
            <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
              공지 메시지 초안
            </div>
            <p className="whitespace-pre-wrap text-foreground">
              {current.share_message_draft}
            </p>
          </div>
        ) : null}

        <div className="mt-3 flex flex-wrap gap-2">
          {current.share_message_draft ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              data-testid={copyTestId}
              onClick={() => copyDraft(current.share_message_draft as string)}
            >
              <Copy className="h-3.5 w-3.5" />
              공지 복사
            </Button>
          ) : null}
          <Button
            type="button"
            size="sm"
            data-testid={pickTestId}
            onClick={() => onPick(current)}
          >
            <Check className="h-3.5 w-3.5" />이 시간으로 확정
          </Button>
          {kind === "calculate" ? (
            <RecommendButton
              slug={slug}
              disabled={calculating || !ready}
              loading={recommending}
              setLoading={setRecommending}
              onResult={onRecommendResult}
            />
          ) : null}
        </div>
      </div>

      {alts.length > 0 ? (
        <div className="border-t border-border pt-3">
          <div className="mb-2 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
            다른 후보 ({alts.length} / {allCount})
          </div>
          <ol className="flex flex-col gap-1">
            {alts.map((alt) => {
              const altInfo = formatCandidateLong(alt.start, alt.end)
              // E1 e2e expects every candidate to expose its own pick testid.
              // alt indices follow their position in the *original* candidates
              // array; we resolve that index in the click handler via onAltClick
              // so the index in the visible alts list is irrelevant for testids.
              return (
                <li key={`${alt.start}-${alt.end}`}>
                  <button
                    type="button"
                    onClick={() => onAltClick(alt)}
                    data-testid={`recommend-alt-${alt.start}`}
                    className="flex w-full items-start justify-between gap-3 rounded-lg px-2 py-2 text-left transition-colors hover:bg-card"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline gap-2 text-sm font-bold tracking-tight text-foreground">
                        <span className="text-xs font-semibold text-muted-foreground">
                          {altInfo.day}
                        </span>
                        <span className="font-mono tabular-nums">{altInfo.range}</span>
                      </div>
                      {alt.reason ? (
                        <p className="mt-0.5 text-xs leading-snug text-muted-foreground">
                          {alt.reason}
                        </p>
                      ) : null}
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      <span className="rounded-md border border-border bg-card px-1.5 py-0.5 text-[11px] font-semibold text-muted-foreground">
                        {alt.available_count}명
                      </span>
                      <ChevronRight className="h-3.5 w-3.5 text-[color:var(--soma-faint)]" aria-hidden="true" />
                    </div>
                  </button>
                </li>
              )
            })}
          </ol>
        </div>
      ) : null}
    </div>
  )
}

// ---------- confirmed card ----------

interface ConfirmedCardProps {
  confirmedSlot: ConfirmedSlot
  confirmedShareMessage: string | null
  onCancelConfirm?: () => void | Promise<void>
}

function ConfirmedCard({
  confirmedSlot,
  confirmedShareMessage,
  onCancelConfirm,
}: ConfirmedCardProps) {
  const { toast } = useToast()
  const range = formatKstRange(confirmedSlot.start, confirmedSlot.end)

  async function copyMessage() {
    if (!confirmedShareMessage) return
    try {
      await navigator.clipboard.writeText(confirmedShareMessage)
      toast("메시지가 복사되었습니다.", "success")
    } catch {
      toast("복사에 실패했습니다. 직접 선택해 주세요.", "error")
    }
  }

  return (
    <section
      data-testid="recommend-card"
      data-state="confirmed"
      className="overflow-hidden rounded-2xl border border-success/40 bg-background shadow-[0_1px_2px_rgba(15,23,42,0.04),_0_12px_40px_rgba(22,163,74,0.14)]"
    >
      <HeaderBand title="확정 시간" confirmed />
      <div className="flex flex-col gap-3 p-4">
        <div className="rounded-lg border border-success/30 bg-[var(--soma-success-soft)] px-3 py-2.5 text-sm font-semibold text-success">
          <Check className="mr-1 inline h-3.5 w-3.5" aria-hidden="true" />
          회의가 확정되었습니다.
        </div>
        <div className="text-[22px] font-extrabold leading-tight tracking-tight text-foreground tabular-nums">
          {range}
        </div>
        {confirmedShareMessage ? (
          <div className="rounded-xl bg-card p-3 text-sm">
            <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
              공지 메시지
            </div>
            <p className="whitespace-pre-wrap text-foreground">{confirmedShareMessage}</p>
          </div>
        ) : null}
        <div className="flex flex-wrap gap-2">
          {confirmedShareMessage ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={copyMessage}
            >
              <Copy className="h-3.5 w-3.5" />
              공지 복사
            </Button>
          ) : null}
          {onCancelConfirm ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void onCancelConfirm()}
              className="text-destructive hover:bg-destructive/10 hover:text-destructive"
            >
              <XIcon className="h-3.5 w-3.5" />
              확정 취소
            </Button>
          ) : null}
        </div>
      </div>
    </section>
  )
}
