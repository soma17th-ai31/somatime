# SomaMeet Joonggon

Demo: https://somameet-joonggon.vercel.app

개인 일정 제목, 장소, 설명을 저장하지 않고 참여자별 busy/free 시간만 사용해 회의 후보를 추천하는 SomaMeet 개인 구현 레포입니다.

## MVP 범위

- 회의 생성: 제목, 후보 날짜 범위, 하루 탐색 시간대, 회의 길이, 목표 참여 인원, 온라인/오프라인 입력
- 참여자 제출: 닉네임 등록과 직접 busy/free 입력 또는 `.ics` 업로드를 하나의 화면에서 처리
- 결과 생성: 목표 참여 인원이 모두 제출하기 전에는 버튼 비활성화
- 프론트엔드: shadcn/ui 컴포넌트와 Tailwind CSS 기반 UI, Date Range Picker와 30분 단위 Time Picker 포함
- 추천: `backend/.env`의 `UPSTAGE_API_KEY`로 Upstage `solar-pro3`가 후보를 추천
- 검증: 백엔드가 LLM 후보의 날짜 범위, 하루 시간대, 회의 길이, 최대 가능 인원 조건을 재검증
- 메시지: 확정 후보를 바탕으로 복사용 회의 안내 메시지 생성

## 프로젝트 구조

```text
SomaMeet_Joonggon/
├── backend/
│   ├── app/
│   │   ├── main.py
│   │   ├── database.py
│   │   ├── ics_parser.py
│   │   ├── llm_recommender.py
│   │   ├── prompts.py
│   │   ├── scheduling_validator.py
│   │   └── schemas.py
│   ├── tests/
│   ├── .env.example
│   └── requirements.txt
├── frontend/
│   ├── src/
│   ├── .env.example
│   └── package.json
└── samples/
    └── sample-calendar.ics
```

## 백엔드 실행

```bash
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
```

`backend/.env`에 Upstage API 키를 입력합니다.

```env
UPSTAGE_API_KEY=your_upstage_api_key_here
UPSTAGE_BASE_URL=https://api.upstage.ai/v1
UPSTAGE_MODEL=solar-pro3
UPSTAGE_TIMEOUT_SECONDS=45
SOMAMEET_DB_PATH=/data/somameet.db
ALLOWED_ORIGINS=*
```

서버를 실행합니다.

```bash
uvicorn app.main:app --reload
```

## 프론트엔드 실행

```bash
cd frontend
npm install
cp .env.example .env
npm run dev
```

브라우저에서 `http://localhost:5173`으로 접속합니다.

## 데모 흐름

1. 홈에서 회의 조건을 입력하고 초대 링크를 생성합니다.
2. 회의 상세 화면에서 참여자 닉네임을 입력합니다.
3. 직접 입력 또는 `.ics` 업로드 중 하나를 선택해 시간을 제출합니다.
4. 제출 완료 인원이 목표 참여 인원에 도달할 때까지 결과 생성 버튼은 비활성화됩니다.
5. 모든 참여자가 제출하면 결과 생성 버튼이 활성화됩니다.
6. 결과 화면에서 LLM 추천 후보 3개와 30분 단위 타임테이블을 확인합니다.
7. 후보를 확정하고 복사용 안내 메시지를 생성합니다.

## 개인정보 보호 원칙

- `.ics` 파일은 파싱 후 시작/종료 시간만 저장합니다.
- 이벤트 제목, 장소, 설명은 DB에 저장하지 않습니다.
- LLM에는 닉네임과 busy/free 시간 블록만 전달합니다.
- 외부 이메일, 메신저, 캘린더 초대 자동 발송은 하지 않습니다.

## 테스트

```bash
cd backend
pytest
```

## 배포

### 백엔드 Docker

백엔드는 Docker Compose로 실행합니다. 기본 host port는 `18080`이며, 컨테이너 내부에서는 `8000` 포트를 사용합니다.

```bash
cp backend/.env.example backend/.env
docker compose up -d --build
curl http://localhost:18080/health
```

host port를 바꾸려면 실행 전에 `SOMAMEET_BACKEND_PORT`를 지정합니다.

```bash
SOMAMEET_BACKEND_PORT=18081 docker compose up -d --build
```

SQLite DB는 Docker volume의 `/data/somameet.db`에 저장됩니다.

### 프론트엔드 Vercel

프론트엔드는 Vercel에서 `frontend` 디렉토리를 기준으로 배포합니다.

```bash
cd frontend
npm install
npm run build
vercel --prod
```

production 환경에서는 기본 API 경로가 `/api`이며, `frontend/vercel.json`에서 NHN 백엔드로 rewrite합니다. 로컬 개발에서는 기본값으로 `http://localhost:8000`을 사용합니다.
