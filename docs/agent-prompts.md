# SomaMeet 에이전트 팀 위임 프롬프트 로그

> 본 문서는 Claude Code 리더가 4인 에이전트 팀 + 후속 작업에 보낸 프롬프트를 시간순으로 정리한 기록입니다.
> 기준 문서는 `기획서/구현_위임_스펙.md`(왜/무엇)이고, 각 프롬프트는 그 스펙을 어떻게 분배했는지를 보여줍니다.

---

## 팀 구성

| # | 이름 | subagent_type | 영역 | 책임 |
|---|---|---|---|---|
| 1 | backend-core | tdd-guide | `backend/app/services/`, `backend/app/db/`, `backend/app/schemas/`, `backend/tests/` | SQLAlchemy 모델, Pydantic 스키마, Scheduler 계산 엔진, ICS 파서, LLM 어댑터 + S1~S11 테스트 |
| 2 | frontend-ui | general-purpose | `frontend/` 전부 | Vite + React + Tailwind + shadcn 스캐폴딩, 회의 생성/입력/결과 페이지, 두 URL 분리 UX |
| 3 | backend-api | general-purpose | `backend/app/api/`, `backend/app/core/`, `backend/alembic/`, `backend/main.py` | API 라우터 10개, 인증 미들웨어, Alembic, OAuth 콜백 |
| 4 | qa-security | security-reviewer | `tests/` 전반 + 마지막 검토 | Playwright E1, LLM Privacy 가드, 권한 매트릭스 검증, README |

병렬 가능한 작업: backend-core ∥ frontend-ui (Phase 1) → backend-api (Phase 2) → qa-security (Phase 3)

---

## Phase 1A — backend-core

```
You are **backend-core**, one of four teammates building **SomaMeet** MVP — a privacy-preserving meeting scheduler. The leader is orchestrating; do NOT touch other teammates' files.

## Your file ownership (you may CREATE/EDIT only these)
- backend/pyproject.toml
- backend/.env.example
- backend/conftest.py
- backend/app/__init__.py
- backend/app/db/** (models, base, session)
- backend/app/schemas/** (Pydantic)
- backend/app/services/** (scheduler, ICS parser, LLM adapters, google freebusy client, slug/token gen)
- backend/tests/** (unit/integration/acceptance + fixture .ics already placed)

**Forbidden** (other teammates own these): backend/app/api/**, backend/app/core/**, backend/alembic/**, backend/main.py, frontend/**, tests/e2e/**.

## Reference docs (READ FIRST, in this order)
1. 기획서/구현_위임_스펙.md — single source of truth (sections 0–13). Every architectural decision is there.
2. 기획서/구글독스_1차피드백_반영_통합본.md — product context.

## Authoritative decisions (do NOT change)
- Slot unit: **30 minutes** (busy_blocks normalized to 30-min boundaries by floor)
- Timezone: **Asia/Seoul fixed** (all datetimes stored KST). Use zoneinfo.ZoneInfo("Asia/Seoul").
- Access control: **Option A** — slug + organizer_token (URL ?org=...) + participant cookie
- Offline buffer: candidate [start-30min, end+30min] whole range must be free
- `any` location: treat as online (no buffer)
- LLM provider default: **gemini** (gemini-2.5-flash); `template` is fallback
- LLM Privacy: NEVER send event titles/descriptions/locations to LLM. Only slot times, available counts, meeting metadata.
- Last-write-wins on duplicate nickname: replace ALL prior busy_blocks atomically (transaction)

## What to deliver

### 1. backend/pyproject.toml
- Python 3.11+, name = "somameet-backend"
- Dependencies: fastapi, uvicorn[standard], sqlalchemy>=2, alembic, pydantic>=2, pydantic-settings, python-dotenv, python-multipart, icalendar, httpx, google-auth, google-auth-oauthlib, google-api-python-client, google-generativeai, anthropic (optional), openai (optional).
- Dev deps: pytest, pytest-asyncio, httpx, freezegun, ruff.
- Tool config: [tool.pytest.ini_options] testpaths = ["tests"], asyncio_mode = "auto".

### 2. backend/.env.example
Mirror backend/.env (already created by leader) but with empty values. Reference spec section 2.

### 3. backend/app/db/
- base.py — class Base(DeclarativeBase): ...
- session.py — engine + SessionLocal from DATABASE_URL. Provide get_db() generator.
- models.py — Meeting, Participant, BusyBlock per spec section 3 (exact columns, types, constraints, indexes). UNIQUE INDEX (meeting_id, nickname). Index (participant_id, start_at). **Schema must NOT have title/description/location columns on busy_blocks.**

### 4. backend/app/schemas/ (Pydantic v2)
Cover all request/response shapes in spec section 4.1:
- MeetingCreate, MeetingCreateResponse, MeetingDetail
- ParticipantCreate, ParticipantResponse
- ManualAvailabilityInput
- Candidate, CalculateResponse
- ConfirmRequest, ConfirmResponse
- TimetableSlot, TimetableResponse (per S10: start, end, available_count, available_nicknames)
- ErrorResponse {error_code, message, suggestion}
- All datetime fields ISO 8601 with KST offset.

### 5. backend/app/services/
- tokens.py — generate_slug() (8-char base62), generate_organizer_token(), generate_participant_token() (urlsafe, 32+ chars).
- ics_parser.py — uses icalendar. Returns list of (start_at, end_at) KST-normalized to 30-min boundaries. Raises ICSParseError. **Strips title/description/location.**
- availability.py — helpers: normalize busy blocks, merge overlapping, replace_busy_blocks_for_participant(db, participant_id, blocks) atomic.
- scheduler.py — pure deterministic engine. Function signature exactly per spec 6.1. Implements: enumerate slots, intersect free, apply offline buffer if location_type == "offline", find runs of length duration_minutes, rank by (available_count desc, time-spread vs prior chosen ≥2h, earlier date). If no candidate: try fallback removing 1 missing participant. Add Timetable builder.
- google_freebusy.py — OAuth flow helpers (build_oauth_url with scope calendar.freebusy ONLY, exchange_code, fetch_freebusy(start, end)).
- llm/__init__.py — get_llm_adapter() factory per spec 7.1.
- llm/base.py — abstract LLMAdapter.
- llm/template.py — deterministic strings. Privacy-safe.
- llm/gemini.py — uses google.generativeai. NEVER includes raw busy_block content.
- llm/anthropic.py and llm/openai.py — minimal stubs.

**LLM prompt rule:** When constructing prompts, build a dict {title, location_type, duration_minutes, candidates: [{start_iso, end_iso, available_count, missing}]} and JSON-stringify it. Never iterate raw busy_blocks into prompts.

### 6. Tests — write FIRST per TDD

Use FastAPI TestClient against the app exposed by backend.main:app. The app doesn't exist yet; that's fine — the import will fail, S1-S11 will RED, that's TDD.

#### tests/unit/
- test_scheduler.py — exhaustive unit tests for calculate_candidates covering S2 buffer, ranking, fallback, suggestion, KST handling, weekend toggle, time window.
- test_ics_parser.py — happy path on sample_busy_weekdays.ics, sample_busy_evenings.ics, sample_empty.ics. Error path on invalid_empty.ics, invalid_corrupt.ics. Asserts no title/description leakage.
- test_tokens.py — slug 8 chars base62 alphabet, tokens ≥32 chars urlsafe, no collisions in 1k iterations.
- test_llm_template.py — privacy: feed candidates with imaginary "병원 진료" busy_block context, assert template output never contains "병원"/"진료"/"데이트".
- test_availability.py — 30-min normalization, overlap merge, replace_busy_blocks transaction.

#### tests/integration/
- test_meeting_flow.py — POST /api/meetings → GET /api/meetings/{slug} → POST participants → manual availability → calculate → confirm.
- test_oauth_url.py — assert scope contains ONLY calendar.freebusy.

#### tests/acceptance/test_acceptance_S1_S11.py
ONE file with 11 test functions, exactly named test_S1_happy_path, test_S2_offline_buffer, ..., test_S11_llm_privacy.

### 7. backend/conftest.py
- Loads backend/.env for tests (override LLM_PROVIDER=template).
- client fixture: TestClient(app) with a clean DB per test.

## Coordination contract with backend-api
- They will create backend/app/main.py that imports your services and creates the FastAPI app.
- They will run Alembic against your backend/app/db/models.py. Make sure model metadata is importable as app.db.base.Base.metadata.

## Process
1. Read spec sections 0–13 completely.
2. Write pyproject.toml and install.
3. Write all model files.
4. Write all schema files.
5. Write all test files (RED).
6. Implement services until unit + integration tests pass. Acceptance tests will stay RED until backend-api lands.
7. Run pytest tests/unit tests/integration -v and ensure GREEN.
8. Report back: list of files created, unit/integration test pass count, any open questions for the leader.

**No emojis in code or comments.** **Many small files preferred.** Use immutable patterns (dataclasses with frozen=True for value objects).
```

