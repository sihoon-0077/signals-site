// 서명 키 파일·보관본 확인. keygen이 만든 파일(기본: 홈의 .signals-keys/prod-keys.env)이나 보관본에서 꺼낸 파일을 읽어
//  1) 6줄(키마다 ID·생성 시각·개인키)이 모두 있는지
//  2) 키 ID가 개인키에서 다시 계산한 공개키 지문과 짝이 맞는지(다른 키 파일의 줄이 섞이면 같은 ID 아래 다른 키로 봉인된다)
//  3) 생성 시각이 keygen이 쓴 그대로인지(다시 입력해 한 글자라도 바뀌면 공개된 값과 달라 과거 서명 검증이 실패한다)
// 를 확인하고, 공개 정보(키 ID·생성 시각·공개키 지문)만 출력한다. 개인키는 출력하지 않는다.
// 보관본 두 곳을 각각 꺼내 확인하고 출력이 원본과 같을 때만 원본을 지운다(DEPLOY.md 1단계).
// 사용: npm run keys:check -- [키 파일] [--expect <keys.json 파일 또는 https 주소>]
//   --expect: 사이트의 /keys.json이나 공개 앵커 저장소의 keys.json과 같은지 비교(pull-anchor.sh와 같은 항목). 다르면 그 파일로 복원하면 안 된다.
//   --expect 없이는 사이트와 비교하지 않는다. 그 밖의 인자(모르는 옵션, 두 번째 파일·주소)는 받지 않는다.
// 종료 코드: 0 정상, 1 문제 있음, 2 사용법 오류(아무것도 확인하지 않음).
import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { type KeyPurpose, type PublicKeyEntry, expectedKeyId } from "../src/core/keys";
import { publicKeyFingerprint, publicKeyPemFromPrivate } from "../src/core/signature";

const USAGE = "사용법: npm run keys:check -- [키 파일] [--expect <keys.json 파일 또는 https://<운영도메인>/keys.json>]";

/**
 * 인자를 잘못 준 경우. 남는 인자를 조용히 무시하면 기준 keys.json과 비교하지 않고 '이상 없습니다'가 나와
 * 원본 키를 지워도 된다는 잘못된 근거가 된다. 그래서 아무것도 확인하지 않고 종료 코드 2로 멈춘다.
 */
class UsageError extends Error {}

const DEFAULT_FILE = path.join(os.homedir(), ".signals-keys", "prod-keys.env");
const PURPOSES: [KeyPurpose, string, string][] = [
  ["signal", "SIGNING", "시그널"],
  ["checkpoint", "CHECKPOINT", "체크포인트"],
];
// keygen은 Date.toISOString() 그대로 쓴다(밀리초까지, UTC Z)
const ISO_MS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

/** KEY=값 줄을 읽는다(빈 줄·주석 무시, 값을 감싼 따옴표 제거). 같은 이름이 두 번 나오면 어느 값이 쓰일지 모르므로 문제로 본다. */
function parseEnvFile(text: string, problems: string[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (!m) continue;
    let v = m[2];
    if (v.length >= 2 && ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))) v = v.slice(1, -1);
    if (out.has(m[1])) problems.push(`${m[1]}이(가) 두 번 있습니다(다른 키 파일과 섞였을 수 있음).`);
    out.set(m[1], v);
  }
  return out;
}

function takeOption(args: string[], name: string): string | null {
  const i = args.indexOf(name);
  if (i < 0) return null;
  const v = args[i + 1];
  if (!v || v.startsWith("--")) throw new UsageError(`${name} 뒤에 keys.json 파일 경로나 https 주소가 필요합니다.`);
  args.splice(i, 2);
  return v;
}

/**
 * --expect를 꺼낸 뒤 남은 인자는 키 파일 하나뿐이어야 한다. 기준 keys.json을 두 번째 인자로 주거나,
 * 셸이 '--'를 떨어뜨려 npm이 --expect를 가져가면 스크립트에는 [키 파일, 주소]만 남는다. 둘 다 여기서 멈춘다.
 */
