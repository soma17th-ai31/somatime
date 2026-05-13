// Natural-language availability input. Mirrors the ICS pre-fill pipeline:
// user types schedule constraints in free-form text, hits "미리보기" to call
// the LLM-backed parser, reviews the parsed busy_blocks on a read-only grid,
// and then chooses 합치기 / 덮어쓰기 to push the result into the manual form.

import { useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import { useToast } from "@/components/ui/toast"
import { api } from "@/lib/api"
import { ApiError, type MeetingDetail } from "@/lib/types"
import { AvailabilityGrid } from "@/components/AvailabilityGrid"
import { selectedFromBusyBlocks } from "@/lib/availabilityCells"
import type { PendingApplyMode } from "./ManualAvailabilityForm"

interface Props {
  slug: string
  meeting: MeetingDetail
  onApply: (
    blocks: { start: string; end: string }[],
    mode: PendingApplyMode,
  ) => void
}

const PLACEHOLDER = `예시 (자유 형식):
월: 09:00 - 12:00, 16:30 - 18:00
화: 09:00 - 12:00
수: 09:00 - 12:00, 15:00 - 19:00
목: 09:00 - 12:00, 16:30 - 18:00
금: 09:00 - 14:00
토, 일: 없음`

interface PreviewState {
  busyBlocks: { start: string; end: string }[]
  summary: string
}

export function NaturalLanguageAvailabilityForm({ slug, meeting, onApply }: Props) {
  const { toast } = useToast()
  const [text, setText] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [errorCode, setErrorCode] = useState<string | null>(null)
  const [suggestion, setSuggestion] = useState<string | null>(null)
  const [preview, setPreview] = useState<PreviewState | null>(null)

  const previewSelected = useMemo(
    () => (preview ? selectedFromBusyBlocks(meeting, preview.busyBlocks) : new Set<string>()),
    [preview, meeting],
  )

  async function handlePreview() {
    if (!text.trim()) {
      setError("자연어 일정을 입력하세요.")
      return
    }
    setSubmitting(true)
    setError(null)
    setErrorCode(null)
    setSuggestion(null)
    try {
      const res = await api.parseNaturalLanguage(slug, text)
      setPreview({ busyBlocks: res.busy_blocks, summary: res.summary })
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message)
        setErrorCode(err.errorCode)
        setSuggestion(err.suggestion ?? null)
      } else {
        setError("자연어 분석에 실패했습니다.")
      }
    } finally {
      setSubmitting(false)
    }
  }

  function applyAndReturn(mode: PendingApplyMode) {
    if (!preview) return
    onApply(preview.busyBlocks, mode)
    toast(
      mode === "merge"
        ? "자연어 결과를 기존 선택과 합쳤습니다. 직접 입력 탭에서 확인하세요."
        : "자연어 결과로 덮어썼습니다. 직접 입력 탭에서 확인하세요.",
      "success",
    )
    setPreview(null)
    setText("")
  }

  function cancelPreview() {
    setPreview(null)
  }

  if (preview) {
    return (
      <div className="flex flex-col gap-4">
        <div className="rounded-md border border-border bg-card p-3 text-sm">
          <div className="font-medium text-foreground">분석 결과 요약</div>
          <div className="mt-1 whitespace-pre-wrap text-muted-foreground">{preview.summary}</div>
        </div>
        <p className="text-sm text-muted-foreground">
          아래 미리보기는 읽기 전용입니다. 결과가 맞으면 합치기 또는 덮어쓰기를 선택하세요. 적용
          후 직접 입력 탭에서 추가 편집할 수 있습니다.
        </p>
        <div
          aria-label="자연어 파싱 결과 미리보기"
          data-testid="nl-preview-grid"
          className="pointer-events-none opacity-90 [&_*]:cursor-default"
          aria-readonly="true"
        >
          <AvailabilityGrid
            meeting={meeting}
            value={previewSelected}
            onChange={() => {}}
            bufferMinutes={0}
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            data-testid="nl-apply-merge"
            onClick={() => applyAndReturn("merge")}
          >
            기존 선택과 합치기
          </Button>
          <Button
            type="button"
            variant="secondary"
            data-testid="nl-apply-overwrite"
            onClick={() => applyAndReturn("overwrite")}
          >
            덮어쓰기
          </Button>
          <Button
            type="button"
            variant="outline"
            data-testid="nl-cancel"
            onClick={cancelPreview}
          >
            취소
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        가용/불가 시간을 자연어로 입력하세요. 요일·시간대를 자유 형식으로 적으면 LLM이 슬롯으로
        변환합니다. 미리보기에서 결과를 확인한 뒤 기존 선택에 합치거나 덮어쓸 수 있습니다.
      </p>
      <textarea
        data-testid="nl-input"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={PLACEHOLDER}
        disabled={submitting}
        rows={8}
        className="min-h-[10rem] w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-60"
      />
      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          data-testid="nl-preview"
          disabled={submitting || text.trim().length === 0}
          onClick={handlePreview}
        >
          {submitting ? "분석 중... (LLM 사용)" : "미리보기"}
        </Button>
        {submitting ? (
          <span
            className="text-xs text-muted-foreground"
            data-testid="nl-analyzing"
            aria-live="polite"
          >
            LLM 응답까지 5-10초 소요될 수 있습니다.
          </span>
        ) : null}
      </div>

      {error ? (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          <div className="font-medium">{error}</div>
          {errorCode ? <div className="mt-1 text-xs">코드: {errorCode}</div> : null}
          {suggestion ? <div className="mt-1 text-xs">{suggestion}</div> : null}
        </div>
      ) : null}
    </div>
  )
}
