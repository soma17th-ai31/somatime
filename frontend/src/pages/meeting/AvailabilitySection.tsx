// Availability input section. Spec §6 — manual / ICS / 자연어 입력.
// v3.24 — ICS upload no longer saves directly; it pre-fills the manual grid
// with the parsed busy_blocks and switches the user to the 직접 입력 tab so
// they can review/edit before saving.
// Natural-language follows the same pipeline plus a preview + merge/overwrite
// choice before pushing busy_blocks into the manual form.

import { useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import type { MeetingDetail } from "@/lib/types"
import {
  ManualAvailabilityForm,
  type PendingApplyMode,
} from "./ManualAvailabilityForm"
import { IcsUploadForm } from "./IcsUploadForm"
import { NaturalLanguageAvailabilityForm } from "./NaturalLanguageAvailabilityForm"

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

export function AvailabilitySection({ slug, meeting, onSubmitted }: Props) {
  const [tab, setTab] = useState<TabKey>("manual")
  const [pending, setPending] = useState<PendingState | null>(null)

  return (
    <Card>
      <CardHeader>
        <CardTitle>가용 시간 입력</CardTitle>
        <CardDescription>
          직접 입력하거나 ICS 파일 / 자연어로 일정을 불러와 그리드에 반영한 뒤 저장하세요. 같은
          닉네임으로 다시 제출하면 마지막 입력으로 덮어씌워집니다.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Tabs value={tab} onValueChange={(v) => setTab(v as TabKey)}>
          <TabsList>
            <TabsTrigger value="manual">직접 입력</TabsTrigger>
            <TabsTrigger value="ics">ICS 업로드</TabsTrigger>
            <TabsTrigger value="nl">자연어 입력</TabsTrigger>
          </TabsList>
          <TabsContent value="manual">
            <ManualAvailabilityForm
              slug={slug}
              meeting={meeting}
              onSubmitted={onSubmitted}
              pendingBlocks={pending?.blocks ?? null}
              pendingApplyMode={pending?.mode}
              onPendingApplied={() => setPending(null)}
            />
          </TabsContent>
          <TabsContent value="ics">
            <IcsUploadForm
              slug={slug}
              onParsed={(blocks) => {
                setPending({ blocks, mode: "overwrite" })
                setTab("manual")
              }}
            />
          </TabsContent>
          <TabsContent value="nl">
            <NaturalLanguageAvailabilityForm
              slug={slug}
              meeting={meeting}
              onApply={(blocks, mode) => {
                setPending({ blocks, mode })
                setTab("manual")
              }}
            />
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  )
}
