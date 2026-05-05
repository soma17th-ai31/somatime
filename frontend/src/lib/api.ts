import {
  ApiError,
  type AvailabilitySubmitResponse,
  type CalculateResponse,
  type ConfirmRequest,
  type ConfirmResponse,
  type GoogleOAuthUrlResponse,
  type ManualAvailabilityRequest,
  type MeetingCreateRequest,
  type MeetingCreateResponse,
  type MeetingDetail,
  type ParticipantJoinResponse,
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
    const message = typeof obj.message === "string" ? obj.message : `요청이 실패했습니다 (${response.status})`
    const suggestion = typeof obj.suggestion === "string" ? obj.suggestion : undefined
    throw new ApiError(response.status, errorCode, message, suggestion)
  }

  return parsed as T
}

// Endpoints
export const api = {
  createMeeting(payload: MeetingCreateRequest) {
    return request<MeetingCreateResponse>("/api/meetings", { method: "POST", body: payload })
  },

  getMeeting(slug: string) {
    return request<MeetingDetail>(`/api/meetings/${encodeURIComponent(slug)}`)
  },

  joinParticipant(slug: string, nickname: string) {
    return request<ParticipantJoinResponse>(`/api/meetings/${encodeURIComponent(slug)}/participants`, {
      method: "POST",
      body: { nickname },
    })
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

  getGoogleOauthUrl(slug: string) {
    return request<GoogleOAuthUrlResponse>(
      `/api/meetings/${encodeURIComponent(slug)}/availability/google/oauth-url`,
    )
  },

  getTimetable(slug: string) {
    return request<TimetableResponse>(`/api/meetings/${encodeURIComponent(slug)}/timetable`)
  },

  calculate(slug: string) {
    return request<CalculateResponse>(`/api/meetings/${encodeURIComponent(slug)}/calculate`, {
      method: "POST",
    })
  },

  confirm(slug: string, organizerToken: string, payload: ConfirmRequest) {
    return request<ConfirmResponse>(`/api/meetings/${encodeURIComponent(slug)}/confirm`, {
      method: "POST",
      body: payload,
      headers: { "X-Organizer-Token": organizerToken },
    })
  },
}
