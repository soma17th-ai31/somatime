# SomaMeet

> 일정 제목을 들여다보지 않고도 모두가 가능한 회의 시간을 빠르게 합의하기 위한 개인정보 보호 일정 조율 서비스 (v3.20 기준, 2026-05-06+).

SomaMeet은 ICS 업로드 또는 직접 입력만으로 참여자 전원의 busy/free 시간을 받아 후보 시간을 산출하고, Upstage Solar 모델 한 번 호출로 추천 사유와 단톡방 공유용 안내 메시지를 함께 만들어 줍니다. Google Calendar 연동 / OAuth 통신은 v3에서 모두 제거되어 더 이상 사용하지 않습니다.

v3.2 이후 점진적으로 추가된 기능들:
- **회의 설정 수정** (`PATCH /api/meetings/{slug}/settings`, v3.19) — 확정 전 회의에서 날짜 범위 / 길이 / 진행 방식을 통째로 갱신.
- **필수 참여자 플래그** (`participants.is_required`, v3.11) — 멘토처럼 반드시 참석해야 하는 사람을 표시하면 추천이 그를 떨어뜨리지 않도록 가중.
- **쿠키 기반 참여자 인증** (v3.5–v3.7) — 닉네임 등록 시 HttpOnly 쿠키를 발급하고, PIN을 설정한 사용자에게 한해 재진입을 `POST /api/meetings/{slug}/participants/login`으로 처리.
- **Docker compose 부팅 옵션** (v3.20) — 로컬에서 백엔드 + SQLite 볼륨을 한 번에 띄우는 `docker compose up`.

## 목차

