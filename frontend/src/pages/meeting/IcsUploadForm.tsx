import { useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { useToast } from "@/components/ui/toast"
import { api } from "@/lib/api"
import { ApiError } from "@/lib/types"

interface Props {
  slug: string
  onSubmitted: () => void
}

export function IcsUploadForm({ slug, onSubmitted }: Props) {
  const { toast } = useToast()
  const inputRef = useRef<HTMLInputElement>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [suggestion, setSuggestion] = useState<string | null>(null)
  const [errorCode, setErrorCode] = useState<string | null>(null)
  const [uploadedCount, setUploadedCount] = useState<number | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const file = inputRef.current?.files?.[0]
    if (!file) {
      setError("ICS 파일을 선택하세요.")
      return
    }
    setSubmitting(true)
    setError(null)
    setSuggestion(null)
    setErrorCode(null)
    setUploadedCount(null)
    try {
      const res = await api.submitIcs(slug, file)
      setUploadedCount(res.busy_block_count)
      toast(`ICS에서 ${res.busy_block_count}개 일정을 불러왔습니다.`, "success")
      if (inputRef.current) inputRef.current.value = ""
      onSubmitted()
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

  return (
    <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
      <p className="text-sm text-slate-600">
        Google Calendar 또는 Outlook에서 내보낸 .ics 파일을 업로드하세요. 일정 제목/설명/위치는
        서버에 저장하지 않습니다.
      </p>
      <input
        ref={inputRef}
        type="file"
        accept=".ics,text/calendar"
        className="block w-full text-sm text-slate-700 file:mr-3 file:rounded-md file:border-0 file:bg-accent file:px-4 file:py-2 file:text-sm file:font-medium file:text-accent-foreground hover:file:bg-blue-700"
      />
      <div>
        <Button type="submit" disabled={submitting}>
          {submitting ? "업로드 중..." : "ICS 업로드"}
        </Button>
      </div>

      {uploadedCount !== null ? (
        <p className="text-sm text-emerald-700">
          {uploadedCount}개의 일정이 가용 정보에 반영되었습니다.
        </p>
      ) : null}

      {error ? (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          <div className="font-medium">{error}</div>
          {errorCode ? <div className="mt-1 text-xs">코드: {errorCode}</div> : null}
          {suggestion ? <div className="mt-1 text-xs">{suggestion}</div> : null}
        </div>
      ) : null}
    </form>
  )
}
