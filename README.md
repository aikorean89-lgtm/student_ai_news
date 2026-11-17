# AI 어린이 뉴스 연구소

초등학생(1~6학년)을 위한 AI 기반 어린이 뉴스 문해력 학습 웹앱입니다.

- 사이트: https://student-ai-news.vercel.app
- `main` 브랜치에 push하면 Vercel이 자동으로 다시 배포합니다.

## 주요 기능
- 📰 카테고리별(IT/과학, 사회, 경제, 세계, 어린이, 문화) 뉴스 목록·검색·더 보기
- 🔍 **쉽게 기사 읽기** — 학년 수준(1~2학년/3~4학년/5~6학년)에 맞춰 AI가 기사를 다시 설명
- ⚖️ **사실과 의견 보기** — AI가 기사에서 사실과 의견/추측을 구분해 분석
- 🕵️ **탐정 퀴즈** — AI가 기사 내용으로 이해도 확인 퀴즈를 생성
- 🏅 포인트·10단계 탐정 등급·연속 출석·카테고리별 탐험 지도
- 📔 단어 수첩(쉽게 읽기에서 배운 낱말 자동 수집), 📝 오답노트, 📅 읽기 기록 캘린더
- 🔊 읽어 주기(TTS), ☀️/🌙 라이트·다크 모드, ⭐ 스크랩, ✓ 읽은 기사 표시

## AI 기능 켜기 (선생님이 한 번만)
AI 기능은 서버 함수 `api/ai.js`가 Anthropic API를 대신 불러 줍니다.
학생은 키를 입력할 필요가 없고, 키는 브라우저에 절대 전달되지 않습니다.

1. Vercel 대시보드 → `student-ai-news` 프로젝트 → **Settings → Environment Variables**
2. `ANTHROPIC_API_KEY` = 본인의 Anthropic API 키 (`platform.claude.com`에서 발급) 추가
3. **Deployments**에서 최신 배포를 **Redeploy**

확인: `https://student-ai-news.vercel.app/api/ai` 에서 `"ready":true`가 보이면 준비 완료입니다.

### 선택 설정
| 변수 | 설명 |
| --- | --- |
| `AI_MODEL` | 사용할 모델 (기본값 `claude-haiku-5-5`) |
| `KV_REST_API_URL` / `KV_REST_API_TOKEN` (또는 `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN`) | Upstash Redis를 연결하면 같은 기사·학년의 AI 결과를 반 전체가 함께 써서 비용과 대기 시간이 줄어듭니다. |

### 서버 함수의 보호 장치
- 같은 사이트에서 온 요청만 받습니다.
- IP당 10분에 120회까지 (한 교실이 같은 IP를 써도 넉넉하게).
- 기사 길이 제한, AI 결과 형식 검사(실패 시 한 번 재시도), 결과 캐시.

## 파일 구성
- `index.html` — 앱 전체 (HTML/CSS/JS 한 파일, 빌드 과정 없음)
- `api/ai.js` — AI 요청을 처리하는 Vercel 서버 함수
