// v3.24 — ICS upload now PARSES the file (no save) and hands the resulting
// busy_blocks back to AvailabilitySection so they pre-fill the manual grid.
// The user reviews / edits there, then clicks `가용 시간 저장`. This avoids
// the "I uploaded the wrong file and now my entire schedule is wrong"
// problem and gives users a chance to correct ICS quirks before commit.
//
// Soma ICSTab pattern: dashed-border dropzone + file icon + headline +
// subtitle + soft button. Clicking the button opens the native file picker.

import { useRef, useState } from "react"
import { File as FileIcon, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useToast } from "@/components/ui/toast"
import { api } from "@/lib/api"
import { ApiError } from "@/lib/types"

interface Props {
  slug: string
  onParsed: (blocks: { start: string; end: string }[]) => void
}

export function IcsUploadForm({ slug, onParsed }: Props) {
  const { toast } = useToast()
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [suggestion, setSuggestion] = useState<string | null>(null)
  const [errorCode, setErrorCode] = useState<string | null>(null)

  async function handleFile(file: File) {
    setSubmitting(true)
    setError(null)
    setSuggestion(null)
    setErrorCode(null)
    try {
      const res = await api.parseIcs(slug, file)
      const count = res.busy_blocks.length
      toast(
        `ICS에서 ${count}개 일정을 읽었습니다. 직접 입력 탭에서 확인 후 저장하세요.`,
        "success",
      )
      onParsed(res.busy_blocks)
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message)
        setErrorCode(err.errorCode)
        setSuggestion(err.suggestion ?? null)
      } else {
        setError("업로드에 실패했습니다.")
      }
    } finally {
      setSubmitting(false)
    }
  }

  function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const input = e.target
    const file = input.files?.[0]
    if (file) void handleFile(file)
    // Reset so re-selecting the same file still fires.
    input.value = ""
  }

  function onDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault()
    if (submitting) return
    const file = e.dataTransfer.files?.[0]
    if (file) void handleFile(file)
  }

  return (
    <div className="flex flex-col gap-3">
      <div
        onDragOver={(e) => e.preventDefault()}
        onDrop={onDrop}
        className="flex flex-col items-center rounded-xl border-2 border-dashed border-[var(--soma-border-strong)] bg-card p-7 text-center"
      >
        <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-xl border border-border bg-background text-muted-foreground">
          <FileIcon className="h-5 w-5" aria-hidden="true" />
        </div>
        <div className="text-sm font-bold text-foreground">
          ICS 파일을 드래그하거나 선택
        </div>
        <p className="mt-1 max-w-sm text-xs leading-relaxed text-muted-foreground">
          캘린더에서 내보낸 .ics 파일에서 바쁜 시간을 자동으로 읽어옵니다.
          <br />
          일정 제목·참여자 정보는 저장하지 않습니다.
        </p>
        <input
          ref={inputRef}
          type="file"
          accept=".ics,text/calendar"
          disabled={submitting}
          onChange={onPick}
          data-testid="ics-file-input"
          className="hidden"
        />
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={submitting}
          onClick={() => inputRef.current?.click()}
          className="mt-3 bg-[var(--soma-primary-soft)] text-primary hover:bg-[var(--soma-primary-soft)]/80"
        >
          {submitting ? (
            <>
              <Loader2
                className="h-3.5 w-3.5 animate-spin"
                aria-hidden="true"
                data-testid="ics-analyzing"
              />
              분석 중...
            </>
          ) : (
            "파일 선택"
          )}
        </Button>
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
