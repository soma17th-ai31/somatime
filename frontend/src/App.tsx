import {
  CheckCircle2,
  Copy,
  FileUp,
  Loader2,
  LockKeyhole,
  Moon,
  Network,
  Sun,
  UserRound,
} from "lucide-react";
import type { ChangeEvent, DragEvent, FormEvent, PointerEvent } from "react";
import { useEffect, useState } from "react";
import type { DateRange } from "react-day-picker";

import {
  createMeeting,
  getMeeting,
  getResults,
  parseIcs,
  selectCandidate,
  submitManual,
} from "@/api";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import type {
  Candidate,
  LocationType,
  ManualBlock,
  Meeting,
  MeetingCreatePayload,
  MessageDraft,
  Results,
  TimetableSlot,
} from "@/types";

interface AvailabilitySlot {
  key: string;
  date: string;
  startTime: string;
  endTime: string;
  start: string;
  end: string;
}

type DragMode = "select" | "unselect";
type ThemeMode = "light" | "dark";

interface ThemeControls {
  theme: ThemeMode;
  onToggleTheme: () => void;
}

const SLOT_UNIT_MINUTES = 30;
const THEME_STORAGE_KEY = "somameet-theme";

const getInitialTheme = (): ThemeMode => {
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (stored === "light" || stored === "dark") return stored;
  } catch {
    // localStorage can be unavailable in restricted browser contexts.
  }

  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
};

const addDays = (date: Date, days: number) => {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
};

const dateInput = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};
const normalizeTime = (value: string) => value.slice(0, 5);

const timeOptions = Array.from(
  { length: 48 },
  (_, index) =>
    `${String(Math.floor(index / 2)).padStart(2, "0")}:${index % 2 === 0 ? "00" : "30"}`,
);

const parseDateValue = (value: string) => {
  if (!value) return undefined;
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return undefined;
  return new Date(year, month - 1, day);
};

const formatDateLabel = (value: string) => {
  const date = parseDateValue(value);
  if (!date) return "날짜 선택";
  return new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(date);
};

const formatCompactDateLabel = (value: string) => {
  const date = parseDateValue(value);
  if (!date) return value;
  const weekdays = ["일", "월", "화", "수", "목", "금", "토"];
  return `${date.getMonth() + 1}/${date.getDate()} ${weekdays[date.getDay()]}`;
};

const timeToMinutes = (value: string) => {
  const [hour, minute] = normalizeTime(value).split(":").map(Number);
  return (hour || 0) * 60 + (minute || 0);
};

const minutesToTime = (value: number) =>
  `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;

const combineDateTime = (date: string, time: string) => {
  if (!date || !time) return "";
  return `${date}T${normalizeTime(time)}:00+09:00`;
};

const getDateValues = (start: string, end: string) => {
  const startDate = parseDateValue(start);
  const endDate = parseDateValue(end);
  if (!startDate || !endDate) return [];

  const dates: string[] = [];
  const cursor = new Date(startDate);
  while (cursor <= endDate) {
    dates.push(dateInput(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return dates;
};

const getTimeRows = (start: string, end: string) => {
  const startMinutes = timeToMinutes(start);
  const endMinutes = timeToMinutes(end);
  const rows: string[] = [];
  for (let minutes = startMinutes; minutes + SLOT_UNIT_MINUTES <= endMinutes; minutes += SLOT_UNIT_MINUTES) {
    rows.push(minutesToTime(minutes));
  }
  return rows;
};

const buildAvailabilitySlots = (meeting: Meeting): AvailabilitySlot[] => {
  const dates = getDateValues(meeting.start_date, meeting.end_date);
  const timeRows = getTimeRows(meeting.daily_start_time, meeting.daily_end_time);

  return dates.flatMap((date) =>
    timeRows.map((startTime) => {
      const endTime = minutesToTime(timeToMinutes(startTime) + SLOT_UNIT_MINUTES);
      const start = combineDateTime(date, startTime);
      const end = combineDateTime(date, endTime);
      return {
        key: start,
        date,
        startTime,
        endTime,
        start,
        end,
      };
    }),
  );
};

const rangesOverlap = (startA: string, endA: string, startB: string, endB: string) =>
  Date.parse(startA) < Date.parse(endB) && Date.parse(startB) < Date.parse(endA);

const slotOverlapsBlocks = (slot: AvailabilitySlot, blocks: ManualBlock[]) =>
  blocks.some((block) => rangesOverlap(slot.start, slot.end, block.start, block.end));

const mergeSelectedSlots = (slots: AvailabilitySlot[], selectedSlots: Set<string>): ManualBlock[] => {
  const sorted = slots
    .filter((slot) => selectedSlots.has(slot.key))
    .sort((left, right) => Date.parse(left.start) - Date.parse(right.start));

  return sorted.reduce<ManualBlock[]>((merged, slot) => {
    const previous = merged[merged.length - 1];
    if (previous && previous.end === slot.start) {
      previous.end = slot.end;
    } else {
      merged.push({ start: slot.start, end: slot.end });
    }
    return merged;
  }, []);
};

const formatDurationMinutes = (minutes: number) => {
  if (minutes < 60) return `${minutes}분`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours}시간 ${rest}분` : `${hours}시간`;
};

