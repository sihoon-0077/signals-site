// TSA에 요청하는 로컬 스크립트(npm run anchor -- --local, npm run seed:dev)가 정상 종료 코드로 곧바로 끝나는지 본다.
//  - Windows(Node 24)에서 fetch 직후 process.exit()를 부르면 libuv 검사에 걸려 0xC0000409(3221226505)로 죽었다.
//    두 TSA가 모두 HTTP 오류(재시도 포함 4번 요청)일 때 수정 전 anchor.ts는 매번 이렇게 끝났다(앵커 파일은 만들어진 뒤).
//  - process.exit() 대신 종료 코드만 정하면, 열어 둔 PGlite가 마지막 줄 뒤에도 10초쯤 종료를 붙잡는다(DB를 닫아야 곧바로 끝남).
// TSA는 이 테스트가 127.0.0.1에 띄운 가짜 서버(항상 503)다. 개발자 PC의 .data(로컬 DB·개발용 키)를 건드리지 않게
// 작업 폴더를 임시 폴더로 바꾼다(개발용 키·마이그레이션 폴더는 작업 폴더 기준). PGlite는 메모리에 둔다(memory://):
// 파일 DB를 새로 만들면 다른 테스트와 함께 돌 때 디스크 경합으로 수십 초씩 늘어진다. 두 증상(0xC0000409, 10초 붙잡힘)은 메모리 DB에서도 같다.
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runScript } from "./run-script";

const ROOT = process.cwd();
/** 마지막 출력 뒤 이 시간 안에 끝나야 한다(DB를 닫으면 1초 안, 열어 두면 약 10초) */
const PROMPT_EXIT_MS = 5_000;
/** 스크립트 하나(PGlite 준비·마이그레이션 포함)에 주는 시간. 혼자 돌면 5~15초, 전체 테스트와 함께면 더 걸린다 */
const SCRIPT_TIMEOUT_MS = 150_000;

let server: Server;
let tsaUrls = "";
let hits = 0;
const tmps: string[] = [];

/** 새로 clone한 폴더처럼 db/migrations만 있는 임시 작업 폴더 */
function workDir(): string {
  const work = mkdtempSync(path.join(tmpdir(), "signals-exit-"));
  tmps.push(work);
  // fs.cpSync는 쓰지 않는다: Node 24.8(Windows)의 cpSync는 한글 경로(바탕 화면 등)에서 프로세스째 죽는다(0xC0000409)
  mkdirSync(path.join(work, "db", "migrations"), { recursive: true });
  for (const f of readdirSync(path.join(ROOT, "db", "migrations"))) copyFileSync(path.join(ROOT, "db", "migrations", f), path.join(work, "db", "migrations", f));
  return work;
}

/** npm 스크립트와 같은 tsx 옵션으로, 임시 작업 폴더에서 실행한다 */
function run(script: string, args: string[], work: string, env: Record<string, string | undefined> = {}) {
  return runScript(
    script,
    args,
    { DATABASE_URL: undefined, NODE_ENV: undefined, PGLITE_DIR: "memory://", ANCHOR_OUT_DIR: path.join(work, "anchors-out"), TSA_URLS: tsaUrls, ...env },
    { cwd: work, tsxArgs: ["--conditions=react-server"], timeoutMs: SCRIPT_TIMEOUT_MS },
  );
}

beforeAll(async () => {
  server = createServer((req, res) => {
    hits++;
    req.resume();
    req.on("end", () => {
      res.writeHead(503, { "content-type": "text/plain" });
      res.end("unavailable");
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  tsaUrls = `a=${base}/a,b=${base}/b`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  for (const d of tmps.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("TSA에 요청한 뒤 끝나는 로컬 스크립트", () => {
  it("npm run anchor -- --local: 두 TSA가 모두 503이어도 종료 코드 0으로 곧바로 끝나고 앵커 파일을 남긴다", async () => {
    const work = workDir();
    const before = hits;
    const r = await run("anchor.ts", ["--local"], work);
    expect(r.stderr).not.toContain("Assertion failed");
    expect(r.code).toBe(0);
    expect(hits - before).toBe(4); // TSA 2곳 × (첫 요청 + 재시도 1번)
    expect(r.stdout).toMatch(/앵커 생성: \d{4}-\d{2}-\d{2} 루트 [0-9a-f]{64} \(에이전트 0개, 타임스탬프 0건/);
    expect(r.stderr).toContain("타임스탬프 실패: a: HTTP 503; b: HTTP 503");
    expect(r.stdout.trim().split("\n").at(-1)).toBe("로컬 PGlite에만 만들었습니다. 운영 기록은 바뀌지 않습니다.");
    expect(readdirSync(path.join(work, "anchors-out", "anchors"))).toHaveLength(1);
    // 개발용 키는 작업 폴더(임시)에 생겼다
    expect(existsSync(path.join(work, ".data", "keys", "checkpoint.json"))).toBe(true);
    expect(r.tailMs).toBeLessThan(PROMPT_EXIT_MS);
  }, SCRIPT_TIMEOUT_MS + 30_000);

  it("npm run seed:dev: 발행·앵커의 TSA 요청이 모두 503이어도 종료 코드 0으로 곧바로 끝난다", async () => {
    const work = workDir();
    const before = hits;
    const r = await run("seed-dev.ts", [], work);
    expect(r.stderr).not.toContain("Assertion failed");
    expect(r.code).toBe(0);
    expect(hits - before).toBeGreaterThan(4);
    expect(r.stdout).toMatch(/발행 #1 005930 .*타임스탬프 0건 \(실패: a: HTTP 503; b: HTTP 503\)/);
    expect(r.stdout.trim().split("\n").at(-1)).toMatch(/^앵커 생성: \d{4}-\d{2}-\d{2} 루트 [0-9a-f]{16}…$/);
    expect(r.tailMs).toBeLessThan(PROMPT_EXIT_MS);
  }, SCRIPT_TIMEOUT_MS + 30_000);

  it("seed:dev는 DATABASE_URL이 있으면 아무 데도 쓰지 않고 종료 코드 1로 끝난다", async () => {
    const work = workDir();
    const before = hits;
    // 파일 DB 경로를 줘서 DB를 열지 않았는지(.data가 생기지 않음) 본다
    const r = await run("seed-dev.ts", [], work, { DATABASE_URL: "postgresql://u:p@db.example.invalid:6543/postgres", PGLITE_DIR: path.join(work, ".data", "pglite") });
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("seed:dev는 로컬 PGlite 전용입니다");
    expect(existsSync(path.join(work, ".data"))).toBe(false);
    expect(hits - before).toBe(0);
    expect(r.tailMs).toBeLessThan(PROMPT_EXIT_MS);
  }, SCRIPT_TIMEOUT_MS + 30_000);
});
