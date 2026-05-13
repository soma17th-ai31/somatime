// MeetingPage — Spec §6 vertical order.
//
// v4 (2026-05-13) Soma redesign:
//   - Phase C1: TopBar, MeetingSummary, CurrentParticipantCard, Participants
//   - Phase C2: Timetable heat ramp / mine / best / buffer hatching
//   - Phase C3: sticky sidebar = RecommendCard + Participants. Result state
//     (calculate / recommend) lives here so the card can sit in the sidebar
//     while Timetable receives bestSlots in the main column.
//
// Data flow (preserved):
//   - useEffect 5-sec polling while !confirmed
//   - participantSession cookie / nickname
//   - ShareMessageDialog post-confirm round-trip (readOnly)

import { useCallback, useEffect, useMemo, useState } from "react"
import { Link, useParams } from "react-router-dom"
import {
  ApiError,
  type CalculateResponse,
  type Candidate,
  type ConfirmResponse,
  type MeetingDetail,
  type RecommendResponse,
} from "@/lib/types"
import { api } from "@/lib/api"
import { MeetingSummary } from "./meeting/MeetingSummary"
import { JoinSection } from "./meeting/JoinSection"
import { CurrentParticipantCard } from "./meeting/CurrentParticipantCard"
import { AvailabilitySection } from "./meeting/AvailabilitySection"
import { TimetableSection } from "./meeting/TimetableSection"
import { Participants } from "./meeting/Participants"
import { RecommendCard, type RecommendCardResultState } from "./meeting/RecommendCard"
import { ShareMessageDialog } from "@/components/ShareMessageDialog"
import { useToast } from "@/components/ui/toast"
import { formatKstRange } from "@/lib/datetime"
import {
  clearParticipantSession,
  readParticipantNickname,
  writeParticipantSession,
} from "@/lib/participantSession"

