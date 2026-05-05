import { useState } from "react"
import { Button } from "@/components/ui/button"
import { useToast } from "@/components/ui/toast"

interface CopyableUrlProps {
  label: string
  url: string
  warning?: string
}

export function CopyableUrl({ label, url, warning }: CopyableUrlProps) {
  const { toast } = useToast()
  const [copied, setCopied] = useState(false)

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      toast("링크가 복사되었습니다.", "success")
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      toast("복사에 실패했습니다. 직접 선택해 주세요.", "error")
    }
  }

  return (
    <div className="rounded-md border border-surface-border bg-white p-4">
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</div>
      {warning ? <div className="mt-1 text-xs text-red-600">{warning}</div> : null}
      <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
        <code
          className="flex-1 truncate rounded bg-surface-muted px-3 py-2 text-sm text-slate-800"
          title={url}
        >
          {url}
        </code>
        <Button variant="outline" size="sm" onClick={handleCopy} aria-label={`${label} 복사`}>
          {copied ? "복사됨" : "복사"}
        </Button>
      </div>
    </div>
  )
}