- [Quick Start](#quick-start)
- [환경 변수](#환경-변수)
- [LLM_PROVIDER 모드](#llm_provider-모드)
- [API 표면](#api-표면)
- [3분 데모 흐름](#3분-데모-흐름)
- [테스트](#테스트)
  - [Backend (pytest)](#backend-pytest)
  - [Frontend E1 (Playwright)](#frontend-e1-playwright)
  - [S11/S13 권장 검증 절차](#s11s13-권장-검증-절차)
  - [Upstage 라이브 검증](#upstage-라이브-검증)
- [개인정보 / 보안 원칙](#개인정보--보안-원칙)
- [보안 한계](#보안-한계)
- [스펙 문서](#스펙-문서)

## Quick Start

전제 조건:
- Python 3.11 이상
- Node.js 20 + pnpm 9
- Git, 그리고 Windows / macOS / Linux 어느 환경이든 가능 (저장소는 Windows + Git Bash + PowerShell 환경에서 검증).

### 1. 백엔드 (FastAPI + SQLite)

```bash
git clone <repo-url> somameet
cd somameet/backend

python -m pip install -e ".[dev]"
cp .env.example .env                 # 그대로 두면 LLM_PROVIDER=template로 시작
python -m alembic upgrade head
python -m uvicorn app.main:app --reload --port 8000
```

서버가 떠 있으면:

```bash
curl http://localhost:8000/api/health
# {"ok":true}
```

### 2. 프론트엔드 (Vite + React + Tailwind)

다른 터미널에서:

```bash
cd somameet/frontend
pnpm install
cp .env.local.example .env.local     # VITE_API_BASE_URL=http://localhost:8000
pnpm dev
```

브라우저로 http://localhost:5173 에 접속해 회의를 만들 수 있습니다.

### 3. (선택) Docker compose로 백엔드만 띄우기

`docker-compose.yml`은 백엔드 컨테이너 + `./backend/data` 영속 볼륨만 다룹니다 (프론트는 여전히 `pnpm dev` 또는 Vercel).

```bash
cp backend/.env.example backend/.env   # 필요한 값 채우기
docker compose up --build              # http://localhost:8000/api/health
```

SQLite 파일은 `./backend/data/somameet.db`에 남고 `docker compose down` 후에도 유지됩니다.

## 환경 변수

### backend/.env

| 변수 | 기본값 | 설명 |
|---|---|---|
| `DATABASE_URL` | `sqlite:///./somameet.db` | 로컬 SQLite. Railway에서는 Postgres URL이 자동 주입. |
| `SESSION_SECRET` | (비움) | 향후 서명/쿠키용. 운영에서는 32자 이상의 무작위 값. |
| `APP_BASE_URL` | `http://localhost:5173` | 공유 URL과 CORS 화이트리스트의 origin. |
| `CORS_EXTRA_ORIGINS` | (비움) | 콤마 구분 추가 origin (예: Vercel preview 도메인). |
| `COOKIE_SAMESITE` / `COOKIE_SECURE` | `lax` / `false` | Vercel ↔ Railway 등 cross-site는 `none` / `true`. |
| `LLM_PROVIDER` | `template` | `template` 또는 `upstage`. 자세히는 아래 절. |
| `UPSTAGE_API_KEY` | (비움) | `LLM_PROVIDER=upstage` 일 때만 필요. |
| `UPSTAGE_BASE_URL` | `https://api.upstage.ai/v1` | OpenAI 호환 SDK가 가리키는 엔드포인트. |
| `UPSTAGE_MODEL` | `solar-pro3` | 모델 식별자. |
| `UPSTAGE_TIMEOUT_SECONDS` | `45` | 단일 호출 타임아웃. |

`backend/.env.example`에는 운영 변수가 모두 비어 있는 상태로 들어 있습니다. 시크릿 값은 절대 커밋하지 마세요.

### frontend/.env.local

| 변수 | 기본값 | 설명 |
|---|---|---|
| `VITE_API_BASE_URL` | `http://localhost:8000` | 백엔드 API 기본 URL. 빌드 시 인라인. |

## LLM_PROVIDER 모드

`/api/meetings/{slug}/recommend` 엔드포인트가 사용하는 어댑터를 결정합니다. v3에서는 두 가지만 지원합니다.

| 값 | 외부 호출 | 동작 |
|---|---|---|
| `template` (기본) | 없음 | `app/services/llm/template.py`의 결정적 어댑터. 회의 메타데이터와 후보 시각만 사용해 한국어 안내 메시지 / reason을 만들어 냅니다. UPSTAGE_API_KEY가 없어도 모든 acceptance 테스트와 E1 골든패스가 통과합니다. |
| `upstage` | OpenAI 호환 SDK로 Upstage Solar | `UpstageAdapter`. 추천 1회 호출, 검증 실패 시 최대 3회 재시도 (총 4회 cap, Q9). 4회 모두 실패하면 `template`과 동일한 결정적 결과로 폴백하며, 응답에서 `source="deterministic_fallback"`로 표시됩니다. |

신선한 클론에서는 `template`을 그대로 두는 것이 가장 안전한 시작점입니다. 실제 솔라 모델 응답을 보고 싶다면 `LLM_PROVIDER=upstage` 로 바꾸고 `UPSTAGE_API_KEY`만 채우면 즉시 동작합니다.

## API 표면

`backend/app/api/`에 라우터 파일 단위로 정리되어 있습니다 (모두 `/api` prefix).

| 라우터 | 메서드 + 경로 | 설명 |
|---|---|---|
| `meetings` | `POST /meetings` | 회의 생성 (`range` / `picked` 두 가지 날짜 모드). |
| `meetings` | `GET /meetings/{slug}` | 회의 상세 + `submitted_count` / `is_ready_to_calculate`. 요청자 쿠키가 있으면 본인 정보만 노출 (v3.6). |
| `meetings` | `PATCH /meetings/{slug}/settings` | v3.19 — 확정 전 회의 설정 통째로 갱신. |
| `meetings` | `POST /meetings/{slug}/calculate` | 결정적 후보만 계산 (LLM 호출 0회). `submitted_count >= 1`로 게이트. |
| `meetings` | `POST /meetings/{slug}/confirm` | `share_message_draft` 본문 필수, 두 번째 호출은 409 `already_confirmed`. |
| `participants` | `POST /meetings/{slug}/participants` | 닉네임 + 선택적 PIN으로 등록. HttpOnly 쿠키 발급. |
| `participants` | `PATCH /meetings/{slug}/participants/me` | v3.5 — 닉네임 / PIN 갱신 (쿠키 인증). v3.11 — `is_required` 토글. |
| `auth` | `POST /meetings/{slug}/participants/login` | v3.7 — 같은 닉네임으로 재진입할 때 PIN 검증 후 쿠키 재발급. |
| `availability` | `POST /meetings/{slug}/availability` | 직접 입력 / ICS 업로드. 같은 닉네임 재제출 시 last-write-wins. |
| `recommend` | `POST /meetings/{slug}/recommend` | LLM 1회 호출 (실패 시 최대 3회 재시도, 총 cap 4). |
| `timetable` | `GET /meetings/{slug}/timetable` | 가로 타임테이블 데이터. v3.16 — submitted 참여자만 풀에 포함. |

## 3분 데모 흐름

E1 Playwright 시나리오와 동일한 절차입니다.

1. http://localhost:5173 접속 → "새 회의 만들기" 폼 입력 (제목, 날짜 범위, 회의 길이, 진행 방식 / 버퍼). v3.1: 참여 인원 입력은 폼에서 제거됐습니다.
2. "회의 만들기" 누르면 결과 카드에 **공유 링크 하나**가 표시됩니다 (v3.2 Path B). 옆에 QR 코드 토글이 있고, 이 링크 하나로 모든 동작 (결과 보기 / 추천 / 확정) 이 가능합니다.
3. "회의 페이지로 이동" 클릭 → 회의 페이지. v3.2: 주최자/참여자 분기가 시스템에서 완전히 제거됐고, 사고 방지는 확정 다이얼로그의 2단계 게이트가 흡수합니다.
4. 시크릿 창 / 다른 디바이스에서 공유 링크 열기 → 닉네임 입력 (선택적으로 4자리 PIN). 곧바로 가용 시간 입력 화면.
5. "직접 입력" 또는 "ICS 업로드"로 가용 시간 제출. 같은 닉네임으로 다시 제출하면 last-write-wins 트랜잭션으로 덮어쓰기.
6. 최소 1명이 제출하면 "결과 보기" / "추천받기" 버튼이 활성화됩니다 (`is_ready_to_calculate = submitted_count >= 1`).
7. "결과 보기" → 결정적 후보 (LLM 호출 0회). "추천받기" → LLM 1회 호출, 후보별 reason + share_message_draft 표시.
8. 후보를 선택하면 메시지 초안 모달이 열립니다. 메시지를 검토 / 수정 → "확정" 누르면 backend가 메시지를 그대로 저장하고 (LLM 호출 0회) 읽기 전용 다이얼로그로 전환됩니다. 두 명이 동시에 확정을 누르면 두 번째 호출은 409 `already_confirmed` 로 거부됩니다.
9. 가로 타임테이블 (날짜 행 / 30분 컬럼)에서 닉네임 단위 가용 인원이 시각화됩니다.

## 테스트

### Backend (pytest)

```bash
cd backend

# 전체 (acceptance + integration + unit; 115개)
python -m pytest tests/ -v

# 인수 시나리오만 (S1 / S1b / S2~S8 / S10~S15)
python -m pytest tests/acceptance/ -v

# 단일 시나리오만 빠르게
python -m pytest tests/acceptance/test_acceptance_S1_S11.py::test_S1_happy_path -v
```

기대 결과: `114 passed, 1 skipped` (skipped 한 건은 `UPSTAGE_API_KEY` 없을 때 자동 건너뛰는 라이브 검증). 분포는 acceptance 34 / integration 9 / unit 72.

### Frontend E1 (Playwright)

```bash
cd frontend
pnpm install
pnpm exec playwright install chromium    # 최초 1회
pnpm test:e2e
```

`playwright.config.ts`가 직접 백엔드 (uvicorn) + 프론트엔드 (vite dev) 두 webServer를 부팅하고, `LLM_PROVIDER=template`을 강제하므로 UPSTAGE_API_KEY 없이도 골든패스가 통과합니다. 기존 서버를 재사용하려면 `SOMAMEET_E2E_REUSE=1` 환경 변수를 사용하세요 (단, 이 경우 alembic upgrade는 사용자가 직접 챙겨야 합니다).

스크린샷 / trace는 실패 시 `frontend/test-results/`에 자동 저장됩니다.

### S11/S13 권장 검증 절차

S11(개인정보 누출 방지)과 S13(LLM 호출 횟수 cap=4) 회귀를 빠르게 잡으려면 다음 두 명령을 짝지어 돌리는 것을 권장합니다.

```bash
cd backend

# S11 — 템플릿 / 업스테이지 모킹 두 케이스가 한 번에 돕니다.
python -m pytest -v \
  tests/acceptance/test_acceptance_S1_S11.py::test_S11_llm_privacy_template_path \
  tests/acceptance/test_acceptance_S1_S11.py::test_S11_llm_privacy_upstage_prompt_spy

# S13 — recommend 재시도 루프가 5번째 호출로 새지 않는지 확인.
python -m pytest -v tests/acceptance/test_v3_scenarios.py -k "S13"
```

`test_S11_llm_privacy_upstage_prompt_spy`는 `OpenAI` 클라이언트를 monkeypatch해서 user prompt를 캡처하고, "병원 / 진료 / 데이트" 단어가 단 한 번도 페이로드에 들어가지 않는지 단언합니다. 시스템 프롬프트 자체에는 "장소"라는 라벨 단어가 의도적으로 들어가지만, 사용자 메시지(우리가 직접 만든 페이로드 JSON)에는 일정 제목 / 위치 / 설명이 절대 실리지 않아야 합니다.

### Upstage 라이브 검증

실제 Upstage Solar API에 호출이 잘 가는지 보고 싶다면:

```bash
cd backend

export UPSTAGE_API_KEY=...                 # PowerShell이면 $env:UPSTAGE_API_KEY="..."
export LLM_PROVIDER=upstage

# 옵트인된 라이브 acceptance 테스트만 실행. UPSTAGE_API_KEY가 없으면 자동 SKIP.
python -m pytest tests/acceptance/test_acceptance_S1_S11.py::test_S11_llm_privacy_upstage_live -v

# 또는 dev 서버를 띄워 실제로 추천을 한 번 받아보기.
python -m uvicorn app.main:app --reload --port 8000
# 다른 터미널에서:
curl -X POST http://localhost:8000/api/meetings/<slug>/recommend
```

`UPSTAGE_API_KEY`는 절대 커밋하지 마세요. `.env`는 `.gitignore`로 차단되어 있습니다.

## 개인정보 / 보안 원칙

- 데이터베이스에 일정 제목 / 설명 / 위치 컬럼이 존재하지 않습니다. ICS 업로드 시 SUMMARY / DESCRIPTION / LOCATION은 파싱 단계에서 폐기되고, busy/free 구간만 `busy_blocks` 테이블에 저장됩니다.
- LLM 호출 페이로드는 `app/services/llm/base.py::LLMAdapter.build_recommendation_payload`가 만든 dict뿐입니다. `meeting.title / location_type / duration_minutes / target_participants / offline_buffer_minutes` 와 결정적으로 산출된 `candidate_windows`만 들어갑니다. 절대 busy_block 본문이나 참여자 식별 정보는 들어가지 않습니다 (S11 단언으로 회귀 방지).
- Google Calendar 연동은 v3에서 완전 제거되었습니다 (기획서 Q3). `freebusy` 단일 scope조차 더는 요청하지 않습니다.
- 자세한 설계 근거는 기획서 §4 (개인정보 처리 원칙) 와 §8 (Privacy guard) 를 참고하세요.

## 보안 한계

- **PIN은 평문 저장 (Q7).** MVP 우선순위 결정으로 `participants.pin` 컬럼에 4자리 숫자가 그대로 들어갑니다. 운영 배포 전에는 반드시 bcrypt/argon2 해시로 전환하고 마이그레이션 + 새 검증 로직을 추가해야 합니다. 현재 acceptance test `test_S14_pin_stored_in_plaintext`가 이 제약을 명시적으로 단언하므로, 해시 전환 시 이 테스트를 우선 갱신해야 합니다.
- `SESSION_SECRET`이 비어 있어도 부팅이 막히지는 않지만, 향후 서명된 토큰 / 쿠키를 도입할 때 강제 검증을 추가할 예정입니다.
- 라이브러리 의존성은 `pip-audit` / `npm audit` 으로 정기 점검 권장.
- E1 시나리오와 acceptance 테스트는 모두 SQLite 위에서 돌도록 설계되었습니다. Postgres 등 다른 백엔드로 옮길 때는 alembic 마이그레이션 호환성을 별도로 점검하세요.

## 스펙 문서

- `기획서/구현_위임_스펙.md` — 전체 기능 / API 계약 / acceptance 시나리오 (v3 기준).
- `기획서/구현_위임_스펙_추가.md`, `기획서/구현_위임_스펙_추가v2.md` — v3.1 이후 추가된 결정 사항 (필수 참여자, 설정 수정, Path B 등).
- `회의록/2026-05-06_3차_오프라인_회의_데모분석_및_회의방향.md` — v3 결정 배경. 1차/2차 회의록도 같은 폴더에 있습니다.
- `docs/agent-prompts.md` — backend-merger / frontend-merger / qa-cleanup 분업 명세.

라이선스: TBD.
