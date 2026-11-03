// 운영자 PC에서 도는 DB 스크립트(npm run db:migrate, npm run anchor)의 흐름. scripts/*.ts는 이 함수를 부르고 종료 코드만 넘긴다
// (접속 전에 멈추는지, 무엇을 출력하는지를 테스트에서 확인할 수 있게 여기에 둔다).
// 두 스크립트 모두 접속 전에 대상 DB와 TLS 방식을 먼저 출력한다: 엉뚱한 DB(로컬 파일 DB 등)에 쓰고 성공으로 착각하지 않게.
import "server-only";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { kstHour, kstToday } from "@/core/date";
import { ConfigError, siteUrl } from "./config";
import { dbTlsMode, ensurePgliteParent, getDb, pgliteDb, postgresDb } from "./db";
import { type LoadedKey, loadKey, publicKeysFile } from "./keys";
import { describeMigrationTarget, runMigrations } from "./migrate";
import { AnchorConsistencyError, buildDailyAnchor } from "./services/anchor";
import { InputError } from "./sql";

/** 스크립트 출력(테스트에서는 모아서 확인한다) */
export type ScriptIo = Pick<Console, "log" | "warn" | "error">;

const pgliteDir = () => process.env.PGLITE_DIR ?? ".data/pglite";

/** 접속 전에 출력하는 대상 줄. 원격이면 TLS 방식을 붙인다(verify-full이 아니면 서버 인증서를 확인하지 않는 연결이다). */
export function dbTargetLine(url: string | undefined, dir: string): string {
  return `대상: ${describeMigrationTarget(url, dir)}${url ? ` · TLS ${dbTlsMode(url)}` : ""}`;
}

/**
 * 운영자 PC(공용망일 수 있음)에서 원격 DB에 비밀번호를 보내기 전 확인. 서버 인증서를 확인할 수 없으면(DATABASE_CA_PEM이 비었거나,
 * 인증서 파일 경로가 틀려 빈 값이 들어감) 멈춘다: 그대로 접속하면 가짜 서버가 비밀번호를 받아 갈 수 있다.
 * 'invalid'(주소의 sslmode·읽을 수 없는 PEM)는 postgresDb가 구체적인 ConfigError로 접속 전에 멈춘다.
 * 사이트(Vercel)의 같은 경우는 막지 않는다: 운영 중 비상 절차가 암호화만 하는 연결에 기대고, smoke 점검이 실패로 알린다(사이트는 계속 동작).
 * 인증서 없는 시험용 DB에 일부러 붙을 때만 ALLOW_UNVERIFIED_TLS=1.
 */
export function unverifiedTlsProblem(url: string): string | null {
  if (dbTlsMode(url) !== "encrypt-only" || process.env.ALLOW_UNVERIFIED_TLS === "1") return null;
  return "DATABASE_CA_PEM이 비어 있어 DB 서버 인증서를 확인할 수 없습니다. 비밀번호를 보내기 전에 멈춥니다. 2단계 3번에서 확인한 prod-ca-2021.crt 경로를 확인하세요.";
}

/** npm run db:migrate. DATABASE_URL이 있으면 그 DB(Supabase 등)에, 없으면 로컬 PGlite에 적용한다. 종료 코드를 돌려준다. */
export async function migrateCli(io: ScriptIo = console): Promise<number> {
  const url = process.env.DATABASE_URL || undefined;
  const dir = pgliteDir();
  io.log(dbTargetLine(url, dir));
  if (url) {
    const problem = unverifiedTlsProblem(url);
    if (problem) {
      io.error(problem);
      return 1;
    }
  } else {
    ensurePgliteParent(dir);
  }
  // 마이그레이션은 파일 하나씩 순서대로 적용하므로 연결 하나면 된다
  const db = url ? postgresDb(url, { max: 1 }) : pgliteDb(new PGlite(dir));
  try {
    const applied = await runMigrations(db);
    io.log(applied.length ? `적용: ${applied.join(", ")}` : "새로 적용할 마이그레이션이 없습니다.");
    return 0;
  } finally {
    await db.end?.().catch(() => undefined);
  }
}

const KEY_SOURCE: Record<LoadedKey["source"], string> = { env: "env: 환경변수", dev: "dev: 개발용 .data/keys" };

/** 운영 /anchors 주소. SITE_URL이 공개 https 주소일 때만 쓰고, 아니면(.env.local의 localhost 등) 자리표시로 둔다. */
function anchorsPage(): string {
  try {
    const site = siteUrl();
    const host = new URL(site).hostname;
    if (site.startsWith("https://") && host !== "localhost" && host !== "127.0.0.1") return `${site}/anchors`;
  } catch {
    // 형식이 틀린 SITE_URL은 아래 자리표시로 둔다
  }
  return "https://<운영도메인>/anchors";
}

