import { useEffect, useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import { useToast } from "@/components/ui/toast"
import { api } from "@/lib/api"
import { ApiError, type MeetingDetail } from "@/lib/types"
import { AvailabilityGrid } from "@/components/AvailabilityGrid"
import { AvailabilityTimeline } from "@/components/AvailabilityTimeline"
import { enumerateAllCells, mergeBusyBlocks } from "@/lib/availabilityCells"
import { cn } from "@/lib/cn"

interface Props {
  slug: string
  meeting: MeetingDetail
  onSubmitted: () => void
}

type InputMode = "timeline" | "grid"

const MODE_STORAGE_KEY = "somameet_manual_mode"
const DEFAULT_MODE: InputMode = "timeline"

function readInitialMode(): InputMode {
  if (typeof window === "undefined") return DEFAULT_MODE
  try {
    const stored = window.localStorage.getItem(MODE_STORAGE_KEY)
    if (stored === "timeline" || stored === "grid") return stored
  } catch {
    // Storage access can throw in private mode; fall through to default.
  }
  return DEFAULT_MODE
}

export function ManualAvailabilityForm({ slug, meeting, onSubmitted }: Props) {
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

  function selectAll() {
    setSelected(new Set(allCells))
  }

  function clearAll() {
    setSelected(new Set())
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    if (selected.size === 0) {
      const msg = "가능한 시간을 1개 이상 선택해주세요."
      setError(msg)
      toast(msg, "error")
      return
    }

    const busyKeys = allCells.filter((k) => !selected.has(k))
    const busy_blocks = mergeBusyBlocks(busyKeys)

    setSubmitting(true)
    try {
      await api.submitManual(slug, { busy_blocks })
      toast("가용 시간이 저장되었습니다.", "success")
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
        <p className="text-sm text-slate-600">
          가능한 시간을 선택하세요. 선택하지 않은 시간은 모두 불가능으로 처리됩니다.
        </p>
        <div
          role="group"
          aria-label="입력 방식"
          className="inline-flex w-fit gap-1 rounded-lg bg-slate-100 p-1"
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

      {mode === "timeline" ? (
        <AvailabilityTimeline meeting={meeting} value={selected} onChange={setSelected} />
      ) : (
        <AvailabilityGrid meeting={meeting} value={selected} onChange={setSelected} />
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600">
        <span>
          <span className="font-semibold text-slate-800">{selected.size}</span>개 슬롯 선택됨
          <span className="text-slate-400"> / 전체 {totalCells}개</span>
        </span>
        <div className="flex gap-3">
          <button
            type="button"
            className="text-accent underline-offset-2 hover:underline"
            onClick={selectAll}
          >
            전체 가능
          </button>
          <button
            type="button"
            className="text-slate-500 underline-offset-2 hover:underline"
            onClick={clearAll}
          >
            전체 초기화
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" data-testid="manual-submit" disabled={submitting}>
          {submitting ? "저장 중..." : "가용 시간 저장"}
        </Button>
      </div>

      {error ? <p className="text-sm text-red-600">{error}</p> : null}
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
        "rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
        active
          ? "bg-slate-900 text-white shadow-sm"
          : "border border-slate-300 bg-white text-slate-600 hover:bg-slate-50",
      )}
    >
      {children}
    </button>
  )
}
