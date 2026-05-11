// Single source of truth for backend HTTP calls. v3 — 2026-05-06.
// All requests use credentials: "include" so the somameet_pt_{slug} cookie travels.
// All errors are normalized to ApiError(status, errorCode, message, suggestion?).

import {
  ApiError,
  type AvailabilitySubmitResponse,
  type CalculateResponse,
  type ConfirmRequest,
  type ConfirmResponse,
  type ManualAvailabilityRequest,
  type MeetingCreateRequest,
  type MeetingCreateResponse,
  type MeetingDetail,
  type MeetingSettingsUpdate,
  type ParticipantJoinRequest,
  type ParticipantLoginRequest,
  type ParticipantResponse,
  type RecommendResponse,
  type TimetableResponse,
} from "./types"

const RAW_BASE = import.meta.env.VITE_API_BASE_URL ?? ""
// In dev we rely on the Vite proxy at /api. If VITE_API_BASE_URL is set we use it directly.
const API_BASE = RAW_BASE.replace(/\/$/, "")

interface RequestOptions {
  method?: "GET" | "POST" | "DELETE" | "PATCH"
  body?: unknown
  headers?: Record<string, string>
  isFormData?: boolean
  signal?: AbortSignal
}

async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const url = `${API_BASE}${path}`
  const headers: Record<string, string> = { ...(opts.headers ?? {}) }
  let body: BodyInit | undefined

  if (opts.body !== undefined) {
    if (opts.isFormData) {
      body = opts.body as FormData
    } else {
      headers["Content-Type"] = "application/json"
      body = JSON.stringify(opts.body)
    }
  }

  let response: Response
  try {
    response = await fetch(url, {
      method: opts.method ?? "GET",
      headers,
      body,
      credentials: "include",
      signal: opts.signal,
    })
  } catch (err) {
    throw new ApiError(0, "network_error", "서버에 연결할 수 없습니다.", String(err))
  }

  const text = await response.text()
  let parsed: unknown = null
  if (text.length > 0) {
    try {
      parsed = JSON.parse(text)
    } catch {
      parsed = null
    }
  }

  if (!response.ok) {
    const obj = (parsed ?? {}) as Record<string, unknown>
    const errorCode = typeof obj.error_code === "string" ? obj.error_code : "unknown_error"
    const message =
      typeof obj.message === "string" ? obj.message : `요청이 실패했습니다 (${response.status})`
    const suggestion = typeof obj.suggestion === "string" ? obj.suggestion : undefined
    throw new ApiError(response.status, errorCode, message, suggestion)
  }

  return parsed as T
}

// Endpoints — payload shapes track spec §5.1 verbatim.
export const api = {
  createMeeting(payload: MeetingCreateRequest) {
    return request<MeetingCreateResponse>("/api/meetings", { method: "POST", body: payload })
  },

  getMeeting(slug: string) {
    return request<MeetingDetail>(`/api/meetings/${encodeURIComponent(slug)}`)
  },

  // v3.19 — replace meeting settings (날짜/길이/방식/시간대 등). Title not editable.
  updateMeetingSettings(slug: string, payload: MeetingSettingsUpdate) {
    return request<MeetingDetail>(
      `/api/meetings/${encodeURIComponent(slug)}/settings`,
      { method: "PATCH", body: payload },
    )
  },

  joinMeeting(slug: string, payload: ParticipantJoinRequest) {
    return request<ParticipantResponse>(
      `/api/meetings/${encodeURIComponent(slug)}/participants`,
      { method: "POST", body: payload },
    )
  },

  // Spec §5.1: PIN re-entry. Re-issues somameet_pt_{slug} cookie on success.
  loginParticipant(slug: string, payload: ParticipantLoginRequest) {
    return request<ParticipantResponse>(
      `/api/meetings/${encodeURIComponent(slug)}/participants/login`,
      { method: "POST", body: payload },
    )
  },

  // v3.5 / v3.11 — update current participant. Cookie-authed.
  // pin field semantics:
  //   - omit pin       → leave existing PIN unchanged
  //   - pin: ""        → clear existing PIN
  //   - pin: "1234"    → set new 4-digit PIN
  // is_required field semantics:
  //   - omit field             → leave existing flag unchanged
  //   - is_required: true/false → set accordingly
  // #13 — buffer_minutes field semantics:
  //   - omit field    → leave existing value unchanged
  //   - null          → clear, fall back to meeting.offline_buffer_minutes
  //   - 0/30/60/90/120 → explicit per-participant value
  updateSelf(
    slug: string,
    payload: {
      nickname: string
      pin?: string
      is_required?: boolean
      buffer_minutes?: number | null
    },
  ) {
    return request<{
      id: number
      nickname: string
      has_pin: boolean
      is_required: boolean
      buffer_minutes: number | null
    }>(
      `/api/meetings/${encodeURIComponent(slug)}/participants/me`,
      { method: "PATCH", body: payload },
    )
  },

  submitManual(slug: string, payload: ManualAvailabilityRequest) {
    return request<AvailabilitySubmitResponse>(
      `/api/meetings/${encodeURIComponent(slug)}/availability/manual`,
      { method: "POST", body: payload },
    )
  },

  submitIcs(slug: string, file: File) {
    const fd = new FormData()
    fd.append("file", file)
    return request<AvailabilitySubmitResponse>(
      `/api/meetings/${encodeURIComponent(slug)}/availability/ics`,
      { method: "POST", body: fd, isFormData: true },
    )
  },

  // v3.24 — parse ICS without saving. Returns busy_blocks for client-side
  // pre-fill so the user can review/edit before committing via /availability/manual.
  parseIcs(slug: string, file: File) {
    const fd = new FormData()
    fd.append("file", file)
    return request<{ busy_blocks: { start: string; end: string }[] }>(
      `/api/meetings/${encodeURIComponent(slug)}/availability/ics/parse`,
      { method: "POST", body: fd, isFormData: true },
    )
  },

  getTimetable(slug: string) {
    return request<TimetableResponse>(`/api/meetings/${encodeURIComponent(slug)}/timetable`)
  },

  // Deterministic only. No LLM call. reason/share_message_draft are null.
  calculate(slug: string) {
    return request<CalculateResponse>(`/api/meetings/${encodeURIComponent(slug)}/calculate`, {
      method: "POST",
    })
  },

  // LLM-driven. 1 call (up to 3 retries on validation fail). Returns reason + share_message_draft.
  recommend(slug: string) {
    return request<RecommendResponse>(`/api/meetings/${encodeURIComponent(slug)}/recommend`, {
      method: "POST",
    })
  },

  // Spec §5.1: confirm now persists share_message_draft as-is.
  // v3.2 (Path B): no X-Organizer-Token header — share-URL holders may confirm.
  confirm(slug: string, payload: ConfirmRequest) {
    return request<ConfirmResponse>(`/api/meetings/${encodeURIComponent(slug)}/confirm`, {
      method: "POST",
      body: payload,
    })
  },

  // #24 — 확정 취소. Returns the updated MeetingDetail with confirmed_slot/confirmed_share_message
  // cleared. BE may reject (409) when the meeting start is already in the past.
  cancelConfirm(slug: string) {
    return request<MeetingDetail>(`/api/meetings/${encodeURIComponent(slug)}/confirm`, {
      method: "DELETE",
    })
  },
}

// Re-export for convenience.
export { ApiError }