const formatDateTime = (value: string) =>
  new Intl.DateTimeFormat("ko-KR", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));

const formatTime = (value: string) =>
  new Intl.DateTimeFormat("ko-KR", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));

const isoDateKey = (value: string) => value.slice(0, 10);
const isoTimeKey = (value: string) => value.slice(11, 16);

const heatmapToneClass = (availableCount: number, totalParticipants: number) => {
  if (totalParticipants <= 0 || availableCount <= 0) {
    return "bg-secondary/30 text-muted-foreground hover:bg-secondary/50";
  }

  const ratio = availableCount / totalParticipants;
  if (ratio >= 1) return "bg-primary text-primary-foreground hover:bg-primary/90";
  if (ratio >= 0.75) return "bg-primary/75 text-primary-foreground hover:bg-primary/85";
  if (ratio >= 0.5) return "bg-primary/50 text-foreground hover:bg-primary/60";
  if (ratio >= 0.25) return "bg-primary/30 text-foreground hover:bg-primary/40";
  return "bg-primary/15 text-muted-foreground hover:bg-primary/25";
};

const slotIsRecommended = (slot: TimetableSlot, candidates: Candidate[]) =>
  candidates.some((candidate) => rangesOverlap(slot.start, slot.end, candidate.start, candidate.end));

const locationLabel: Record<LocationType, string> = {
  online: "온라인",
  offline: "오프라인",
  either: "상관없음",
};

