// Availability input section. Spec §6 — manual / ICS only (Q3 removed Google OAuth).
// v3.24 — ICS upload no longer saves directly; it pre-fills the manual grid
// with the parsed busy_blocks and switches the user to the 직접 입력 tab so
// they can review/edit before saving.

import { useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import type { MeetingDetail } from "@/lib/types"
import { ManualAvailabilityForm } from "./ManualAvailabilityForm"
import { IcsUploadForm } from "./IcsUploadForm"

interface Props {
  slug: string
  meeting: MeetingDetail
  onSubmitted: () => void
}

type TabKey = "manual" | "ics"

export function AvailabilitySection({ slug, meeting, onSubmitted }: Props) {
  const [tab, setTab] = useState<TabKey>("manual")
  const [pendingIcsBlocks, setPendingIcsBlocks] =
    useState<{ start: string; end: string }[] | null>(null)

  return (
    <Card>
      <CardHeader>
        <CardTitle>가용 시간 입력</CardTitle>
        <CardDescription>
          직접 입력하거나 ICS 파일을 업로드해 그리드에 반영한 뒤 저장하세요. 같은 닉네임으로 다시
          제출하면 마지막 입력으로 덮어씌워집니다.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Tabs value={tab} onValueChange={(v) => setTab(v as TabKey)}>
          <TabsList>
            <TabsTrigger value="manual">직접 입력</TabsTrigger>
            <TabsTrigger value="ics">ICS 업로드</TabsTrigger>
          </TabsList>
          <TabsContent value="manual">
            <ManualAvailabilityForm
              slug={slug}
              meeting={meeting}
              onSubmitted={onSubmitted}
              pendingIcsBlocks={pendingIcsBlocks}
              onPendingIcsApplied={() => setPendingIcsBlocks(null)}
            />
          </TabsContent>
          <TabsContent value="ics">
            <IcsUploadForm
              slug={slug}
              onParsed={(blocks) => {
                setPendingIcsBlocks(blocks)
                setTab("manual")
              }}
            />
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  )
}