**결과:** 51 unit + 4 integration PASS. 11 acceptance + 4 integration SKIP (backend-api 의존). 코디네이션 계약 문서화 완료.

---

## Phase 1B — frontend-ui (병렬)

```
You are **frontend-ui**, one of four teammates building **SomaMeet** MVP. The leader orchestrates; do NOT touch other teammates' files.

## Your file ownership (CREATE/EDIT only these)
- Everything under frontend/

**Forbidden**: anything outside frontend/. Backend folks own all of backend/.

## Reference docs (READ FIRST)
1. 기획서/구현_위임_스펙.md — sections 1, 2, 4 (API), 5 (access control / two-URL UX), 9 (E1 scenario), 10 (stack defaults).
2. 기획서/구글독스_1차피드백_반영_통합본.md — product context.

## Authoritative decisions (do NOT change)
- Stack: **Vite + React 18 + TypeScript + Tailwind + shadcn/ui + React Router v6 + react-hook-form + zod + fetch**
- Package manager: **pnpm**
- API base: VITE_API_BASE_URL=http://localhost:8000. Vite dev proxy: /api → http://localhost:8000.
- Two-URL access control (Option A):
  - /m/:slug?org=<organizer_token> → organizer view: shows confirm button
  - /m/:slug → participant view: NO confirm button
- Timezone display: **Asia/Seoul** for all dates.
- No emojis anywhere.

## What to deliver

### 1. Scaffold
- frontend/package.json with pnpm scripts: dev, build, preview, lint, test:e2e.
- frontend/vite.config.ts with React plugin + /api proxy to http://localhost:8000.
- frontend/tsconfig.json (strict mode).
- frontend/tailwind.config.ts, frontend/postcss.config.js.
- frontend/index.html with <title>SomaMeet</title>.
- shadcn primitives inline copies (button, input, card, dialog, label, select, checkbox, toast, tabs).

### 2. Routing
- src/App.tsx with routes: / → CreateMeetingPage, /m/:slug → MeetingPage, * → 404

### 3. Pages

#### CreateMeetingPage
Form (react-hook-form + zod): title, date_range_start/end, duration_minutes (30/60/90/120), participant_count, location_type, time_window_start/end, include_weekends. Submit → POST /api/meetings → show TWO copyable URL boxes labeled exactly:
[내 관리용 링크 — 공유 금지]   {organizer_url}    [복사]
[팀원에게 공유할 링크]          {share_url}        [복사]

#### MeetingPage — single page with tabbed sections, role-aware
Loads GET /api/meetings/:slug. Detects org query param → isOrganizer = true.
1. Meeting summary (always visible)
2. Join as participant (visible if no cookie)
3. Submit availability (Manual | ICS Upload | Google Calendar tabs)
4. Timetable + candidates (visible after participants exist)
5. Confirm slot (organizer ONLY): X-Organizer-Token header from ?org= param

If isOrganizer === false, the confirm buttons must NOT render.

### 4. API client
- src/lib/api.ts — typed fetch wrapper. Throws on non-2xx with error_code + message.
- src/lib/types.ts — TS types matching backend Pydantic schemas.

### 5. Components
- src/components/ui/* — shadcn primitives.
- src/components/CopyableUrl.tsx, Timetable.tsx, CandidateList.tsx, ShareMessageDialog.tsx

## Process
1. Read spec sections listed above.
2. cd frontend && pnpm init, install deps.
3. Initialize Tailwind: pnpm tailwindcss init -p.
4. Build all pages and components.
5. Run pnpm build to verify TS compiles.
6. Report back.

**No emojis. Many small files. Immutable patterns. No backend code.**
```

**결과:** pnpm build PASS, 76 modules. Dev server boot OK. 모든 페이지 + UI 프리미티브 + API 클라이언트 완성.

---

## Phase 2 — backend-api

```
You are **backend-api**, one of four teammates building **SomaMeet** MVP. backend-core already finished services/models/schemas + tests. frontend-ui finished. Your job is to wire the FastAPI app.

## Your file ownership (CREATE/EDIT only these)
- backend/app/api/**
- backend/app/core/**
- backend/app/main.py
- backend/alembic.ini
- backend/alembic/**

**Forbidden**: app/db/**, app/schemas/**, app/services/**, tests/**, frontend/**, root pyproject.toml, root conftest.py, root .env*.

## backend-core coordination contract (binding)
- App import path: tests import from app.main import app.
- Models metadata: app.db.base.Base.metadata.
- Engine cache: tests call app.db.session.reset_engine() between tests. Use app.db.session.get_engine() and Depends(get_db) everywhere.
- Manual availability input: {"busy_blocks": [{"start": iso, "end": iso}, ...]}.
- Confirm endpoint header: X-Organizer-Token. Mismatch → 403.
- Participant cookie: name somameet_pt_{slug}, value = participant.token, httponly=True, samesite="lax".
- ICS upload: multipart `file`. Parse failure → 400 {error_code: "ics_parse_failed", ...}.
- OAuth URL endpoint: returns {url} 200 OR 503 when keys missing. Scope MUST be calendar.freebusy ONLY.
- Timetable: {slots: [{start, end, available_count, available_nicknames: []}]}.
- Calculate: {candidates: [...], suggestion: null|str} — empty + suggestion is HTTP 200, not 4xx.
- Confirm response: {confirmed_slot: {start, end}, share_message_draft: str}.

## What to deliver

### 1. backend/app/core/
- config.py — pydantic_settings.BaseSettings reading from backend/.env.
- dependencies.py — get_db, get_current_meeting (404), require_organizer (403), get_participant (403), cookie_name_for(slug).
- errors.py — exception → JSON converter. Always {error_code, message, suggestion}.

### 2. backend/app/main.py
- Create app = FastAPI(title="SomaMeet API", version="0.1.0").
- CORS for APP_BASE_URL with credentials=True.
- Include all 5 routers.
- Health endpoint GET /api/health → {"ok": true}.

### 3. backend/app/api/
- meetings.py, participants.py, availability.py, oauth.py, timetable.py — 각 라우터 1파일.

### 4. Endpoint behaviors (binding)
[10개 엔드포인트별 상세 명세 — 본문에서 생략]

### 5. Alembic
- alembic.ini at backend/alembic.ini.
- alembic/env.py imports from app.db.base import Base; target_metadata = Base.metadata.
- 초기 마이그레이션은 정확히 3 테이블 (meetings, participants, busy_blocks) 생성, no extra title/description/location columns.

### 6. Process
1. Read spec sections 4, 5, 7, 9.
2. Read backend-core's deliverables.
3. Write core/config.py, dependencies.py, errors.py.
4. Write all routers.
5. Write app/main.py.
6. Initialize Alembic and generate migration.
7. Run FULL test suite. Goal: all S1–S11 PASS.
8. Boot the app: uvicorn app.main:app --reload --port 8000.
9. Report back.
```

**결과:** 70/70 PASS (acceptance 12, integration 7, unit 51). Live boot 검증, alembic 초기 마이그레이션 정확히 3 테이블 생성.

---

## Phase 3 — qa-security

