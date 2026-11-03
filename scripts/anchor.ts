// 로컬 시험용 일일 앵커: npm run anchor -- --local   (로컬 PGlite에 오늘(KST) 앵커를 만든다. 출력: ANCHOR_OUT_DIR, 기본 ./anchors-out)
// 운영 앵커는 공개 앵커 저장소의 GitHub Actions가 매일 18시(KST) 무렵 /api/cron/anchor를 불러 만든다(deploy/anchors-repo).
// 그 실행이 실패한 날의 복구는 운영 사이트 /admin의 '오늘(KST) 앵커 만들기'(18시 이후·24시 전)로 한다. 이 스크립트는 운영 복구에 쓰지 않는다:
// 운영자 PC의 .env.local에는 운영 DATABASE_URL이 없어서, 그대로 실행하면 로컬 DB에만 앵커가 생긴다.
// 그래서 먼저 대상 DB와 키 출처(env·dev)를 출력하고, DATABASE_URL이 없으면 --local 없이는 멈춘다(종료 코드 1).
// DATABASE_URL을 셸에 직접 넣어 실행하면 18시(KST) 전에는 멈추고, 운영 키 환경변수를 DB 접속 전에 확인한다(개발용 키 거부).
// 오늘(KST) 앵커만 만든다. 빠진 날을 나중에 채우면 이후 앵커의 prev_root 사슬이 깨지므로 날짜 지정은 받지 않는다.
// 과거가 바뀐 것이 발견되면(체인 길이 감소·접두 불일치) 종료 코드 2로 실패한다. 흐름은 src/server/cli.ts에 있다.
import { anchorCli } from "../src/server/cli";
import { closeDb } from "../src/server/db";

// process.exit()를 부르지 않고 종료 코드만 정한다(scripts/verify.ts와 같은 이유): Windows(Node 24)에서 TSA 요청 직후 process.exit()를 부르면
// libuv 검사(UV_HANDLE_CLOSING)에 걸려 0xC0000409(3221226505)로 죽어 0·1·2 종료 코드가 사라진다.
// 대신 getDb()가 연 DB를 닫는다. 열어 둔 PGlite는 마지막 줄을 출력한 뒤에도 10초쯤 종료를 붙잡는다.
anchorCli(process.argv.slice(2))
  .then(
    (code) => {
      process.exitCode = code;
    },
    (e) => {
      console.error(e);
      process.exitCode = 1;
    },
  )
  .finally(() => closeDb().catch(() => undefined));
