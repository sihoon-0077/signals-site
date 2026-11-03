// scripts/의 명령을 운영자가 치는 것과 같이 별도 프로세스(tsx)로 실행한다. 종료 코드와 출력 줄까지 확인하기 위해서다.
// 비동기로 띄우므로 같은 테스트 프로세스 안의 가짜 HTTP 서버가 응답할 수 있다(spawnSync는 이벤트 루프를 막는다).
// 마지막 출력 뒤 프로세스가 끝나기까지 걸린 시간(tailMs)도 잰다: 열어 둔 DB·타이머가 종료를 붙잡는지 보기 위해서다.
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const TSX_CLI = createRequire(import.meta.url).resolve("tsx/cli");

export interface ScriptResult {
  /** 종료 코드. 시간 초과로 끊겼으면 null */
  code: number | null;
  stdout: string;
  stderr: string;
  /** 마지막 출력(stdout·stderr)부터 프로세스 종료까지 걸린 시간(ms) */
  tailMs: number;
}

export interface ScriptOptions {
  /** 작업 폴더(기본: 프로젝트 폴더). 개발용 키(.data/keys)·마이그레이션 폴더를 작업 폴더 기준으로 읽는 스크립트는 임시 폴더를 준다 */
  cwd?: string;
  /** tsx 옵션(예: npm 스크립트와 같은 --conditions=react-server) */
  tsxArgs?: string[];
  /** 이 시간이 지나면 끊는다(기본 60초). DB를 여는 스크립트는 다른 테스트와 함께 돌 때 느려지므로 더 길게 준다 */
  timeoutMs?: number;
}

export function runScript(script: string, args: string[], env: Record<string, string | undefined> = {}, opts: ScriptOptions = {}): Promise<ScriptResult> {
  return new Promise((resolve) => {
    // 작업 폴더를 바꿔도 프로젝트의 tsconfig(@/ 경로)를 쓰게 한다(tsx는 기본으로 작업 폴더의 tsconfig.json을 찾는다)
    const tsx = [TSX_CLI, "--tsconfig", path.join(ROOT, "tsconfig.json"), ...(opts.tsxArgs ?? [])];
    const child = spawn(process.execPath, [...tsx, path.join(ROOT, "scripts", script), ...args], {
      cwd: opts.cwd ?? ROOT,
      env: { ...process.env, ...env },
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    let lastOutput = Date.now();
    let exitedAt = 0;
    let timedOut = false;
    child.stdout.setEncoding("utf8").on("data", (s: string) => {
      stdout += s;
      lastOutput = Date.now();
    });
    child.stderr.setEncoding("utf8").on("data", (s: string) => {
      stderr += s;
      lastOutput = Date.now();
    });
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, opts.timeoutMs ?? 60_000);
    child.on("exit", () => {
      exitedAt = Date.now();
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: timedOut ? null : code, stdout, stderr, tailMs: Math.max(0, (exitedAt || Date.now()) - lastOutput) });
    });
  });
}
