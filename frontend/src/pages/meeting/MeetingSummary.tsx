import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import type { MeetingDetail } from "@/lib/types"
import { formatKstRange } from "@/lib/datetime"

const LOCATION_LABEL: Record<MeetingDetail["location_type"], string> = {
  online: "온라인",
  offline: "오프라인",
  any: "온라인/오프라인 모두 가능",
}

interface Props {
  meeting: MeetingDetail
  isOrganizer: boolean
}

export function MeetingSummary({ meeting, isOrganizer }: Props) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{meeting.title}</CardTitle>
        <CardDescription>
          {isOrganizer ? "주최자 모드" : "참여자 모드"} · 모든 시간은 KST 기준입니다.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">기간</dt>
            <dd className="mt-1 text-slate-800">
              {meeting.date_range_start} ~ {meeting.date_range_end}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">검색 시간대</dt>
            <dd className="mt-1 text-slate-800">
              매일 {meeting.time_window_start} ~ {meeting.time_window_end}
              {meeting.include_weekends ? " (주말 포함)" : " (주말 제외)"}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">회의 길이</dt>
            <dd className="mt-1 text-slate-800">{meeting.duration_minutes}분</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">진행 방식</dt>
            <dd className="mt-1 text-slate-800">{LOCATION_LABEL[meeting.location_type]}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">예상 인원</dt>
            <dd className="mt-1 text-slate-800">
              {meeting.participants_registered} / {meeting.participant_count}명 등록 완료
            </dd>
          </div>
          {meeting.confirmed_slot ? (
            <div className="sm:col-span-2 rounded-md bg-accent-muted p-3 text-accent">
              <dt className="text-xs font-semibold uppercase tracking-wide">확정된 시각</dt>
              <dd className="mt-1 font-medium">
                {formatKstRange(meeting.confirmed_slot.start, meeting.confirmed_slot.end)}
              </dd>
            </div>
          ) : null}
        </dl>
      </CardContent>
    </Card>
  )
}
