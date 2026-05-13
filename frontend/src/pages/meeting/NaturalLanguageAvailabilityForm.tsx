// Natural-language availability input — Phase D 5-state shell.
//   1. NLEmpty   — textarea is blank
//   2. NLTyping  — user is typing (textarea has content, no result yet)
//   3. NLLoading — LLM call in flight (faked 3-stage progress, 1.4s/step)
//   4. NLPreview — got a parse result; user picks merge/overwrite
//   5. NLError   — request failed
//
// Decisions (lead-confirmed):
//   - Typing state has NO recognized-phrase chips (LLM hasn't run yet)
//   - Preview state shows BE recognized_phrases when present (optional)
//   - Loading progress is a UI-only fake (no real progress events from BE)
//   - ExampleChip click APPENDS to the textarea (separated by newline)
//
// Soma mockup source: /tmp/handoff/app-onboarding/project/soma-nl.jsx

import { useEffect, useMemo, useState } from "react"
import { AlertTriangle, Check, Loader2, Sparkles } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useToast } from "@/components/ui/toast"
import { api } from "@/lib/api"
import { ApiError, type MeetingDetail } from "@/lib/types"
import { AvailabilityGrid } from "@/components/AvailabilityGrid"
import { selectedFromBusyBlocks } from "@/lib/availabilityCells"
import { cn } from "@/lib/cn"
import type { PendingApplyMode } from "./ManualAvailabilityForm"

interface Props {
  slug: string
  meeting: MeetingDetail
  onApply: (
    blocks: { start: string; end: string }[],
    mode: PendingApplyMode,
  ) => void
}

const PLACEHOLDER =
  "예: 월요일 9시부터 12시까지는 회의가 있어서 안돼요. 수요일은 종일 비어있고, 목요일은 오후에만 가능합니다."

const TEXT_MAX = 500

const EXAMPLE_CHIPS = [
  "월 9시~12시 불가",
  "화 ~18시까지 가능",
  "수 종일 가능",
  "목 오후만",
  "매일 점심시간 빼고",
]

const LOADING_STAGES = [
  {
    label: "문장 해석 중",
    sub: "자연어를 구조화된 시간 조건으로 변환하고 있어요",
  },
  {
    label: "시간대 매핑 중",
    sub: "회의 기간과 30분 단위 슬롯에 맞추고 있어요",
  },
  {
    label: "미리보기 생성 중",
    sub: "기존 입력과 합치는 옵션을 준비하고 있어요",
  },
] as const

type Stage = "empty" | "typing" | "loading" | "preview" | "error"

interface PreviewState {
  busyBlocks: { start: string; end: string }[]
  summary: string
  recognizedPhrases: string[]
}

interface ErrorState {
  message: string
  errorCode: string | null
  suggestion: string | null
}

