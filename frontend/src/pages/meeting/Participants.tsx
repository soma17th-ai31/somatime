// Participants card — lives in the right-hand sticky sidebar on desktop and
// at the bottom of the stack on mobile. Surfaces:
//   - submitted_nicknames as chips (initial + name + green dot)
//   - required participants highlighted with the primarySoft band
//   - required-but-pending callout when at least one required participant
//     hasn't submitted yet
//
// Previously the chip list lived inside MeetingSummary; the new Soma layout
// pulls it out into its own card so the summary stays focused on metadata.

import type { MeetingDetail } from "@/lib/types"
import { cn } from "@/lib/cn"

interface Props {
  meeting: MeetingDetail
}

interface Row {
  nickname: string
  required: boolean
  submitted: boolean
}

function buildRows(meeting: MeetingDetail): Row[] {
  const submitted = new Set(meeting.submitted_nicknames ?? [])
  const required = new Set(meeting.required_nicknames ?? [])
  const all = new Set<string>([...submitted, ...required])
  return [...all]
    .map((nickname) => ({
      nickname,
      required: required.has(nickname),
      submitted: submitted.has(nickname),
    }))
    .sort((a, b) => {
      // submitted first, then required-but-pending, then alphabetical.
      if (a.submitted !== b.submitted) return a.submitted ? -1 : 1
      if (a.required !== b.required) return a.required ? -1 : 1
      return a.nickname.localeCompare(b.nickname, "ko")
    })
}

export function Participants({ meeting }: Props) {
  const rows = buildRows(meeting)
  const submitted = rows.filter((r) => r.submitted).length
  const requiredPending = rows.filter((r) => r.required && !r.submitted)

  return (
    <aside
      data-testid="participants-card"
      className="rounded-2xl border border-border bg-background p-4"
    >
      <div className="flex items-center justify-between">
        <div className="text-[13.5px] font-bold tracking-tight text-foreground">참여자</div>
        <span className="rounded-md border border-border bg-card px-1.5 py-0.5 text-[11px] font-semibold text-muted-foreground">
          {submitted}명 제출
        </span>
      </div>
      {(meeting.required_nicknames ?? []).length > 0 ? (
        <div className="mt-1 flex items-center gap-1.5 text-[11.5px] text-muted-foreground">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-primary" aria-hidden="true" />
          필수 참여자 {meeting.required_nicknames?.length ?? 0}명
        </div>
      ) : null}

      {rows.length > 0 ? (
        <ul
          aria-label="참여자 목록"
          data-testid="submitted-nicknames"
          className="mt-3 flex flex-col gap-1"
        >
          {rows.map((row) => (
            <li
              key={row.nickname}
              className={cn(
                "flex items-center gap-2.5 rounded-lg px-2 py-1.5",
                row.required ? "bg-[var(--soma-primary-soft)]" : "bg-transparent",
              )}
              title={row.required ? "필수 참여자" : undefined}
            >
              <div
                aria-hidden="true"
                className={cn(
                  "flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11.5px] font-bold",
                  row.required
                    ? "bg-primary text-primary-foreground"
                    : "bg-card text-[color:var(--soma-ink-soft)]",
                )}
              >
                {row.nickname.slice(0, 1)}
              </div>
              <span
                className={cn(
                  "min-w-0 flex-1 truncate text-[13.5px] tracking-tight",
                  row.required ? "font-bold text-primary" : "font-medium text-foreground",
                )}
              >
                {row.nickname}
              </span>
              <span
                aria-label={row.submitted ? "제출 완료" : "미응답"}
                className={cn(
                  "h-2 w-2 shrink-0 rounded-full",
                  row.submitted ? "bg-success" : "bg-[color:var(--soma-faint)] opacity-50",
                )}
              />
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-xs text-muted-foreground">아직 제출한 참여자가 없습니다.</p>
      )}

      {requiredPending.length > 0 ? (
        <p
          className="mt-3 rounded-md border border-primary/30 bg-primary/10 px-2.5 py-1.5 text-xs text-primary"
          data-testid="required-pending"
        >
          ★ 필수 참여자 미제출: {requiredPending.map((r) => r.nickname).join(", ")}
        </p>
      ) : null}
    </aside>
  )
}
