import { useEffect, useMemo, useRef, useState } from "react"
import { RotateCcw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useToast } from "@/components/ui/toast"
import { api } from "@/lib/api"
import { ApiError, type MeetingDetail } from "@/lib/types"
import { AvailabilityGrid } from "@/components/AvailabilityGrid"
import { AvailabilityTimeline } from "@/components/AvailabilityTimeline"
import {
  enumerateAllCells,
  mergeBusyBlocks,
  selectedFromBusyBlocks,
} from "@/lib/availabilityCells"
import { cn } from "@/lib/cn"

interface Props {
  slug: string
  meeting: MeetingDetail
  onSubmitted: () => void
  // v3.24 — ICS upload pre-fill pipeline. AvailabilitySection passes parsed
  // busy_blocks here when the user uploads an ICS file; the form converts
  // them to selected cells and clears the pending state via onPendingIcsApplied.
  pendingIcsBlocks?: { start: string; end: string }[] | null
  onPendingIcsApplied?: () => void
}

type InputMode = "timeline" | "grid"

const MODE_STORAGE_KEY = "somameet_manual_mode"
const DEFAULT_MODE: InputMode = "timeline"

// #30 — 사용자 선택값 우선, 없으면 pointer-coarse(모바일/터치) 면 grid, 그 외 timeline.
function readInitialMode(): InputMode {
  if (typeof window === "undefined") return DEFAULT_MODE
  try {
    const stored = window.localStorage.getItem(MODE_STORAGE_KEY)
    if (stored === "timeline" || stored === "grid") return stored
  } catch {
    // Storage access can throw in private mode; fall through to default.
  }
  try {
    if (window.matchMedia?.("(pointer: coarse)").matches) return "grid"
  } catch {
    // matchMedia 미지원 환경 fallback.
  }
  return DEFAULT_MODE
}

export function ManualAvailabilityForm({
  slug,
  meeting,
  onSubmitted,
  pendingIcsBlocks,
  onPendingIcsApplied,
}: Props) {
  const { toast } = useToast()
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [mode, setMode] = useState<InputMode>(() => readInitialMode())

  const allCells = useMemo(() => enumerateAllCells(meeting), [meeting])
  const totalCells = allCells.length

  useEffect(() => {
    if (typeof window === "undefined") return
    try {
      window.localStorage.setItem(MODE_STORAGE_KEY, mode)
    } catch {
      // Ignore storage write failures (private mode, quota, etc.).
    }
  }, [mode])

  // v3.6 / v3.10 — pre-fill from server when meeting.my_busy_blocks changes.
  //   Reflects the current participant's last server-side submission so refresh
  //   / re-entry restores prior selection. Stabilized against MeetingPage's
  //   polling: we only re-apply when the actual blocks payload changes (deep
  //   compare via JSON), so a 5-second poll that returns identical my_busy_blocks
  //   does NOT clobber the user's mid-edit selection.
  const myBlocksKey = useMemo(
    () => JSON.stringify(meeting.my_busy_blocks ?? null),
    [meeting.my_busy_blocks],
  )
  const lastAppliedKeyRef = useRef<string>("")
  useEffect(() => {
    if (meeting.my_busy_blocks === undefined || meeting.my_busy_blocks === null) return
    if (myBlocksKey === lastAppliedKeyRef.current) return
    setSelected(selectedFromBusyBlocks(meeting, meeting.my_busy_blocks))
    lastAppliedKeyRef.current = myBlocksKey
  }, [myBlocksKey, meeting])

  // v3.24 — when ICS upload hands us parsed busy_blocks, immediately convert
  // them to a selected Set (= available = allCells - busyCells) so the user
  // can review on the grid. Then clear the pending so a single tab-switch
  // doesn't re-apply repeatedly.
  useEffect(() => {
    if (!pendingIcsBlocks) return
    setSelected(selectedFromBusyBlocks(meeting, pendingIcsBlocks))
    onPendingIcsApplied?.()
  }, [pendingIcsBlocks, meeting, onPendingIcsApplied])

  function selectAll() {
    setSelected(new Set(allCells))
  }

  function clearAll() {
    setSelected(new Set())
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    // selected.size === 0 도 유효한 제출: "이 회의 기간엔 가능한 시간이 없다"
    // 라는 의미를 명시적으로 저장. 초기화 직후 저장도 동일 경로.
    const busyKeys = allCells.filter((k) => !selected.has(k))
    const busy_blocks = mergeBusyBlocks(busyKeys)

    setSubmitting(true)
    try {
      await api.submitManual(slug, { busy_blocks })
      toast(
        selected.size === 0
          ? "전부 불가능으로 저장되었습니다."
          : "가용 시간이 저장되었습니다.",
        "success",
      )
      onSubmitted()
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "제출에 실패했습니다."
      setError(msg)
      toast(msg, "error")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form
      data-testid="manual-form"
      className="flex flex-col gap-4"
      onSubmit={handleSubmit}
    >
      <div className="flex flex-col gap-2">
        <p className="text-sm text-muted-foreground">
          가능한 시간을 선택하세요. 선택하지 않은 시간은 모두 불가능으로 처리됩니다.
        </p>
        <div
          role="group"
          aria-label="입력 방식"
          className="inline-flex w-fit gap-1 rounded-md border border-border bg-card p-1"
        >
          <ModeButton
            active={mode === "timeline"}
            onClick={() => setMode("timeline")}
            testId="mode-toggle-timeline"
          >
            타임라인
          </ModeButton>
          <ModeButton
            active={mode === "grid"}
            onClick={() => setMode("grid")}
            testId="mode-toggle-grid"
          >
            슬롯 그리드
          </ModeButton>
        </div>
      </div>

      {(() => {
        const bufferMinutes =
          meeting.location_type === "online"
            ? 0
            : meeting.my_buffer_minutes ?? 60
        return mode === "timeline" ? (
          <AvailabilityTimeline
            meeting={meeting}
            value={selected}
            onChange={setSelected}
            bufferMinutes={bufferMinutes}
          />
        ) : (
          <AvailabilityGrid
            meeting={meeting}
            value={selected}
            onChange={setSelected}
            bufferMinutes={bufferMinutes}
          />
        )
      })()}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="text-xs text-muted-foreground">
          <span className="font-semibold text-foreground">{selected.size}</span>개 슬롯 선택됨
          <span className="text-muted-foreground/60"> / 전체 {totalCells}개</span>
        </span>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={selectAll}
            data-testid="select-all"
          >
            전체 가능
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={clearAll}
            disabled={selected.size === 0}
            data-testid="clear-all"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            초기화
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" data-testid="manual-submit" disabled={submitting}>
          {submitting ? "저장 중..." : "가용 시간 저장"}
        </Button>
      </div>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </form>
  )
}

interface ModeButtonProps {
  active: boolean
  onClick: () => void
  testId: string
  children: React.ReactNode
}

function ModeButton({ active, onClick, testId, children }: ModeButtonProps) {
  return (
    <button
      type="button"
      data-testid={testId}
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "rounded-sm px-3 py-1.5 text-xs font-medium transition-colors",
        active
          ? "bg-secondary text-foreground shadow-sm"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  )
}
