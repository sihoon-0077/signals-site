// 서명 키 로딩의 안전장치: 미리보기 배포 차단, 키 ID와 개인키의 짝 확인, 운영에서 키가 없으면 ConfigError.
// 개발용 키 파일(.data/keys)을 만들지 않도록 모든 경우가 그 전에 끝나게 환경변수를 둔다.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { expectedKeyId } from "@/core/keys";
import { exportPrivateKeyPem, exportPublicKeyPem, generateSigningKeyPair, publicKeyFingerprint } from "@/core/signature";

async function makeEnvKey(purpose: "signal" | "checkpoint") {
  const kp = await generateSigningKeyPair();
  const fp = await publicKeyFingerprint(await exportPublicKeyPem(kp.publicKey));
  // keygen과 같은 모양(PEM 줄바꿈은 \n 두 글자)
  return { id: expectedKeyId(purpose, fp), fp, pem: (await exportPrivateKeyPem(kp.privateKey)).replace(/\n/g, "\\n") };
}

const ENV_NAMES = ["VERCEL", "VERCEL_ENV", "ALLOW_PREVIEW_DB", "DATABASE_URL", "ALLOW_DEV_KEYS", "SIGNING_KEY_ID", "SIGNING_KEY_CREATED_AT", "SIGNING_PRIVATE_KEY_PEM"];
const setSigning = (k: { id: string; pem: string }) => {
  vi.stubEnv("SIGNING_KEY_ID", k.id);
  vi.stubEnv("SIGNING_KEY_CREATED_AT", "2026-10-30T01:02:03.456Z");
  vi.stubEnv("SIGNING_PRIVATE_KEY_PEM", k.pem);
};
// loadKey는 모듈 안에 결과를 캐시하므로 경우마다 새로 불러온다
const freshLoadKey = async () => {
  vi.resetModules();
  return (await import("../keys")).loadKey;
};

beforeEach(() => {
  for (const n of ENV_NAMES) vi.stubEnv(n, "");
});
afterEach(() => vi.unstubAllEnvs());

describe("서명 키 로딩 안전장치", () => {
  it("keygen이 만든 키(ID = 지문 앞 12자리)는 그대로 쓴다", async () => {
    const k = await makeEnvKey("signal");
    setSigning(k);
    const key = await (await freshLoadKey())("signal");
    expect([key.keyId, key.fingerprint, key.createdAt]).toEqual([k.id, k.fp, "2026-10-30T01:02:03.456Z"]);
  });

  it("키 ID와 개인키가 다른 키 파일에서 섞이면 거부한다(같은 ID 아래 다른 키로 봉인되는 사고 방지)", async () => {
    const a = await makeEnvKey("signal");
    const b = await makeEnvKey("signal");
    setSigning({ id: a.id, pem: b.pem });
    await expect((await freshLoadKey())("signal")).rejects.toMatchObject({ code: "CONFIG_INVALID", message: expect.stringMatching(/짝이 아닙니다/) });
  });

  it("Vercel 미리보기·개발 배포에서는 운영 키를 쓰지 않는다(ALLOW_PREVIEW_DB=1일 때만 허용)", async () => {
    setSigning(await makeEnvKey("signal"));
    vi.stubEnv("VERCEL", "1");
    for (const env of ["preview", "development", ""]) {
      vi.stubEnv("VERCEL_ENV", env);
      await expect((await freshLoadKey())("signal"), env).rejects.toMatchObject({ code: "PREVIEW_BLOCKED" });
    }
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("ALLOW_PREVIEW_DB", "1");
    await expect((await freshLoadKey())("signal")).resolves.toMatchObject({ purpose: "signal" });
    vi.stubEnv("ALLOW_PREVIEW_DB", "");
    vi.stubEnv("VERCEL_ENV", "production");
    await expect((await freshLoadKey())("signal")).resolves.toMatchObject({ purpose: "signal" });
  });

  it("운영에서 키가 없거나, 원격 DB에 쓰는데 키가 없으면 ConfigError(CONFIG_MISSING)로 멈춘다", async () => {
    vi.stubEnv("NODE_ENV", "production");
    await expect((await freshLoadKey())("checkpoint")).rejects.toMatchObject({ code: "CONFIG_MISSING" });
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("DATABASE_URL", "postgresql://u:p@db.example.invalid:6543/postgres");
    await expect((await freshLoadKey())("checkpoint")).rejects.toMatchObject({ code: "CONFIG_MISSING" });
  });
});