function checkRest(args: string[]): void {
  const flags = args.filter((a) => a.startsWith("-"));
  if (flags.length) throw new UsageError(`알 수 없는 옵션: ${flags.join(" ")}`);
  if (args.length > 1) throw new UsageError(`키 파일은 하나만 받습니다(남은 인자: ${args.slice(1).join(" ")}). 기준 keys.json은 --expect 뒤에 줍니다.`);
  if (args[0] && /^https?:\/\//i.test(args[0])) throw new UsageError(`키 파일 자리에 주소가 왔습니다: ${args[0]}. 기준 keys.json은 --expect 뒤에 줍니다.`);
}

async function loadExpected(ref: string): Promise<PublicKeyEntry[]> {
  let text: string;
  if (/^https:\/\//.test(ref)) {
    const res = await fetch(ref, { signal: AbortSignal.timeout(30_000) });
    if (!res.ok) {
      // 읽지 않은 오류 본문은 연결을 붙잡아 출력 뒤에도 프로세스가 바로 끝나지 않는다
      await res.body?.cancel().catch(() => {});
      throw new Error(`기준 keys.json을 받지 못했습니다(HTTP ${res.status}): ${ref}`);
    }
    text = await res.text();
  } else {
    text = readFileSync(ref, "utf8");
  }
  const keys = (JSON.parse(text) as { keys?: PublicKeyEntry[] }).keys;
  if (!Array.isArray(keys)) throw new Error(`기준 파일이 keys.json 형식이 아닙니다: ${ref}`);
  return keys;
}

async function main() {
  const args = process.argv.slice(2);
  const expectRef = takeOption(args, "--expect");
  checkRest(args);
  const file = path.resolve(args[0] ?? DEFAULT_FILE);
  if (!existsSync(file)) {
    throw new Error(`키 파일이 없습니다: ${file}\nkeygen이 만든 파일(홈 폴더의 .signals-keys/prod-keys.env)이나 보관본에서 꺼낸 파일 경로를 주세요.`);
  }
  const synced = [process.env.OneDrive, process.env.OneDriveConsumer, process.env.OneDriveCommercial].filter((d): d is string => !!d).map((d) => path.resolve(d).toLowerCase());
  if (synced.some((d) => file.toLowerCase().startsWith(d))) {
    console.warn("주의: 이 파일은 OneDrive 폴더 안에 있어 클라우드에 올라갔을 수 있습니다. 확인이 끝나면 바로 지우고(Shift+Delete) 휴지통·버전 기록도 비우세요.");
  }

  const problems: string[] = [];
  const env = parseEnvFile(readFileSync(file, "utf8"), problems);
  const mine: PublicKeyEntry[] = [];
  console.log(`키 파일: ${file}`);
  for (const [purpose, prefix, label] of PURPOSES) {
    const names = [`${prefix}_KEY_ID`, `${prefix}_KEY_CREATED_AT`, `${prefix}_PRIVATE_KEY_PEM`];
    const missing = names.filter((n) => !env.get(n));
    if (missing.length) {
      problems.push(`${missing.join(", ")} 줄이 없습니다.`);
      continue;
    }
    const keyId = env.get(names[0])!;
    const createdAt = env.get(names[1])!;
    let publicPem: string;
    try {
      // 서버(src/server/keys.ts)와 같은 방식으로 읽는다: \n 두 글자를 줄바꿈으로 바꾸고 PKCS#8 개인키로 가져온다
      publicPem = await publicKeyPemFromPrivate(env.get(names[2])!.replace(/\\n/g, "\n"));
    } catch {
      problems.push(`${names[2]}를 개인키로 읽을 수 없습니다(줄이 잘렸거나 글자가 바뀌었습니다).`);
      continue;
    }
    const fingerprint = await publicKeyFingerprint(publicPem);
    const want = expectedKeyId(purpose, fingerprint);
    if (keyId !== want) problems.push(`${names[0]}(${keyId})가 개인키와 짝이 아닙니다(이 개인키의 키 ID는 ${want}). 다른 키 파일의 줄이 섞였습니다.`);
    if (!ISO_MS.test(createdAt) || Number.isNaN(Date.parse(createdAt))) {
      problems.push(`${names[1]}이(가) keygen이 쓴 형식(예: 2026-10-30T01:23:45.678Z)이 아닙니다. 다시 입력한 값이면 공개된 값과 달라 과거 서명 검증이 실패합니다.`);
    }
    console.log(`  ${label} 키 ${keyId} · 생성 ${createdAt} · 공개키 지문 ${fingerprint}`);
    mine.push({ key_id: keyId, purpose, algorithm: "ECDSA-P256-SHA256", public_key_pem: publicPem, fingerprint, created_at: createdAt, retired_at: null });
  }

  if (mine.length === PURPOSES.length && mine[0].fingerprint === mine[1].fingerprint) {
    problems.push("시그널 키와 체크포인트 키가 같은 키입니다(용도별로 따로 만든 키여야 합니다).");
  }

  if (expectRef && mine.length === PURPOSES.length) {
    const expected = await loadExpected(expectRef);
    for (const k of mine) {
      const e = expected.find((x) => x.key_id === k.key_id && x.purpose === k.purpose);
      if (!e) {
        problems.push(`${k.key_id}가 기준 keys.json(${expectRef})에 없습니다. 다른 키 묶음입니다.`);
        continue;
      }
      // pull-anchor.sh가 공개 저장소에 고정해 비교하는 항목과 같다
      const diff = (["algorithm", "public_key_pem", "fingerprint", "created_at"] as const).filter((f) => String(e[f] ?? "").trim() !== String(k[f]).trim());
      if (diff.length) problems.push(`${k.key_id}가 기준 keys.json과 다릅니다(${diff.join(", ")}). 이 파일로 복원하면 안 됩니다.`);
    }
    if (!problems.length) console.log(`기준 keys.json(${expectRef})과 같습니다.`);
  }

  if (problems.length) {
    console.error("문제가 있습니다. 이 파일만 남아 있다면 지우지 마세요.");
    for (const p of problems) console.error(`  - ${p}`);
    // process.exit()가 아니라 종료 코드만 정한다(--expect로 주소를 받은 직후 process.exit()는 Windows Node 24에서 0xC0000409로 죽을 수 있음)
    process.exitCode = 1;
    return;
  }
  console.log(expectRef ? "이상 없습니다. 키 파일이 완전하고 기준 keys.json과 같습니다." : "키 파일은 이상 없습니다. 사이트 keys.json과는 비교하지 않았습니다(--expect 없음).");
  console.log("원본은 DEPLOY.md 1단계 조건(보관본 두 곳을 이 명령으로 확인 + 4단계 배포 뒤 --expect 확인)을 모두 통과한 뒤에만 지우세요.");
}

main().catch((e) => {
  if (e instanceof UsageError) {
    console.error(`${e.message}\n${USAGE}`);
    process.exitCode = 2;
    return;
  }
  console.error(`실패: ${(e as Error).message ?? e}`);
  process.exitCode = 1;
});
