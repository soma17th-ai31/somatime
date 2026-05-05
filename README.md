# SomaMeet — 지상근 개인 구현

> SW마에스트로 31조 소마밋 팀 프로젝트의 **지상근 개인 구현 레포**입니다.
> 팀 기획 문서와 통합본은 [`soma17th-ai31/SomaMeet`](https://github.com/soma17th-ai31/SomaMeet)에서 관리하며, 이 레포는 그 기획을 기반으로 한 MVP 구현체입니다.

## 한 줄 정의

여러 사람이 각자 편한 방식(Google Calendar / `.ics` 업로드 / 직접 입력)으로 일정을 제출하면, 일정 제목·장소·설명은 **저장하지 않고** busy/free 시간만으로 모두가 가능한 회의 시간 후보를 추천하는 개인정보 보호 일정 조율 서비스.

## 핵심 원칙

- 원본 캘린더를 복제하지 않습니다.
- 일정 제목·장소·설명을 **DB 컬럼 자체에 두지 않습니다**.
- 회의 조율에 필요한 busy/free availability block만 사용합니다.
- LLM 프롬프트에도 일정 내용은 절대 포함하지 않습니다 (회의 메타데이터·슬롯 시간·가용 인원만 전달).
- Google Calendar 권한은 `freebusy` scope **단독**.

## 기술 스택

| 영역 | 스택 |
|---|---|
| Frontend | Vite + React 18 + TypeScript + Tailwind + shadcn/ui + React Router v6 + react-hook-form + zod |
| Backend | FastAPI + SQLAlchemy 2.x + Alembic + Pydantic v2 + SQLite |
| ICS 파싱 | `icalendar` |
| Google API | `google-auth` + `google-api-python-client` (freeBusy) |
| LLM | Gemini 2.5 Flash 기본 (`google-generativeai`), Anthropic / OpenAI / template 어댑터 교체 가능 |
| 테스트 | pytest, Playwright |

## 폴더 구조

```text
.
├── backend/                   # FastAPI + SQLite + Alembic
│   ├── app/
│   │   ├── api/               # 라우터 (meetings / participants / availability / oauth / timetable)
│   │   ├── core/              # 설정, 의존성, 에러 핸들러
│   │   ├── db/                # SQLAlchemy Base + 모델 (meetings, participants, busy_blocks)
│   │   ├── schemas/           # Pydantic 스키마
│   │   └── services/          # scheduler, ics_parser, google_freebusy, llm/*
│   ├── alembic/               # 초기 마이그레이션 1개 (3 테이블)
│   └── tests/
│       ├── unit/
│       ├── integration/
│       ├── acceptance/        # S1~S11 인수 시나리오
│       └── fixtures/          # 샘플 .ics
├── frontend/                  # Vite + React + Tailwind
│   └── tests/e2e/             # Playwright E1 골든패스
├── tests/e2e/scripts/         # Gemini 라이브 검증, 권한 smoke
├── 기획서/                     # 팀 기획서 통합본 + 위임 스펙
└── 회의록/
```

## 인수 기준 (MVP 완성 정의)

`기획서/구현_위임_스펙.md` 9번 시나리오를 그대로 자동화 테스트로 옮겼습니다.

| 시나리오 | 내용 |
|---|---|
| S1 | Happy path (생성 → 입력 → 계산 → 확정 → 메시지 초안) |
| S2 | 오프라인 30분 버퍼 검증 |
| S3 | 후보 0개 → "1명 빠진 후보" 폴백 |
| S4 | 폴백조차 0개 → 조건 완화 제안 (HTTP 200 + suggestion) |
| S5 | 주최자 토큰 권한 (403/200) |
| S6 | 참여자 격리 (교차 회의 쿠키 거부) |
| S7 | 같은 닉네임 재입력 시 last-write-wins 트랜잭션 |
| S8 | ICS 파싱 실패 → 400 + `error_code: ics_parse_failed` |
| S9 | Google OAuth scope = `calendar.freebusy` 단독 |
| S10 | 타임테이블 응답에 닉네임만 포함 (이메일/실명 없음) |
| S11 | LLM 출력 privacy 검증 (이벤트 제목 단어가 메시지에 안 나타남) |
| E1 | Playwright 브라우저 골든패스 |

현재 상태:
- `pytest tests/ -v` → **70/70 PASS** (acceptance 12, integration 7, unit 51)
- `pnpm test:e2e` → **E1 PASS**
- LLM_PROVIDER=gemini 실호출 검증 PASS, privacy guard PASS

## Quick start (local dev)

### Backend
```
cd backend
python -m pip install -e .[dev]
python -m alembic upgrade head
python -m uvicorn app.main:app --reload --port 8000
```

### Frontend
```
cd frontend
pnpm install
pnpm dev   # http://localhost:5173
```

### 환경 변수
1. `backend/.env.example`을 `backend/.env`로 복사
2. 다음 키 채우기:
   - `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` (Calendar `freebusy` scope만 승인)
   - `GEMINI_API_KEY` (https://aistudio.google.com 에서 무료 발급)
3. 키가 없으면 `LLM_PROVIDER=template`로 두면 템플릿 어댑터로 폴백 (LLM 호출 없이 동작)

## 테스트

```
# 백엔드 전체 (S1-S11 acceptance + unit + integration)
cd backend && python -m pytest tests/ -v

# 프론트엔드 E1 (Playwright; backend + frontend webServer 자동 부팅)
cd frontend && pnpm test:e2e

# 실 Gemini 호출 검증 (Gemini quota 소모)
python tests/e2e/scripts/verify_gemini_live.py

# 권한 매트릭스 smoke
python tests/e2e/scripts/smoke_permissions.py
```

## 사용 흐름

1. 주최자가 회의 조건 입력 (제목, 기간, 길이, 인원, 온/오프라인) → 회의 생성
2. 결과 화면에 **두 URL** 표시: 관리용(`?org=...`) / 공유용
3. 참여자가 공유 링크로 접속 → 닉네임 등록 → 입력 방식 선택
   - **직접 입력**: 타임라인 모드(드래그로 가능 시간 블록 생성) 또는 슬롯 그리드 모드(셀 클릭/드래그) 토글 가능
   - **`.ics` 업로드**: 파일 선택 후 자동 파싱
   - **Google Calendar**: OAuth로 freeBusy 수집
4. 주최자 화면에서 "후보 시간 계산" → 최대 3개 후보 카드
5. 후보 선택 → 메시지 초안 모달에서 복사

## 알고리즘 결정사항

| 항목 | 값 |
|---|---|
| 슬롯 단위 | 30분 |
| 검색 시간대 | 주최자 입력 (기본 09:00-22:00) |
| 주말 포함 | 주최자 토글 (기본 OFF) |
| 오프라인 버퍼 | 후보 `[start-30min, end+30min]` 전 구간 free일 때만 인정 |
| `any` 처리 | 온라인 기준 (버퍼 미적용) |
| 후보 랭킹 | (1) 가용 인원 (2) 시간대 분산 (직전 후보와 2h+) (3) 빠른 날짜 |
| 타임존 | Asia/Seoul 고정 |
| 후보 0개 폴백 | 1명 빠진 후보 → 그것도 0이면 조건 완화 메시지 |
| 데이터 충돌 | 같은 닉네임 재입력 시 last-write-wins (트랜잭션) |

## 보안/프라이버시

- `backend/.env`는 `.gitignore`로 차단됨. 실제 키는 본인 환경에만 보관.
- DB 스키마에 `summary` / `description` / `location` 컬럼 0개 (`busy_blocks` 테이블 검증).
- ICS 파서가 SUMMARY/DESCRIPTION/LOCATION 필드를 읽지도 저장하지도 않음.
- LLM 프롬프트는 `{title, location_type, duration_minutes, candidates: {...}}` 만 포함.
- Google OAuth는 `calendar.freebusy` 단일 scope.

## 위임 스펙

세부 결정사항과 API 계약은 `기획서/구현_위임_스펙.md`에 정리되어 있습니다. 결정이 바뀌면 이 문서를 먼저 수정한 뒤 코드에 반영합니다.