```
You are **qa-security**, the final teammate on the **SomaMeet** MVP. backend-core, backend-api, frontend-ui all finished. Your job is final verification + Playwright E1 + privacy/permission audit + README.

## Your file ownership (CREATE/EDIT only these)
- tests/e2e/**
- frontend/playwright.config.ts
- frontend/tests/e2e/**
- README.md (root README)
- frontend/package.json (test:e2e 스크립트만)

**Forbidden**: backend code, frontend pages/components/lib, services, schemas, models, app/main.py, alembic/.

## Status of the project
- Backend: 70/70 tests PASS including S1-S11 acceptance.
- Frontend: pnpm build PASS, dev server boots.
- LLM_PROVIDER=gemini in backend/.env with real key.
- Real Google OAuth client ID/secret in backend/.env.

## What to deliver

### 1. Playwright E1 test
- pnpm add -D @playwright/test && pnpm exec playwright install chromium
- frontend/playwright.config.ts with webServer (backend uvicorn + frontend pnpm dev), globalSetup runs alembic upgrade head against e2e.db.
- frontend/tests/e2e/golden-path.spec.ts: implements E1 verbatim per spec section 9.
  1. Open /, fill form, submit.
  2. Assert TWO URL boxes.
  3. Open share_url in new context. Assert NO confirm button.
  4. Three participants register + manual input.
  5. Organizer calculate → ≥1 candidate.
  6. Confirm first → modal with share_message_draft → copy button.

### 2. Real Gemini verification
Write tests/e2e/scripts/verify_gemini_live.py:
- Loads backend/.env.
- Asserts LLM_PROVIDER=gemini, GEMINI_API_KEY set.
- Calls get_llm_adapter().generate_share_message(...) and generate_recommendation_reasons(...).
- Greps outputs for 병원|진료|데이트|secret — must be absent.

### 3. Privacy & permission audit (READ ONLY — patch only via report)
- BusyBlock model: no summary/description/location columns.
- ICS parser: SUMMARY/DESCRIPTION/LOCATION not extracted.
- LLM adapters: prompts only carry {title, location_type, duration_minutes, candidates: {...}}.
- Permissions: confirm requires X-Organizer-Token, availability/* requires cookie, timetable/calculate/get-meeting public.
- OAuth scope: calendar.freebusy 단독.
- Secrets hygiene: backend/.env gitignored, no hardcoded keys in source.

### 4. README.md
4-5 line "Quick start (local dev)" 섹션 추가:
- Backend install + alembic + uvicorn
- Frontend pnpm install + pnpm dev
- Tests: pytest + pnpm test:e2e
- Env: copy .env.example to .env

### 5. Process
1. Read spec sections 5, 7, 9, 12.
2. Skim backend files.
3. Set up Playwright. Write E1 spec. Run it. Iterate until green.
4. Run privacy + permission audit.
5. Run live Gemini verification.
6. Append README quick start section.
7. Final report.

**No emojis. No backend/frontend source patches. If you spot a bug, REPORT — don't fix.**
```

**결과:** E1 PASS (5.5s), Gemini live PASS, privacy/permission audit no findings. smoke_permissions.py로 10/10 권한 케이스 검증.

---

# 후속 위임 (사용자 피드백 반영)

## ManualAvailabilityForm → When2Meet 드래그 그리드 (frontend-ui-2)

```
사용자가 직접 입력 UX를 When2Meet 스타일 드래그 그리드로 변경하기로 했습니다. 의미는 "A안 — When2Meet 그대로": 기본값 전 슬롯 불가능(회색), 드래그하면 가능(녹색)으로 페인팅. 제출 시 (time_window × date_range)에서 페인팅된 가능 부분을 빼서 busy_blocks로 변환해서 보냅니다.

## 변경 범위 (당신의 ownership 안)
- NEW: frontend/src/components/AvailabilityGrid.tsx — 순수 그리드 컴포넌트
- EDIT: frontend/src/pages/meeting/ManualAvailabilityForm.tsx — 기존 row 입력 제거하고 그리드 + 제출 버튼

## AvailabilityGrid 명세
**Props**: meeting: MeetingDetail, value: Set<string>, onChange: (next: Set<string>) => void
cell key 포맷: "YYYY-MM-DD|HH:MM" (시작 시각만, 30분 길이 고정)

**그리드 렌더링**
- 행: time_window_start..end 30분 간격
- 열: date_range의 모든 날짜 (include_weekends false면 토/일 제외)
- 좌측 첫 컬럼: 시각 라벨, 매시 정각만 굵게
- 상단 첫 행: 날짜 라벨 (5/12 (화) KST)
- 셀 크기: 너비 56px / 높이 24px
- 색상: 미선택 bg-slate-200, 선택 bg-emerald-500

**드래그 동작 (When2Meet 그대로)**
- onMouseDown: 셀의 새 상태로 paint mode 진입 (selecting/deselecting)
- onMouseEnter while painting: 같은 paint state 적용
- 전역 onMouseUp: paint mode 종료
- document.body.style.userSelect = 'none' during paint

**테스트 후크**: data-testid={`slot-${dateIso}-${time}`}, data-slot-key={`${dateIso}|${time}`}, aria-pressed={selected}. 그리드: data-testid="availability-grid"

## ManualAvailabilityForm 변경
- selected: Set<string> 상태 관리
- 안내 + AvailabilityGrid + 제출 버튼 (data-testid="manual-submit")
- 제출 시 inversion 로직: busy_blocks = (time_window × dates) - selected, 같은 날짜 연속 셀 병합
- 빈 선택 → 토스트 "가능한 시간을 1개 이상 선택하세요"
- 전체 선택 → busy_blocks: [] (정상 제출)
- API 호출은 기존 api.submitManualAvailability(slug, busy_blocks) 그대로

## 빌드/검증
1. 위 두 파일 작성/수정
2. pnpm build → TS 통과
3. 가능하면 pnpm dev 잠깐 띄워서 그리드 렌더링 시각 확인
4. 보고: 변경 파일, 빌드 상태, 그리드 레이아웃, qa-security가 쓸 셀렉터

**금지**: 다른 팀원 영역 수정 금지. backend API 시그니처 변경 금지.
```

**결과:** AvailabilityGrid + availabilityCells 유틸 + ManualAvailabilityForm 교체. 빌드 + dev 부팅 OK. data-testid 일관됨.

---

## Playwright E1 그리드 셀렉터 업데이트 (qa-security-2)

```
SomaMeet MVP. The participant manual-input UI was just changed from a row-based form to a When2Meet-style drag-paint grid. The Playwright E1 test at frontend/tests/e2e/golden-path.spec.ts needs ONE section updated to match.

## What changed in the UI
- 그리드 컨테이너: [data-testid="availability-grid"]
- 각 셀: [data-testid="slot-{YYYY-MM-DD}-{HH:MM}"] AND [data-slot-key="{YYYY-MM-DD}|{HH:MM}"]
- 셀 aria-pressed="true" when selected
- 제출 버튼: [data-testid="manual-submit"]
- 헬퍼 버튼: "전체 가능", "전체 초기화"
- 빈 선택 → 토스트 후 차단

## 새 헬퍼 시그니처
async function registerAndSubmit(nickname: string, deselectKeys: string[] = []): Promise<void>

deselectKeys는 "YYYY-MM-DD|HH:MM" 포맷. 전체 가능 클릭 후 각 키의 [data-slot-key="..."] 클릭으로 deselect (= busy 표시).

## 호출 사이트 변경
참여자A: [`${startDate}|09:00`, `${startDate}|09:30`] (월요일 9-10시 busy 동등)
참여자B/C: [] (전체 가능)

## 헬퍼 내부 manual 블록 교체
기존 input[id^="date-"], input[id^="start-"], input[id^="end-"] 제거.
새로:
await expect(p.locator('[data-testid="availability-grid"]')).toBeVisible({ timeout: 10_000 })
await p.getByRole("button", { name: "전체 가능" }).click()
for (const key of deselectKeys) {
  await p.locator(`[data-slot-key="${key}"]`).click()
}

다른 부분(meeting creation form, two-URL assertions, incognito participant, calculate, confirm, share-message modal, copy button, privacy regex)은 모두 그대로.

## Process
1. 현재 golden-path.spec.ts 다시 읽기
2. 헬퍼 변경 적용
3. cd frontend && pnpm test:e2e (auto-boots backend + frontend)
4. 실패 시 셀렉터 미스매치는 테스트 수정, 프론트엔드 버그면 STOP + REPORT.
5. green까지 재실행
6. 보고: 최종 status, 변경 셀렉터, flakiness 관찰
```

