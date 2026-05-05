// Types mirrored from backend Pydantic schemas. Keep in sync with backend/app/schemas/*.

export type LocationType = "online" | "offline" | "any"

export interface MeetingCreateRequest {
  title: string
  date_range_start: string // YYYY-MM-DD
  date_range_end: string // YYYY-MM-DD
  duration_minutes: number
  participant_count: number
  location_type: LocationType
  time_window_start: string // HH:MM
  time_window_end: string // HH:MM
  include_weekends: boolean
}

export interface MeetingCreateResponse {
  slug: string
  organizer_token: string
  organizer_url: string
  share_url: string
}

export interface ConfirmedSlot {
  start: string // ISO 8601 with KST offset
  end: string
}

export interface MeetingDetail {
  slug: string
  title: string
  date_range_start: string
  date_range_end: string
  duration_minutes: number
  participant_count: number
  location_type: LocationType
  time_window_start: string
  time_window_end: string
  include_weekends: boolean
  confirmed_slot: ConfirmedSlot | null
  participants_registered: number
  created_at: string
}

export interface BusyBlock {
  start: string // ISO 8601 KST
  end: string
}

export interface ParticipantJoinResponse {
  participant_id: number
  nickname: string
}

export interface ManualAvailabilityRequest {
  busy_blocks: BusyBlock[]
}

export interface AvailabilitySubmitResponse {
  participant_id: number
  busy_block_count: number
  source_type: "google" | "ics" | "manual"
}

export interface IcsErrorResponse {
  error_code: string
  message: string
  suggestion?: string
}

export interface GoogleOAuthUrlResponse {
  oauth_url: string
}

export interface Candidate {
  start: string
  end: string
  available_count: number
  missing_participants: string[]
  reason: string
  note?: string | null
}

export interface CalculateResponse {
  candidates: Candidate[]
  suggestion: string | null
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
