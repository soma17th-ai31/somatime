import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useToast } from "@/components/ui/toast"
import { api } from "@/lib/api"
import { ApiError } from "@/lib/types"

interface Props {
  slug: string
  onJoined: (nickname: string) => void
}

export function JoinSection({ slug, onJoined }: Props) {
  const { toast } = useToast()
  const [nickname, setNickname] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = nickname.trim()
    if (trimmed.length === 0) {
      setError("닉네임을 입력하세요.")
      return
    }
    if (trimmed.length > 50) {
      setError("닉네임은 50자 이내여야 합니다.")
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      const res = await api.joinParticipant(slug, trimmed)
      toast(`${res.nickname}님으로 등록되었습니다.`, "success")
      onJoined(res.nickname)
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "등록에 실패했습니다."
      setError(msg)
      toast(msg, "error")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>참여자 등록</CardTitle>
        <CardDescription>닉네임을 입력하면 가용 시간 입력을 시작할 수 있습니다.</CardDescription>
      </CardHeader>
      <CardContent>
        <form className="flex flex-col gap-3 sm:flex-row sm:items-end" onSubmit={handleSubmit}>
          <div className="flex flex-1 flex-col gap-2">
            <Label htmlFor="nickname">닉네임</Label>
            <Input
              id="nickname"
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              placeholder="팀에서 알아볼 수 있는 이름"
              maxLength={50}
              autoComplete="off"
            />
          </div>
          <Button type="submit" disabled={submitting}>
            {submitting ? "등록 중..." : "등록"}
          </Button>
        </form>
        {error ? <p className="mt-3 text-sm text-red-600">{error}</p> : null}
      </CardContent>
    </Card>
  )
}
