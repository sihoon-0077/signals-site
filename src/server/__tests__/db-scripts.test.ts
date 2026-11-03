// 운영자 PC에서 도는 DB 스크립트(npm run db:migrate·anchor, 흐름은 src/server/cli.ts)의 안전장치.
// - db:migrate: 대상 줄에 TLS 방식을 보이고, 원격인데 서버 인증서를 확인할 수 없으면(encrypt-only) 접속 전에 멈춘다(비밀번호를 보내지 않음)
// - anchor: DATABASE_URL이 없으면 --local 없이는 멈춘다(로컬 DB에 만든 앵커를 운영 복구로 착각하지 않게).
//   원격이면 18시(KST)·TLS·키(환경변수 운영 키만)를 DB 접속 전에 확인한다
// - 새로 clone한 폴더(.data 없음)에서도 로컬 PGlite 폴더를 만든다
// '접속하지 않았다'는 가짜 TCP 서버가 받은 연결 수로 확인한다. 127.0.0.1은 TLS를 쓰지 않는 로컬 주소라 원격 흉내는 127.0.0.2를 쓴다.
// 개발자 PC의 .data(로컬 DB·개발용 키)는 건드리지 않는다: PGlite는 임시 폴더에, 개발용 키가 필요한 경우는 작업 폴더를 임시 폴더로 바꾼다.
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { expectedKeyId } from "@/core/keys";
import { exportPrivateKeyPem, exportPublicKeyPem, generateSigningKeyPair, publicKeyFingerprint } from "@/core/signature";
import { type Db, closeDb, ensurePgliteParent, getDb, pgliteDb } from "../db";
import { runMigrations } from "../migrate";

const ROOT = process.cwd(); // 프로젝트 폴더(db/migrations를 복사해 올 곳)
const g = globalThis as unknown as { __signalsDb?: Promise<Db> };

const ENV_NAMES = [
  "DATABASE_URL",
  "DATABASE_CA_PEM",
  "PGLITE_DIR",
  "ALLOW_UNVERIFIED_TLS",
  "ALLOW_DEV_KEYS",
  "ALLOW_PREVIEW_DB",
  "ANCHOR_OUT_DIR",
  "SITE_URL",
  "VERCEL",
  "VERCEL_ENV",
  "VERCEL_PROJECT_PRODUCTION_URL",
  ...["SIGNING", "CHECKPOINT"].flatMap((p) => [`${p}_KEY_ID`, `${p}_KEY_CREATED_AT`, `${p}_PRIVATE_KEY_PEM`]),
];

const tmps: string[] = [];
const tmp = () => {
  const d = mkdtempSync(path.join(tmpdir(), "signals-scripts-"));
  tmps.push(d);
  return d;
};

/** 스크립트 출력 모음 */
function collect() {
  const lines: string[] = [];
  const io = { log: (m: string) => lines.push(m), warn: (m: string) => lines.push(`WARN ${m}`), error: (m: string) => lines.push(`ERR ${m}`) };
  return { io, lines, text: () => lines.join("\n") };
}

/** 서명 키 캐시(keys.ts)가 경우마다 새로 시작하게 cli를 새로 불러온다 */
const freshCli = async () => {
  vi.resetModules();
  return import("../cli");
};

/** 받은 TCP 연결 수만 세고 바로 끊는 서버. 그 주소에서 들을 수 없으면(macOS의 127.0.0.2 등) null */
async function countingServer(host: string): Promise<{ port: number; count: () => number; close: () => Promise<void> } | null> {
  let n = 0;
  const server = net.createServer((s) => {
    n++;
    s.on("error", () => {});
    s.destroy();
  });
  const ok = await new Promise<boolean>((resolve) => {
    server.once("error", () => resolve(false));
    server.listen(0, host, () => resolve(true));
  });
  if (!ok) return null;
  return { port: (server.address() as net.AddressInfo).port, count: () => n, close: () => new Promise((r) => server.close(() => r())) };
}