**결과:** 첫 시도 PASS (5.9s). 헬퍼 시그니처 + 3 호출 사이트만 변경, 다른 부분 그대로.

---

## 타임라인 + 슬롯 그리드 모드 토글 (frontend-ui-3)

```
SomaMeet MVP frontend. The participant manual-input UI is currently a When2Meet-style 30-min cell grid. User feedback: **"너무 엑셀같다"** — the rigid grid borders + uniform tiny cells feel like a spreadsheet.

User wants TWO display modes for the same input, with a toggle:
- **Mode A — Timeline bars** (default): one horizontal bar per day, drag on the bar to create rounded green time-range blocks. Click a block to delete it.
- **Mode B — Chip grid** (alternative): same 30-min granularity, but cells rendered as rounded pills with breathing room (gap, no borders).

Both modes operate on the SAME underlying state (Set<string> of cell keys). Toggling preserves selection. Mode preference persists in localStorage.

## Your file ownership
- NEW: frontend/src/components/AvailabilityTimeline.tsx (Mode A)
- EDIT: frontend/src/components/AvailabilityGrid.tsx (chip restyle for Mode B)
- EDIT: frontend/src/pages/meeting/ManualAvailabilityForm.tsx (mode toggle + render selected mode)
- EDIT: frontend/tests/e2e/golden-path.spec.ts (switch to chip mode at start of manual-input section)

May add helpers to frontend/src/lib/availabilityCells.ts (range↔keys conversion).

## Mode A — AvailabilityTimeline.tsx

### Visual
- 날짜별 카드 (rounded-xl bg-white shadow-sm border border-slate-200 p-4)
- 날짜 라벨 (5/12 큰 글씨 + 화 작은 글씨, 두 줄)
- 시각 라벨 (09 10 11 ... 22) 위에 48px 슬레이트 바
- 선택 범위: 둥근 emerald-500 블록 (36px height, ring + shadow)

### Interaction
- pointer-down on empty bar → drag to grow preview block
- pointer-up → snap to 30-min, commit
- Click existing block → delete
- Touch support via Pointer Events + elementFromPoint

### State conversion
- 내부: {startMin, endMin} ranges
- commit 시: range → cell keys (30-min slots)
- 렌더 시: cell keys → ranges (consecutive 30-min folded)

## Mode B — AvailabilityGrid.tsx (restyle)
- border-t 제거, gap-1으로 변경
- 셀: rounded-md, 선택 bg-emerald-500 + ring + shadow, 미선택 bg-white + border-slate-200
- 컨테이너: rounded-xl bg-slate-50 p-2
- 정각 행: mt-1 호흡 공간

## ManualAvailabilityForm — mode toggle
- Segmented control: "타임라인" | "슬롯 그리드"
- localStorage: somameet_manual_mode (default "timeline")
- 헬퍼 버튼/제출 버튼은 mode 외부 (양쪽에서 동작)
- data-testid: mode-toggle-timeline, mode-toggle-grid, manual-form, manual-submit (유지)

## Playwright update
헬퍼에서 "직접 입력" 탭 클릭 직후, "전체 가능" 누르기 전에:
await p.locator('[data-testid="mode-toggle-grid"]').click()
await expect(p.locator('[data-testid="availability-grid"]')).toBeVisible(...)

## Process
1. 기존 파일 읽기
2. AvailabilityTimeline 구현
3. AvailabilityGrid 리스타일 (셀렉터 보존)
4. ManualAvailabilityForm + localStorage
5. Playwright 헬퍼 업데이트
6. pnpm build → TS 통과
7. pnpm test:e2e → E1 PASS
8. pnpm dev 잠깐 띄워서 두 모드 시각 확인

## Constraints
- No emojis. Korean copy.
- Immutable Set updates.
- localStorage key: somameet_manual_mode. default: "timeline".
- backend API 무변경.
```

**결과:** AvailabilityTimeline (NEW) + AvailabilityGrid 리스타일 + ManualAvailabilityForm 토글. localStorage 영속. Pointer Events + ResizeObserver. Build + E2E PASS.

---

## Timetable 슬롯 그리드 스타일로 통일 (frontend-ui-4)

```
SomaMeet MVP frontend. The participant manual-input "슬롯 그리드" mode (Mode B chip grid) was just polished — rounded pills, gap-1 spacing, no borders. User now wants the **Timetable** (read-only heatmap) to use the SAME slot-grid visual style.

## Your task
Restyle frontend/src/components/Timetable.tsx to match the chip-grid look. Currently a <table> with horizontal day-rows + slot-cells, blue intensity classes. Make it visually consistent with the input grid.

## Your file ownership
- frontend/src/components/Timetable.tsx
- (optionally) frontend/src/lib/availabilityCells.ts

**Forbidden**: 다른 파일 일체. Timetable 컴포넌트의 props 시그니처도 그대로.

## Design — match chip grid

### Layout
- CSS grid (not <table>)
- Rows = 30-min times, columns = dates (입력 그리드와 같은 방향, 현재 transposed 상태)
- 컨테이너: rounded-xl bg-slate-50 p-2 (입력 그리드와 동일)
- gridTemplateColumns: 64px repeat(N, minmax(56px, 1fr))
- gap-1 between cells, no borders, rounded-md cells, 24px h

### Colors (heatmap, emerald scale)
- 0 → bg-white border border-slate-200
- 0 < r < 0.34 → bg-emerald-100
- 0.34 ≤ r < 0.67 → bg-emerald-200
- 0.67 ≤ r < 1.0 → bg-emerald-400 text-white
- r == 1.0 → bg-emerald-600 text-white shadow-sm ring-1 ring-emerald-700/30

### Hover (preserve)
title 툴팁: "{start} - {end}\n가능 N명\n참여자: A, B, C"

### Footer hint update
"셀의 색이 진할수록 더 많은 참여자가 가능한 시간입니다. 마우스를 올리면 닉네임이 표시됩니다."

## Implementation
- dates: sorted unique date keys
- times: sorted unique HH:MM
- slotByKey: Map<string, TimetableSlot> for ${date}|${time} lookup
- 누락된 (date, time) 페어는 비어있는 placeholder 셀로 렌더 (그리드 직사각형 유지)

## Verification
1. pnpm build → TS pass
2. pnpm test:e2e → E1 still PASS
3. Briefly pnpm dev to confirm no runtime errors
4. Report: file changes, build/E2E status, color samples
```

**결과:** <table> → CSS Grid 변환. 입력 그리드와 동일한 외관. 색상 스케일 emerald 단일 톤. Build + E2E PASS, 5.9s.

---

# 운영 회고

## 잘 작동한 패턴
1. **파일 ownership 격리** — 4명이 동시 진행해도 충돌 없음 (backend-core/api는 코디네이션 계약 문서로 인터페이스 합의)
2. **위임 스펙 문서 우선** — 기획서/구현_위임_스펙.md를 매 프롬프트 첫 줄에 박아서 결정사항 다툼 0건
3. **TDD 강제** — backend-core가 test 먼저 작성, backend-api는 기존 test 통과시키는 방식으로 인수 기준 자동 검증
4. **Playwright webServer 자동 부팅** — globalSetup에서 alembic upgrade head, globalTeardown에서 e2e.db 삭제 → CI-ready

