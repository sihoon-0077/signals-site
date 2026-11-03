// 명령줄 검증기(scripts/verify.ts)를 실제로 실행해 본다. 이 검증기는 사이트를 믿지 않는 쪽이 쓰므로,
// 사이트가 준 문자열의 제어 문자(ANSI 이스케이프 등)로 앞의 '불일치' 줄을 지우거나 덮어쓸 수 없어야 하고,
// 경로 이탈 앵커 날짜의 묶음은 종료 코드 1(불일치)로 끝나야 한다(R07).
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { type IncomingMessage, type ServerResponse, createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { runScript } from "../../../scripts/__tests__/run-script";
import { type SignalFieldsV2, contentHashV2 } from "../canonical";
import { toBase64 } from "../encoding";
import type { KeysFile } from "../keys";
import { exportPublicKeyPem, generateSigningKeyPair, publicKeyFingerprint, signMessage } from "../signature";
import { parseTimestampToken } from "../tsa";
import type { SignalBundle } from "../verify";

const ROOT = process.cwd();
const TSX = path.join(ROOT, "node_modules", "tsx", "dist", "cli.mjs");
const dir = mkdtempSync(path.join(tmpdir(), "verify-cli-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const run = (...args: string[]) => spawnSync(process.execPath, [TSX, "scripts/verify.ts", ...args], { cwd: ROOT, encoding: "utf8", timeout: 60_000 });

const ESC = "\u001b";
const bundle = {
  signal: {
    id: `3c2b1a09-8f7e-4d6c-9b5a-4f3e2d1c0b9a${ESC}]0;title\u0007`,
    agent_id: "6f1c2a7e-3b4d-4e5f-8a9b-0c1d2e3f4a5b",
    sequence_no: 1,
    canonical_version: 2,
    published_at: "2026-10-29T06:37:18.253Z",
    content_hash: "a".repeat(64),
    prev_hash: "0".repeat(64),
    signature: "",
    key_id: `sig${ESC}[2K${ESC}[1A‮`,
    revealed: false,
    fields: null,
  },
  previous: null,
  timestamps: [],
  anchor: {
    version: "anchor-v1",
    date: `9999/../../attacker/x${ESC}[1A${ESC}[2K`,
    merkle_root: "b".repeat(64),
    prev_root: null,
    leaf_count: 0,
    leaves: [],
    checkpoint_key_id: "cp",
    root_signature: "",
    created_at: "2026-10-29T09:00:00.000Z",
    timestamps: [],
  },
  keys: { version: 1, keys: [] },
};

describe("명령줄 검증기 출력", () => {
  it("사이트가 준 제어 문자는 '?'로 바꿔 찍고, 경로 이탈 날짜의 묶음은 불일치(종료 코드 1)로 끝난다", () => {
    const file = path.join(dir, "bundle.json");
    writeFileSync(file, JSON.stringify(bundle));
    const r = run(file);
    expect(r.error).toBeUndefined();
    expect(r.status).toBe(1);
    expect(r.stdout).toContain("[불일치] 일일 앵커(외부 고정)에 포함 — 앵커 날짜가 YYYY-MM-DD 형식의 실제 날짜가 아닙니다.");
    expect(r.stdout).toContain("키(sig?[2K?[1A?)"); // 지우지 않고 바꿔 찍어 무엇이 들어 있었는지 보이게 한다
    expect(r.stdout).toContain("종합: 불일치 있음");
    expect(r.stdout).not.toMatch(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f‪-‮⁦-⁩]/);
    expect(r.stdout).not.toContain("attacker");
  });

  it("사이트 주소와 함께 준 값이 ID·지문 형식이 아니면 요청하지 않고 멈춘다", () => {
    // 닫힌 포트: 요청을 보냈다면 이 문장 대신 네트워크 오류가 났을 것이다
    const r = run("http://127.0.0.1:9", "../../admin");
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("두 번째 값은 지문(64자리 16진수)이나 시그널 ID(UUID)여야 합니다");
  });
});

// ---- 실제로 서명한 정직한 묶음(앵커 없음, 발행 2026-10-29 KST, 실제 기관 토큰) ----
const fixtures = path.join(ROOT, "src", "core", "__tests__", "fixtures");
const fields: SignalFieldsV2 = JSON.parse(readFileSync(path.join(fixtures, "signal.json"), "utf8"));
const tok = (n: string) => new Uint8Array(readFileSync(path.join(fixtures, `${n}-token.der`)));
const honest = (async (): Promise<SignalBundle> => {
  const sig = await generateSigningKeyPair();
  const pem = await exportPublicKeyPem(sig.publicKey);
  const keys: KeysFile = {
    version: 1,
    keys: [{ key_id: "sig-test", purpose: "signal", algorithm: "ECDSA-P256-SHA256", public_key_pem: pem, fingerprint: await publicKeyFingerprint(pem), created_at: "2026-01-01T00:00:00.000Z", retired_at: null }],
  };
  const h = await contentHashV2(fields);
  return {
    signal: { id: fields.signalId, agent_id: fields.agentId, sequence_no: 1, canonical_version: 2, published_at: fields.publishedAt, content_hash: h, prev_hash: fields.prevHash, signature: await signMessage(sig.privateKey, h), key_id: "sig-test", revealed: true, fields },
    previous: null,
    timestamps: ["freetsa", "digicert"].map((n) => ({ tsa: n, token_b64: toBase64(tok(n)), gen_time: parseTimestampToken(tok(n)).genTime.toISOString() })),
    anchor: null,
    keys,
  };
})();

// 공개 저장소(raw.githubusercontent.com) 요청을 이 테스트의 가짜 서버로 돌리는 preload. 실제 fetch·소켓은 그대로 쓴다.
const preload = path.join(dir, "raw-to-local.mjs");
writeFileSync(
  preload,
  `const base = process.env.VERIFY_TEST_RAW_BASE;
const real = globalThis.fetch;
const raw = "https://raw.githubusercontent.com/";
globalThis.fetch = (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  return real(base && url.startsWith(raw) ? base + url.slice(raw.length) : input, init);
};
`,
);

/** 가짜 서버. 연결을 오래 유지해(keep-alive 120초) 읽지 않은 본문이 프로세스를 붙잡는 상황을 그대로 만든다. */
async function serve(handler: (req: IncomingMessage, res: ServerResponse) => void) {
  const server = createServer(handler);
  server.keepAliveTimeout = 120_000;
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    url,
    close: () =>
      new Promise<void>((r) => {
        server.closeAllConnections();
        server.close(() => r());
      }),
  };
}

/** 503 머리와 64KB 본문 일부만 보내고 응답을 끝내지 않는다(프록시 오류 화면이 느리게 오거나 멈춘 경우) */
const hangingError = (_req: IncomingMessage, res: ServerResponse) => {
  res.writeHead(503, { "content-type": "text/html" });
  res.write("x".repeat(64 * 1024));
};

const mirrorEnv = (base: string) => ({ NODE_OPTIONS: `--import=${pathToFileURL(preload).href}`, VERIFY_TEST_RAW_BASE: `${base}/raw/` });
const REPO = "https://github.com/acme/signals-anchors";

describe("명령줄 검증기: 사이트가 앵커를 빼고 보낸 오래된 기록(S09)", () => {
  it("저장소 키가 같아도 '확인 가능한 항목 모두 통과'(exit 0)가 아니라 '확인 못 함'(exit 2)으로 끝난다", async () => {
    const b = await honest;
    const file = path.join(dir, "noanchor.json");
    writeFileSync(file, JSON.stringify(b));
    const srv = await serve((req, res) => {
      if (req.url === "/raw/acme/signals-anchors/main/keys.json") res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(b.keys));
      else res.writeHead(404).end("404: Not Found");
    });
    try {
      const r = await runScript("verify.ts", [file, "--mirror", REPO], mirrorEnv(srv.url));
      expect(r.stdout).toContain("[통과] 공개키를 공개 저장소와 대조");
      expect(r.stdout).toContain("[확인 못 함] 앵커를 공개 저장소와 대조 — 사이트가 이 기록(2026-10-29, KST)을 담은 일일 앵커를 보내지 않았습니다");
      expect(r.stdout).toContain("종합: 공개 저장소와 대조하지 못함");
      expect(r.code).toBe(2);
    } finally {
      await srv.close();
    }
  }, 60_000);
});

