# SIGNALS 1R 사이트

AI·규칙 기반 투자 시그널을 결과 전에 봉인해 기록하는 서비스(SIGNALS)의 1R 공개 사이트입니다. 지금은 무료 기록 서비스이며 시그널을 판매하거나 결제를 받지 않습니다.

- 공급자 무료 사전등록, 공개 프로필·초대 링크
- 시그널 봉인(1R은 KOSPI·KOSDAQ만, 공급자 시그널은 운영 메일로 받아 `/admin`에서 봉인): 정규화(v2) → SHA-256 해시 체인 → ECDSA P-256 서명 → RFC 3161 타임스탬프(FreeTSA·DigiCert)
- 매일 18시(KST) 무렵 일일 앵커: 모든 에이전트의 체인 길이·마지막 지문을 머클 루트(RFC 6962)로 묶어 서명 → 공개 GitHub 저장소·OpenTimestamps(비트코인)에 사본 고정
- 검증 페이지(`/verify/지문`)와 명령줄 검증기(`npm run verify`, 아직 비공개)가 서버 답을 그대로 믿지 않고 직접 계산. 청산 전에는 원문 비공개(커밋-리빌)

설계 근거는 `../signals/docs/03_시스템_아키텍처_설계.md`, 배포는 [DEPLOY.md](DEPLOY.md)를 봅니다.

## 로컬 실행

```bash
npm install
npm run seed:dev        # 시연 데이터(실제 TSA 토큰 포함). 오프라인이면 TSA_URLS=off
npm run dev             # http://localhost:3000
```

- 새로 clone한 폴더에서도 이 순서 그대로 됩니다. DB는 설치 없이 PGlite(`.data/pglite`)를 쓰고, `.data/` 폴더는 처음 실행할 때 만들어집니다. 개발용 서명 키는 `.data/keys/`에 자동 생성됩니다(개발 전용입니다. 운영 키는 이 폴더에 두지 않습니다).
- 관리자 화면 `/admin`은 `.env.local`의 `ADMIN_USER`·`ADMIN_PASSWORD`가 있어야 열립니다(`.env.example` 참고).
- 로컬 앵커 시험은 `npm run anchor -- --local`입니다(로컬 PGlite에만 만듦). `--local` 없이 `DATABASE_URL`도 없으면 운영 DB가 아니라며 멈춥니다.
- 개발 서버가 PGlite를 쓰는 동안 같은 폴더로 `seed:dev`·`anchor`·`db:migrate`를 동시에 돌리지 마세요(파일 DB를 한 프로세스만 써야 함).

## 명령

| 명령 | 하는 일 |
|---|---|
| `npm run check` | 타입 검사 + lint + 테스트 |
| `npm test` | 단위·통합 테스트(실제 TSA 토큰 검증, 변조 공격 재현, 앵커 경합, RLS, 실제 Postgres 프로토콜 포함) |
| `npm run build` | 배포 빌드 |
| `npm run keys:generate` | 배포용 서명 키 생성 → 홈 폴더 `.signals-keys/prod-keys.env`(OneDrive 밖, 이미 있으면 덮어쓰지 않음). 내용을 Vercel 환경변수에 넣고 두 곳에 보관([DEPLOY.md](DEPLOY.md) 1단계). 프로젝트 폴더로 복사하지 마세요 |
| `npm run keys:check -- <키 파일> --expect https://<운영도메인>/keys.json` | 키 파일(원본·보관본)이 완전한지 확인하고, `--expect`로 준 keys.json(운영 사이트 또는 공개 앵커 저장소)과 같은지 비교(공개 정보만 출력). `--expect` 없이는 사이트와 비교하지 않음. 모르는 인자는 받지 않음(종료 코드 2) |
| `npm run db:migrate` | 마이그레이션 적용(`DATABASE_URL` 있으면 그 DB). 대상 호스트와 TLS 방식을 먼저 출력하고, 원격인데 `TLS encrypt-only`(인증서 없음)면 접속 전에 멈춤 |
| `npm run seed:dev` | 로컬 시연 데이터 |
| `npm run anchor -- --local` | 로컬 PGlite에 오늘 앵커 만들기(시험용). 운영 앵커 복구는 운영 사이트 `/admin`의 '오늘(KST) 앵커 만들기'([DEPLOY.md](DEPLOY.md) 5단계 5번) |
| `npm run verify -- <사이트주소> <지문 또는 시그널ID> --mirror <공개 앵커 저장소 주소>` | 명령줄 검증(브라우저 검증과 같은 코드). 종료 코드 0 맞지 않는 항목 없음, 1 불일치·오류(파일·네트워크 오류 포함), 2 공개 저장소와 대조하지 못함(`--mirror` 없음·받기 실패, 또는 발행 후 이틀(KST)이 지난 기록을 사이트가 앵커 없이 보냄). 요청마다 30초 시간 제한 |
| `npm run smoke -- <사이트주소>` | 배포 후 읽기 전용 점검(기록을 만들지 않음). 중간에 요청이 실패해도 모든 결과를 출력, 실패가 있으면 종료 코드 1. 운영 주소 점검(`--local` 없이)은 DB 연결이 서버 인증서까지 확인하지 않으면(`TLS verify-full`이 아니면) 실패로 셈 |
| `npm run fixtures:tsa` / `npm run vectors:canonical` | 테스트용 실제 TSA 토큰·정규화 정답값(별도 Python 구현) 다시 만들기 |

## 구조

```
src/core/      프레임워크·DB 의존 없는 순수 로직(정규화, 서명, 머클, TSA 토큰, 진입 규칙, 검증) — 브라우저·CLI·서버 공용
src/server/    DB 접근(Db 인터페이스: PGlite / pg Pool), repo(SQL), services(등록·발행·앵커·검증 묶음), 키·설정
src/app/       화면과 API(Next.js App Router). /admin은 미들웨어 Basic 인증 + 서버 액션마다 재확인
db/migrations/ 스키마(봉인 테이블 수정·삭제·비우기 금지 트리거, RLS)
deploy/anchors-repo/  공개 앵커 저장소 템플릿(GitHub Actions, 별도 구현 Python 검증기, OpenTimestamps)
scripts/       키 생성·확인, 마이그레이션, 시드, 로컬 시험용 앵커, CLI 검증기, 배포 후 점검
```
