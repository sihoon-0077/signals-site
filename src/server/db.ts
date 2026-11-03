// 데이터 접근 계층의 바닥. 화면 코드는 이 파일을 직접 쓰지 않고 src/server/repo/* 만 거친다.
// - 개발·테스트: PGlite(설치가 필요 없는 내장 PostgreSQL)
// - 배포: DATABASE_URL의 PostgreSQL(Supabase 등), node-postgres(pg) 연결 풀
// 두 경우 모두 같은 SQL($1 자리표시자)을 쓰므로, 나중에 NestJS로 옮겨도 쿼리를 그대로 가져갈 수 있다.
import "server-only";
import { X509Certificate } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import type { ConnectionOptions } from "node:tls";
import { PGlite } from "@electric-sql/pglite";
import { attachDatabasePool } from "@vercel/functions/db-connections";
import { type CustomTypesConfig, Pool, type PoolClient, types } from "pg";
import { ConfigError, previewDeploymentBlocked } from "./config";
import { runMigrations } from "./migrate";

export interface Db {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  /** 한 트랜잭션 안에서 실행. 예외가 나면 전부 되돌린다. */
  tx<T>(fn: (q: Db) => Promise<T>): Promise<T>;
  /** 여러 문장 SQL(마이그레이션용). */
  exec(sql: string): Promise<void>;
  /** 연결 닫기(스크립트·테스트 종료용). */
  end?(): Promise<void>;
}

export function pgliteDb(pg: PGlite): Db {
  const wrap = (q: Pick<PGlite, "query" | "exec">): Db => ({
    async query<T>(sql: string, params: unknown[] = []) {
      return (await q.query<T>(sql, params)).rows;
    },
    async tx<T>(fn: (inner: Db) => Promise<T>) {
      return pg.transaction(async (t) => fn(wrap(t)));
    },
    async exec(sql: string) {
      await q.exec(sql);
    },
  });
  return { ...wrap(pg), end: () => pg.close() };
}

/**
 * PGlite(NodeFS)는 데이터 폴더의 마지막 단계 하나만 만든다(recursive 아님). .data/는 저장소에 없으므로(.gitignore)
 * 새로 clone한 폴더에서는 부모 폴더가 없어 seed:dev·db:migrate·anchor가 ENOENT로 멈췄다. 부모 폴더를 먼저 만든다.
 * 파일 경로일 때만 만든다(PGlite의 dataDir 규칙: memory://·idb://·opfs-ahp://는 파일이 아니고, file://은 떼고 쓴다).
 */
