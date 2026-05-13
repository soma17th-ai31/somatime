// Availability input section — Soma AvailInput pattern.
// Card wrapper + header strip (small title + subtitle, segmented tabs on the
// right) + body. Tab bodies (manual / ICS / natural-language) are unchanged.

import { useState } from "react"
import type { MeetingDetail } from "@/lib/types"
import {
  ManualAvailabilityForm,
  type PendingApplyMode,
} from "./ManualAvailabilityForm"
import { IcsUploadForm } from "./IcsUploadForm"
import { NaturalLanguageAvailabilityForm } from "./NaturalLanguageAvailabilityForm"
import { cn } from "@/lib/cn"

interface Props {
  slug: string
  meeting: MeetingDetail
  onSubmitted: () => void
}

type TabKey = "manual" | "ics" | "nl"

interface PendingState {
  blocks: { start: string; end: string }[]
  mode: PendingApplyMode
}

const TABS: Array<{ value: TabKey; label: string }> = [
  { value: "manual", label: "직접 입력" },
  { value: "ics", label: "ICS 업로드" },
  { value: "nl", label: "자연어 입력" },
]

export function AvailabilitySection({ slug, meeting, onSubmitted }: Props) {
  const [tab, setTab] = useState<TabKey>("manual")
  const [pending, setPending] = useState<PendingState | null>(null)

  return (
    <section className="overflow-hidden rounded-2xl border border-border bg-background">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3.5">
        <div className="min-w-0">
          <div className="text-[14px] font-bold tracking-tight text-foreground">
            가용 시간 입력
          </div>
          <div className="mt-0.5 text-xs text-muted-foreground">
            편한 방식으로 입력해 주세요
          </div>
        </div>
        <div
          role="radiogroup"
          aria-label="입력 방식"
          data-testid="availability-tabs"
          className="inline-flex gap-1 rounded-md border border-border bg-card p-1"
        >
          {TABS.map((opt) => {
            const active = tab === opt.value
            return (
              <button
                key={opt.value}
                type="button"
                role="radio"
                aria-checked={active}
                data-testid={`availability-tab-${opt.value}`}
                onClick={() => setTab(opt.value)}
                className={cn(
                  "rounded-sm px-3 py-1.5 text-xs font-medium transition-all",
                  active
                    ? "bg-secondary text-foreground shadow-sm ring-2 ring-primary ring-inset"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {opt.label}
              </button>
            )
          })}
        </div>
      </div>

      <div className="p-4">
        {tab === "manual" ? (
          <ManualAvailabilityForm
            slug={slug}
            meeting={meeting}
            onSubmitted={onSubmitted}
            pendingBlocks={pending?.blocks ?? null}
            pendingApplyMode={pending?.mode}
            onPendingApplied={() => setPending(null)}
          />
        ) : null}
        {tab === "ics" ? (
          <IcsUploadForm
            slug={slug}
            onParsed={(blocks) => {
              setPending({ blocks, mode: "overwrite" })
              setTab("manual")
            }}
          />
        ) : null}
        {tab === "nl" ? (
          <NaturalLanguageAvailabilityForm
            slug={slug}
            meeting={meeting}
            onApply={(blocks, mode) => {
              setPending({ blocks, mode })
              setTab("manual")
            }}
          />
        ) : null}
      </div>
    </section>
  )
}