/**
 * npm run anchor. 로컬 시험용이다(npm run anchor -- --local: 로컬 PGlite에 오늘(KST) 앵커를 만든다).
 * 운영 앵커 복구는 운영 사이트 /admin의 '오늘(KST) 앵커 만들기'(18시 이후)로 한다. 운영자 PC의 .env.local에는 운영 DATABASE_URL이 없어서,
 * 예전에는 그대로 실행하면 로컬 DB와 개발용 키로 앵커를 만들고 '앵커 생성'으로 끝나 운영이 복구된 것처럼 보였다.
 * 그래서 대상 DB와 키 출처를 먼저 출력하고, DATABASE_URL이 없으면 --local 없이는 멈춘다.
 * DATABASE_URL이 있으면(셸에 직접 넣은 경우) 관리자 버튼과 같은 18시(KST) 규칙을 따르고, 키를 DB보다 먼저 확인한다(환경변수 운영 키만).
 * 종료 코드: 0 정상, 1 멈춤·오류, 2 과거 기록 불일치(공개 저장소 작업과 같은 경보).
 */
export async function anchorCli(argv: string[], io: ScriptIo = console): Promise<number> {
  // 날짜·시각은 한 번만 잡는다(사이트 호출구와 같은 규칙: 확인한 시각과 앵커 날짜가 어긋나지 않게)
  const now = new Date();
  const url = process.env.DATABASE_URL || undefined;
  const local = argv.includes("--local");
  io.log(dbTargetLine(url, pgliteDir()));
  if (!url && !local) {
    io.error("운영 DB가 아닙니다. 로컬 시험이면 npm run anchor -- --local");
    io.error("운영 앵커 복구는 운영 사이트 /admin의 '오늘(KST) 앵커 만들기'(18시 이후)로 합니다.");
    return 1;
  }
  if (url && local) {
    io.error("--local은 로컬 PGlite 시험용인데 DATABASE_URL이 있어 멈춥니다. 셸이나 .env.local의 DATABASE_URL을 비우고 실행하세요.");
    return 1;
  }
  if (url) {
    if (kstHour(now) < 18) {
      const at = new Date(now.getTime() + 9 * 3600 * 1000).toISOString().slice(11, 16);
      io.error(`18시(KST) 전에는 운영 앵커를 만들지 않습니다(지금 KST ${at}). 일찍 만들면 오늘 앵커가 이 시각으로 확정되어 이후 발행분이 다음 날 앵커로 밀립니다.`);
      return 1;
    }
    const problem = unverifiedTlsProblem(url);
    if (problem) {
      io.error(problem);
      return 1;
    }
  }
  // 키를 DB보다 먼저 읽는다: 키가 없거나 키 ID와 개인키의 짝이 틀리면 DB에 접속하지 않고 멈춘다
  let keys: LoadedKey[];
  try {
    keys = [await loadKey("signal"), await loadKey("checkpoint")];
  } catch (e) {
    if (e instanceof ConfigError) {
      io.error(e.message);
      return 1;
    }
    throw e;
  }
  io.log(`키: ${keys.map((k) => `${k.purpose === "signal" ? "시그널" : "체크포인트"} ${k.keyId}(${KEY_SOURCE[k.source]})`).join(", ")}`);
  if (url && keys.some((k) => k.source !== "env")) {
    io.error("원격 DB에는 개발용 키로 앵커를 만들지 않습니다(지울 수 없는 기록이 개발용 키로 봉인됩니다). 운영 키 환경변수를 넣으세요.");
    return 1;
  }
  const db = await getDb();
  let r: Awaited<ReturnType<typeof buildDailyAnchor>>;
  try {
    r = await buildDailyAnchor(db, kstToday(now));
  } catch (e) {
    if (e instanceof AnchorConsistencyError) {
      io.error(`과거 기록 불일치 발견: ${e.message}`);
      return 2;
    }
    // 실행 도중 자정(KST)이 지남: 그날은 빈 날로 남는다(빠진 날은 나중에 채우지 않음)
    if (e instanceof InputError) {
      io.error(e.message);
      return 1;
    }
    throw e;
  }
  const out = process.env.ANCHOR_OUT_DIR ?? path.join(process.cwd(), "anchors-out");
  mkdirSync(path.join(out, "anchors"), { recursive: true });
  const file = path.join(out, "anchors", `${r.document.date}.json`);
  writeFileSync(file, JSON.stringify(r.document, null, 2) + "\n");
  writeFileSync(path.join(out, "keys.json"), JSON.stringify(await publicKeysFile(), null, 2) + "\n");
  io.log(
    `${r.created ? "앵커 생성" : "이미 있음"}: ${r.document.date} 루트 ${r.document.merkle_root} (에이전트 ${r.document.leaf_count}개, 타임스탬프 ${r.document.timestamps.length}건, 체크포인트 키 ${r.document.checkpoint_key_id})`,
  );
  if (r.tsaErrors.length) io.warn(`타임스탬프 실패: ${r.tsaErrors.join("; ")}`);
  io.log(`파일: ${file}`);
  io.log(
    url
      ? `확인: 시크릿 창에서 ${anchorsPage()}에 ${r.document.date} 앵커가 보이는지 확인하세요(공개 저장소에는 다음 실행 때 반영됩니다).`
      : "로컬 PGlite에만 만들었습니다. 운영 기록은 바뀌지 않습니다.",
  );
  return 0;
}
