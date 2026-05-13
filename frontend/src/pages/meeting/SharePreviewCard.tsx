// Placeholder share-preview card shown on CreateMeetingPage *before* the
// meeting is created. Mirrors soma-create.jsx's SharePreview block:
//   - fake QR (deterministic SVG pixel pattern, seeded from the dummy URL)
//   - dummy share URL in a monospace pill
//   - disabled "링크 복사" / "QR 저장" buttons
//   - "회의 생성 후 실제 링크..." caption
// After the meeting is created the real link + QR are shown on /m/{slug}.

import { Copy, Link as LinkIcon, Share2 } from "lucide-react"
import { Button } from "@/components/ui/button"

const DUMMY_URL = "soma.meet/m/preview"

function FakeQR({ size = 108, seed = DUMMY_URL }: { size?: number; seed?: string }) {
  // Deterministic PRNG from the URL so the placeholder stays visually stable.
  let h = 0
  for (let i = 0; i < seed.length; i += 1) {
    h = (h * 31 + seed.charCodeAt(i)) | 0
  }
  const rng = () => {
    h = (h * 1103515245 + 12345) | 0
    return ((h >>> 0) % 100) / 100
  }

  const N = 25
  const cell = size / N
  const cells: { x: number; y: number }[] = []
  for (let y = 0; y < N; y += 1) {
    for (let x = 0; x < N; x += 1) {
      const inLocator =
        (x < 7 && y < 7) ||
        (x >= N - 7 && y < 7) ||
        (x < 7 && y >= N - 7)
      if (inLocator) continue
      if (rng() > 0.52) cells.push({ x, y })
    }
  }

  const Locator = ({ x, y }: { x: number; y: number }) => (
    <>
      <rect x={x * cell} y={y * cell} width={7 * cell} height={7 * cell} fill="var(--foreground)" />
      <rect x={(x + 1) * cell} y={(y + 1) * cell} width={5 * cell} height={5 * cell} fill="#fff" />
      <rect x={(x + 2) * cell} y={(y + 2) * cell} width={3 * cell} height={3 * cell} fill="var(--foreground)" />
    </>
  )

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      style={{ display: "block", background: "#fff" }}
      aria-hidden="true"
    >
      {cells.map((c, i) => (
        <rect key={i} x={c.x * cell} y={c.y * cell} width={cell} height={cell} fill="var(--foreground)" />
      ))}
      <Locator x={0} y={0} />
      <Locator x={N - 7} y={0} />
      <Locator x={0} y={N - 7} />
      <rect x={size / 2 - 14} y={size / 2 - 14} width={28} height={28} rx={6} fill="#fff" />
      <rect x={size / 2 - 10} y={size / 2 - 10} width={20} height={20} rx={5} fill="var(--primary)" />
    </svg>
  )
}

interface Props {
  inline?: boolean
}

export function SharePreviewCard({ inline = false }: Props) {
  return (
    <div
      data-testid="share-preview-card"
      className={`rounded-2xl border border-border bg-background ${inline ? "p-4" : "p-5"}`}
    >
      <div className="mb-3 flex items-center gap-2">
        <div className="flex h-7 w-7 items-center justify-center rounded-md bg-[var(--soma-primary-soft)] text-primary">
          <Share2 className="h-3.5 w-3.5" />
        </div>
        <div>
          <div className="text-[13.5px] font-bold tracking-tight text-foreground">공유 링크</div>
          <div className="mt-px text-[11.5px] text-muted-foreground">
            회의 생성 직후 받게 될 링크입니다
          </div>
        </div>
      </div>

      <div className="mb-3 flex items-center gap-3">
        <div className="shrink-0 rounded-xl border border-border bg-white p-2">
          <FakeQR size={108} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
            URL
          </div>
          <div className="mb-2 flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2">
            <LinkIcon className="h-3 w-3 text-muted-foreground" />
            <div className="min-w-0 flex-1 truncate font-mono text-[12.5px] font-semibold text-primary">
              {DUMMY_URL}
            </div>
          </div>
          <div className="text-[11.5px] leading-snug text-muted-foreground">
            회의 생성 후 실제 링크가 여기에 채워집니다. QR을 스캔하거나 링크를 공유하면 팀원이 바로
            참여할 수 있어요.
          </div>
        </div>
      </div>

      <div className="flex gap-2">
        <Button type="button" variant="secondary" size="sm" disabled className="flex-1">
          <Copy className="h-3.5 w-3.5" />
          링크 복사
        </Button>
        <Button type="button" variant="secondary" size="sm" disabled className="flex-1">
          <Share2 className="h-3.5 w-3.5" />
          QR 저장
        </Button>
      </div>
    </div>
  )
}
