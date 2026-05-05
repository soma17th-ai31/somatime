import { useCallback, useEffect, useMemo, useState } from "react"
import { Link, useParams, useSearchParams } from "react-router-dom"
import { Card, CardContent } from "@/components/ui/card"
import { ApiError, type Candidate, type ConfirmResponse, type MeetingDetail } from "@/lib/types"
import { api } from "@/lib/api"
import { MeetingSummary } from "./meeting/MeetingSummary"
import { JoinSection } from "./meeting/JoinSection"
import { AvailabilitySection } from "./meeting/AvailabilitySection"
import { TimetableSection } from "./meeting/TimetableSection"
import { ShareMessageDialog } from "@/components/ShareMessageDialog"
import { formatKstRange } from "@/lib/datetime"

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
  const [searchParams] = useSearchParams()
  const organizerToken = searchParams.get("org")
  const isOrganizer = Boolean(organizerToken)

  const [meeting, setMeeting] = useState<MeetingDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [participantNickname, setParticipantNickname] = useState<string | null>(() =>
    slug ? readParticipantNickname(slug) : null,
  )
  const [refreshKey, setRefreshKey] = useState(0)
  const [shareDialog, setShareDialog] = useState<{
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

  const onConfirmed = useCallback(
    (response: ConfirmResponse, candidate: Candidate) => {
      setShareDialog({
        open: true,
        message: response.share_message_draft,
        rangeLabel: formatKstRange(candidate.start, candidate.end),
      })
      void reloadMeeting()
    },
    [reloadMeeting],
  )

  const headerBadge = useMemo(() => {
    if (isOrganizer) {
      return (
        <span className="inline-flex items-center rounded-full bg-accent-muted px-3 py-1 text-xs font-medium text-accent">
          주최자 모드
        </span>
      )
    }
    return (
      <span className="inline-flex items-center rounded-full bg-slate-200 px-3 py-1 text-xs font-medium text-slate-700">
        참여자 모드
      </span>
    )
  }, [isOrganizer])

  if (!slug) {
    return (
      <main className="mx-auto flex min-h-screen max-w-xl flex-col items-center justify-center p-8">
        <p className="text-slate-700">잘못된 주소입니다.</p>
        <Link to="/" className="mt-4 text-accent underline">
          홈으로
        </Link>
      </main>
    )
  }

  if (loading) {
    return (
      <main className="mx-auto flex min-h-screen max-w-3xl flex-col items-center justify-center p-8">
        <p className="text-sm text-slate-600">회의 정보를 불러오는 중...</p>
      </main>
    )
  }

  if (loadError || !meeting) {
    return (
      <main className="mx-auto flex min-h-screen max-w-2xl flex-col items-center justify-center p-8 text-center">
        <h1 className="text-xl font-semibold text-slate-900">회의를 불러올 수 없습니다</h1>
        <p className="mt-2 text-sm text-slate-600">
          {loadError ?? "주소를 다시 확인해 주세요."}
        </p>
        <Link to="/" className="mt-4 text-accent underline">
          홈으로
        </Link>
      </main>
    )
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-6 p-6 sm:py-12">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">{meeting.title}</h1>
          <p className="text-xs text-slate-500">slug: {meeting.slug}</p>
        </div>
        {headerBadge}
      </header>

      <MeetingSummary meeting={meeting} isOrganizer={isOrganizer} />

      {participantNickname ? (
        <Card>
          <CardContent className="flex items-center justify-between gap-3">
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                현재 참여자
              </div>
              <div className="mt-1 text-sm text-slate-800">{participantNickname}</div>
            </div>
            <p className="text-xs text-slate-500">
              아래 가용 시간 입력에서 직접 입력 / ICS / Google 중 한 가지 방법을 선택하세요.
            </p>
          </CardContent>
        </Card>
      ) : (
        <JoinSection slug={slug} onJoined={onJoined} />
      )}

      {participantNickname ? (
        <AvailabilitySection slug={slug} meeting={meeting} onSubmitted={onParticipantSubmitted} />
      ) : null}

      <TimetableSection
        slug={slug}
        meeting={meeting}
        isOrganizer={isOrganizer}
        organizerToken={organizerToken}
        refreshKey={refreshKey}
        onConfirmed={onConfirmed}
      />

      <ShareMessageDialog
        open={shareDialog.open}
        onOpenChange={(open) => setShareDialog((prev) => ({ ...prev, open }))}
        message={shareDialog.message}
        confirmedRange={shareDialog.rangeLabel}
      />
    </main>
  )
}
