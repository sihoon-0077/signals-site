// 서명 키 관리. 개인키는 서버 환경변수에만 두고, 공개키는 /keys.json과 GitHub 앵커 저장소로 공개한다.
// 시그널 서명 키와 체크포인트(일일 루트) 서명 키를 분리한다(03 설계 §6.2).
// 개발 환경에서 키가 없으면 .data/keys/에 새로 만든다. 배포 환경에서는 키가 없으면 키를 쓰는 요청이 오류로 끝난다
// (키가 바뀌면 과거 서명 전체가 무효가 되므로 조용히 새로 만들면 안 된다).
import "server-only";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { type KeyPurpose, type KeysFile, type PublicKeyEntry, expectedKeyId } from "@/core/keys";
import {
  exportPrivateKeyPem,
  generateSigningKeyPair,
  importPrivateKeyPem,
  publicKeyFingerprint,
  publicKeyPemFromPrivate,
} from "@/core/signature";
import { ConfigError, isProduction, previewDeploymentBlocked } from "./config";

export interface LoadedKey {
  keyId: string;
  purpose: KeyPurpose;
  privateKey: CryptoKey;
  publicPem: string;
  fingerprint: string;
  createdAt: string;
  /** 키를 읽은 곳: env = 환경변수(운영 키), dev = 개발용 파일(.data/keys). 수동 앵커 스크립트가 출력하고, 원격 DB에는 dev를 쓰지 않는다. */
  source: "env" | "dev";
}

interface RawKey {
  keyId: string;
  privatePem: string;
  createdAt: string;
}

async function devKey(purpose: KeyPurpose): Promise<RawKey> {
  // 실행할 때의 작업 폴더 기준(모듈을 불러올 때 고정하지 않음): 테스트가 임시 폴더로 바꿔 개발자 PC의 .data/keys를 건드리지 않게
  const dir = path.join(process.cwd(), ".data", "keys");
  const file = path.join(dir, `${purpose}.json`);
  if (existsSync(file)) return JSON.parse(readFileSync(file, "utf8")) as RawKey;
  mkdirSync(dir, { recursive: true });
  const kp = await generateSigningKeyPair();
  const privatePem = await exportPrivateKeyPem(kp.privateKey);
  const fp = await publicKeyFingerprint(await publicKeyPemFromPrivate(privatePem));
  const raw: RawKey = { keyId: `${purpose === "signal" ? "sig" : "cp"}-dev-${fp.slice(0, 8)}`, privatePem, createdAt: new Date().toISOString() };
  writeFileSync(file, JSON.stringify(raw, null, 2));
  console.warn(`[keys] 개발용 ${purpose} 키를 새로 만들었습니다: ${file}`);
  return raw;
}

function envKey(purpose: KeyPurpose): RawKey | null {
  const prefix = purpose === "signal" ? "SIGNING" : "CHECKPOINT";
  const keyId = process.env[`${prefix}_KEY_ID`];
  const privatePem = process.env[`${prefix}_PRIVATE_KEY_PEM`];
  const createdAt = process.env[`${prefix}_KEY_CREATED_AT`];
  if (!keyId || !privatePem || !createdAt) return null;
  return { keyId, privatePem: privatePem.replace(/\\n/g, "\n"), createdAt };
}

const cache = new Map<KeyPurpose, Promise<LoadedKey>>();

export function loadKey(purpose: KeyPurpose): Promise<LoadedKey> {
  let p = cache.get(purpose);
  if (!p) {
    p = (async () => {
      // Vercel 미리보기 배포(브랜치·PR마다 자동 생성)가 운영 키를 받으면, 검토 안 된 코드가 운영 기록을 영구 봉인할 수 있다
      if (previewDeploymentBlocked()) {
        throw new ConfigError(
          `미리보기(Preview) 배포에서는 ${purpose} 서명 키를 쓰지 않습니다. 키 환경변수는 Vercel의 Production에만 두세요(따로 만든 시험용 DB·키라면 ALLOW_PREVIEW_DB=1).`,
          "PREVIEW_BLOCKED",
        );
      }
      let raw = envKey(purpose);
      const fromEnv = raw !== null;
      if (!raw) {
        if (isProduction()) throw new ConfigError(`${purpose} 서명 키 환경변수가 없습니다(.env.example 참고).`);
        // 원격 DB(DATABASE_URL)에 쓰는데 키 환경변수가 없으면, 로컬 개발용 키로 운영 기록을 영구 봉인하게 된다. 멈춘다.
        if (process.env.DATABASE_URL && process.env.ALLOW_DEV_KEYS !== "1") {
          throw new ConfigError(`${purpose} 서명 키 환경변수 없이 원격 DB(DATABASE_URL)에 쓸 수 없습니다. 운영 키를 셸 환경변수로 넣으세요.`);
        }
        raw = await devKey(purpose);
      }
      const publicPem = await publicKeyPemFromPrivate(raw.privatePem);
      const fingerprint = await publicKeyFingerprint(publicPem);
      // 운영 키 ID는 개인키의 공개키 지문에서 나온다(keygen). 다르면 키 ID·개인키 줄이 다른 키 파일에서 섞인 것이다:
      // 그대로 쓰면 '같은 키 ID'라 발행·앵커의 키 일치 검사를 통과한 채 다른 키로 지울 수 없는 기록을 봉인한다.
      if (fromEnv && raw.keyId !== expectedKeyId(purpose, fingerprint)) {
        throw new ConfigError(`${purpose} 키 ID(${raw.keyId})가 개인키와 짝이 아닙니다. 같은 키 파일(prod-keys.env)의 줄인지 확인하세요(npm run keys:check).`, "CONFIG_INVALID");
      }
      return {
        keyId: raw.keyId,
        purpose,
        privateKey: await importPrivateKeyPem(raw.privatePem),
        publicPem,
        fingerprint,
        createdAt: raw.createdAt,
        source: fromEnv ? "env" : "dev",
      };
    })();
    cache.set(purpose, p);
  }
  return p;
}

export async function publicKeysFile(): Promise<KeysFile> {
  const keys: PublicKeyEntry[] = [];
  for (const purpose of ["signal", "checkpoint"] as const) {
    const k = await loadKey(purpose);
    keys.push({ key_id: k.keyId, purpose, algorithm: "ECDSA-P256-SHA256", public_key_pem: k.publicPem, fingerprint: k.fingerprint, created_at: k.createdAt, retired_at: null });
  }
  return { version: 1, keys };
}
