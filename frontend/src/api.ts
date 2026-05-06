import type { BlockType, IcsParseResult, ManualBlock, Meeting, MeetingCreatePayload, MessageDraft, Results } from '@/types';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? (import.meta.env.PROD ? '/api' : 'http://localhost:8000');

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers: options?.body instanceof FormData ? options.headers : { 'Content-Type': 'application/json', ...options?.headers },
  });

  if (!response.ok) {
    let message = '요청을 처리하지 못했습니다.';
    try {
      const body = await response.json();
      message = body.detail ?? message;
    } catch {
      message = response.statusText || message;
    }
    throw new Error(message);
  }

  return response.json() as Promise<T>;
}

export function createMeeting(payload: MeetingCreatePayload): Promise<Meeting> {
  return request<Meeting>('/meetings', { method: 'POST', body: JSON.stringify(payload) });
}

export function getMeeting(meetingId: string): Promise<Meeting> {
  return request<Meeting>(`/meetings/${meetingId}`);
}

export function submitManual(meetingId: string, nickname: string, blockType: BlockType, blocks: ManualBlock[]): Promise<Meeting> {
  return request<Meeting>(`/meetings/${meetingId}/submissions/manual`, {
    method: 'POST',
    body: JSON.stringify({ nickname, block_type: blockType, blocks }),
  });
}

export function submitIcs(meetingId: string, nickname: string, file: File): Promise<Meeting> {
  const formData = new FormData();
  formData.append('nickname', nickname);
  formData.append('file', file);
  return request<Meeting>(`/meetings/${meetingId}/submissions/ics`, { method: 'POST', body: formData });
}

export function parseIcs(meetingId: string, file: File): Promise<IcsParseResult> {
  const formData = new FormData();
  formData.append('file', file);
  return request<IcsParseResult>(`/meetings/${meetingId}/parse-ics`, { method: 'POST', body: formData });
}

export function getResults(meetingId: string): Promise<Results> {
  return request<Results>(`/meetings/${meetingId}/results`);
}

export function selectCandidate(meetingId: string, start: string, end: string, reason: string): Promise<MessageDraft> {
  return request<MessageDraft>(`/meetings/${meetingId}/select`, {
    method: 'POST',
    body: JSON.stringify({ start, end, reason }),
  });
}