/** keygen과 같은 모양의 운영 키 환경변수(키 ID = 공개키 지문 앞부분) */
async function stubProdKeys() {
  for (const [purpose, prefix] of [
    ["signal", "SIGNING"],
    ["checkpoint", "CHECKPOINT"],
  ] as const) {
    const kp = await generateSigningKeyPair();
    const fp = await publicKeyFingerprint(await exportPublicKeyPem(kp.publicKey));
    vi.stubEnv(`${prefix}_KEY_ID`, expectedKeyId(purpose, fp));
    vi.stubEnv(`${prefix}_KEY_CREATED_AT`, "2026-10-30T01:02:03.456Z");
    vi.stubEnv(`${prefix}_PRIVATE_KEY_PEM`, (await exportPrivateKeyPem(kp.privateKey)).replace(/\n/g, "\\n"));
  }
}

/** 시계를 정한 시각(UTC ISO)으로 고정한다. Date만 바꾼다(타이머·소켓은 그대로). */
const at = (utc: string) => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(utc));
};

/** getDb()가 만든 연결을 닫고 다음 경우가 새로 열게 한다(스크립트가 끝날 때 쓰는 closeDb 그대로) */
const closeGlobalDb = closeDb;

let local: Awaited<ReturnType<typeof countingServer>>;
let remote: Awaited<ReturnType<typeof countingServer>>;