## 개선 여지
1. 첫 phase에서 backend-core 단독으로 acceptance 테스트까지 작성하니 backend-api 작업 후 SKIP→PASS 전환만 보였음. test가 backend-core 단독 영역이라 backend-api가 만든 라우터 형태에 100% 의존. 차후엔 contract test를 별도 합의 산출물로 빼는 게 깔끔할 듯.
2. Python 3.11 요구를 명시했지만 로컬은 3.9였음. 코드는 3.9 호환이라 통과했지만 환경 정합성 검증은 따로 필요.
3. 후속 UX 변경(타임라인/그리드 토글)은 위임 스펙에 없던 사용자 즉흥 요청이라 매번 새 프롬프트를 길게 작성. 다음엔 "UI 변형 위임 양식"을 미리 만들어두면 빠를 듯.

## 비용/시간
- Phase 1A (backend-core): 약 11분
- Phase 1B (frontend-ui): 약 10분 (병렬)
- Phase 2 (backend-api): 약 10분
- Phase 3 (qa-security): 약 19분
- 후속 4건: 각 3-10분

총 wall clock ~1시간으로 70 unit/integration/acceptance + E1 + privacy audit 완료.

---

# v3 통합 작업 (2026-05-06) — Sanggeun base + Joonggon FE/Upstage 흡수

> 본 섹션은 회의 방향 문서(`회의록/2026-05-06_3차_오프라인_회의_데모분석_및_회의방향.md`) 결정과 spec v3(`기획서/구현_위임_스펙.md` 977→1051줄)에 따라 5개 데모 중 Sanggeun + Joonggon 두 데모만 통합하는 작업의 위임 프롬프트.
>
> Phase 1A~3에서 만들어진 결과물(현재 `somameet/` = Sanggeun 코드)이 v3 spec과 어긋나는 항목을 메꾼다.

## 팀 구성

| # | 이름 | subagent_type | 영역 | 책임 |
|---|---|---|---|---|
| 1 | backend-merger | tdd-guide | `backend/` 전반 | DB 컬럼 6개 추가, `/recommend` 신규, `/calculate` 분리, Upstage adapter, 가변 buffer, picked 모드, PIN, S2/S12~S15 acceptance |
| 2 | frontend-merger | general-purpose | `frontend/` 전반 | Joonggon shadcn 16개 이식, QR, 캘린더 양 모드, 가로 timetable, segmented 위치, buffer select, PIN UI, "추천받기" 분리 버튼 |
| 3 | qa-cleanup | security-reviewer | OAuth 제거 + tests + README | OAuth 흔적 일소, S1/S1b/S11 갱신, E1 Playwright, README v3, privacy spy |

**병렬성:**
- backend-merger ∥ frontend-merger 동시 진행 (API 계약은 spec §5에 잠겨 있어 프론트는 mock으로 시작)
- qa-cleanup은 backend-merger가 끝난 뒤 — 그래야 Upstage adapter/S2 가변 buffer 테스트가 의미 있음

**API 계약 잠금:** 위 둘이 시작 전에 모두 spec v3 §5 + §5.2 에러 카탈로그 한 번 읽고 잠금. spec과 다른 응답 만들면 즉시 PR 코멘트로 질문.

---

## v3-A — backend-merger

