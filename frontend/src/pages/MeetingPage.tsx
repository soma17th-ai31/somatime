// MeetingPage — Spec §6 vertical order:
//   1. MeetingSummary (title/date/duration/target/location/buffer + progress)
//   2. JoinSection (only when no participant cookie/nickname yet) — nickname + optional PIN + login foldout
//   3. AvailabilitySection (after join — manual / ICS tabs)
//   4. TimetableSection (horizontal grid)
//   5. ResultSection: [결과 보기] / [추천받기], CandidateList, ConfirmSection
//
// v3.2 (2026-05-06 Path B): organizer_token concept retired entirely. Anyone
// with the slug (= share URL) can run calculate / recommend / confirm. The
// 2-step ShareMessageDialog is the sole accident safeguard.

import { useCallback, useEffect, useMemo, useState } from "react"
import { Link, useParams } from "react-router-dom"
import { ApiError, type Candidate, type ConfirmResponse, type MeetingDetail } from "@/lib/types"
import { api } from "@/lib/api"
import { MeetingSummary } from "./meeting/MeetingSummary"
import { JoinSection } from "./meeting/JoinSection"
import { CurrentParticipantCard } from "./meeting/CurrentParticipantCard"
import { AvailabilitySection } from "./meeting/AvailabilitySection"
import { TimetableSection } from "./meeting/TimetableSection"
import { ShareMessageDialog } from "@/components/ShareMessageDialog"
import { useToast } from "@/components/ui/toast"
import { formatKstRange } from "@/lib/datetime"
import { cn } from "@/lib/cn"

// Layout breakpoint: when the meeting has many dates, the timetable + grid get
// too wide for a 2-col split — fall back to a single-column stack.
const TWO_COL_DATE_LIMIT = 5

function countMeetingDates(meeting: MeetingDetail): number {
  if (meeting.date_mode === "range") {
    if (!meeting.date_range_start || !meeting.date_range_end) return 0
    const start = new Date(`${meeting.date_range_start}T00:00:00`)
    const end = new Date(`${meeting.date_range_end}T00:00:00`)
    return Math.max(1, Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1)
  }
  return meeting.candidate_dates?.length ?? 0
}

const PARTICIPANT_LS_KEY = (slug: string) => `somameet_pt_local_${slug}`

function readParticipantNickname(slug: string): string | null {
  try {
    return window.localStorage.getItem(PARTICIPANT_LS_KEY(slug))
  } catch {
    return null
  }
}

function writeParticipantNickname(slug: string, nickname: string) {
  try {
    window.localStorage.setItem(PARTICIPANT_LS_KEY(slug), nickname)
  } catch {
    /* ignore */
  }
}

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
    (nickname: string) => {
      if (slug) writeParticipantNickname(slug, nickname)
      setParticipantNickname(nickname)
      void reloadMeeting()
    },
    [slug, reloadMeeting],
  )

  const useTwoColumnLayout = useMemo(
    () => (meeting ? countMeetingDates(meeting) <= TWO_COL_DATE_LIMIT : true),
    [meeting],
  )

  // v3.10 — soft real-time: poll meeting + timetable every 5s while the tab is
  // visible and the meeting hasn't been confirmed. ManualAvailabilityForm is
  // hardened so user-mid-edit selection isn't overwritten on each tick.
  useEffect(() => {
    if (!slug) return
    if (meeting?.confirmed_slot) return // confirmed = no further sync needed

    const POLL_INTERVAL_MS = 5_000
    let cancelled = false

    const tick = () => {
      if (cancelled) return
      if (typeof document !== "undefined" && document.hidden) return
      void reloadMeeting()
      setRefreshKey((k) => k + 1)
    }
    const id = window.setInterval(tick, POLL_INTERVAL_MS)

    // Refetch immediately when the tab regains focus (catch up on missed updates).
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
      // Show a read-only "공유 메시지" dialog right after the confirm round-trips.
      setConfirmedDialog({
        open: true,
        message: response.share_message_draft,
        rangeLabel: formatKstRange(candidate.start, candidate.end),
      })
      void reloadMeeting()
    },
    [reloadMeeting],
  )

  // #24 — 확정 취소. 성공 시 reload + refreshKey 증가 + readOnly 다이얼로그 닫기 + 토스트.
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

  // v3.2 (Path B): no organizer/participant split anywhere. The
  // ShareMessageDialog 2-step gate is the only accident safeguard now.

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

  function handleSwitchUser() {
    if (slug) {
      try {
        window.localStorage.removeItem(PARTICIPANT_LS_KEY(slug))
      } catch {
        /* ignore */
      }
    }
    setParticipantNickname(null)
    void reloadMeeting()
  }

  return (
    <main className="linear-container flex min-h-screen flex-col gap-6 py-10 sm:py-14">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link
            to="/"
            className="text-xs text-muted-foreground underline-offset-2 hover:text-primary hover:underline"
            data-testid="back-to-home"
          >
            ← 홈으로
          </Link>
          <h1 className="mt-1 font-display text-[clamp(24px,3.2vw,36px)] font-semibold leading-[1.15] tracking-[-1px] text-foreground">
            {meeting.title}
          </h1>
          <p className="mt-1 font-mono text-xs text-muted-foreground">slug: {meeting.slug}</p>
        </div>
        {participantNickname ? (
          <CurrentParticipantCard
            slug={slug}
            nickname={participantNickname}
            isRequired={(meeting.required_nicknames ?? []).includes(participantNickname)}
            onRenamed={(newName) => {
              writeParticipantNickname(slug, newName)
              setParticipantNickname(newName)
              void reloadMeeting()
            }}
            onSwitchUser={handleSwitchUser}
          />
        ) : null}
      </header>

      <MeetingSummary
        slug={slug}
        meeting={meeting}
        onSettingsSaved={() => {
          void reloadMeeting()
          setRefreshKey((k) => k + 1)
        }}
        onCancelConfirm={handleCancelConfirm}
      />

      {participantNickname ? null : <JoinSection slug={slug} onJoined={onJoined} />}

      {participantNickname ? (
        <div
          className={cn(
            "grid gap-6 lg:items-start",
            useTwoColumnLayout ? "lg:grid-cols-2" : "lg:grid-cols-1",
          )}
        >
          <AvailabilitySection
            slug={slug}
            meeting={meeting}
            onSubmitted={onParticipantSubmitted}
          />
          <TimetableSection
            slug={slug}
            meeting={meeting}
            refreshKey={refreshKey}
            onConfirmed={onConfirmed}
          />
        </div>
      ) : (
        <TimetableSection
          slug={slug}
          meeting={meeting}
          refreshKey={refreshKey}
          onConfirmed={onConfirmed}
        />
      )}

      <ShareMessageDialog
        open={confirmedDialog.open}
        onOpenChange={(open) => setConfirmedDialog((prev) => ({ ...prev, open }))}
        initialDraft={confirmedDialog.message}
        confirmedRange={confirmedDialog.rangeLabel}
        readOnly
      />
    </main>
  )
}