beforeAll(async () => {
  local = await countingServer("127.0.0.1");
  remote = await countingServer("127.0.0.2");
});
afterAll(async () => {
  await local?.close();
  await remote?.close();
});
beforeEach(() => {
  for (const n of ENV_NAMES) vi.stubEnv(n, undefined);
});
afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await closeGlobalDb();
  for (const d of tmps.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("로컬 PGlite 폴더(새로 clone한 폴더에는 .data가 없다)", () => {
  it("파일 경로면 부모 폴더까지 만들고(PGlite는 마지막 단계만 만든다), memory:// 등 파일이 아닌 주소는 건드리지 않는다", () => {
    const base = tmp();
    ensurePgliteParent(path.join(base, "a", "b", "pglite"));
    expect([existsSync(path.join(base, "a", "b")), existsSync(path.join(base, "a", "b", "pglite"))]).toEqual([true, false]);
    ensurePgliteParent(`file://${path.join(base, "c", "pglite")}`);
    expect(existsSync(path.join(base, "c"))).toBe(true);
    // file://이 붙은 채로 폴더를 만들지 않는다(예전 제안대로 dirname만 쓰면 Linux에서 './file:' 잡폴더가 생김)
    expect(existsSync(path.join(process.cwd(), "file:"))).toBe(false);
    for (const d of ["memory://", "memory://x/y", "idb://signals", "opfs-ahp://signals", ""]) expect(() => ensurePgliteParent(d), d).not.toThrow();
  });
});

describe("스크립트 종료 전 DB 닫기(closeDb)", () => {
  it("getDb()가 연 PGlite를 닫고 다음 getDb()는 새로 연다. 열지 않았거나 여는 데 실패했으면 아무것도 하지 않는다", async () => {
    await expect(closeDb()).resolves.toBeUndefined(); // 연 적 없음
    vi.stubEnv("PGLITE_DIR", "memory://");
    const first = await getDb();
    await closeDb();
    expect(g.__signalsDb).toBeUndefined();
    await expect(first.query("SELECT 1")).rejects.toThrow(); // 닫힌 연결
    const second = await getDb();
    expect(second).not.toBe(first);
    expect(await second.query<{ n: number }>("SELECT 1 AS n")).toEqual([{ n: 1 }]);
    await closeDb();
    // 실패한 연결(미리보기 배포 차단)도 던지지 않고 비운다
    vi.stubEnv("DATABASE_URL", "postgresql://u:p@db.example.invalid:6543/postgres");
    vi.stubEnv("VERCEL", "1");
    vi.stubEnv("VERCEL_ENV", "preview");
    await expect(getDb()).rejects.toMatchObject({ code: "PREVIEW_BLOCKED" });
    await expect(closeDb()).resolves.toBeUndefined();
    expect(g.__signalsDb).toBeUndefined();
  });
});

describe("npm run db:migrate", () => {
  it("원격 주소인데 DATABASE_CA_PEM이 없으면 'TLS encrypt-only'를 보이고 접속 전에 멈춘다(종료 코드 1, 연결 0)", async (ctx) => {
    if (!remote) return ctx.skip("127.0.0.2에서 들을 수 없음");
    vi.stubEnv("DATABASE_URL", `postgresql://postgres.abcdefghijklmnop:pw@127.0.0.2:${remote.port}/postgres`);
    const before = remote.count();
    const out = collect();
    expect(await (await freshCli()).migrateCli(out.io)).toBe(1);
    expect(out.lines[0]).toBe(`대상: postgres.abcdefghijklmnop@127.0.0.2:${remote.port}/postgres · TLS encrypt-only`);
    expect(out.text()).toMatch(/ERR DATABASE_CA_PEM이 비어 있어 DB 서버 인증서를 확인할 수 없습니다/);
    expect(out.text()).not.toContain("pw"); // 비밀번호는 출력하지 않는다
    expect(remote.count() - before).toBe(0);
  });

  it("ALLOW_UNVERIFIED_TLS=1이면 그대로 접속을 시도한다(인증서 없는 시험용 DB)", async (ctx) => {
    if (!remote) return ctx.skip("127.0.0.2에서 들을 수 없음");
    vi.stubEnv("DATABASE_URL", `postgresql://u:pw@127.0.0.2:${remote.port}/postgres`);
    vi.stubEnv("ALLOW_UNVERIFIED_TLS", "1");
    const before = remote.count();
    const out = collect();
    await expect((await freshCli()).migrateCli(out.io)).rejects.toThrow(); // 가짜 서버가 바로 끊는다 → 스크립트는 종료 코드 1
    expect(out.lines[0]).toMatch(/· TLS encrypt-only$/);
    expect(remote.count() - before).toBeGreaterThanOrEqual(1);
  });

  it("인증서가 있으면 verify-full로 표시하고 멈추지 않는다", async (ctx) => {
    if (!remote) return ctx.skip("127.0.0.2에서 들을 수 없음");
    const tls = await import("node:tls");
    vi.stubEnv("DATABASE_URL", `postgresql://u:pw@127.0.0.2:${remote.port}/postgres`);
    vi.stubEnv("DATABASE_CA_PEM", tls.rootCertificates[0]);
    const out = collect();
    await expect((await freshCli()).migrateCli(out.io)).rejects.toThrow(); // 가짜 서버라 연결은 실패
    expect(out.lines[0]).toMatch(/· TLS verify-full$/);
    expect(out.text()).not.toMatch(/ERR DATABASE_CA_PEM/);
  });

  it("localhost 주소(로컬 DB)는 지금처럼 TLS 없이 적용한다", async () => {
    const pg = new PGlite();
    const server = new PGLiteSocketServer({ db: pg, port: 0, host: "127.0.0.1", maxConnections: 4 });
    await server.start();
    try {
      const port = Number(server.getServerConn().split(":")[1]);
      vi.stubEnv("DATABASE_URL", `postgres://postgres:postgres@127.0.0.1:${port}/postgres`);
      const out = collect();
      expect(await (await freshCli()).migrateCli(out.io)).toBe(0);
      expect(out.lines).toEqual([
        `대상: postgres@127.0.0.1:${port}/postgres · TLS off-localhost`,
        "적용: 0001_init.sql, 0002_rls.sql, 0003_hardening.sql, 0004_providers_privacy.sql, 0005_indexes.sql",
      ]);
    } finally {
      await server.stop();
      await pg.close();
    }
  });

  it("DATABASE_URL이 없으면 로컬 PGlite: 부모 폴더가 없어도 만들고 적용한다(대상 줄에 TLS 없음)", async () => {
    const dir = path.join(tmp(), "fresh-clone", ".data", "pglite");
    vi.stubEnv("PGLITE_DIR", dir);
    const out = collect();
    expect(await (await freshCli()).migrateCli(out.io)).toBe(0);
    expect(out.lines[0]).toBe(`대상: 로컬 PGlite(${path.resolve(dir)}) — 운영 DB가 아닙니다`);
    expect(out.lines[1]).toMatch(/^적용: 0001_init\.sql, .*0005_indexes\.sql$/);
    // 다시 돌리면 같은 폴더를 열어 아무것도 하지 않는다(위 실행이 연결을 닫았다)
    const again = collect();
    expect(await (await freshCli()).migrateCli(again.io)).toBe(0);
    expect(again.lines[1]).toBe("새로 적용할 마이그레이션이 없습니다.");
  });
});

describe("npm run anchor", () => {
  it("DATABASE_URL이 없으면 --local 없이는 멈춘다: 대상만 보이고 DB·키를 열지 않는다(종료 코드 1)", async () => {
    const dir = path.join(tmp(), "pglite");
    vi.stubEnv("PGLITE_DIR", dir);
    const out = collect();
    expect(await (await freshCli()).anchorCli([], out.io)).toBe(1);
    expect(out.lines).toEqual([
      `대상: 로컬 PGlite(${path.resolve(dir)}) — 운영 DB가 아닙니다`,
      "ERR 운영 DB가 아닙니다. 로컬 시험이면 npm run anchor -- --local",
      "ERR 운영 앵커 복구는 운영 사이트 /admin의 '오늘(KST) 앵커 만들기'(18시 이후)로 합니다.",
    ]);
    expect(g.__signalsDb).toBeUndefined();
    expect(existsSync(dir)).toBe(false);
  });

  it("DATABASE_URL과 --local을 함께 주면 멈춘다", async () => {
    vi.stubEnv("DATABASE_URL", `postgres://u:pw@127.0.0.1:${local!.port}/db`);
    const out = collect();
    expect(await (await freshCli()).anchorCli(["--local"], out.io)).toBe(1);
    expect(out.text()).toMatch(/ERR --local은 로컬 PGlite 시험용인데 DATABASE_URL이 있어 멈춥니다/);
  });

  it("원격 DB: 18시(KST) 전이면 DB에 접속하지 않고 멈춘다", async () => {
    vi.stubEnv("DATABASE_URL", `postgres://u:pw@127.0.0.1:${local!.port}/db`);
    await stubProdKeys();
    const before = local!.count();
    for (const utc of ["2026-11-10T15:00:05Z", "2026-11-11T08:59:59Z"]) {
      at(utc);
      const out = collect();
      expect(await (await freshCli()).anchorCli([], out.io), utc).toBe(1);
      expect(out.text()).toMatch(/ERR 18시\(KST\) 전에는 운영 앵커를 만들지 않습니다\(지금 KST (00:00|17:59)\)/);
    }
    expect(local!.count() - before).toBe(0);
  });

  it("원격 DB: 인증서를 확인할 수 없는 연결(encrypt-only)이면 접속 전에 멈춘다", async (ctx) => {
    if (!remote) return ctx.skip("127.0.0.2에서 들을 수 없음");
    vi.stubEnv("DATABASE_URL", `postgres://u:pw@127.0.0.2:${remote.port}/db`);
    await stubProdKeys();
    at("2026-11-10T10:00:00Z"); // KST 19:00
    const before = remote.count();
    const out = collect();
    expect(await (await freshCli()).anchorCli([], out.io)).toBe(1);
    expect(out.lines[0]).toMatch(/· TLS encrypt-only$/);
    expect(remote.count() - before).toBe(0);
  });

  it("원격 DB: 키 환경변수가 없으면 DB보다 먼저 멈춘다(연결 0)", async () => {
    vi.stubEnv("DATABASE_URL", `postgres://u:pw@127.0.0.1:${local!.port}/db`);
    at("2026-11-10T10:00:00Z");
    const before = local!.count();
    const out = collect();
    expect(await (await freshCli()).anchorCli([], out.io)).toBe(1);
    expect(out.text()).toMatch(/ERR signal 서명 키 환경변수 없이 원격 DB\(DATABASE_URL\)에 쓸 수 없습니다/);
    expect(local!.count() - before).toBe(0);
  });

  it("원격 DB: ALLOW_DEV_KEYS=1이어도 개발용 키로는 만들지 않는다(키 출처 dev를 보이고 멈춤, 연결 0)", async () => {
    vi.stubEnv("DATABASE_URL", `postgres://u:pw@127.0.0.1:${local!.port}/db`);
    vi.stubEnv("ALLOW_DEV_KEYS", "1");
    at("2026-11-10T10:00:00Z");
    const work = tmp(); // 개발용 키 파일은 이 임시 작업 폴더의 .data/keys에 생긴다
    const cli = await freshCli();
    const before = local!.count();
    const out = collect();
    vi.spyOn(process, "cwd").mockReturnValue(work);
    const code = await cli.anchorCli([], out.io);
    vi.mocked(process.cwd).mockRestore();
    expect(code).toBe(1);
    expect(out.text()).toMatch(/키: 시그널 sig-dev-[0-9a-f]{8}\(dev: 개발용 \.data\/keys\), 체크포인트 cp-dev-[0-9a-f]{8}\(dev: 개발용 \.data\/keys\)/);
    expect(out.text()).toMatch(/ERR 원격 DB에는 개발용 키로 앵커를 만들지 않습니다/);
    expect(existsSync(path.join(work, ".data", "keys", "signal.json"))).toBe(true);
    expect(local!.count() - before).toBe(0);
  });

  it("원격 DB 정상 경로: 18시 이후·운영 키·localhost DB → 앵커를 만들고 키 출처(env)와 운영 /anchors 확인 안내를 출력한다", async () => {
    const pg = new PGlite();
    await runMigrations(pgliteDb(pg));
    const server = new PGLiteSocketServer({ db: pg, port: 0, host: "127.0.0.1", maxConnections: 4 });
    await server.start();
    try {
      const port = Number(server.getServerConn().split(":")[1]);
      vi.stubEnv("DATABASE_URL", `postgres://postgres:postgres@127.0.0.1:${port}/postgres`);
      vi.stubEnv("SITE_URL", "https://signals.example");
      vi.stubEnv("ANCHOR_OUT_DIR", tmp());
      await stubProdKeys();
      at("2026-11-10T10:00:00Z"); // KST 19:00
      const out = collect();
      expect(await (await freshCli()).anchorCli([], out.io)).toBe(0);
      expect(out.lines[0]).toBe(`대상: postgres@127.0.0.1:${port}/postgres · TLS off-localhost`);
      expect(out.lines[1]).toMatch(/^키: 시그널 sig-[0-9a-f]{12}\(env: 환경변수\), 체크포인트 cp-[0-9a-f]{12}\(env: 환경변수\)$/);
      expect(out.text()).toMatch(/앵커 생성: 2026-11-10 루트 [0-9a-f]{64} \(에이전트 0개, 타임스탬프 0건, 체크포인트 키 cp-[0-9a-f]{12}\)/);
      expect(out.text()).toContain("확인: 시크릿 창에서 https://signals.example/anchors에 2026-11-10 앵커가 보이는지 확인하세요");
    } finally {
      await closeGlobalDb();
      await server.stop();
      await pg.close();
    }
  });

  it("--local: 새로 clone한 폴더(.data 없음)에서도 로컬 PGlite·개발용 키로 오늘 앵커를 만들고, 운영 기록이 아니라고 알린다", async () => {
    const work = tmp(); // 새 clone 흉내: db/migrations만 있고 .data는 없다
    // fs.cpSync는 쓰지 않는다: Node 24.8(Windows)의 cpSync는 한글 경로(바탕 화면 등)에서 프로세스째 죽는다(0xC0000409)
    mkdirSync(path.join(work, "db", "migrations"), { recursive: true });
    for (const f of readdirSync(path.join(ROOT, "db", "migrations"))) copyFileSync(path.join(ROOT, "db", "migrations", f), path.join(work, "db", "migrations", f));
    const dir = path.join(work, ".data", "pglite");
    vi.stubEnv("PGLITE_DIR", dir);
    vi.stubEnv("ANCHOR_OUT_DIR", path.join(work, "anchors-out"));
    const cli = await freshCli();
    const out = collect();
    vi.spyOn(process, "cwd").mockReturnValue(work);
    try {
      expect(await cli.anchorCli(["--local"], out.io)).toBe(0);
    } finally {
      vi.mocked(process.cwd).mockRestore();
    }
    const today = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
    expect(out.lines[0]).toBe(`대상: 로컬 PGlite(${path.resolve(dir)}) — 운영 DB가 아닙니다`);
    expect(out.lines[1]).toMatch(/^키: 시그널 sig-dev-[0-9a-f]{8}\(dev: 개발용 \.data\/keys\), 체크포인트 cp-dev-[0-9a-f]{8}\(dev: 개발용 \.data\/keys\)$/);
    expect(out.text()).toMatch(new RegExp(`앵커 생성: ${today} 루트 [0-9a-f]{64} \\(에이전트 0개`));
    expect(out.lines.at(-1)).toBe("로컬 PGlite에만 만들었습니다. 운영 기록은 바뀌지 않습니다.");
    expect([existsSync(path.join(work, ".data", "keys", "checkpoint.json")), existsSync(path.join(work, "anchors-out", "anchors", `${today}.json`))]).toEqual([true, true]);
  });
});
