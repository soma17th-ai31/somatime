import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { useToast } from "@/components/ui/toast"
import { CandidateList } from "@/components/CandidateList"
import { Timetable } from "@/components/Timetable"
import { api } from "@/lib/api"
import {
  ApiError,
  type Candidate,
  type CalculateResponse,
  type ConfirmResponse,
  type MeetingDetail,
  type TimetableResponse,
} from "@/lib/types"

interface Props {
  slug: string
  meeting: MeetingDetail
  isOrganizer: boolean
  organizerToken: string | null
  refreshKey: number
  onConfirmed: (response: ConfirmResponse, candidate: Candidate) => void
}

export function TimetableSection({
  slug,
  meeting,
  isOrganizer,
  organizerToken,
  refreshKey,
  onConfirmed,
}: Props) {
  const { toast } = useToast()
  const [timetable, setTimetable] = useState<TimetableResponse | null>(null)
  const [timetableError, setTimetableError] = useState<string | null>(null)
  const [calculating, setCalculating] = useState(false)
  const [calcResult, setCalcResult] = useState<CalculateResponse | null>(null)
  const [calcError, setCalcError] = useState<string | null>(null)
  const [confirmingKey, setConfirmingKey] = useState<string | null>(null)

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
    setCalcError(null)
    try {
      const res = await api.calculate(slug)
      setCalcResult(res)
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "계산에 실패했습니다."
      setCalcError(msg)
      toast(msg, "error")
    } finally {
      setCalculating(false)
    }
  }

  async function handleConfirm(candidate: Candidate) {
    if (!isOrganizer || !organizerToken) {
      toast("주최자만 확정할 수 있습니다.", "error")
      return
    }
    const key = `${candidate.start}-${candidate.end}`
    setConfirmingKey(key)
    try {
      const res = await api.confirm(slug, organizerToken, {
        slot_start: candidate.start,
        slot_end: candidate.end,
      })
      onConfirmed(res, candidate)
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "확정에 실패했습니다."
      toast(msg, "error")
    } finally {
      setConfirmingKey(null)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>후보 시간과 타임테이블</CardTitle>
        <CardDescription>
          참여자 입력이 모이면 후보를 계산하세요. 타임테이블은 30분 단위로 자동 갱신됩니다.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        <section className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="text-sm font-semibold text-slate-800">후보 시간</h3>
            <Button onClick={handleCalculate} disabled={calculating}>
              {calculating ? "계산 중..." : "후보 시간 계산"}
            </Button>
          </div>

          {calcError ? (
            <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
              {calcError}
            </div>
          ) : null}

          {calcResult ? (
            calcResult.candidates.length > 0 ? (
              <CandidateList
                candidates={calcResult.candidates}
                isOrganizer={isOrganizer}
                onConfirm={handleConfirm}
                confirmingKey={confirmingKey}
              />
            ) : (
              <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                <div className="font-medium">조건을 만족하는 후보가 없습니다.</div>
                {calcResult.suggestion ? (
                  <p className="mt-1">{calcResult.suggestion}</p>
                ) : null}
              </div>
            )
          ) : (
            <p className="text-sm text-slate-600">
              아직 후보를 계산하지 않았습니다. 충분한 참여자가 입력을 마친 뒤 계산을 시도하세요.
            </p>
          )}
        </section>

        <section className="flex flex-col gap-3">
          <h3 className="text-sm font-semibold text-slate-800">타임테이블</h3>
          {timetableError ? (
            <p className="text-sm text-red-600">{timetableError}</p>
          ) : null}
          <Timetable
            slots={timetable?.slots ?? []}
            participantCount={meeting.participant_count}
          />
        </section>
      </CardContent>
    </Card>
  )
}
