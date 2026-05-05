import { useState } from "react"
import { Button } from "@/components/ui/button"
import { useToast } from "@/components/ui/toast"
import { api } from "@/lib/api"
import { ApiError } from "@/lib/types"

interface Props {
  slug: string
}

export function GoogleConnectButton({ slug }: Props) {
  const { toast } = useToast()
  const [busy, setBusy] = useState(false)
  const [warning, setWarning] = useState<string | null>(null)

  async function handleClick() {
    setBusy(true)
    setWarning(null)
    try {
      const res = await api.getGoogleOauthUrl(slug)
      window.location.href = res.oauth_url
    } catch (err) {
      if (err instanceof ApiError && err.status === 503) {
        const msg = "Google 연동 비활성화: 직접 입력 또는 ICS를 사용하세요."
        setWarning(msg)
        toast(msg, "error")
      } else {
        const msg = err instanceof ApiError ? err.message : "Google 연동에 실패했습니다."
        setWarning(msg)
        toast(msg, "error")
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-slate-600">
        Google 계정의 free/busy 정보만 읽어 옵니다. 일정 제목/설명/위치는 가져오지 않습니다.
      </p>
      <div>
        <Button onClick={handleClick} disabled={busy}>
          {busy ? "연결 중..." : "Google Calendar 연동"}
        </Button>
      </div>
      {warning ? (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          {warning}
        </div>
      ) : null}
      <p className="text-xs text-slate-500">
        주소창에 ?google=connected 가 붙어 돌아오면 연동이 성공한 상태입니다.
      </p>
    </div>
  )
}