// process.exit() 대신 exitCode로 끝내므로, 읽지 않은 오류 본문이 연결을 붙잡으면 결과를 찍은 뒤에도 끝나지 않았다(S27).
// 고치기 전 Windows Node 24에서는 이 두 경우 모두 출력 뒤 약 8초를 더 남았다(응답 객체가 GC로 정리될 때까지).
// tsx 시작 시간(1~3초)과 상관없이 '마지막 출력 뒤 바로 끝나는지'(tailMs)를 본다.
describe("명령줄 검증기: 오류 응답 뒤 바로 끝난다(S27)", () => {
  it("사이트가 503 본문을 끝내지 않아도 'HTTP 503'(exit 1)을 찍고 바로 끝난다", async () => {
    const srv = await serve(hangingError);
    try {
      const r = await runScript("verify.ts", [srv.url, "a".repeat(64)]);
      expect(r.stderr).toContain("HTTP 503");
      expect(r.code).toBe(1);
      expect(r.tailMs).toBeLessThan(3_000);
    } finally {
      await srv.close();
    }
  }, 60_000);

  it("공개 저장소의 keys.json이 503 본문을 끝내지 않아도 '확인 못 함'(exit 2)을 찍고 바로 끝난다", async () => {
    const file = path.join(dir, "mirror503.json");
    writeFileSync(file, JSON.stringify(await honest));
    const srv = await serve(hangingError);
    try {
      const r = await runScript("verify.ts", [file, "--mirror", REPO], mirrorEnv(srv.url));
      expect(r.stdout).toContain("공개키 목록을 받지 못했습니다(HTTP 503)");
      expect(r.code).toBe(2);
      expect(r.tailMs).toBeLessThan(3_000);
    } finally {
      await srv.close();
    }
  }, 60_000);
});