```
You are **backend-merger**, integrating Joonggon's Upstage LLM pattern + 7 product decisions (Q5~Q9) into the Sanggeun backend base. The base lives in `backend/`. The leader (박세종) is orchestrating; do NOT touch other teammates' files.

## Your file ownership (you may CREATE/EDIT only these)
- backend/pyproject.toml (add `openai>=1.57`)
- backend/.env.example
- backend/alembic/versions/<new>_v3_columns.py (NEW migration)
- backend/app/db/models/meeting.py (add columns)
- backend/app/db/models/participant.py (add `pin` column)
- backend/app/schemas/meeting.py, participant.py, candidate.py, manual.py, confirm.py (Pydantic v2 changes)
- backend/app/schemas/recommendation.py (NEW)
- backend/app/services/scheduler.py (variable buffer + picked mode + `enumerate_search_dates` + `deterministic_top_candidates`)
- backend/app/services/llm/__init__.py (factory: keep upstage + template only)
- backend/app/services/llm/base.py (add `recommend()` abstract)
- backend/app/services/llm/upstage.py (NEW)
- backend/app/services/llm/template.py (rewrite — single `recommend()` returning summary+candidates+share_message_draft)
- backend/app/services/llm/prompts.py (NEW)
- backend/app/api/meetings.py (date_mode/buffer/3-state location, GET response with submitted/target/share_url, calculate split, confirm body share_message_draft)
- backend/app/api/participants.py (PIN optional)
- backend/app/api/recommend.py (NEW endpoint)
- backend/app/api/auth.py (NEW — POST /participants/login)
- backend/app/core/errors.py (add new error_codes per spec §5.2)
- backend/app/core/dependencies.py (CORS + cookie config per spec §6.1-6.2)
- backend/app/main.py (mount new routers)
- backend/tests/unit/test_scheduler_v3.py (NEW — variable buffer, picked mode, `any` buffer)
- backend/tests/unit/test_llm_upstage.py (NEW — privacy payload spy)
- backend/tests/integration/test_recommend.py (NEW — call count, fallback)
- backend/tests/acceptance/test_v3_scenarios.py (NEW — S1b, S2, S12, S13, S14, S15)

**Forbidden** (others own these): frontend/**, README.md, removing OAuth files (qa-cleanup), modifying existing acceptance tests S1/S3-S8/S10/S11 (qa-cleanup will update them).

## Reference docs (READ FIRST, IN THIS ORDER)
1. `기획서/구현_위임_스펙.md` v3 — single source of truth. **Especially §4 (DB), §5 (API + 5.2 error catalog), §6.1-6.2 (CORS/cookie), §7 (algorithm), §8 (LLM, 8.1 adapter, 8.2 recommend flow), §10 (acceptance), §14 (decisions Q5-Q9).**
2. `회의록/2026-05-06_3차_오프라인_회의_데모분석_및_회의방향.md` — context.
3. `demos/SomaMeet_Joonggon/backend/app/llm_recommender.py`, `prompts.py`, `scheduling_validator.py` — Upstage integration reference (DO NOT copy verbatim — reimplement in our adapter pattern).
4. `demos/SomaMeet_Sanggeun/backend/app/services/scheduler.py` — current scheduler shape.

## Authoritative decisions (do NOT change)
- Slot unit: 30 min (busy_blocks normalized to 30-min boundaries by floor)
- Timezone: Asia/Seoul (zoneinfo.ZoneInfo("Asia/Seoul"))
- LLM provider default: `upstage`; `template` for missing key
- LLM adapter signature: SINGLE `recommend()` method returning `{"summary", "candidates": [{start, end, reason, share_message_draft}, ...]}` — DO NOT split into select_candidates + generate_share_message
- LLM call budget: max 4 per `/recommend` (1 + 3 retries on validation failure). Network errors → immediate fallback (no retry).
- `any` location: applies offline buffer (Q8 v3 — changed from v2)
- PIN: PLAIN TEXT in `participants.pin VARCHAR(8)`, NULLABLE. NO bcrypt. README will warn.
- date_mode: `range` uses `date_range_start/end`, `picked` uses `candidate_dates JSON list`. Mutually exclusive (DB + Pydantic validator both enforce).
- confirm body MUST include `share_message_draft` from recommend response. Backend stores verbatim. NO LLM call in confirm.
- Error format: `{error_code, message, suggestion?, ...flat_extra}`. Use codes from §5.2 ONLY.

## What to deliver

### 1. Alembic migration
- One new revision file `<rev>_v3_columns.py` upgrading from current head:
  - `meetings`: ADD `date_mode VARCHAR(8) NOT NULL DEFAULT 'range'`, `candidate_dates JSON NULL`, `offline_buffer_minutes INTEGER NOT NULL DEFAULT 30`, `confirmed_share_message TEXT NULL`. ALTER `date_range_start`, `date_range_end` to NULLABLE.
  - `participants`: ADD `pin VARCHAR(8) NULL`. CHECK existing `source_type` rows for `'google'` and migrate to `'manual'` (then no need to alter enum if not strictly enforced at DB level).
- `downgrade()` reverses all of the above.

### 2. Pydantic schemas
- `MeetingCreate` accepts `date_mode`, `candidate_dates`, `offline_buffer_minutes`. Validator: `date_mode == 'range'` → start/end required, dates None; `date_mode == 'picked'` → dates required len ≥ 1, start/end None.
- `MeetingDetail` adds `target_count`, `submitted_count`, `is_ready_to_calculate`, `share_url`, `confirmed_share_message`.
- `ParticipantCreate { nickname, pin?: str (4-digit numeric) }`.
- `ParticipantLogin { nickname, pin }`.
- `RecommendResponse { summary, candidates: [Candidate+share_message_draft], source: "llm"|"deterministic_fallback", llm_call_count }`.
- `ConfirmRequest { slot_start, slot_end, share_message_draft }`.

### 3. Scheduler upgrades (`scheduler.py`)
- `enumerate_search_dates(meeting) -> list[date]` per §7.
- `generate_candidate_windows(meeting, busy_by_pid)` uses meeting.offline_buffer_minutes; for `any`, applies buffer; for `online`, buffer=0.
- `deterministic_top_candidates(windows, max_candidates=3)` for both calculate and fallback. Ranking per §7 table.
- `validate_and_enrich(llm_candidates, windows, meeting) -> list[Candidate]` raises `CandidateValidationError` if any LLM start/end is not in windows OR available_count mismatched.
- All datetimes Asia/Seoul aware.

### 4. LLM adapter
- `base.LLMAdapter.recommend()` per spec §8.1.
- `upstage.UpstageAdapter` using `from openai import OpenAI` with `base_url=os.environ["UPSTAGE_BASE_URL"]`. Reads UPSTAGE_API_KEY/MODEL/TIMEOUT_SECONDS. JSON parse response.
- `template.TemplateAdapter.recommend()` returns deterministic strings including a fabricated share_message_draft per candidate.
- `prompts.py` SYSTEM_PROMPT_RECOMMEND verbatim from spec §8.1 (Korean).
- Factory `__init__.get_llm_adapter()` supports only `upstage` and `template`. Remove gemini/anthropic/openai branches.

### 5. API endpoints
- `POST /api/meetings`: accepts new fields, returns 201 with `slug, organizer_token, organizer_url, share_url`.
- `GET /api/meetings/{slug}`: includes target_count/submitted_count/is_ready_to_calculate/share_url. 404 → `meeting_not_found`.
- `POST /api/meetings/{slug}/participants`: PIN optional. UNIQUE nickname → `nickname_conflict` 409. Set HttpOnly cookie per §6.2.
- `POST /api/meetings/{slug}/participants/login`: nickname + pin. Plain text comparison. Wrong → `invalid_pin` 401. No PIN set → `pin_not_set` 409. Sets cookie on success.
- `POST /api/meetings/{slug}/calculate`: gate via submitted_count. **NO LLM call.** Returns deterministic top 3, `source: "deterministic"`, `summary: null`, candidates have `reason: null`.
- `POST /api/meetings/{slug}/recommend`: gate. Calls adapter.recommend() with retry per §8.2 pseudocode. Returns `source: "llm" | "deterministic_fallback"` + `llm_call_count`. On all-fail fallback, fabricate share_message_draft via template helper.
- `POST /api/meetings/{slug}/confirm`: organizer header, body includes share_message_draft. Validates slot is in current windows OR matches confirmed candidate from a prior recommend call. Stores `confirmed_share_message` verbatim. Returns same payload echo.

### 6. CORS + cookie config
- `app.main` mounts `CORSMiddleware` with `allow_origins=[settings.APP_BASE_URL]`, `allow_credentials=True`. Read APP_BASE_URL from env.
- Cookie helper sets HttpOnly+SameSite=Lax+Path=/+Max-Age=604800. Secure from `COOKIE_SECURE` env (default false).

### 7. Tests (TDD — write first, then implement)
- `tests/unit/test_scheduler_v3.py`:
  - variable buffer 30/60/120 minute exclusion correctness
  - `any` location applies buffer (NEW v3 behavior)
  - picked mode: only listed dates appear in windows
  - empty windows when 0 free intersections
- `tests/unit/test_llm_upstage.py`:
  - mock `OpenAI` client; assert `build_recommendation_payload()` dict has NO "병원" / "진료" / "데이트" strings even when busy_blocks have those labels (spy on payload creation BEFORE OpenAI call — even though we don't store labels, this test guards future regressions).
- `tests/integration/test_recommend.py`:
  - happy path: 1 OpenAI call, validated response → 200 source=llm count=1
  - validation fail × 4 → fallback, count=4, source=deterministic_fallback, candidates have non-empty share_message_draft
  - network error on 1st call → immediate fallback, count=0
- `tests/acceptance/test_v3_scenarios.py` — S1b, S2 (multi-buffer), S12 (LLM fallback), S13 (call count cap), S14 (PIN login), S15 (picked mode) per spec §10.

### 8. Definition of done
- `cd backend && uv run alembic upgrade head` succeeds in fresh sqlite db
- `cd backend && uv run pytest -v` — all new + existing pass except S1/S1b/S11 (qa-cleanup will fix those)
- OpenAPI at `/docs` shows recommend, login, updated calculate/confirm
- LLM_PROVIDER=template path works without UPSTAGE_API_KEY (no exception at boot)
- LLM_PROVIDER=upstage with empty key raises clear RuntimeError mentioning template fallback

## Communication
- If spec is ambiguous, comment in PR — do NOT guess.
- If you need a frontend type that's not in spec §5.1, add it to spec §5.1 first as a PR — don't invent silently.
- Before finishing, run `pytest tests/unit/ tests/integration/` and report counts.
```

---

## v3-B — frontend-merger

