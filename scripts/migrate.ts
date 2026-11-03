// DB 마이그레이션. DATABASE_URL이 있으면 그 DB(Supabase 등)에, 없으면 로컬 PGlite(.data/pglite)에 적용한다.
// 사용: npm run db:migrate
// 적용 전에 대상 DB와 TLS 방식을 먼저 출력한다(비밀번호 제외). '대상: 로컬 PGlite'가 보이면 DATABASE_URL이 전달되지 않은 것이다.
// 원격 DB는 '· TLS verify-full'이어야 한다. 'TLS encrypt-only'(DATABASE_CA_PEM이 비었음)면 비밀번호를 보내기 전에 멈춘다(종료 코드 1).
// 흐름은 src/server/cli.ts에 있다(테스트가 접속 여부·출력을 확인).
import { migrateCli } from "../src/server/cli";

migrateCli().then(
  (code) => process.exit(code),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