function navigate(path: string) {
  window.history.pushState({}, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

function useRoute() {
  const [path, setPath] = useState(window.location.pathname);
  useEffect(() => {
    const onPopState = () => setPath(window.location.pathname);
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);
  return path;
}

function ThemeFab({ theme, onToggleTheme }: ThemeControls) {
  const isDark = theme === "dark";
  return (
    <Button
      type="button"
      variant="secondary"
      size="icon"
      className="fixed right-5 top-5 z-50 size-12 rounded-full surface-edge"
      onClick={onToggleTheme}
      aria-label={isDark ? "라이트모드로 전환" : "다크모드로 전환"}
      title={isDark ? "라이트모드로 전환" : "다크모드로 전환"}
    >
      {isDark ? <Sun /> : <Moon />}
      <span className="sr-only">{isDark ? "라이트모드로 전환" : "다크모드로 전환"}</span>
    </Button>
  );
}

function CreateMeetingPage() {
  const today = new Date();
  const [form, setForm] = useState<MeetingCreatePayload>({
    title: "SomaMeet 멘토링 세션",
    start_date: dateInput(addDays(today, 1)),
    end_date: dateInput(addDays(today, 5)),
    daily_start_time: "10:00",
    daily_end_time: "22:00",
    duration_minutes: 60,
    target_participants: 4,
    location_type: "online",
  });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const update = (key: keyof MeetingCreatePayload, value: string | number) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      const meeting = await createMeeting(form);
      navigate(`/meetings/${meeting.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "회의를 생성하지 못했습니다.");
    } finally {
      setLoading(false);
    }
  };

  const selectedDateRange: DateRange = {
    from: parseDateValue(form.start_date),
    to: parseDateValue(form.end_date),
  };

  const updateDateRange = (range: DateRange | undefined) => {
    if (!range?.from) return;
    setForm((current) => ({
      ...current,
      start_date: dateInput(range.from!),
      end_date: dateInput(range.to ?? range.from!),
    }));
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <main className="linear-container py-8 sm:py-12">
        <section id="meeting-form">
          <Card className="surface-edge rounded-xl bg-card">
            <CardHeader className="border-b border-border">
              <CardTitle className="font-display text-[clamp(30px,4vw,48px)] font-semibold leading-[1.1] tracking-[-1.4px]">
                SomaMeet
              </CardTitle>
            </CardHeader>
            <CardContent className="p-6 lg:p-8">
              <form className="grid gap-4 lg:grid-cols-[1fr_1.08fr_1fr]" onSubmit={onSubmit}>
                <Card className="bg-background/70">
                  <CardHeader>
                    <CardTitle className="text-base tracking-[-0.05px]">날짜</CardTitle>
                    <CardDescription>
                      {formatDateLabel(form.start_date)} - {formatDateLabel(form.end_date)}
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <Calendar
                      mode="range"
                      selected={selectedDateRange}
                      onSelect={updateDateRange}
                      numberOfMonths={1}
                      className="rounded-md border border-border bg-card p-3"
                    />
                  </CardContent>
                </Card>

                <Card className="bg-background/70">
                  <CardHeader>
                    <CardTitle className="text-base tracking-[-0.05px]">회의</CardTitle>
                  </CardHeader>
                  <CardContent className="grid gap-5">
                    <div className="grid gap-2">
                      <Label htmlFor="title">회의 제목</Label>
                      <Input
                        id="title"
                        value={form.title}
                        onChange={(event) => update("title", event.target.value)}
                        required
                        className="h-12 text-lg font-semibold"
                      />
                    </div>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="grid gap-2">
                        <Label htmlFor="target">참여 인원</Label>
                        <Input
                          id="target"
                          type="number"
                          min={1}
                          max={20}
                          value={form.target_participants}
                          onChange={(event) =>
                            update("target_participants", Number(event.target.value))
                          }
                        />
                      </div>
                      <div className="grid gap-2">
                        <Label>회의 방식</Label>
                        <Select
                          value={form.location_type}
                          onValueChange={(value) => update("location_type", value as LocationType)}
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="online">온라인</SelectItem>
                            <SelectItem value="offline">오프라인</SelectItem>
                            <SelectItem value="either">상관없음</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                <Card className="bg-background/70">
                  <CardHeader>
                    <CardTitle className="text-base tracking-[-0.05px]">시간</CardTitle>
                  </CardHeader>
                  <CardContent className="grid gap-5">
                    <div className="grid gap-2">
                      <Label>시작 시간</Label>
                      <Select
                        value={form.daily_start_time}
                        onValueChange={(value) => update("daily_start_time", value)}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {timeOptions.map((option) => (
                            <SelectItem key={option} value={option}>
                              {option}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="grid gap-2">
                      <Label>종료 시간</Label>
                      <Select
                        value={form.daily_end_time}
                        onValueChange={(value) => update("daily_end_time", value)}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {timeOptions.map((option) => (
                            <SelectItem key={option} value={option}>
                              {option}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="grid gap-2">
                      <Label>회의 길이</Label>
                      <Select
                        value={String(form.duration_minutes)}
                        onValueChange={(value) => update("duration_minutes", Number(value))}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="30">30분</SelectItem>
                          <SelectItem value="60">60분</SelectItem>
                          <SelectItem value="90">90분</SelectItem>
                          <SelectItem value="120">120분</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </CardContent>
                </Card>

                {error && (
                  <Alert variant="destructive" className="lg:col-span-3">
                    <AlertTitle>회의 생성 실패</AlertTitle>
                    <AlertDescription>{error}</AlertDescription>
                  </Alert>
                )}
                <Card className="bg-background/70 lg:col-span-3">
                  <CardContent className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <p className="mb-1 truncate text-sm font-medium text-foreground">{form.title || '회의 제목'}</p>
                      <p className="truncate text-sm tabular-nums text-muted-foreground">
                        {formatDateLabel(form.start_date)} - {formatDateLabel(form.end_date)} ·{" "}
                        {form.daily_start_time}-{form.daily_end_time} · {form.duration_minutes}분
                      </p>
                    </div>
                    <Button className="w-full sm:w-fit" disabled={loading} type="submit">
                      {loading && <Loader2 className="animate-spin" />}{" "}
                      {loading ? "초대 링크 생성 중…" : "초대 링크 생성"}
                    </Button>
                  </CardContent>
                </Card>
              </form>
            </CardContent>
          </Card>
        </section>
      </main>
    </div>
  );
}

function MeetingPage({ meetingId }: { meetingId: string }) {
  const [meeting, setMeeting] = useState<Meeting | null>(null);
  const [nickname, setNickname] = useState("");
  const [selectedSlots, setSelectedSlots] = useState<Set<string>>(() => new Set());
  const [icsBusyBlocks, setIcsBusyBlocks] = useState<ManualBlock[]>([]);
  const [dragMode, setDragMode] = useState<DragMode | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(false);
  const [icsLoading, setIcsLoading] = useState(false);
  const [isIcsDragging, setIsIcsDragging] = useState(false);

  useEffect(() => {
    getMeeting(meetingId)
      .then((data) => {
        setMeeting(data);
        setSelectedSlots(new Set<string>());
        setIcsBusyBlocks([]);
      })
      .catch((err) =>
        setError(err instanceof Error ? err.message : "회의 정보를 불러오지 못했습니다."),
      );
  }, [meetingId]);

  useEffect(() => {
    const stopDrag = () => setDragMode(null);
    window.addEventListener("pointerup", stopDrag);
    window.addEventListener("pointercancel", stopDrag);
    return () => {
      window.removeEventListener("pointerup", stopDrag);
      window.removeEventListener("pointercancel", stopDrag);
    };
  }, []);

  const setSlotSelected = (slotKey: string, selected: boolean) => {
    setSelectedSlots((current) => {
      if (selected && current.has(slotKey)) return current;
      if (!selected && !current.has(slotKey)) return current;

      const next = new Set(current);
      if (selected) {
        next.add(slotKey);
      } else {
        next.delete(slotKey);
      }
      return next;
    });
  };

  const beginSlotDrag = (event: PointerEvent<HTMLButtonElement>, slotKey: string) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.focus();
    const nextMode: DragMode = selectedSlots.has(slotKey) ? "unselect" : "select";
    setDragMode(nextMode);
    setSlotSelected(slotKey, nextMode === "select");
  };

  const continueSlotDrag = (slotKey: string) => {
    if (!dragMode) return;
    setSlotSelected(slotKey, dragMode === "select");
  };

  const continueSlotDragFromPointer = (event: PointerEvent<HTMLDivElement>) => {
    if (!dragMode) return;
    const target = document.elementFromPoint(event.clientX, event.clientY);
    const slotKey = target instanceof Element
      ? target.closest<HTMLButtonElement>("[data-slot-key]")?.dataset.slotKey
      : undefined;
    if (slotKey) continueSlotDrag(slotKey);
  };

  const selectAllSlots = () => {
    if (!meeting) return;
    setSelectedSlots(new Set(buildAvailabilitySlots(meeting).map((slot) => slot.key)));
    setNotice("회의 범위의 모든 슬롯을 가능한 시간으로 선택했습니다.");
  };

  const clearSelection = () => {
    setSelectedSlots(new Set<string>());
    setIcsBusyBlocks([]);
    setNotice("선택을 초기화했습니다.");
  };

  const handleIcsFile = async (selectedFile: File) => {
    if (!meeting) return;
    setIcsLoading(true);
    setError("");
    setNotice("");
    try {
      const data = await parseIcs(meetingId, selectedFile);
      const slots = buildAvailabilitySlots(meeting);
      const freeSlots = slots.filter((slot) => !slotOverlapsBlocks(slot, data.busy_blocks));
      const busySlotCount = slots.length - freeSlots.length;

      setIcsBusyBlocks(data.busy_blocks);
      setSelectedSlots(new Set(freeSlots.map((slot) => slot.key)));
      setNotice(
        `${selectedFile.name}에서 바쁜 슬롯 ${busySlotCount}개를 제외하고 가능한 슬롯 ${freeSlots.length}개를 선택했습니다.`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : ".ics 파일을 반영하지 못했습니다.");
    } finally {
      setIcsLoading(false);
    }
  };

  const handleIcsUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const selectedFile = input.files?.[0];
    if (selectedFile) {
      await handleIcsFile(selectedFile);
    }
    input.value = "";
  };

  const handleIcsDrop = async (event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    setIsIcsDragging(false);
    if (loading || icsLoading) return;

    const selectedFile = event.dataTransfer.files?.[0];
    if (selectedFile) {
      await handleIcsFile(selectedFile);
    }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!meeting) return;
    if (!nickname.trim()) {
      setError("닉네임을 입력해주세요.");
      return;
    }
    setLoading(true);
    setError("");
    setNotice("");
    try {
      const normalized = mergeSelectedSlots(buildAvailabilitySlots(meeting), selectedSlots);
      if (!normalized.length) throw new Error("가능한 시간을 1개 이상 선택해주세요.");
      if (normalized.length > 80) {
        throw new Error("선택 구간이 너무 잘게 나뉘었습니다. 연속된 시간을 더 크게 선택해주세요.");
      }
      const data = await submitManual(meetingId, nickname, "free", normalized);
      setMeeting(data);
      setSelectedSlots(new Set<string>());
      setIcsBusyBlocks([]);
      setNotice(`${nickname}님의 일정 입력이 완료되었습니다.`);
      setNickname("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "일정을 제출하지 못했습니다.");
    } finally {
      setLoading(false);
    }
  };

  if (!meeting) {
    return (
      <div className="min-h-screen bg-background text-foreground">
        <div className="linear-container grid min-h-screen content-center gap-4">
          <Skeleton className="h-10 w-64" />
          <Skeleton className="h-56 w-full rounded-xl" />
        </div>
      </div>
    );
  }

  const meetingDates = getDateValues(meeting.start_date, meeting.end_date);
  const timeRows = getTimeRows(meeting.daily_start_time, meeting.daily_end_time);
  const timetableSlots = buildAvailabilitySlots(meeting);
  const slotByDateTime = new Map(
    timetableSlots.map((slot) => [`${slot.date}:${slot.startTime}`, slot]),
  );
  const selectedMinutes = selectedSlots.size * SLOT_UNIT_MINUTES;
  const selectedBlocks = mergeSelectedSlots(timetableSlots, selectedSlots);
  const resultsDisabled = !meeting.is_ready_for_results;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <main className="linear-container grid min-w-0 gap-8 py-8 sm:py-10 lg:grid-cols-[1.38fr_0.62fr]">
        <Card className="surface-edge order-2 min-w-0 rounded-xl bg-card lg:sticky lg:top-6 lg:self-start">
          <CardHeader>
            <CardTitle className="font-display text-[clamp(30px,4vw,44px)] font-semibold leading-[1.1] tracking-[-1.4px]">
              {meeting.title}
            </CardTitle>
            <CardDescription className="text-base leading-7">
              {meeting.start_date} - {meeting.end_date} · {meeting.duration_minutes}분 · {locationLabel[meeting.location_type]}
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-6">
            <div
              className="grid gap-3"
              aria-label={`제출 완료 ${meeting.submitted_participants}/${meeting.target_participants}`}
            >
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">제출 완료</span>
                <span className="font-medium text-foreground">
                  {meeting.submitted_participants}/{meeting.target_participants}
                </span>
              </div>
              <div className="flex flex-wrap gap-2">
                {Array.from({ length: meeting.target_participants }, (_, index) => {
                  const active = index < meeting.submitted_participants;
                  return (
                    <span
                      key={index}
                      className={`inline-flex size-9 items-center justify-center rounded-full border transition ${
                        active
                          ? "border-success/50 bg-success/15 text-success"
                          : "border-border bg-secondary/70 text-muted-foreground/45"
                      }`}
                      title={`${index + 1}번째 참여자 ${active ? "제출 완료" : "대기 중"}`}
                      aria-label={`${index + 1}번째 참여자 ${active ? "제출 완료" : "대기 중"}`}
                    >
                      <UserRound className="size-4" aria-hidden="true" />
                    </span>
                  );
                })}
              </div>
            </div>

            <form id="availability-form" className="grid gap-4" onSubmit={submit}>
              <div className="grid gap-2">
                <Label htmlFor="nickname">닉네임</Label>
                <Input
                  id="nickname"
                  value={nickname}
                  onChange={(event) => setNickname(event.target.value)}
                  placeholder="예: 중곤"
                />
              </div>

              {notice && (
                <Alert>
                  <CheckCircle2 className="mb-2 size-4 text-success" />
                  <AlertTitle>알림</AlertTitle>
                  <AlertDescription>{notice}</AlertDescription>
                </Alert>
              )}
              {error && (
                <Alert variant="destructive">
                  <AlertTitle>처리 실패</AlertTitle>
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}

              <div className="grid gap-2">
                <Button disabled={loading || icsLoading} type="submit" className="w-full">
                  {(loading || icsLoading) && <Loader2 className="animate-spin" />} 일정 제출
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  disabled={resultsDisabled}
                  aria-disabled={resultsDisabled}
                  title={resultsDisabled ? "모든 참여자가 제출하면 결과를 생성할 수 있습니다." : "결과 생성"}
                  onClick={() => {
                    if (resultsDisabled) return;
                    navigate(`/meetings/${meeting.id}/results`);
                  }}
                  className="w-full"
                >
                  {resultsDisabled && <LockKeyhole />} 결과 생성
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>

        <Card className="surface-edge order-1 min-w-0 overflow-hidden rounded-xl bg-card">
          <CardHeader>
            <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
              <div className="min-w-0">
                <CardTitle>가능 시간 선택</CardTitle>
                <CardDescription>
                  선택한 가능 시간 {selectedSlots.size}개 · 총 {formatDurationMinutes(selectedMinutes)}
                </CardDescription>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {dragMode && (
                  <Badge variant={dragMode === "select" ? "success" : "outline"}>
                    {dragMode === "select" ? "선택 중" : "해제 중"}
                  </Badge>
                )}
                <Button type="button" variant="secondary" size="sm" onClick={selectAllSlots}>
                  전체 선택
                </Button>
                <Button type="button" variant="secondary" size="sm" onClick={clearSelection}>
                  선택 초기화
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="grid min-w-0 gap-5">
            <div className="grid gap-2">
              <input
                id="ics-file"
                type="file"
                accept=".ics,text/calendar"
                disabled={loading || icsLoading}
                className="sr-only"
                onChange={handleIcsUpload}
              />
              <Label
                htmlFor="ics-file"
                className={`flex h-24 cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed bg-background/70 px-4 text-center transition ${
                  isIcsDragging ? "border-primary bg-primary/10" : "border-border"
                }`}
                onDragEnter={() => setIsIcsDragging(true)}
                onDragLeave={() => setIsIcsDragging(false)}
                onDragOver={(event) => {
                  event.preventDefault();
                  setIsIcsDragging(true);
                }}
                onDrop={handleIcsDrop}
              >
                <FileUp className="size-5 text-primary" />
                <span className="text-sm font-medium text-foreground">.ics 파일 Drag & Drop</span>
              </Label>
            </div>

            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-2 rounded-full border border-border bg-secondary/60 px-3 py-1 text-foreground">
                <span className="size-2.5 rounded-sm bg-primary" /> 가능
              </span>
              <span className="inline-flex items-center gap-2 rounded-full border border-border bg-secondary/60 px-3 py-1 text-foreground">
                <span className="size-2.5 rounded-sm bg-destructive/25" /> 바쁨
              </span>
            </div>

            <div
              className="max-h-[70vh] min-w-0 overflow-auto rounded-xl border border-border bg-background/70 touch-none"
              onPointerMove={continueSlotDragFromPointer}
            >
              <table className="w-full min-w-[860px] border-collapse select-none text-xs">
                <thead>
                  <tr>
                    <th className="sticky left-0 top-0 z-30 w-16 border-b border-r border-border bg-card px-3 py-2 text-left font-medium text-muted-foreground">
                      시간
                    </th>
                    {meetingDates.map((date) => (
                      <th
                        key={date}
                        className="sticky top-0 z-20 min-w-24 border-b border-r border-border bg-card px-3 py-2 text-center font-medium text-foreground last:border-r-0"
                      >
                        {formatCompactDateLabel(date)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {timeRows.map((time) => {
                    const isHour = time.endsWith(":00");
                    return (
                      <tr key={time}>
                        <th
                          className={`sticky left-0 z-10 w-16 border-b border-r bg-card px-3 py-1.5 text-left font-mono font-medium ${
                            isHour
                              ? "border-t border-t-border text-foreground"
                              : "border-border text-muted-foreground/70"
                          }`}
                        >
                          {time}
                        </th>
                        {meetingDates.map((date) => {
                          const slot = slotByDateTime.get(`${date}:${time}`);
                          const selected = slot ? selectedSlots.has(slot.key) : false;
                          const icsBusy = slot ? slotOverlapsBlocks(slot, icsBusyBlocks) : false;
                          const stateClass = selected
                            ? "bg-primary/85 hover:bg-primary shadow-[inset_0_0_0_1px_rgba(255,255,255,0.18)]"
                            : icsBusy
                              ? "bg-destructive/15 hover:bg-destructive/25 shadow-[inset_0_0_0_1px_rgba(255,92,92,0.16)]"
                              : "bg-secondary/35 hover:bg-primary/20";

                          return (
                            <td
                              key={`${date}:${time}`}
                              className={`h-6 min-w-24 border-b border-r p-0 last:border-r-0 ${
                                isHour ? "border-t border-t-border" : "border-border"
                              }`}
                            >
                              {slot && (
                                <button
                                  type="button"
                                  data-slot-key={slot.key}
                                  aria-pressed={selected}
                                  aria-label={`${formatDateLabel(date)} ${slot.startTime}-${slot.endTime} 가능한 시간 ${selected ? "선택됨" : "선택 안 됨"}`}
                                  title={icsBusy && !selected ? ".ics에서 바쁜 시간으로 감지됨" : undefined}
                                  className={`h-full w-full cursor-cell transition duration-75 focus-visible:relative focus-visible:z-20 focus-visible:outline-2 focus-visible:outline-ring ${stateClass}`}
                                  onPointerDown={(event) => beginSlotDrag(event, slot.key)}
                                  onPointerEnter={() => continueSlotDrag(slot.key)}
                                />
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}

function ResultsPage({ meetingId }: { meetingId: string }) {
  const [results, setResults] = useState<Results | null>(null);
  const [draft, setDraft] = useState<MessageDraft | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    getResults(meetingId)
      .then(setResults)
      .catch((err) => setError(err instanceof Error ? err.message : "결과를 생성하지 못했습니다."))
      .finally(() => setLoading(false));
  }, [meetingId]);

  const choose = async (candidate: Candidate) => {
    setError("");
    try {
      const data = await selectCandidate(
        meetingId,
        candidate.start,
        candidate.end,
        candidate.reason,
      );
      setDraft(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "후보를 확정하지 못했습니다.");
    }
  };

  const timetableSlots = results?.timetable ?? [];
  const timetableDates = Array.from(new Set(timetableSlots.map((slot) => isoDateKey(slot.start)))).sort();
  const timetableTimes = Array.from(new Set(timetableSlots.map((slot) => isoTimeKey(slot.start)))).sort();
  const resultSlotByDateTime = new Map(
    timetableSlots.map((slot) => [`${isoDateKey(slot.start)}:${isoTimeKey(slot.start)}`, slot]),
  );

  return (
    <div className="min-h-screen bg-background text-foreground">
      <main className="linear-container grid gap-8 py-8 sm:py-10">
        <Card className="surface-edge rounded-xl bg-card">
          <CardHeader className="border-b border-border">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <CardTitle className="font-display text-[clamp(30px,4vw,48px)] font-semibold leading-[1.1] tracking-[-1.4px]">
                  추천 결과
                </CardTitle>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => navigate(`/meetings/${meetingId}`)}
                >
                  입력 화면
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-6">
            {loading && (
              <div className="grid gap-4">
                <Skeleton className="h-24 rounded-xl" />
                <Skeleton className="h-24 rounded-xl" />
                <Skeleton className="h-24 rounded-xl" />
              </div>
            )}
            {error && (
              <Alert variant="destructive">
                <AlertTitle>결과 생성 실패</AlertTitle>
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            {results && (
              <div className="grid gap-6">
                <div className="flex flex-wrap items-center gap-3">
                  <Badge variant="secondary">
                    best {results.best_available_count}/{results.total_participants}
                  </Badge>
                  <span className="text-sm text-muted-foreground">{results.summary}</span>
                </div>
                <div className="grid gap-4 lg:grid-cols-3">
                  {results.candidates.length === 0 ? (
                    <Alert>
                      <AlertTitle>후보 없음</AlertTitle>
                      <AlertDescription>
                        회의 길이를 줄이거나 날짜 범위를 넓혀 다시 시도해보세요.
                      </AlertDescription>
                    </Alert>
                  ) : (
                    results.candidates.map((candidate, index) => (
                      <Card
                        key={`${candidate.start}-${candidate.end}`}
                        className="surface-edge bg-secondary/60"
                      >
                        <CardHeader>
                          <Badge className="w-fit rounded-md">0{index + 1}</Badge>
                          <CardTitle>
                            {formatDateTime(candidate.start)} - {formatTime(candidate.end)}
                          </CardTitle>
                          <CardDescription>{candidate.reason}</CardDescription>
                        </CardHeader>
                        <CardContent className="grid gap-4">
                          <div className="flex flex-wrap gap-2">
                            <Badge variant={candidate.is_full_match ? "success" : "outline"}>
                              {candidate.is_full_match ? "전원 가능" : "대안 후보"}
                            </Badge>
                            <Badge variant="secondary">
                              {candidate.available_count}/{results.total_participants} 가능
                            </Badge>
                          </div>
                          <Button onClick={() => choose(candidate)}>이 시간 확정</Button>
                        </CardContent>
                      </Card>
                    ))
                  )}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {draft && (
          <Card className="surface-edge rounded-xl bg-card">
            <CardHeader>
              <CardTitle>복사용 안내 메시지</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4">
              <Textarea readOnly value={draft.message} className="min-h-40 font-mono text-sm" />
              <Button
                className="w-fit"
                onClick={() => navigator.clipboard.writeText(draft.message)}
              >
                <Copy /> 메시지 복사
              </Button>
            </CardContent>
          </Card>
        )}

        {results && (
          <Card className="surface-edge rounded-xl bg-card">
            <CardHeader>
              <Badge variant="secondary" className="mb-3 w-fit rounded-md">
                <Network className="size-3" /> Timetable
              </Badge>
              <CardTitle>가능 인원 Heatmap</CardTitle>
              <CardDescription>
                참석 가능한 사람이 많을수록 셀이 더 진하게 표시됩니다.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-5">
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-2 rounded-full border border-border bg-secondary/60 px-3 py-1 text-foreground">
                  <span className="size-2.5 rounded-sm bg-primary/30" /> 일부 가능
                </span>
                <span className="inline-flex items-center gap-2 rounded-full border border-border bg-secondary/60 px-3 py-1 text-foreground">
                  <span className="size-2.5 rounded-sm bg-primary/60" /> 대부분 가능
                </span>
                <span className="inline-flex items-center gap-2 rounded-full border border-border bg-secondary/60 px-3 py-1 text-foreground">
                  <span className="size-2.5 rounded-sm bg-primary" /> 전원 가능
                </span>
                <span className="inline-flex items-center gap-2 rounded-full border border-border bg-secondary/60 px-3 py-1 text-foreground">
                  <span className="size-2.5 rounded-sm bg-primary ring-2 ring-foreground/70" /> 추천 후보
                </span>
              </div>

              <div className="max-h-[70vh] min-w-0 overflow-auto rounded-xl border border-border bg-background/70">
                <table className="w-full min-w-[860px] border-collapse text-xs">
                  <thead>
                    <tr>
                      <th className="sticky left-0 top-0 z-30 w-16 border-b border-r border-border bg-card px-3 py-2 text-left font-medium text-muted-foreground">
                        시간
                      </th>
                      {timetableDates.map((date) => (
                        <th
                          key={date}
                          className="sticky top-0 z-20 min-w-24 border-b border-r border-border bg-card px-3 py-2 text-center font-medium text-foreground last:border-r-0"
                        >
                          {formatCompactDateLabel(date)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {timetableTimes.map((time) => {
                      const isHour = time.endsWith(":00");
                      return (
                        <tr key={time}>
                          <th
                            className={`sticky left-0 z-10 w-16 border-b border-r bg-card px-3 py-1.5 text-left font-mono font-medium ${
                              isHour
                                ? "border-t border-t-border text-foreground"
                                : "border-border text-muted-foreground/70"
                            }`}
                          >
                            {time}
                          </th>
                          {timetableDates.map((date) => {
                            const slot = resultSlotByDateTime.get(`${date}:${time}`);
                            const recommended = slot ? slotIsRecommended(slot, results.candidates) : false;
                            const title = slot
                              ? `${formatCompactDateLabel(date)} ${isoTimeKey(slot.start)}-${isoTimeKey(slot.end)} · ${slot.available_count}/${results.total_participants} 가능 · ${slot.available_participants.join(", ") || "없음"}`
                              : `${formatCompactDateLabel(date)} ${time}`;

                            return (
                              <td
                                key={`${date}:${time}`}
                                className={`h-7 min-w-24 border-b border-r p-0 last:border-r-0 ${
                                  isHour ? "border-t border-t-border" : "border-border"
                                }`}
                              >
                                {slot && (
                                  <div
                                    title={title}
                                    aria-label={title}
                                    className={`flex h-full w-full items-center justify-center text-[11px] font-medium transition ${heatmapToneClass(
                                      slot.available_count,
                                      results.total_participants,
                                    )} ${recommended ? "ring-2 ring-inset ring-foreground/70" : ""}`}
                                  >
                                    {slot.available_count}/{results.total_participants}
                                  </div>
                                )}
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        )}
      </main>
    </div>
  );
}

export default function App() {
  const path = useRoute();
  const [theme, setTheme] = useState<ThemeMode>(getInitialTheme);
  const resultsMatch = path.match(/^\/meetings\/([^/]+)\/results$/);
  const meetingMatch = path.match(/^\/meetings\/([^/]+)$/);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.remove("light");
    root.classList.toggle("dark", theme === "dark");
    root.style.removeProperty("color-scheme");
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      // Ignore storage failures; the active class still applies for this session.
    }
  }, [theme]);

  const toggleTheme = () => setTheme((current) => (current === "dark" ? "light" : "dark"));

  let page;
  if (resultsMatch) {
    page = <ResultsPage meetingId={resultsMatch[1]} />;
  } else if (meetingMatch) {
    page = <MeetingPage meetingId={meetingMatch[1]} />;
  } else {
    page = <CreateMeetingPage />;
  }

  return (
    <>
      {page}
      <ThemeFab theme={theme} onToggleTheme={toggleTheme} />
    </>
  );
}