```
You are **frontend-merger**, ingesting Joonggon's UI assets (shadcn/ui + Tailwind v4 + lucide + react-day-picker + pretendard) into the Sanggeun frontend base, and adding 7 v3 product features. The base lives in `frontend/`. The leader is orchestrating; do NOT touch backend.

## Your file ownership (you may CREATE/EDIT only these)
- frontend/package.json (deps + scripts)
- frontend/tailwind.config.ts, postcss.config.js, vite.config.ts (Tailwind v4 + alias)
- frontend/src/index.css (pretendard import, Tailwind directives)
- frontend/src/App.tsx (routing — keep react-router-dom v6)
- frontend/src/main.tsx
- frontend/src/lib/api.ts (NEW + edited methods per spec §5)
- frontend/src/lib/types.ts (v3 shapes)
- frontend/src/lib/cn.ts, datetime.ts (cn = clsx+tailwind-merge wrapper, datetime = KST helpers)
- frontend/src/lib/availabilityCells.ts (horizontal layout helpers)
- frontend/src/components/ui/* (Joonggon's 16 shadcn components — copy verbatim from `demos/SomaMeet_Joonggon/frontend/src/components/ui/` then adjust imports)
- frontend/src/components/CopyableUrl.tsx (modify — add QR toggle)
- frontend/src/components/QrPanel.tsx (NEW — qrcode.react)
- frontend/src/components/DateRangeOrPicker.tsx (NEW — tabs: 범위 / 개별 선택)
- frontend/src/components/Timetable.tsx (rewrite — horizontal: dates row × time columns)
- frontend/src/components/AvailabilityGrid.tsx (rewrite — same horizontal axis)
- frontend/src/components/AvailabilityTimeline.tsx (keep but adapt to horizontal data)
- frontend/src/components/CandidateList.tsx (modify — show reason + copy share_message_draft)
- frontend/src/components/ShareMessageDialog.tsx (modify — receive share_message_draft prop)
- frontend/src/pages/CreateMeetingPage.tsx (modify — calendar tabs, segmented online/offline/any, buffer select 30/60/90/120, target_count input)
- frontend/src/pages/MeetingPage.tsx (modify — host vs participant view, recommend flow)
- frontend/src/pages/meeting/*.tsx (JoinSection adds PIN optional + "이미 등록함, PIN으로 재진입" form; MeetingSummary shows submitted/target progress; AvailabilitySection unchanged routing; IcsUploadForm unchanged; ManualAvailabilityForm horizontal grid; TimetableSection horizontal; RecommendButton.tsx NEW)
- frontend/.env.local.example
- frontend/playwright.config.ts (existing, keep)

**Forbidden** (others own these): backend/**, frontend/tests/e2e/** (qa-cleanup writes E1), README.md, removing OAuth backend files.

## Reference docs (READ FIRST, IN THIS ORDER)
1. `기획서/구현_위임_스펙.md` v3 — especially §1 (asset map), §2 (FE structure), §5.1 (API shapes), §6 UX rules, §10 E1.
2. `demos/SomaMeet_Joonggon/frontend/src/` — visual/UX inspiration. Study `App.tsx` 1185 lines for screen flow but DO NOT copy as a single file. Re-decompose into Sanggeun's page structure.
3. `demos/SomaMeet_Sanggeun/frontend/src/pages/` — keep this routing/page structure as scaffold.
4. `demos/SomaMeet_Sejong/` — only QR pattern. Use `qrcode.react` library directly; don't import Sejong code.

## Authoritative decisions (do NOT change)
- Routing: react-router-dom v6, paths `/`, `/m/:slug`. Organizer detected by `?org=` query param.
- State: useState + Context. NO Redux/Zustand.
- Forms: react-hook-form + zod (Sanggeun pattern).
- Date picker: `react-day-picker` (Joonggon). Two modes via tabs:
  - Tab 1 "범위": date range (mode="range").
  - Tab 2 "개별 선택": multi-date picker (mode="multiple"). Output ISO date strings.
- Location UI: 3-button segmented control (online / offline / 상관없음). NOT a toggle.
- Buffer UI: shadcn `<Select>` with options 30/60/90/120, hidden when location=online.
- "결과 보기" button calls `POST /calculate` (no LLM, instant). Disabled until submitted=target.
- "추천받기" button calls `POST /recommend` (1 LLM call). Same gate. Loading state while waiting.
- "확정" button POSTs `/confirm` with `share_message_draft` body field (use the one from recommend response for the picked candidate).
- QR shows `share_url` only — NEVER include organizer_token in QR.
- All datetimes from API are ISO with +09:00. Render in KST regardless of user timezone.
- `credentials: "include"` on every fetch (cookies cross-port).

## What to deliver

### 1. Dependencies (`package.json`)
```jsonc
{
  "dependencies": {
    "react": "^18", "react-dom": "^18", "react-router-dom": "^6",
    "react-hook-form": "^7", "@hookform/resolvers": "^3", "zod": "^3",
    "tailwindcss": "^4", "@tailwindcss/vite": "^4",
    "@radix-ui/react-label": "*", "@radix-ui/react-popover": "*",
    "@radix-ui/react-progress": "*", "@radix-ui/react-select": "*",
    "@radix-ui/react-separator": "*", "@radix-ui/react-slot": "*",
    "@radix-ui/react-tabs": "*", "@radix-ui/react-dialog": "*",
    "@radix-ui/react-checkbox": "*",
    "class-variance-authority": "*", "clsx": "*", "tailwind-merge": "*",
    "lucide-react": "*", "pretendard": "*",
    "react-day-picker": "^9", "date-fns": "*",
    "qrcode.react": "^4"
  }
}
```

### 2. lib/api.ts methods (with TypeScript types matching spec §5.1)
- `createMeeting(payload)` → `{slug, organizer_token, organizer_url, share_url}`
- `getMeeting(slug)` → MeetingDetail
- `joinMeeting(slug, {nickname, pin?})` → ParticipantResponse (sets cookie)
- `loginParticipant(slug, {nickname, pin})` → ParticipantResponse
- `submitManual(slug, blocks)`, `submitIcs(slug, file)`
- `getTimetable(slug)`
- `calculate(slug)` → CalculateResponse (no reason)
- `recommend(slug)` → RecommendResponse (reason + share_message_draft)
- `confirm(slug, {slot_start, slot_end, share_message_draft, organizer_token})`

All errors thrown as `ApiError(error_code, message, suggestion, status)` parsed from response body.

### 3. CreateMeetingPage flow
- Sections: 제목 → 날짜(탭: 범위/개별) → 회의 길이(30/60/90 select) → 참여 인원 → 위치(segmented) → [위치≠online] 이동버퍼(select) → 시간대(time range) → 주말 toggle → 생성 버튼.
- On success: navigate to `/m/:slug?org=:token`. Show `CopyableUrl` for both organizer_url and share_url with QR for share_url only.

### 4. MeetingPage flow
- Detect organizer mode by `?org=` param.
- Sections (in this vertical order):
  1. MeetingSummary (title/date/duration/target/location/buffer + progress bar `submitted/target`)
  2. JoinSection (only if no participant cookie OR no nickname yet) — nickname + optional PIN. Plus "이미 닉네임 등록함, PIN으로 재진입" foldout (POSTs `/participants/login`).
  3. AvailabilitySection (after join — manual / ICS tabs).
  4. TimetableSection (horizontal grid).
  5. ResultSection: two buttons side-by-side `[결과 보기]` (calculate) `[추천받기]` (recommend). Both disabled while `!is_ready_to_calculate`. After click, show CandidateList. Each candidate has `[복사] [선택]` actions.
  6. (organizer only) ConfirmSection — picking a candidate fills ShareMessageDialog with that candidate's share_message_draft (editable textarea). 확정 button POSTs /confirm with current draft text.

### 5. Horizontal Timetable layout
- Top-left corner cell empty.
- First row: time headers (e.g., 09:00, 09:30, ..., 22:00).
- First column: date headers (one row per date in scope).
- Cells: heatmap-style availability (`available_count` / `target_count`). Tooltip lists `available_nicknames`.
- For picked mode, only the chosen dates appear as rows. For range mode, all dates between start and end (or weekdays if `include_weekends=false`).

### 6. Definition of done
- `pnpm install` then `pnpm dev` works without errors
- TypeScript builds with `pnpm build`
- All API calls use `credentials: "include"` and parse error_code per §5.2
- Manual smoke test in browser:
  - Create meeting in both date modes
  - Switch online/offline/any — buffer select shows/hides correctly
  - Generate share_url — QR renders
  - Join with and without PIN; re-login with PIN
  - Submit manual + ICS for ≥2 participants
  - Calculate (no reason) vs Recommend (reason + share_message_draft)
  - Confirm — share_message_draft round-trips
  - Horizontal timetable readable on 1280px viewport

## Communication
- If a spec § shape is unclear, comment PR — do NOT improvise an extra field.
- If a Joonggon visual choice conflicts with shadcn defaults, prefer shadcn unless spec §6 explicitly demands the Joonggon look.
```

---

## v3-C — qa-cleanup

