// keys:check(scripts/keys-check.ts)를 실제 명령처럼 실행해 종료 코드를 확인한다.
// 기준 keys.json을 --expect 없이 두 번째 인자로 주면(예전 README 형식) 비교 없이 '이상 없습니다'(종료 코드 0)가 나와,
// 원본 키를 지워도 된다는 잘못된 근거가 됐다. 이제는 사용법 오류(종료 코드 2)로 아무것도 확인하지 않고 멈춘다.
// 키는 이 테스트가 임시 폴더에 만든 버리는 키다(홈의 .signals-keys와 프로젝트 .data는 건드리지 않음). 네트워크는 쓰지 않는다.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type KeyPurpose, type KeysFile, type PublicKeyEntry, expectedKeyId } from "../../src/core/keys";
import { exportPrivateKeyPem, exportPublicKeyPem, generateSigningKeyPair, publicKeyFingerprint } from "../../src/core/signature";
import { runScript } from "./run-script";

let dir: string;
let fileA: string; // 키 묶음 A(운영 키라고 가정)
let fileB: string; // 다른 묶음 B(예: --out으로 한 번 더 만든 시험 키)
let keysJsonA: string; // A로 만든 사이트 /keys.json과 같은 모양의 파일

/** keygen과 같은 형식의 키 파일 6줄과, 사이트 keys.json에 실릴 공개 항목을 만든다. */
async function makeBundle(name: string): Promise<{ file: string; keys: PublicKeyEntry[] }> {
  const lines: string[] = [];
  const keys: PublicKeyEntry[] = [];
  for (const [purpose, prefix] of [["signal", "SIGNING"], ["checkpoint", "CHECKPOINT"]] as [KeyPurpose, string][]) {
    const kp = await generateSigningKeyPair();
    const pub = await exportPublicKeyPem(kp.publicKey);
    const fingerprint = await publicKeyFingerprint(pub);
    const keyId = expectedKeyId(purpose, fingerprint);
    const createdAt = new Date().toISOString();
    const priv = (await exportPrivateKeyPem(kp.privateKey)).replace(/\n/g, "\\n");
    lines.push(`${prefix}_KEY_ID=${keyId}`, `${prefix}_KEY_CREATED_AT=${createdAt}`, `${prefix}_PRIVATE_KEY_PEM="${priv}"`);
    keys.push({ key_id: keyId, purpose, algorithm: "ECDSA-P256-SHA256", public_key_pem: pub, fingerprint, created_at: createdAt, retired_at: null });
  }
  const file = path.join(dir, `${name}.env`);
  writeFileSync(file, lines.join("\n") + "\n");
  return { file, keys };
}

beforeAll(async () => {
  dir = mkdtempSync(path.join(os.tmpdir(), "signals-keys-check-"));
  const a = await makeBundle("a");
  fileA = a.file;
  fileB = (await makeBundle("b")).file;
  keysJsonA = path.join(dir, "keys-a.json");
  writeFileSync(keysJsonA, JSON.stringify({ version: 1, keys: a.keys } satisfies KeysFile, null, 2));
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("keys:check 인자", () => {
  it("기준 keys.json을 --expect 없이 주면(예전 README 형식) 비교하지 않고 사용법 오류(2)로 멈춘다", async () => {
    const r = await runScript("keys-check.ts", [fileB, keysJsonA]);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("--expect");
    expect(r.stderr).toContain("사용법");
    expect(r.stdout).not.toContain("이상 없습니다");
  });

  it("npm이 --expect를 가져가 주소만 남은 경우도 멈춘다(주소를 받으러 가지 않음)", async () => {
    // '--' 없이 실행하면 npm이 --expect를 자기 설정으로 먹어 스크립트에는 [키 파일, 주소]나 [주소]만 남는다
    for (const args of [[fileA, "https://signals.invalid/keys.json"], ["https://signals.invalid/keys.json"]]) {
      const r = await runScript("keys-check.ts", args);
      expect(r.code).toBe(2);
      expect(r.stdout).not.toContain("이상 없습니다");
    }
  });

  it("모르는 옵션(오타)과 값 없는 --expect도 사용법 오류다", async () => {
    for (const args of [[fileA, "--expcet", keysJsonA], [fileA, "--expect"]]) {
      const r = await runScript("keys-check.ts", args);
      expect(r.code).toBe(2);
      expect(r.stderr).toContain("사용법");
    }
  });
});

describe("keys:check 비교", () => {
  it("다른 키 묶음을 --expect로 비교하면 실패(1)한다", async () => {
    const r = await runScript("keys-check.ts", [fileB, "--expect", keysJsonA]);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("다른 키 묶음");
  });

  it("같은 묶음이면 '같습니다'로 통과(0)한다", async () => {
    const r = await runScript("keys-check.ts", [fileA, "--expect", keysJsonA]);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("과 같습니다.");
    expect(r.stdout).toContain("이상 없습니다");
  });

  it("--expect 없이 키 파일만 주면 파일만 확인하고, 사이트와 비교하지 않았다고 알린다", async () => {
    const r = await runScript("keys-check.ts", [fileA]);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("비교하지 않았습니다(--expect 없음)");
    expect(r.stdout).not.toContain("과 같습니다.");
  });
});
