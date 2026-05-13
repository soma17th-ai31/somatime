// Timetable + share-message-dialog section. Spec §5.1 / §6 (Q9).
//
// v4 (2026-05-13) — Phase C3 redesign:
//   - Result state (calculate / recommend) was lifted out to MeetingPage so the
//     new RecommendCard can live in the sticky sidebar while the Timetable
//     stays in the main column. This component now only renders the timetable
//     itself + the ShareMessageDialog used by the pick flow.
//   - calculate / recommend buttons and CandidateList are now hosted inside
//     RecommendCard.

import { useEffect, useState } from "react"
import { Timetable } from "@/components/Timetable"
import { ShareMessageDialog } from "@/components/ShareMessageDialog"
import { useToast } from "@/components/ui/toast"
import { api } from "@/lib/api"
import {
  ApiError,
  type Candidate,
  type ConfirmResponse,
  type MeetingDetail,
  type TimetableResponse,
} from "@/lib/types"
import { formatKstRange } from "@/lib/datetime"

interface Props {
  slug: string
  meeting: MeetingDetail
  refreshKey: number
  onConfirmed: (response: ConfirmResponse, candidate: Candidate) => void
  // viewer's nickname for the Timetable "mine" indicator.
  currentNickname?: string | null
  // v4 — recommended candidates (start/end pairs) drive Timetable's best
  // outline + buffer hatching. Sourced from MeetingPage's result state.
  bestSlots?: Array<{ start: string; end: string }>
  // v4 — when a candidate is picked elsewhere (RecommendCard alt list, etc.)
  // the parent passes the candidate to open the confirm dialog through this
  // imperatively-styled prop. We accept the picked candidate via the
  // pickedCandidate prop pattern.
  pickedCandidate: Candidate | null
  onPickedHandled: () => void
}

export function TimetableSection({
  slug,
  meeting,
  refreshKey,
  onConfirmed,
  currentNickname,
  bestSlots,
  pickedCandidate,
  onPickedHandled,
}: Props) {
  const { toast } = useToast()

  const [timetable, setTimetable] = useState<TimetableResponse | null>(null)
  const [timetableError, setTimetableError] = useState<string | null>(null)

  const [confirmDialog, setConfirmDialog] = useState<{
    open: boolean
    candidate: Candidate | null
    draft: string
    rangeLabel: string
    busy: boolean
  }>({ open: false, candidate: null, draft: "", rangeLabel: "", busy: false })

  const submitted = meeting.submitted_count ?? 0

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

  // Open the confirm dialog whenever a candidate is picked from outside (e.g.
  // RecommendCard's main "이 시간으로 확정" button). The parent clears
  // pickedCandidate via onPickedHandled after we've consumed it so the same
  // candidate can be picked again later (e.g. after a 확정 취소).
  useEffect(() => {
    if (!pickedCandidate) return
    setConfirmDialog({
      open: true,
      candidate: pickedCandidate,
      draft: pickedCandidate.share_message_draft ?? "",
      rangeLabel: formatKstRange(pickedCandidate.start, pickedCandidate.end),
      busy: false,
    })
    onPickedHandled()
  }, [pickedCandidate, onPickedHandled])

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

  return (
    <section className="flex flex-col gap-3">
      <h3 className="text-sm font-semibold text-foreground">타임테이블 (가로)</h3>
      {timetableError ? (
        <p className="text-sm text-destructive">{timetableError}</p>
      ) : null}
      <Timetable
        slots={timetable?.slots ?? []}
        participantCount={Math.max(submitted, 1)}
        submittedNicknames={meeting.submitted_nicknames ?? []}
        currentNickname={currentNickname}
        bestSlots={bestSlots}
        bufferMinutes={meeting.my_buffer_minutes ?? 60}
      />

      <ShareMessageDialog
        open={confirmDialog.open}
        onOpenChange={(open) => setConfirmDialog((prev) => ({ ...prev, open }))}
        initialDraft={confirmDialog.draft}
        confirmedRange={confirmDialog.rangeLabel}
        busy={confirmDialog.busy}
        onConfirm={handleConfirm}
      />
    </section>
  )
}