```
You are **qa-cleanup**, performing the integration's final pass: removing all Google OAuth traces (Q3), updating S1/S1b/S11 to v3, writing the Playwright E1 golden path covering all 7 product additions, and authoring README per spec §13.1. The leader is orchestrating; do NOT add features beyond what's needed for tests.

**You start AFTER backend-merger reports completion.** frontend-merger may still be in flight; coordinate via the meeting.title naming in tests so neither side flakes.

## Your file ownership (you may CREATE/EDIT/DELETE)
- DELETE: `backend/app/api/oauth.py`, `backend/app/services/google_freebusy.py`, `backend/tests/integration/test_oauth_url.py`, `backend/app/services/llm/gemini.py`, `backend/app/services/llm/anthropic.py`, `backend/app/services/llm/openai.py`, `frontend/src/pages/meeting/GoogleConnectButton.tsx` (and any imports referencing these)
- EDIT: `backend/tests/acceptance/test_acceptance_S1_S11.py` — update S1, S1b, S11 to v3 (delete S9 OAuth test, restructure S11 around UpstageAdapter privacy spy)
- NEW: `backend/tests/acceptance/test_s11_privacy_upstage.py` (Upstage payload spy + live-mode optional test guarded by env)
- EDIT: `frontend/tests/e2e/golden-path.spec.ts` — rewrite to v3 E1 covering all 13 numbered steps in spec §10 E1
- EDIT: `frontend/tests/e2e/global-setup.ts`, `global-teardown.ts` (keep alembic upgrade head + db cleanup; remove any OAuth state)
- NEW: `README.md` at repo root per spec §13.1
- NEW: `backend/tests/conftest.py` additions if needed for env-guarded live tests (optional)

**Forbidden:** new product features, modifications to scheduler/llm/api code beyond import cleanup, changes to backend Pydantic schemas, frontend product components.

## Reference docs (READ FIRST)
1. `기획서/구현_위임_스펙.md` v3 — §10 acceptance criteria (S1, S1b, S11), E1 13-step Playwright, §13.1 README.
2. `회의록/2026-05-06_3차_오프라인_회의_데모분석_및_회의방향.md` — context.
3. `backend/app/services/llm/upstage.py` — what to spy on.

## Authoritative decisions (do NOT change)
- After cleanup, NO file in repo references `oauth`, `google_freebusy`, `gemini`, `anthropic` (as adapter), or the old `GenerateOpenAI` adapter path. `grep -r` should return only README mentions of "Google OAuth excluded".
- S11 has TWO test cases: (a) mocked OpenAI client — assert build_recommendation_payload dict's JSON has no "병원/진료/데이트" substrings; (b) live (`@pytest.mark.skipif(not os.environ.get("UPSTAGE_API_KEY")...)`) — same payload assertion plus assert returned share_message_draft has no leak.
- E1 must run end-to-end without UPSTAGE_API_KEY (use LLM_PROVIDER=template). Document this in README.
- README QuickStart must be a copy-paste runnable transcript starting from a fresh clone.

## What to deliver

### 1. OAuth + multi-LLM purge
- Walk repo with `grep -rin "oauth\|google_freebusy\|GeminiAdapter\|AnthropicAdapter\|OpenAIAdapter" --include="*.py" --include="*.ts" --include="*.tsx"`
- Delete files listed above
- Remove imports/calls in `backend/app/main.py`, `backend/app/services/llm/__init__.py` (factory), `frontend/src/pages/MeetingPage.tsx` (if GoogleConnectButton imported)
- Verify `pytest --collect-only` succeeds with no import errors after deletion
- Remove env vars from `backend/.env.example` if backend-merger missed any

### 2. S1 update (test_acceptance_S1_S11.py)
- Change happy path: A creates meeting with `target_count=4`, all 4 submit, then **calculate** (deterministic candidates with reason=null), THEN **recommend** (LLM 1 call, reason+share_message_draft populated), then confirm with that draft.
- Assert calculate returns `source: "deterministic"`, recommend returns `source: "llm"`, `llm_call_count: 1`, confirmed_share_message round-trips.

### 3. S1b new test
- target_count=4, only A/B submit
- POST /calculate → 409 `insufficient_responses` `current=2 required=4`
- POST /recommend → 409 same
- GET /meetings/{slug} → `is_ready_to_calculate: false`

### 4. S11 rewrite (privacy w/ Upstage)
- `test_s11_privacy_upstage.py`:
  - Fixture: meeting with 1 participant uploading ICS containing "병원 진료" event
  - `test_payload_no_label_leak_mocked`: monkeypatch `OpenAI` client; capture the user prompt arg; assert no "병원" / "진료" / "위치" / "장소" substrings
  - `test_share_message_no_leak_live` (skipif no UPSTAGE_API_KEY): real recommend call; assert no leak in any share_message_draft

### 5. Delete S9
- Remove S9 OAuth test entirely. Update test class docstrings/numbering.

### 6. E1 Playwright (golden-path.spec.ts)
- Implement all 13 steps from spec §10 E1.
- Use `data-testid` selectors that frontend-merger should add (coordinate via PR comment if missing — do NOT add testids yourself, request them).
- Run with `LLM_PROVIDER=template` (set in `playwright.config.ts` webServer env).
- Save screenshots on failure to `frontend/test-results/`.

### 7. README.md (repo root)
Write per spec §13.1. Concrete sections:
- Title + 1-line tagline
- Quick Start (copy-paste shell transcript: prereqs, backend, frontend, browser URL)
- Environment variables explanation (`backend/.env.example`, frontend `.env.local`, template-mode note)
- 3-min demo flow (matching E1 steps in plain language)
- Testing (backend pytest, frontend playwright)
- Privacy principles (link to spec §4 + §8 Privacy guard)
- Security limitations (PIN plaintext warning explicit + bcrypt-needed-for-prod note)
- License: TBD
- Spec link: see `기획서/구현_위임_스펙.md` for full architecture

### 8. Definition of done
- `grep -rin "oauth" backend/ frontend/` returns only README occurrences
- `cd backend && uv run pytest tests/acceptance/ -v` — S1, S1b, S2~S8, S10~S15 all PASS (S9 absent)
- `cd backend && uv run pytest tests/acceptance/test_s11_privacy_upstage.py::test_payload_no_label_leak_mocked -v` — PASS
- `cd frontend && pnpm test:e2e` — E1 PASS in template mode
- `cat README.md | head -50` — Quick Start section copy-pastable
- Final security pass: no plaintext secrets in any committed file (env.example has empty values only)

## Communication
- If you find a behavior diverging from spec while writing tests, file PR comment — do NOT silently fix code (that's backend-merger's lane).
- If E1 fails because frontend lacks a testid, comment with the exact selector you need; do NOT add testids in frontend yourself.
- Final report: number of files deleted, tests added/updated, README sections, env vars purged.
```

---

## 실행 순서 — 박세종 가이드

1. **준비** (수동, ~5분)
   - 본 spec v3 + 회의 방향 문서 commit & push
   - 통합 레포(`somameet/`) main 브랜치 fresh
   - `UPSTAGE_API_KEY` 발급 (없어도 진행 가능)
   - `demos/` 5개 clone 확인

2. **Phase 1 (병렬)** (~30~45분)
   - backend-merger 띄우기 (브랜치 `merge/v3-backend`)
   - frontend-merger 띄우기 (브랜치 `merge/v3-frontend`)
   - 두 PR 별도 리뷰

3. **Phase 1 머지 후 Phase 2** (~20분)
   - main 머지 후 qa-cleanup 띄우기 (브랜치 `merge/v3-cleanup`)
   - PR 리뷰 + acceptance/E1 통과 확인

4. **검증** (~10분)
   - fresh clone에서 README Quick Start만으로 실행 가능 확인 → 5/10 데모 제출 통과 기준 충족

## 잘 작동할 패턴 (기대)
1. **API 계약 잠금**: spec §5/§5.2/§6.1-6.2가 이미 잠겨 있어 BE/FE 병렬에도 충돌 0건 기대
2. **assets-map 명시**: §1.1 표로 "어디서 가져와서 어디로 옮길지"가 정확 → frontend-merger가 추측 없이 진행 가능
3. **error catalog**: §5.2가 backend-merger와 frontend-merger 사이의 응답 형식 분쟁을 사전 차단
4. **template adapter 기본**: UPSTAGE_API_KEY 없이도 E1 통과 → 키 발급 지연 시 데모 일정 영향 0

## 위험 요소 (미리 인지)
1. **frontend-merger의 1185줄 App.tsx 분해 작업이 가장 큰 단일 비용** — Joonggon UX flow 이해 + Sanggeun 페이지 골격 매핑이 동시에 필요
2. **S2 가변 buffer + `any` buffer 적용** — v2와 v3 의미가 다르므로 backend-merger가 Q8 결정 본문을 정확히 읽어야 함
3. **PIN 평문 저장에 대한 Q7 결정** — qa-cleanup의 README 보안 메모가 안 적히면 코드 리뷰에서 지적될 수 있음
4. **S13 LLM 호출 횟수 spy 테스트** — backend-merger의 retry 루프가 5회 호출하는 버그 회귀 방지에 결정적

