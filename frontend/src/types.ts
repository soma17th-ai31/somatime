export type LocationType = 'online' | 'offline' | 'either';
export type BlockType = 'busy' | 'free';

export interface Participant {
  id: string;
  nickname: string;
  source_type: 'manual' | 'ics';
  block_count: number;
  submitted_at: string;
}

export interface Meeting {
  id: string;
  title: string;
  start_date: string;
  end_date: string;
  daily_start_time: string;
  daily_end_time: string;
  duration_minutes: number;
  target_participants: number;
  location_type: LocationType;
  submitted_participants: number;
  is_ready_for_results: boolean;
  participants: Participant[];
  selected_candidate?: Record<string, unknown> | null;
}

export interface MeetingCreatePayload {
  title: string;
  start_date: string;
  end_date: string;
  daily_start_time: string;
  daily_end_time: string;
  duration_minutes: number;
  target_participants: number;
  location_type: LocationType;
}

export interface ManualBlock {
  start: string;
  end: string;
}

export interface IcsParseResult {
  busy_blocks: ManualBlock[];
}

export interface Candidate {
  start: string;
  end: string;
  available_participants: string[];
  unavailable_participants: string[];
  available_count: number;
  is_full_match: boolean;
  reason: string;
}

export interface TimetableSlot {
  start: string;
  end: string;
  available_count: number;
  available_participants: string[];
  unavailable_participants: string[];
}

export interface Results {
  meeting_id: string;
  summary: string;
  best_available_count: number;
  total_participants: number;
  candidates: Candidate[];
  timetable: TimetableSlot[];
}

export interface MessageDraft {
  meeting_id: string;
  message: string;
  selected_candidate: Record<string, unknown>;
}