export function NaturalLanguageAvailabilityForm({ slug, meeting, onApply }: Props) {
  const { toast } = useToast()
  const [text, setText] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [preview, setPreview] = useState<PreviewState | null>(null)
  const [error, setError] = useState<ErrorState | null>(null)

  const stage: Stage = submitting
    ? "loading"
    : preview
      ? "preview"
      : error
        ? "error"
        : text.trim().length === 0
          ? "empty"
          : "typing"

  const previewSelected = useMemo(
    () =>
      preview ? selectedFromBusyBlocks(meeting, preview.busyBlocks) : new Set<string>(),
    [preview, meeting],
  )

  async function handlePreview() {
    const trimmed = text.trim()
    if (trimmed.length === 0) {
      setError({
        message: "자연어 일정을 입력하세요.",
        errorCode: null,
        suggestion: null,
      })
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      const res = await api.parseNaturalLanguage(slug, text)
      const phrases = res.recognized_phrases ?? []
      // LLM returned a 200 but couldn't extract anything actionable: no
      // busy_blocks and no recognized phrases means the model couldn't find
      // a time expression in the user's input. Surface this as an error
      // state instead of dropping the user into an empty preview grid.
      if (res.busy_blocks.length === 0 && phrases.length === 0) {
        setError({
          message: "문장에서 시간을 찾지 못했어요",
          errorCode: "no_time_recognized",
          suggestion:
            "요일이나 시간을 포함해서 다시 적어주세요. 예: \"월요일 오전은 불가, 화요일 오후 2시부터 가능\"",
        })
        return
      }
      setPreview({
        busyBlocks: res.busy_blocks,
        summary: res.summary,
        recognizedPhrases: phrases,
      })
    } catch (err) {
      if (err instanceof ApiError) {
        setError({
          message: err.message,
          errorCode: err.errorCode,
          suggestion: err.suggestion ?? null,
        })
      } else {
        setError({
          message: "자연어 분석에 실패했습니다.",
          errorCode: null,
          suggestion: null,
        })
      }
    } finally {
      setSubmitting(false)
    }
  }

  function appendExample(example: string) {
    setText((prev) => (prev.length === 0 ? example : `${prev}\n${example}`))
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

  function resetAll() {
    setText("")
    setError(null)
    setPreview(null)
  }

  function retry() {
    setError(null)
    void handlePreview()
  }

  return (
    <NLShell
      title="자연어로 입력하기"
      hint={
        stage === "preview"
          ? "해석 결과를 확인하고 적용 방식을 골라주세요"
          : "문장으로 적으면 자동으로 시간표에 반영됩니다"
      }
      action={<StateBadge stage={stage} />}
    >
      {stage === "empty" ? (
        <EmptyView
          text={text}
          onTextChange={setText}
          onExampleClick={appendExample}
          onPreview={handlePreview}
        />
      ) : null}

      {stage === "typing" ? (
        <TypingView
          text={text}
          onTextChange={setText}
          onExampleClick={appendExample}
          onPreview={handlePreview}
        />
      ) : null}

      {stage === "loading" ? <LoadingView text={text} /> : null}

      {stage === "preview" && preview ? (
        <PreviewView
          meeting={meeting}
          preview={preview}
          previewSelected={previewSelected}
          onMerge={() => applyAndReturn("merge")}
          onOverwrite={() => applyAndReturn("overwrite")}
          onCancel={cancelPreview}
        />
      ) : null}

      {stage === "error" && error ? (
        <ErrorView
          text={text}
          error={error}
          onTextChange={setText}
          onExampleClick={appendExample}
          onReset={resetAll}
          onRetry={retry}
        />
      ) : null}
    </NLShell>
  )
}

// ---------- shell ----------

interface NLShellProps {
  title: string
  hint: string
  action: React.ReactNode
  children: React.ReactNode
}

function NLShell({ title, hint, action, children }: NLShellProps) {
  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-background">
      <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div>
          <div className="text-[14px] font-bold tracking-tight text-foreground">{title}</div>
          <div className="mt-0.5 text-xs text-muted-foreground">{hint}</div>
        </div>
        {action}
      </div>
      <div className="p-4">{children}</div>
    </div>
  )
}

// ---------- state badge ----------

