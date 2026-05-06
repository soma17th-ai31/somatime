// Recommend button — Spec §5.1 / §6 (Q9). LLM call lives only here.
// v3.8: 5-minute client-side cooldown per slug. After a successful recommend,
// the button is disabled until the cooldown expires (countdown shown in label).
// Persisted in localStorage so a refresh does not reset the cooldown.

import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Sparkles } from "lucide-react"
import { useToast } from "@/components/ui/toast"
import { api } from "@/lib/api"
import { ApiError, type RecommendResponse } from "@/lib/types"

interface RecommendButtonProps {
  slug: string
  disabled: boolean
  loading: boolean
  setLoading: (v: boolean) => void
  onResult: (res: RecommendResponse) => void
}

const COOLDOWN_MS = 5 * 60 * 1000
const STORAGE_KEY = (slug: string) => `somameet_recommend_last_${slug}`

function readLastAt(slug: string): number | null {
  if (typeof window === "undefined") return null
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY(slug))
    if (!raw) return null
    const n = Number(raw)
    return Number.isFinite(n) ? n : null
  } catch {
    return null
  }
}

function writeLastAt(slug: string, ts: number): void {
  if (typeof window === "undefined") return
  try {
    window.localStorage.setItem(STORAGE_KEY(slug), String(ts))
  } catch {
    /* ignore quota / private mode */
  }
}

function formatRemaining(ms: number): string {
  const totalSec = Math.ceil(ms / 1000)
  const m = Math.floor(totalSec / 60)
  const s = totalSec % 60
  return `${m}:${String(s).padStart(2, "0")}`
}

export function RecommendButton({
  slug,
  disabled,
  loading,
  setLoading,
  onResult,
}: RecommendButtonProps) {
  const { toast } = useToast()
  const [now, setNow] = useState(() => Date.now())
  const [lastAt, setLastAt] = useState<number | null>(() => readLastAt(slug))

  // Tick once a second only while a cooldown is active.
  useEffect(() => {
    if (!lastAt) return
    const remaining = COOLDOWN_MS - (Date.now() - lastAt)
    if (remaining <= 0) return
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [lastAt])

  // Reload from storage whenever the slug changes (defensive).
  useEffect(() => {
    setLastAt(readLastAt(slug))
  }, [slug])

  const remaining = lastAt ? Math.max(0, COOLDOWN_MS - (now - lastAt)) : 0
  const onCooldown = remaining > 0

  async function handleClick() {
    if (onCooldown) {
      toast(`5분 쿨타임 중입니다. ${formatRemaining(remaining)} 후 다시 시도하세요.`, "default")
      return
    }
    setLoading(true)
    try {
      const res = await api.recommend(slug)
      onResult(res)
      // Mark cooldown only on real success (deterministic_fallback도 LLM 호출은 일어났으니 동일 적용).
      const ts = Date.now()
      writeLastAt(slug, ts)
      setLastAt(ts)
      setNow(ts)
      if (res.source === "deterministic_fallback") {
        toast("추천 모델 응답을 검증하지 못해 기본 후보를 보여드렸어요.", "default")
      }
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "추천에 실패했습니다."
      toast(msg, "error")
    } finally {
      setLoading(false)
    }
  }

  const label = loading
    ? "추천 중..."
    : onCooldown
      ? `재추천 ${formatRemaining(remaining)}`
      : "추천받기"

  return (
    <Button
      type="button"
      variant="default"
      onClick={handleClick}
      disabled={disabled || loading || onCooldown}
      data-testid="recommend-button"
      title={
        onCooldown
          ? `5분 쿨타임 중 (${formatRemaining(remaining)} 남음)`
          : "AI가 후보 시간 + 안내 메시지를 추천합니다"
      }
    >
      <Sparkles className="h-4 w-4" />
      {label}
    </Button>
  )
}
