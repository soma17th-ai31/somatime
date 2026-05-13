// Empty-title fallback. The meeting title is optional (Spec §5.1 — title may
// be omitted at creation), so anywhere we surface it in the UI we replace an
// empty / whitespace-only value with a stable Korean placeholder.
//
// BE keeps the raw empty string in storage and the LLM share_message_draft
// prompt already strips the title fragment when blank, so this helper is
// purely a presentation concern.
export function formatMeetingTitle(title: string | null | undefined): string {
  const trimmed = (title ?? "").trim()
  return trimmed.length > 0 ? trimmed : "제목 없는 회의"
}