// Windows PowerShell 5.1은 Out-File·Set-Content -Encoding UTF8에 BOM을 붙이고, 기본 '>'는 UTF-16LE로 저장한다.
// 그런 파일이 'Unexpected token'(exit 1, 문서상 불일치와 같은 코드)으로 끝나지 않아야 하고, 불일치는 BOM이 있어도 불일치다(S32).
describe("명령줄 검증기: 다시 저장된 묶음 파일", () => {
  const write = (name: string, bytes: Buffer) => {
    const file = path.join(dir, name);
    writeFileSync(file, bytes);
    return file;
  };

  it("UTF-8 BOM·UTF-16LE로 다시 저장한 정직한 묶음도 그대로 검증한다(참고 문장 표시)", async () => {
    const json = JSON.stringify(await honest);
    for (const file of [
      write("bom-utf8.json", Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(json, "utf8")])),
      write("bom-utf16le.json", Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(json, "utf16le")])),
    ]) {
      const r = run(file);
      expect(r.stdout, file).toContain("참고: 이 파일은 내려받은 뒤 다른 도구로 다시 저장된 흔적(BOM)이 있습니다");
      expect(r.stdout, file).toContain("[통과] 원문으로 지문 다시 계산");
      expect(r.stderr, file).not.toContain("Unexpected token");
      expect(r.status, file).toBe(2); // --mirror 없이 실행: 맞지 않는 항목은 없고 저장소 대조만 남음
    }
  }, 60_000);

  it("BOM이 있어도 불일치는 불일치(exit 1)이고, UTF-8이 아닌 파일은 파일 오류로 알린다", () => {
    const tampered = run(write("bom-tampered.json", Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(JSON.stringify(bundle), "utf8")])));
    expect(tampered.stdout).toContain("참고: 이 파일은");
    expect(tampered.stdout).toContain("[불일치] 일일 앵커(외부 고정)에 포함 — 앵커 날짜가 YYYY-MM-DD 형식의 실제 날짜가 아닙니다.");
    expect(tampered.stdout).toContain("종합: 불일치 있음");
    expect(tampered.status).toBe(1);

    // CP949로 다시 저장된 한글(0xC7 0xD1 = '한')은 UTF-8이 아니다: 조용히 글자를 바꿔 '불일치'를 내지 않고 파일 오류로 멈춘다
    const ansi = run(write("ansi.json", Buffer.concat([Buffer.from('{"signal":{"rationale":"', "utf8"), Buffer.from([0xc7, 0xd1]), Buffer.from('"}}', "utf8")])));
    expect(ansi.stderr).toContain("파일을 읽지 못했습니다: UTF-8 텍스트가 아닙니다");
    expect(ansi.stdout).not.toContain("[불일치]");
    expect(ansi.status).toBe(1);
  }, 60_000);
});