export function ensurePgliteParent(dir: string): void {
  if (!dir || /^(memory|idb|opfs-ahp):\/\//.test(dir)) return;
  const fsPath = dir.startsWith("file://") ? dir.slice(7) : dir;
  if (fsPath) mkdirSync(path.dirname(path.resolve(fsPath)), { recursive: true });
}

/**
 * 연결 암호화(TLS) 설정. pg는 기본이 평문이라, 그대로 두면 Vercel↔Supabase 구간에 공급자 이메일·청산 전 원문이 평문으로 흐르고
 * 운영자가 공용망에서 마이그레이션할 때 DB 비밀번호를 가로챌 수 있다.
 *  - localhost(로컬 DB·테스트용 PGlite 소켓 서버)는 TLS를 쓰지 않는다
 *  - DATABASE_CA_PEM(Supabase SSL 인증서)이 있으면 서버 인증서까지 확인한다(중간자 차단)
 *  - 그 밖에는 암호화만 하고 인증서는 확인하지 않는다
 * pg는 주소의 SSL 매개변수가 이 설정을 덮어쓰고(sslmode=require도 인증서 확인으로 바뀌어 Supabase 인증서를 거부),
 * sslrootcert 같은 경로의 파일을 읽으려 한다. 그래서 주소에 SSL 매개변수가 있으면 멈추고, SSL은 DATABASE_CA_PEM 하나로만 정한다.
 */
export function sslOptions(url: string, caPem = process.env.DATABASE_CA_PEM): false | ConnectionOptions {
  if (/[?&](ssl[a-z]*|uselibpqcompat)=/i.test(url)) {
    throw new ConfigError("DATABASE_URL 끝의 ?sslmode=… 같은 SSL 설정을 지우세요. 이 앱은 SSL을 DATABASE_CA_PEM(Supabase SSL 인증서)으로만 정합니다.", "CONFIG_INVALID");
  }
  let host = "";
  try {
    const u = new URL(url);
    // pg는 주소의 host 매개변수를 호스트 이름보다 먼저 쓴다(pg-connection-string). 실제로 접속할 곳으로 판단한다.
    host = (u.searchParams.get("host") ?? u.hostname).replace(/^\[(.*)\]$/, "$1");
  } catch {
    host = "";
  }
  if (["localhost", "127.0.0.1", "::1"].includes(host)) return false;
  const ca = caPem?.replace(/\\n/g, "\n").trim();
  if (!ca) return { rejectUnauthorized: false };
  // 잘린 PEM을 그대로 넘기면 모든 쿼리가 '발급자를 찾을 수 없음'으로 실패해 원인을 찾기 어렵다. 시작할 때 알려 준다.
  try {
    new X509Certificate(ca);
  } catch {
    throw new ConfigError("DATABASE_CA_PEM을 인증서로 읽을 수 없습니다(잘렸거나 다른 파일). Supabase에서 받은 prod-ca-2021.crt 내용을 그대로 넣으세요.", "CONFIG_INVALID");
  }
  return { ca, rejectUnauthorized: true };
}

/** 점검용(/api/health): 지금 설정의 DB 연결 TLS 방식. 방식 이름만 알리고 값(주소·인증서)은 내보내지 않는다. */
export function dbTlsMode(url = process.env.DATABASE_URL ?? ""): "pglite" | "off-localhost" | "verify-full" | "encrypt-only" | "invalid" {
  if (!url) return "pglite";
  try {
    const ssl = sslOptions(url);
    if (ssl === false) return "off-localhost";
    return ssl.rejectUnauthorized ? "verify-full" : "encrypt-only";
  } catch {
    return "invalid";
  }
}

// pg 기본 변환 중 PGlite(개발·테스트)·이전 드라이버(postgres-js)와 결과가 다른 타입만 이 풀에서 바꾼다(pg 전역 설정은 건드리지 않음).
// 앱 쿼리는 시각·소수·개수를 SQL에서 문자열·int로 바꿔 읽지만(sql.ts), 그대로 읽는 열이 생겨도 테스트와 운영의 값이 같아야 한다.
const pgDefault = types.getTypeParser as (oid: number, format?: "text" | "binary") => (value: string) => unknown;
const textArray = pgDefault(1009); // text[] 변환기: 원소를 문자열 그대로 둔다
const mapDeep = (v: unknown, f: (s: string) => unknown): unknown => (Array.isArray(v) ? v.map((x) => mapDeep(x, f)) : v === null ? null : f(v as string));
const PARSERS: Record<number, (value: string) => unknown> = {
  1082: (v) => new Date(v), // date: pg 기본은 Node 시간대의 자정(KST면 전날 15:00Z로 보임) → UTC 자정
  1182: (v) => mapDeep(textArray(v), (s) => new Date(s)), // date[]
  1186: (v) => v, // interval: pg 기본은 객체 → 문자열
  1187: textArray, // interval[]
  1231: textArray, // numeric[]: pg 기본은 부동소수(자릿수 손실) → 문자열
};
const PG_TYPES: CustomTypesConfig = {
  getTypeParser: ((oid: number, format?: "text" | "binary") =>
    (format !== "binary" && PARSERS[oid]) || pgDefault(oid, format)) as CustomTypesConfig["getTypeParser"],
};

/**
 * 배포 DB 연결(node-postgres 풀). Supabase 트랜잭션 풀러(6543)에 맞춘 선택:
 *  - pg는 한 연결에 쿼리를 하나씩만 보낸다(응답의 ReadyForQuery를 받은 뒤 다음 쿼리). 트랜잭션 풀러는 응답 하나가 끝나면
 *    백엔드를 다른 클라이언트에 넘겨, 이어 보낸 쿼리(파이프라이닝)는 멈추거나 남의 행을 받는다.
 *  - 이름 없는 문장만 쓰므로(prepared statement 이름을 남기지 않음) 풀러에서도 동작한다.
 */
export function postgresDb(url: string, opts: { max?: number; connectionTimeoutMillis?: number } = {}): Db {
  const pool = new Pool({
    connectionString: url,
    max: opts.max ?? 5,
    // 서버리스 인스턴스는 요청이 없으면 일시정지되고, 그동안 풀러·NAT가 끊은 소켓을 재개 후 다시 쓰면 멈춘다.
    // 유휴 연결은 5초 뒤 닫고, attachDatabasePool이 그 5초 동안 인스턴스를 살려 둔다.
    idleTimeoutMillis: 5_000,
    // 연결이 막히면 함수 제한 시간(60초)까지 기다리지 않고 10초 안에 실패한다(값을 바꾸는 것은 시간 초과 오류를 만드는 테스트뿐)
    connectionTimeoutMillis: opts.connectionTimeoutMillis ?? 10_000,
    ssl: sslOptions(url),
    types: PG_TYPES,
  });
  // 유휴 연결이 끊기면 풀이 'error'를 낸다. 받는 곳이 없으면 프로세스가 죽는다. 비밀값이 섞이지 않게 코드·메시지만 남긴다.
  pool.on("error", (e: Error & { code?: string }) => console.error(`[db] 유휴 연결 오류(풀에서 뺌): ${e.code ?? ""} ${e.message}`));
  // Vercel 밖(로컬·스크립트·테스트)에서는 아무것도 하지 않는다(VERCEL_URL·VERCEL_REGION이 없으면 바로 끝남).
  attachDatabasePool(pool);

  async function tx<T>(fn: (inner: Db) => Promise<T>): Promise<T> {
    const client = await pool.connect();
    // 빌려 온 클라이언트는 풀의 오류 처리 밖에 있다. 연결이 끊기면 'error'를 내는데 받는 곳이 없으면 프로세스가 죽으므로 여기서 받고,
    // 끊긴 클라이언트는 풀에 돌려보내지 않고 버린다(release(err)). 그대로 돌려보내면 다음 요청이 죽은 연결을 받는다.
    let broken: Error | undefined;
    const onError = (e: Error) => {
      broken = e;
    };
    client.on("error", onError);
    try {
      await client.query("BEGIN");
      const result = await fn(wrap(client));
      await client.query("COMMIT");
      return result;
    } catch (e) {
      if (!broken) {
        await client.query("ROLLBACK").catch((re: Error) => {
          broken = re;
        });
      }
      throw e;
    } finally {
      client.off("error", onError);
      client.release(broken);
    }
  }

  const wrap = (c: Pool | PoolClient): Db => ({
    async query<T>(text: string, params: unknown[] = []) {
      // 매개변수가 없으면 단순 프로토콜, 있으면 이름 없는 확장 프로토콜로 보낸다(둘 다 트랜잭션 풀러에서 동작)
      return (await c.query(text, params)).rows as T[];
    },
    tx,
    async exec(text: string) {
      await c.query(text); // 값 없이 보내면 단순 프로토콜이라 여러 문장(마이그레이션)을 한 번에 실행한다
    },
  });
  return { ...wrap(pool), end: () => pool.end() };
}

const g = globalThis as unknown as { __signalsDb?: Promise<Db> };

/** 앱 전체에서 하나의 연결(개발 서버 재시작 중에도 유지). */
export function getDb(): Promise<Db> {
  if (!g.__signalsDb) {
    g.__signalsDb = (async () => {
      const url = process.env.DATABASE_URL;
      if (url) {
        // 미리보기 배포는 브랜치 push·PR마다 자동으로 생긴다. 거기에 운영 DATABASE_URL이 들어가면 검토 전 코드가
        // 지울 수 없는 기록(발행·청산·앵커·탈퇴 처리)을 운영 DB에 남길 수 있어 연결하지 않는다(서명 키도 같은 규칙, keys.ts).
        if (previewDeploymentBlocked()) {
          throw new ConfigError(
            `미리보기 배포(VERCEL_ENV=${process.env.VERCEL_ENV ?? "없음"})에서는 DATABASE_URL로 연결하지 않습니다. Vercel 환경변수 DATABASE_URL은 Production에만 두세요(따로 만든 시험용 DB라면 ALLOW_PREVIEW_DB=1).`,
            "PREVIEW_BLOCKED",
          );
        }
        return postgresDb(url); // 배포 DB는 npm run db:migrate로 명시적으로 마이그레이션한다
      }
      // 배포에서 DATABASE_URL이 빠졌을 때 조용히 PGlite로 떨어지면, 서버리스의 임시 디스크에 기록이 쌓였다가 사라진다.
      if (process.env.NODE_ENV === "production" && !process.env.PGLITE_DIR) {
        throw new ConfigError("배포 환경에는 DATABASE_URL이 필요합니다(.env.example 참고). 로컬에서 next start로 시험할 때만 PGLITE_DIR을 지정하세요.");
      }
      const dir = process.env.PGLITE_DIR ?? ".data/pglite";
      ensurePgliteParent(dir);
      const db = pgliteDb(new PGlite(dir));
      await runMigrations(db);
      return db;
    })();
  }
  return g.__signalsDb;
}

/**
 * 스크립트 종료용: getDb()가 연 연결을 닫는다(열지 않았거나 여는 데 실패했으면 아무것도 하지 않음).
 * 스크립트는 process.exit() 대신 종료 코드만 정하고 끝나는데(scripts/anchor.ts), 열어 둔 PGlite는 타이머로 종료를 10초쯤 붙잡고
 * 원격 DB 연결 풀은 유휴 연결이 닫힐 때까지 붙잡는다. 그래서 끝나기 전에 닫는다.
 */
export async function closeDb(): Promise<void> {
  const p = g.__signalsDb;
  g.__signalsDb = undefined;
  await p?.then(
    (db) => db.end?.(),
    () => undefined,
  );
}
