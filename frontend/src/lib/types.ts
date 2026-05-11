// Types mirrored from backend Pydantic schemas. Keep in sync with backend/app/schemas/*.
// v3 — 2026-05-06.

export type LocationType = "online" | "offline" | "any"

export type DateMode = "range" | "picked"

export type LlmSource = "llm" | "deterministic_fallback" | "deterministic"

export interface MeetingCreateRequest {
  title: string
  date_mode: DateMode
  date_range_start: string | null // YYYY-MM-DD
  date_range_end: string | null
  candidate_dates: string[] | null
  duration_minutes: number
  location_type: LocationType
  time_window_start: string // HH:MM
  time_window_end: string // HH:MM
  include_weekends: boolean
}

export interface MeetingCreateResponse {
  slug: string
  share_url: string
}

export interface ConfirmedSlot {
  start: string // ISO 8601 with KST offset
  end: string
}

// v3.19 — payload for PATCH /meetings/{slug}/settings.
export interface MeetingSettingsUpdate {
  date_mode: DateMode
  date_range_start: string | null
  date_range_end: string | null
  candidate_dates: string[] | null
  duration_minutes: number
  location_type: LocationType
  time_window_start: string
  time_window_end: string
  include_weekends: boolean
}

export interface MeetingDetail {
  slug: string
  title: string
  date_mode: DateMode
  date_range_start: string | null
  date_range_end: string | null
  candidate_dates: string[] | null
  duration_minutes: number
  // v3.1 simplify pass: target_count / participant_count are gone.
  // Readiness now flips on submitted_count >= 1.
  submitted_count: number
  // Nicknames of participants who have submitted (in submission order).
  submitted_nicknames?: string[]
  // v3.11 — nicknames of participants who self-marked as required attendees
  // (e.g. mentor for a special lecture). Subset of all participants.
  required_nicknames?: string[]
  is_ready_to_calculate: boolean
  location_type: LocationType
  time_window_start: string
  time_window_end: string
  include_weekends: boolean
  share_url: string
  // v3.6: present (and possibly empty []) when the caller has the participant
  // cookie; null/undefined for anonymous reads. Pre-fills the manual form.
  my_busy_blocks?: { start: string; end: string }[] | null
  confirmed_slot: ConfirmedSlot | null
  confirmed_share_message: string | null
  created_at?: string
  // #32 — 회의 자동 삭제 예정 시각 (ISO 8601 with KST offset). 미지원 응답에선 omit.
  expires_at?: string
  // #13 — 본인 참여자의 개인 이동 버퍼(분). null = 시스템 기본값(60분) 사용.
  // anonymous 호출 시 undefined.
  my_buffer_minutes?: number | null
}

export interface BusyBlock {
  start: string // ISO 8601 KST
  end: string
}

export interface ParticipantResponse {
  participant_id: number
  nickname: string
}

// Backwards-compat alias.
export type ParticipantJoinResponse = ParticipantResponse

export interface ParticipantJoinRequest {
  nickname: string
  pin?: string | null
  is_required?: boolean
  // #13 — buffer-on-join. 등록 시 필수. online 회의면 FE 가 0 으로 하드코딩.
  // 값: 0/30/60/90/120 분.
  buffer_minutes: number
}

export interface ParticipantLoginRequest {
  nickname: string
  pin: string
}

export interface ManualAvailabilityRequest {
  busy_blocks: BusyBlock[]
}

export interface AvailabilitySubmitResponse {
  participant_id: number
  busy_block_count: number
  source_type: "ics" | "manual"
}

export interface IcsErrorResponse {
  error_code: string
  message: string
  suggestion?: string
}

export interface Candidate {
  start: string
  end: string
  available_count: number
  missing_participants: string[]
  reason: string | null
  share_message_draft?: string | null
  note?: string | null
}

export interface CalculateResponse {
  summary: string | null
  best_available_count?: number
  total_participants?: number
  candidates: Candidate[]
  source: LlmSource
  suggestion: string | null
}

export interface RecommendResponse {
  summary: string | null
  candidates: Candidate[]
  source: LlmSource
  llm_call_count?: number
  suggestion?: string | null
}

export interface TimetableSlot {
  start: string
  end: string
  available_count: number
  available_nicknames: string[]
}

export interface TimetableResponse {
  slots: TimetableSlot[]
}

export interface ConfirmRequest {
  slot_start: string
  slot_end: string
  share_message_draft: string
}

export interface ConfirmResponse {
  confirmed_slot: ConfirmedSlot
  share_message_draft: string
}

export class ApiError extends Error {
  errorCode: string
  suggestion?: string
  status: number

  constructor(status: number, errorCode: string, message: string, suggestion?: string) {
    super(message)
    this.status = status
    this.errorCode = errorCode
    this.suggestion = suggestion
  }
}
