// v3.24 — ICS upload now PARSES the file (no save) and hands the resulting
// busy_blocks back to AvailabilitySection so they pre-fill the manual grid.
// The user reviews / edits there, then clicks `가용 시간 저장`. This avoids
// the "I uploaded the wrong file and now my entire schedule is wrong"
// problem and gives users a chance to correct ICS quirks before commit.
//
// #27 — file input의 onChange 즉시 파싱·반영. 별도 [ICS 불러오기] 버튼 없음.

import { useState } from "react"
import { useToast } from "@/components/ui/toast"
import { api } from "@/lib/api"
import { ApiError } from "@/lib/types"

interface Props {
  slug: string
  onParsed: (blocks: { start: string; end: string }[]) => void
}

export function IcsUploadForm({ slug, onParsed }: Props) {
  const { toast } = useToast()
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [suggestion, setSuggestion] = useState<string | null>(null)
  const [errorCode, setErrorCode] = useState<string | null>(null)

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const input = e.target
    const file = input.files?.[0]
    if (!file) return

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
      // Reset value so re-selecting the same file fires onChange again.
      input.value = ""
      setSubmitting(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        Google Calendar 또는 Outlook에서 내보낸 .ics 파일을 업로드하세요. 파일을 선택하면 슬롯
        그리드에 자동으로 반영되며, 잘못 들어간 일정은 수정 후 직접 저장할 수 있습니다. 일정
        제목/설명/위치는 서버에 저장하지 않습니다.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <input
          type="file"
          accept=".ics,text/calendar"
          disabled={submitting}
          onChange={handleFileChange}
          data-testid="ics-file-input"
          className="block w-full text-sm text-foreground file:mr-3 file:rounded-md file:border-0 file:bg-primary file:px-4 file:py-2 file:text-sm file:font-medium file:text-primary-foreground hover:file:bg-primary/85 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto sm:flex-1"
        />
        {submitting ? (
          <span
            className="text-sm text-muted-foreground"
            data-testid="ics-analyzing"
            aria-live="polite"
          >
            분석 중...
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
