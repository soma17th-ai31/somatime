// Current-participant identity card. Phase E redesign:
//   - Card shell (avatar + nickname + status chips + 재설정 + 로그아웃)
//   - INLINE buffer chips (0/30/60/90/120) that PATCH the server on click
//   - Nickname / PIN / 필수 참여자 edits move into SelfEditModal
//
// Replaces the previous "single edit-form for everything" pattern. The inline
// buffer call goes through PATCH /participants/me (api.updateSelf) with only
// `buffer_minutes` in the body — same endpoint, narrower payload.

import { useState } from "react"
import { Loader2, LogOut, Pencil, Star } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useToast } from "@/components/ui/toast"
import { api } from "@/lib/api"
import { ApiError, type LocationType } from "@/lib/types"
import { cn } from "@/lib/cn"
import { SelfEditModal } from "./SelfEditModal"

const BUFFER_DEFAULT_MINUTES = 60
const BUFFER_OPTIONS: Array<{ value: number; label: string }> = [
  { value: 0, label: "0" },
  { value: 30, label: "30" },
  { value: 60, label: "60" },
  { value: 90, label: "90" },
  { value: 120, label: "120" },
]

interface Props {
  slug: string
  nickname: string
  isRequired: boolean
  myBufferMinutes: number | null
  locationType: LocationType
  onRenamed: (newNickname: string) => void
  onSwitchUser: () => void
  onBufferChanged?: (newValue: number | null) => void
}

export function CurrentParticipantCard({
  slug,
  nickname,
  isRequired,
  myBufferMinutes,
  locationType,
  onRenamed,
  onSwitchUser,
  onBufferChanged,
}: Props) {
  const { toast } = useToast()
  const [editOpen, setEditOpen] = useState(false)
  const [bufferBusy, setBufferBusy] = useState<number | null>(null)

  const showBuffer = locationType !== "online"
  const effectiveBuffer = myBufferMinutes ?? BUFFER_DEFAULT_MINUTES

  async function handleBufferPick(next: number) {
    if (bufferBusy !== null) return
    // No-op when the picked value already matches the explicit server value.
    if (next === myBufferMinutes) return

    setBufferBusy(next)
    try {
      const res = await api.updateSelf(slug, {
        nickname,
        buffer_minutes: next,
      })
      const effective = res.buffer_minutes ?? BUFFER_DEFAULT_MINUTES
      toast(`버퍼가 ${effective}분으로 변경되었습니다.`, "success")
      onBufferChanged?.(res.buffer_minutes)
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "버퍼 변경에 실패했습니다."
      toast(msg, "error")
    } finally {
      setBufferBusy(null)
    }
  }

  return (
    <div
      data-testid="current-participant-card"
      className="rounded-2xl border border-border bg-background p-4"
    >
      <div className="flex items-center gap-3">
        <div
          aria-hidden="true"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--soma-primary-soft)] text-sm font-bold text-primary"
        >
          {nickname.slice(0, 1)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[14.5px] font-bold tracking-tight text-foreground">
              {nickname}
            </span>
            <span className="inline-flex h-[20px] items-center rounded-md border border-success/30 bg-[var(--soma-success-soft)] px-1.5 text-[11px] font-semibold text-success">
              응답 완료
            </span>
            {isRequired ? (
              <span
                title="필수 참여자로 표시됨"
                className="inline-flex h-[20px] items-center gap-1 rounded-md border border-primary/30 bg-[var(--soma-primary-soft)] px-1.5 text-[11px] font-semibold text-primary"
              >
                <Star className="h-2.5 w-2.5" />
                필수 참여자
              </span>
            ) : null}
          </div>
          <div className="mt-0.5 text-xs text-muted-foreground">본인 참여 정보</div>
        </div>
        <div className="flex shrink-0 gap-1.5">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => setEditOpen(true)}
            aria-label="닉네임/PIN 수정"
            data-testid="rename-toggle"
          >
            <Pencil className="h-3.5 w-3.5" />
            재설정
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onSwitchUser}
            aria-label="로그아웃"
            data-testid="switch-user"
          >
            <LogOut className="h-3.5 w-3.5" />
            로그아웃
          </Button>
        </div>
      </div>

      {showBuffer ? (
        <>
          <div className="my-3 h-px bg-border" aria-hidden="true" />
          <div className="flex items-baseline justify-between gap-2">
            <div>
              <div className="text-[13px] font-semibold text-foreground">
                회의 전후 버퍼
              </div>
              <div className="mt-0.5 text-[11.5px] text-muted-foreground">
                이동·정리 시간을 추천 알고리즘에 반영합니다.
              </div>
            </div>
            <div
              className="text-[13px] font-bold text-primary"
              data-testid="buffer-readout"
            >
              {effectiveBuffer === 0 ? "없음" : `${effectiveBuffer}분`}
            </div>
          </div>
          <div
            role="radiogroup"
            aria-label="회의 전후 버퍼"
            data-testid="buffer-chips"
            className="mt-3 grid grid-cols-5 gap-1.5"
          >
            {BUFFER_OPTIONS.map((opt) => {
              const active = effectiveBuffer === opt.value
              const busy = bufferBusy === opt.value
              return (
                <button
                  key={opt.value}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  aria-busy={busy}
                  disabled={bufferBusy !== null}
                  data-testid={`buffer-chip-${opt.value}`}
                  onClick={() => handleBufferPick(opt.value)}
                  className={cn(
                    "flex h-11 flex-col items-center justify-center rounded-lg text-sm font-bold leading-tight transition-colors disabled:cursor-not-allowed disabled:opacity-60",
                    active
                      ? "bg-primary text-primary-foreground shadow-[0_1px_2px_rgba(15,23,42,0.05),_0_8px_18px_rgba(79,90,170,0.22)]"
                      : "bg-card text-foreground hover:bg-[var(--soma-card-hover)]",
                  )}
                >
                  {busy ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <>
                      <span className="text-[15px]">{opt.value}</span>
                      <span
                        className={cn(
                          "text-[10px] font-semibold",
                          active ? "text-primary-foreground/80" : "text-muted-foreground",
                        )}
                      >
                        분
                      </span>
                    </>
                  )}
                </button>
              )
            })}
          </div>
        </>
      ) : null}

      <SelfEditModal
        open={editOpen}
        onOpenChange={setEditOpen}
        slug={slug}
        nickname={nickname}
        isRequired={isRequired}
        onSaved={onRenamed}
      />
    </div>
  )
}