function StateBadge({ stage }: { stage: Stage }) {
  if (stage === "preview") {
    return (
      <span className="inline-flex items-center gap-1 rounded-md border border-success/30 bg-[var(--soma-success-soft)] px-2 py-0.5 text-[11px] font-semibold tracking-tight text-success">
        <Check className="h-3 w-3" /> 해석 완료
      </span>
    )
  }
  if (stage === "error") {
    return (
      <span className="inline-flex items-center gap-1 rounded-md border border-destructive/30 bg-[var(--soma-destructive-soft)] px-2 py-0.5 text-[11px] font-semibold tracking-tight text-destructive">
        <AlertTriangle className="h-3 w-3" /> 해석 실패
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-md border border-primary/30 bg-[var(--soma-primary-soft)] px-2 py-0.5 text-[11px] font-semibold tracking-tight text-primary">
      <Sparkles className="h-3 w-3" /> AI
    </span>
  )
}

// ---------- textarea ----------

interface NLTextareaProps {
  value: string
  onChange: (v: string) => void
  disabled?: boolean
  placeholder?: string
}

function NLTextarea({ value, onChange, disabled = false, placeholder }: NLTextareaProps) {
  return (
    <div
      className={cn(
        "overflow-hidden rounded-xl border border-border bg-background transition-colors focus-within:border-primary focus-within:shadow-[0_0_0_4px_var(--soma-primary-ring)]",
        disabled && "bg-card",
      )}
    >
      <textarea
        data-testid="nl-input"
        value={value}
        onChange={(e) => onChange(e.target.value.slice(0, TEXT_MAX))}
        disabled={disabled}
        placeholder={placeholder}
        rows={4}
        className="block min-h-[110px] w-full resize-none bg-transparent p-3.5 text-sm font-medium leading-relaxed text-foreground outline-none placeholder:text-muted-foreground/70 disabled:cursor-not-allowed"
      />
      <div className="flex items-center justify-between border-t border-border px-3 py-2 text-[11.5px] font-medium text-muted-foreground">
        <span>한국어 / English · 자유롭게 입력</span>
        <span>
          {value.length} / {TEXT_MAX}
        </span>
      </div>
    </div>
  )
}

// ---------- example chips ----------

interface ExampleChipsProps {
  onPick: (example: string) => void
  disabled?: boolean
}

function ExampleChips({ onPick, disabled = false }: ExampleChipsProps) {
  return (
    <div className="mt-3 flex flex-wrap gap-1.5">
      {EXAMPLE_CHIPS.map((chip) => (
        <button
          key={chip}
          type="button"
          disabled={disabled}
          onClick={() => onPick(chip)}
          data-testid={`nl-example-${chip}`}
          className="rounded-full border border-border bg-background px-2.5 py-1.5 text-[12.5px] font-medium text-[color:var(--soma-ink-soft)] transition-colors hover:bg-card disabled:cursor-not-allowed disabled:opacity-50"
        >
          {chip}
        </button>
      ))}
    </div>
  )
}

// ---------- empty ----------

interface EmptyViewProps {
  text: string
  onTextChange: (v: string) => void
  onExampleClick: (v: string) => void
  onPreview: () => void
}

function EmptyView({ text, onTextChange, onExampleClick, onPreview }: EmptyViewProps) {
  return (
    <div className="flex flex-col">
      <div className="flex flex-col items-center px-2 pb-2 pt-6 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--soma-primary-soft)] text-primary">
          <Sparkles className="h-6 w-6" />
        </div>
        <div className="mt-4 text-[17px] font-bold tracking-tight text-foreground">
          일정을 문장으로 적어주세요
        </div>
        <p className="mt-1.5 max-w-[340px] text-[13.5px] leading-relaxed text-muted-foreground">
          가능한 시간이나 불가능한 시간을 자유롭게 입력하면 AI가 해석해서 시간표에 자동으로
          채워드립니다.
        </p>
      </div>

      <div className="mt-6">
        <NLTextarea value={text} onChange={onTextChange} placeholder={PLACEHOLDER} />
      </div>

      <div className="mt-4">
        <div className="text-xs font-semibold text-muted-foreground">이런 문장을 인식해요</div>
        <ExampleChips onPick={onExampleClick} />
      </div>

      <div className="mt-5 flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-[color:var(--soma-faint)]">
          입력 후 미리보기를 누르면 결과를 볼 수 있어요
        </span>
        <Button
          type="button"
          data-testid="nl-preview"
          disabled
          onClick={onPreview}
        >
          <Sparkles className="h-3.5 w-3.5" />
          미리보기 생성
        </Button>
      </div>
    </div>
  )
}

// ---------- typing ----------

interface TypingViewProps {
  text: string
  onTextChange: (v: string) => void
  onExampleClick: (v: string) => void
  onPreview: () => void
}

function TypingView({ text, onTextChange, onExampleClick, onPreview }: TypingViewProps) {
  return (
    <div className="flex flex-col gap-4">
      <NLTextarea value={text} onChange={onTextChange} placeholder={PLACEHOLDER} />

      {/* Decided: no recognized-phrase chips here — the LLM hasn't run yet,
          so any chips would be guesses. Example chips stay visible to seed
          longer prompts. */}
      <div>
        <div className="text-xs font-medium text-muted-foreground">
          이렇게 적어보세요
        </div>
        <ExampleChips onPick={onExampleClick} />
      </div>

      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-muted-foreground">준비됐어요</span>
        <Button
          type="button"
          data-testid="nl-preview"
          onClick={onPreview}
        >
          <Sparkles className="h-3.5 w-3.5" />
          미리보기 생성
        </Button>
      </div>
    </div>
  )
}

// ---------- loading ----------

function LoadingView({ text }: { text: string }) {
  const [stageIdx, setStageIdx] = useState(0)
  useEffect(() => {
    const id = window.setInterval(() => {
      setStageIdx((s) => (s + 1) % LOADING_STAGES.length)
    }, 1400)
    return () => window.clearInterval(id)
  }, [])

  const current = LOADING_STAGES[stageIdx]

  return (
    <div className="flex flex-col gap-4">
      <NLTextarea value={text} onChange={() => {}} disabled />

      <div
        data-testid="nl-loading-progress"
        aria-live="polite"
        className="rounded-xl border border-[var(--soma-primary-ring)] bg-[var(--soma-primary-soft)] p-4"
      >
        <div className="flex items-center gap-3">
          <Loader2 className="h-4 w-4 animate-spin text-primary" />
          <div className="min-w-0 flex-1">
            <div className="text-[13.5px] font-bold tracking-tight text-primary">
              {current.label}…
            </div>
            <div className="mt-0.5 text-[12px] text-[color:var(--soma-ink-soft)]">
              {current.sub}
            </div>
          </div>
          <div className="text-[11.5px] font-semibold text-muted-foreground">약 5초</div>
        </div>
        <div className="mt-3 flex gap-1" aria-hidden="true">
          {LOADING_STAGES.map((_, i) => (
            <div
              key={i}
              className={cn(
                "h-[3px] flex-1 rounded-sm transition-colors",
                i <= stageIdx ? "bg-primary" : "bg-primary/20",
              )}
            />
          ))}
        </div>
      </div>

      <span
        className="text-xs font-medium text-muted-foreground"
        data-testid="nl-analyzing"
      >
        LLM 응답까지 5-10초 소요될 수 있습니다.
      </span>
    </div>
  )
}

// ---------- preview ----------

interface PreviewViewProps {
  meeting: MeetingDetail
  preview: PreviewState
  previewSelected: Set<string>
  onMerge: () => void
  onOverwrite: () => void
  onCancel: () => void
}

function PreviewView({
  meeting,
  preview,
  previewSelected,
  onMerge,
  onOverwrite,
  onCancel,
}: PreviewViewProps) {
  const hasPhrases = preview.recognizedPhrases.length > 0
  return (
    <div className="flex flex-col gap-4">
      <div
        data-testid="nl-preview-summary"
        className="rounded-xl border border-success/30 bg-[var(--soma-success-soft)] p-3.5"
      >
        <div className="text-[13.5px] font-bold tracking-tight text-success">
          {hasPhrases
            ? `${preview.recognizedPhrases.length}개 조건을 시간표에 반영했어요`
            : "해석이 완료되었어요"}
        </div>
        {hasPhrases ? (
          <div
            className="mt-2 flex flex-wrap gap-1.5"
            data-testid="nl-recognized-phrases"
          >
            {preview.recognizedPhrases.map((phrase) => (
              <RecognizedChip key={phrase}>{phrase}</RecognizedChip>
            ))}
          </div>
        ) : null}
        {preview.summary ? (
          <div className="mt-2 whitespace-pre-wrap text-xs text-[color:var(--soma-ink-soft)]">
            {preview.summary}
          </div>
        ) : null}
      </div>

      <div
        aria-label="자연어 파싱 결과 미리보기"
        data-testid="nl-preview-grid"
        className="opacity-90"
        aria-readonly="true"
      >
        <AvailabilityGrid
          meeting={meeting}
          value={previewSelected}
          onChange={() => {}}
          bufferMinutes={0}
        />
      </div>

      <div className="flex items-start gap-2 rounded-lg bg-[var(--soma-warn-soft)] p-3">
        <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0 text-[color:var(--soma-warn)]" />
        <p className="text-[12.5px] font-medium leading-snug text-[color:var(--soma-warn)]">
          이미 입력한 시간이 있다면 <b>합치기</b>로 새 조건만 추가하거나 <b>덮어쓰기</b>로 기존
          입력을 대체할 수 있어요.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button type="button" data-testid="nl-apply-merge" onClick={onMerge}>
          기존 선택과 합치기
        </Button>
        <Button
          type="button"
          variant="secondary"
          data-testid="nl-apply-overwrite"
          onClick={onOverwrite}
        >
          덮어쓰기
        </Button>
        <Button type="button" variant="ghost" data-testid="nl-cancel" onClick={onCancel}>
          취소
        </Button>
      </div>
    </div>
  )
}

function RecognizedChip({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-2 py-1 text-xs font-semibold tracking-tight text-foreground">
      <Check className="h-2.5 w-2.5 text-success" aria-hidden="true" />
      {children}
    </span>
  )
}

// ---------- error ----------

interface ErrorViewProps {
  text: string
  error: ErrorState
  onTextChange: (v: string) => void
  onExampleClick: (v: string) => void
  onReset: () => void
  onRetry: () => void
}

function ErrorView({
  text,
  error,
  onTextChange,
  onExampleClick,
  onReset,
  onRetry,
}: ErrorViewProps) {
  return (
    <div className="flex flex-col gap-4">
      <NLTextarea value={text} onChange={onTextChange} placeholder={PLACEHOLDER} />

      <div
        data-testid="nl-error-box"
        className="rounded-xl border border-destructive/30 bg-[var(--soma-destructive-soft)] p-4"
      >
        <div className="flex items-center gap-2.5">
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-destructive/15 text-destructive">
            <AlertTriangle className="h-3.5 w-3.5" />
          </div>
          <div className="text-[13.5px] font-bold tracking-tight text-destructive">
            {error.message}
          </div>
        </div>
        <div className="mt-1.5 pl-[38px] text-[12.5px] leading-snug text-destructive/85">
          요일이나 시간을 포함해서 다시 적어주세요.{" "}
          <em>예: "월요일 오전은 불가, 화요일 오후 2시부터 가능"</em>
        </div>
        {error.errorCode ? (
          <div className="mt-1.5 pl-[38px] text-[11px] text-destructive/75">
            코드: {error.errorCode}
          </div>
        ) : null}
        {error.suggestion ? (
          <div className="mt-1 pl-[38px] text-[11px] text-destructive/75">
            {error.suggestion}
          </div>
        ) : null}
      </div>

      <div>
        <div className="text-xs font-semibold text-muted-foreground">이렇게 적어보세요</div>
        <ExampleChips onPick={onExampleClick} />
      </div>

      <div className="flex items-center justify-between gap-2">
        <Button
          type="button"
          variant="ghost"
          data-testid="nl-reset"
          onClick={onReset}
        >
          처음부터 다시
        </Button>
        <Button
          type="button"
          data-testid="nl-retry"
          onClick={onRetry}
          disabled={text.trim().length === 0}
        >
          <Sparkles className="h-3.5 w-3.5" />
          다시 시도
        </Button>
      </div>
    </div>
  )
}