export default function MeetingPage() {
  const { slug } = useParams<{ slug: string }>()
  const { toast } = useToast()

  const [meeting, setMeeting] = useState<MeetingDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [participantNickname, setParticipantNickname] = useState<string | null>(() =>
    slug ? readParticipantNickname(slug) : null,
  )
  const [refreshKey, setRefreshKey] = useState(0)
  const [confirmedDialog, setConfirmedDialog] = useState<{
    open: boolean
    message: string
    rangeLabel: string
  }>({ open: false, message: "", rangeLabel: "" })

  // Phase C3 — result state lives at the page level so RecommendCard (sidebar)
  // and Timetable (main column) can both read it.
  const [result, setResult] = useState<RecommendCardResultState>({ kind: "idle" })
  const [calculating, setCalculating] = useState(false)
  const [recommending, setRecommending] = useState(false)
  const [resultError, setResultError] = useState<string | null>(null)
  // Candidate the user just picked — flows down to TimetableSection which
  // opens the ShareMessageDialog. The section clears it via onPickedHandled
  // after consumption so re-picking the same slot is possible.
  const [pickedCandidate, setPickedCandidate] = useState<Candidate | null>(null)

  const reloadMeeting = useCallback(async () => {
    if (!slug) return
    try {
      const res = await api.getMeeting(slug)
      setMeeting(res)
      setLoadError(null)
    } catch (err) {
      setLoadError(err instanceof ApiError ? err.message : "회의 정보를 불러오지 못했습니다.")
    } finally {
      setLoading(false)
    }
  }, [slug])

  useEffect(() => {
    setLoading(true)
    void reloadMeeting()
  }, [reloadMeeting])

  const onParticipantSubmitted = useCallback(() => {
    setRefreshKey((k) => k + 1)
    void reloadMeeting()
  }, [reloadMeeting])

  const onJoined = useCallback(
    (nickname: string, token?: string) => {
      if (slug) writeParticipantSession(slug, nickname, token)
      setParticipantNickname(nickname)
      void reloadMeeting()
    },
    [slug, reloadMeeting],
  )

  // v3.10 — soft real-time: poll meeting + timetable every 5s while the tab is
  // visible and the meeting hasn't been confirmed.
  useEffect(() => {
    if (!slug) return
    if (meeting?.confirmed_slot) return

    const POLL_INTERVAL_MS = 5_000
    let cancelled = false

    const tick = () => {
      if (cancelled) return
      if (typeof document !== "undefined" && document.hidden) return
      void reloadMeeting()
      setRefreshKey((k) => k + 1)
    }
    const id = window.setInterval(tick, POLL_INTERVAL_MS)

    const onVis = () => {
      if (typeof document !== "undefined" && !document.hidden) tick()
    }
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", onVis)
    }

    return () => {
      cancelled = true
      window.clearInterval(id)
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", onVis)
      }
    }
  }, [slug, meeting?.confirmed_slot, reloadMeeting])

  const onConfirmed = useCallback(
    (response: ConfirmResponse, candidate: Candidate) => {
      setConfirmedDialog({
        open: true,
        message: response.share_message_draft,
        rangeLabel: formatKstRange(candidate.start, candidate.end),
      })
      void reloadMeeting()
    },
    [reloadMeeting],
  )

  const handleCancelConfirm = useCallback(async () => {
    if (!slug) return
    try {
      const updated = await api.cancelConfirm(slug)
      setMeeting(updated)
      setRefreshKey((k) => k + 1)
      setConfirmedDialog((prev) => ({ ...prev, open: false }))
      toast("회의 확정이 취소되었습니다.", "success")
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "확정 취소에 실패했습니다."
      toast(msg, "error")
      throw err
    }
  }, [slug, toast])

  const handleSwitchUser = useCallback(() => {
    if (slug) clearParticipantSession(slug)
    setParticipantNickname(null)
    void reloadMeeting()
  }, [slug, reloadMeeting])

  const handleCalculate = useCallback(async () => {
    if (!slug) return
    setCalculating(true)
    setResultError(null)
    try {
      const res: CalculateResponse = await api.calculate(slug)
      setResult({ kind: "calculate", response: res })
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "계산에 실패했습니다."
      setResultError(msg)
      toast(msg, "error")
    } finally {
      setCalculating(false)
    }
  }, [slug, toast])

  const handleRecommendResult = useCallback((res: RecommendResponse) => {
    setResult({ kind: "recommend", response: res })
    setResultError(null)
  }, [])

  const handlePick = useCallback((candidate: Candidate) => {
    setPickedCandidate(candidate)
  }, [])

  const slugFootnote = useMemo(
    () => (meeting ? `slug: ${meeting.slug}` : null),
    [meeting],
  )

  const bestSlots = useMemo(() => {
    if (result.kind !== "recommend") return undefined
    return (result.response.candidates ?? []).map((c) => ({
      start: c.start,
      end: c.end,
    }))
  }, [result])

  const ready = useMemo(() => {
    if (!meeting) return false
    return meeting.is_ready_to_calculate ?? (meeting.submitted_count ?? 0) >= 1
  }, [meeting])

  if (!slug) {
    return (
      <main className="linear-container flex min-h-screen flex-col items-center justify-center gap-3">
        <p className="text-foreground">잘못된 주소입니다.</p>
        <Link to="/" className="text-primary underline-offset-2 hover:underline">
          홈으로
        </Link>
      </main>
    )
  }

  if (loading) {
    return (
      <main className="linear-container flex min-h-screen flex-col items-center justify-center">
        <p className="text-sm text-muted-foreground">회의 정보를 불러오는 중...</p>
      </main>
    )
  }

  if (loadError || !meeting) {
    return (
      <main className="linear-container flex min-h-screen flex-col items-center justify-center gap-3 text-center">
        <h1 className="font-display text-2xl font-semibold tracking-[-0.5px] text-foreground">
          회의를 불러올 수 없습니다
        </h1>
        <p className="text-sm text-muted-foreground">
          {loadError ?? "주소를 다시 확인해 주세요."}
        </p>
        <Link to="/" className="text-primary underline-offset-2 hover:underline">
          홈으로
        </Link>
      </main>
    )
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <TopBar />
      <main className="linear-container flex flex-col gap-6 px-5 py-6 sm:py-10 lg:px-10 lg:py-10">
        <MeetingSummary
          slug={slug}
          meeting={meeting}
          onSettingsSaved={() => {
            void reloadMeeting()
            setRefreshKey((k) => k + 1)
          }}
          onCancelConfirm={handleCancelConfirm}
        />

        <div className="grid gap-6 lg:grid-cols-[1fr_360px] lg:items-start lg:gap-8">
          <div className="flex min-w-0 flex-col gap-6">
            {participantNickname ? (
              <CurrentParticipantCard
                slug={slug}
                nickname={participantNickname}
                isRequired={(meeting.required_nicknames ?? []).includes(participantNickname)}
                myBufferMinutes={meeting.my_buffer_minutes ?? null}
                locationType={meeting.location_type}
                onRenamed={(newName) => {
                  writeParticipantSession(slug, newName)
                  setParticipantNickname(newName)
                  void reloadMeeting()
                }}
                onSwitchUser={handleSwitchUser}
                onBufferChanged={() => {
                  void reloadMeeting()
                  setRefreshKey((k) => k + 1)
                }}
              />
            ) : (
              <JoinSection
                slug={slug}
                locationType={meeting.location_type}
                onJoined={onJoined}
              />
            )}

            {participantNickname ? (
              <AvailabilitySection
                slug={slug}
                meeting={meeting}
                onSubmitted={onParticipantSubmitted}
              />
            ) : null}

            <TimetableSection
              slug={slug}
              meeting={meeting}
              refreshKey={refreshKey}
              onConfirmed={onConfirmed}
              currentNickname={participantNickname}
              bestSlots={bestSlots}
              pickedCandidate={pickedCandidate}
              onPickedHandled={() => setPickedCandidate(null)}
            />
          </div>

          <div className="flex flex-col gap-4 lg:sticky lg:top-20">
            <RecommendCard
              slug={slug}
              meeting={meeting}
              result={result}
              calculating={calculating}
              recommending={recommending}
              ready={ready}
              resultError={resultError}
              onCalculate={handleCalculate}
              onRecommendResult={handleRecommendResult}
              setRecommending={setRecommending}
              onPick={handlePick}
              onCancelConfirm={handleCancelConfirm}
            />
            <Participants meeting={meeting} />
          </div>
        </div>

        {slugFootnote ? (
          <p className="font-mono text-xs text-muted-foreground">{slugFootnote}</p>
        ) : null}
      </main>

      <ShareMessageDialog
        open={confirmedDialog.open}
        onOpenChange={(open) => setConfirmedDialog((prev) => ({ ...prev, open }))}
        initialDraft={confirmedDialog.message}
        confirmedRange={confirmedDialog.rangeLabel}
        readOnly
      />
    </div>
  )
}

function TopBar() {
  return (
    <div className="sticky top-0 z-10 flex h-14 items-center justify-between border-b border-border bg-background px-5 lg:px-10">
      <Link to="/" className="flex items-center gap-2.5" data-testid="back-to-home">
        <div className="flex h-6.5 w-6.5 items-center justify-center rounded-md bg-primary">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <rect x="3" y="3" width="10" height="10" rx="2" stroke="#fff" strokeWidth="1.6" />
            <path
              d="M6 7l1.5 1.5L11 5"
              stroke="#fff"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>
        <div className="text-[15px] font-bold tracking-tight text-foreground">SomaMeet</div>
      </Link>
    </div>
  )
}
