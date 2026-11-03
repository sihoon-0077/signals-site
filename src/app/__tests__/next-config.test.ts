// next.config.ts: Vercel 운영 빌드에서만 필수 환경변수를 검사해 빌드를 멈추는지(값은 출력하지 않음), 보안 헤더가 붙는지 본다.
// 서버가 요청마다 거부하는 값(주소의 SSL 설정, 읽을 수 없는 DB 인증서, 개인키와 짝이 아닌 키 ID)은 서버 코드(sslOptions·loadKey)와 판단이 같은지도 본다:
// 빌드가 막지 않으면 그 배포가 운영 주소에 붙은 뒤 DB·키를 쓰는 요청이 모두 CONFIG_INVALID로 실패하고, 서버가 쓸 수 있는 값을 빌드가 막으면 배포를 못 한다.
import { generateKeyPairSync } from "node:crypto";
import tls from "node:tls";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type KeyPurpose, expectedKeyId } from "@/core/keys";
import { exportPrivateKeyPem, exportPublicKeyPem, generateSigningKeyPair, publicKeyFingerprint } from "@/core/signature";
import { mailServiceProblem, parseMailService } from "@/lib/mail-service";
import { sslOptions } from "@/server/db";

/** keygen(scripts/keygen.ts)과 같은 모양의 키: 키 ID = 용도 접두 + 공개키 지문 앞 12자리, PEM 줄바꿈은 \n 두 글자 */
async function keygenKey(purpose: KeyPurpose) {
  const kp = await generateSigningKeyPair();
  const fp = await publicKeyFingerprint(await exportPublicKeyPem(kp.publicKey));
  return { id: expectedKeyId(purpose, fp), pem: (await exportPrivateKeyPem(kp.privateKey)).replace(/\n/g, "\\n") };
}
const SIG = await keygenKey("signal");
const CP = await keygenKey("checkpoint");
/** 다른 keygen 묶음의 키(키 ID 줄만 섞여 들어온 경우) */
const OTHER_SIG = await keygenKey("signal");
const OTHER_CP = await keygenKey("checkpoint");

const VALID: Record<string, string> = {
  DATABASE_URL: "postgresql://postgres.projref:dbpass-VALUE-9@aws-0-ap-northeast-2.pooler.supabase.com:6543/postgres",
  SIGNING_KEY_ID: SIG.id,
  SIGNING_KEY_CREATED_AT: "2026-10-30T01:02:03.456Z",
  SIGNING_PRIVATE_KEY_PEM: SIG.pem,
  CHECKPOINT_KEY_ID: CP.id,
  CHECKPOINT_KEY_CREATED_AT: "2026-10-30T01:02:03.789Z",
  CHECKPOINT_PRIVATE_KEY_PEM: CP.pem,
  ADMIN_USER: "operator",
  ADMIN_PASSWORD: "ADMIN-PASSWORD-VALUE-0123456789",
  CRON_SECRET: "CRON-SECRET-VALUE-0123456789",
  ANCHOR_REPO_URL: "https://github.com/acme/signals-anchors",
  PRIVACY_OFFICER: "홍길동",
  CONTACT_EMAIL: "privacy@example.com",
  MAIL_SERVICE: "Google LLC(미국, googlekrsupport@google.com)",
  VERCEL_PROJECT_PRODUCTION_URL: "signals-x.vercel.app",
};
const REQUIRED = Object.keys(VALID).filter((k) => k !== "VERCEL_PROJECT_PRODUCTION_URL");
/** 실제 인증서 PEM(Node에 들어 있는 공개 루트 인증서 하나) */
const CA = tls.rootCertificates[0];

const load = async () => {
  vi.resetModules();
  return (await import("../../../next.config")).default;
};
/** 운영 빌드에서 next.config.ts를 불러 실패 메시지를 돌려준다(통과하면 null) */
const buildError = async (over: Record<string, string> = {}) => {
  vi.stubEnv("VERCEL_ENV", "production");
  setAll(over);
  return load().then(
    () => null,
    (e: Error) => e.message,
  );
};
const setAll = (over: Record<string, string> = {}) => {
  for (const [k, v] of Object.entries({ ...VALID, ...over })) vi.stubEnv(k, v);
};

beforeEach(() => {
  // VERCEL·ALLOW_DEV_KEYS: 아래 loadKey 대조가 미리보기 차단이나 개발용 키(.data/keys) 쪽으로 가지 않게 비운다
  for (const k of [...Object.keys(VALID), "VERCEL_ENV", "VERCEL", "SITE_URL", "ANCHOR_REPO_BRANCH", "DATABASE_CA_PEM", "ALLOW_DEV_KEYS"]) vi.stubEnv(k, "");
});
afterEach(() => vi.unstubAllEnvs());

describe("운영 빌드 환경변수 검사", () => {
  it("로컬·미리보기 빌드는 값이 비어 있어도 검사하지 않는다", async () => {
    await expect(load()).resolves.toBeTruthy();
    vi.stubEnv("VERCEL_ENV", "preview");
    await expect(load()).resolves.toBeTruthy();
  });

  it("운영 빌드에서 값이 모두 맞으면 통과한다(SITE_URL·DATABASE_CA_PEM은 선택)", async () => {
    expect(await buildError()).toBeNull();
    expect(await buildError({ SITE_URL: "https://signals.example", DATABASE_CA_PEM: CA })).toBeNull();
  });

  it("운영 빌드에서 비어 있는 필수 값의 이름을 모두 알려 주며 멈춘다", async () => {
    vi.stubEnv("VERCEL_ENV", "production");
    const err = await load().catch((e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    for (const name of REQUIRED) expect((err as Error).message).toContain(`${name}(비어 있음)`);
    expect((err as Error).message).toContain("SITE_URL(비어 있고 Vercel 운영 주소도 없음)");
    expect((err as Error).message).not.toContain("DATABASE_CA_PEM"); // 선택 값
  });

  it("형식이 틀린 값은 이름과 이유만 알리고 값은 출력하지 않는다", async () => {
    vi.stubEnv("VERCEL_ENV", "production");
    setAll({
      ADMIN_PASSWORD: "SHORT-PW-VALUE1", // 15자
      CRON_SECRET: "SHORT-CRON-VAL1",
      SIGNING_KEY_ID: "sig-dev-01234567", // 개발용 키
      CHECKPOINT_KEY_CREATED_AT: "2026-10-30T01:02:03Z", // 밀리초 없이 다시 입력한 값
      CHECKPOINT_PRIVATE_KEY_PEM: "PRIVATE-PARTIAL-VALUE",
      DATABASE_URL: "postgresql://postgres.projref:[YOUR-PASSWORD]@aws-0.pooler.supabase.com:6543/postgres",
      ANCHOR_REPO_URL: "https://github.com/acme/signals-anchors/tree/main",
      ANCHOR_REPO_BRANCH: "../main",
      CONTACT_EMAIL: "not-an-email",
      MAIL_SERVICE: "Gmail", // 법인명·국가·문의처 없이 서비스 이름만
      SITE_URL: "http://localhost:3000",
    });
    const msg = ((await load().catch((e: Error) => e)) as Error).message;
    for (const name of ["ADMIN_PASSWORD", "CRON_SECRET", "SIGNING_KEY_ID", "CHECKPOINT_KEY_CREATED_AT", "CHECKPOINT_PRIVATE_KEY_PEM", "DATABASE_URL", "ANCHOR_REPO_URL", "ANCHOR_REPO_BRANCH", "CONTACT_EMAIL", "MAIL_SERVICE", "SITE_URL"]) {
      expect(msg).toContain(`${name}(`);
    }
    expect(msg).not.toMatch(/VALUE|projref|YOUR-PASSWORD\]@|not-an-email|Gmail|tree\/main|localhost:3000/);
    expect(msg).not.toContain("SIGNING_PRIVATE_KEY_PEM("); // 맞는 값은 목록에 없다
    expect(msg.match(/SIGNING_KEY_ID\(/g)).toHaveLength(1); // 형식이 틀린 키 ID는 짝 확인까지 겹쳐 알리지 않는다
  });

  // 검증기(mirrorRawBase)가 거부하는 '.'·'..' 계정·저장소 이름은 빌드도 막는다('.github' 같은 이름은 정상). 값은 출력하지 않는다
  it.each(["https://github.com/acme/..", "https://github.com/../attacker", "https://github.com/./signals-anchors"])("ANCHOR_REPO_URL %s는 운영 빌드를 멈춘다", async (url) => {
    const msg = await buildError({ ANCHOR_REPO_URL: url });
    expect(msg).toContain("ANCHOR_REPO_URL(");
    expect(msg).not.toContain(url);
  });
  it("ANCHOR_REPO_URL이 .github처럼 점으로 시작하는 정상 이름이면 통과한다", async () => {
    expect(await buildError({ ANCHOR_REPO_URL: "https://github.com/acme/.github" })).toBeNull();
  });

  // 빌드 검사는 처리방침과 같은 판단(src/lib/mail-service.ts mailServiceProblem)을 쓴다. 빌드를 통과한 값은 처리방침이 읽을 수 있어야 한다
  // (빌드는 통과했는데 처리방침에 '설정 필요'가 뜨면 안 된다). 메일 주소와 업체의 짝처럼 빌드만 보는 규칙은 빌드 쪽이 더 엄격하다.
  it.each([
    "Google LLC(미국, googlekrsupport@google.com)",
    "네이버(주)(대한민국, privacy@example.com)",
    "Proton AG(스위스, https://proton.me/support/contact)",
    "주식회사 예시메일(한국, 1588-0000)",
    "다음메일(국내, 1577-3321)",
    "다음메일(대한민국 서울, 1577-3321)",
    "주식회사 예시메일(한국 및 미국, 1588-0000)",
    "예시메일(국내외, 1588-0000)",
    "Gmail",
    "Google LLC(미국)",
    "Google LLC(googlekrsupport@google.com, 미국)",
    "Google LLC(United States, googlekrsupport@google.com)",
    "Google LLC(미국, <Google 개인정보 문의처>)",
    "Google LLC(미국, Google 고객센터)",
    "[업체 법인명](미국, privacy@example.com)",
    "Google LLC(미국, privacy@example.com))",
  ])("MAIL_SERVICE 빌드 검사는 mailServiceProblem의 판단 그대로이고, 통과시킨 값은 처리방침이 읽을 수 있다: %s", async (value) => {
    const msg = await buildError({ MAIL_SERVICE: value });
    const problem = mailServiceProblem(value, VALID.CONTACT_EMAIL);
    expect(msg === null).toBe(problem === null);
    if (msg === null) expect(parseMailService(value)).not.toBeNull();
    else expect(msg).toMatch(new RegExp(`^운영 배포에 필요한 환경변수가 없거나 형식이 틀립니다: MAIL_SERVICE\\(${problem!.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\)\\. `));
  });

  it("MAIL_SERVICE는 CONTACT_EMAIL과 함께 본다: 국내를 뜻하는 말에 도시·다른 국가가 붙은 값, 메일 주소와 다른 업체는 운영 빌드가 멈춘다", async () => {
    expect(await buildError({ MAIL_SERVICE: "다음메일(대한민국 서울, 1577-3321)" })).toMatch(/: MAIL_SERVICE\(/);
    expect(await buildError({ MAIL_SERVICE: "다음메일(국내, 1577-3321)" })).toBeNull();
    // Gmail 예시를 그대로 둔 채 실제로는 네이버 메일함을 쓰는 경우(처리방침에 사실과 다른 국외 이전이 공개된다)
    expect(await buildError({ CONTACT_EMAIL: "signals.ops@naver.com" })).toMatch(/^운영 배포에 필요한 환경변수가 없거나 형식이 틀립니다: MAIL_SERVICE\(/);
    expect(await buildError({ CONTACT_EMAIL: "signals.ops@gmail.com" })).toBeNull();
    expect(await buildError({ CONTACT_EMAIL: "signals.ops@gmail.com", MAIL_SERVICE: "네이버(주)(대한민국, privacy@example.com)" })).toMatch(/: MAIL_SERVICE\(/);
  });
});

describe("운영 빌드: 서버가 요청마다 거부하는 값도 빌드에서 막는다", () => {
  const REMOTE = VALID.DATABASE_URL;

  it.each([
    ["?sslmode=require", false],
    ["?sslmode=verify-full&sslrootcert=/tmp/prod-ca-2021.crt", false],
    ["?ssl=true", false],
    ["?SSLMODE=disable", false],
    ["?application_name=x&uselibpqcompat=true", false],
    ["?pgbouncer=true", true],
    ["", true],
  ])("DATABASE_URL 끝 %s: 빌드와 서버(sslOptions)의 판단이 같다", async (query, ok) => {
    const msg = await buildError({ DATABASE_URL: REMOTE + query });
    let serverOk = true;
    try {
      sslOptions(REMOTE + query, undefined);
    } catch {
      serverOk = false;
    }
    expect([msg === null, serverOk]).toEqual([ok, ok]);
    if (!ok) {
      expect(msg).toMatch(/^운영 배포에 필요한 환경변수가 없거나 형식이 틀립니다: DATABASE_URL\([^)]*\?sslmode= 같은 SSL 설정 없이\)\. /);
      expect(msg).not.toMatch(/projref|dbpass|pooler|sslrootcert|=require|=true|=disable/);
    }
  });

  const half = CA.slice(0, Math.floor(CA.length / 2));
  it.each([
    ["인증서 파일 그대로(여러 줄)", CA, true],
    ["\\n 두 글자로 한 줄", CA.trim().replace(/\n/g, "\\n"), true],
    ["CRLF(Windows에서 읽은 파일)", CA.trim().replace(/\n/g, "\r\n"), true],
    ["공백뿐(비운 것과 같음: 암호화만)", "   ", true],
    ["첫 줄만", "-----BEGIN CERTIFICATE-----", false],
    ["앞 절반만(잘림)", half, false],
    ["인증서가 아닌 글", "not a certificate", false],
    ["따옴표로 감쌈", `"${CA.trim()}"`, false],
  ])("DATABASE_CA_PEM %s: 빌드와 서버(sslOptions)의 판단이 같다", async (_name, value, ok) => {
    const msg = await buildError({ DATABASE_CA_PEM: value });
    let serverOk = true;
    try {
      sslOptions(REMOTE, value);
    } catch {
      serverOk = false;
    }
    expect([msg === null, serverOk]).toEqual([ok, ok]);
    if (!ok) {
      expect(msg).toMatch(/^운영 배포에 필요한 환경변수가 없거나 형식이 틀립니다: DATABASE_CA_PEM\(인증서로 읽을 수 없음[^)]*\)\. /);
      expect(msg).not.toMatch(/BEGIN|CERTIFICATE|not a certificate/);
    }
  });

  const body = SIG.pem.replace(/-----(BEGIN|END) PRIVATE KEY-----|\\n/g, "");
  const otherPkcs8 = (type: "ed25519" | "p384") =>
    (type === "ed25519"
      ? generateKeyPairSync("ed25519").privateKey
      : generateKeyPairSync("ec", { namedCurve: "secp384r1" }).privateKey
    )
      .export({ type: "pkcs8", format: "pem" })
      .toString();
  it.each([
    ["keygen 출력 그대로(\\n 두 글자)", {}, null],
    ["줄바꿈 그대로 붙여 넣은 PEM", { SIGNING_PRIVATE_KEY_PEM: SIG.pem.replace(/\\n/g, "\n") }, null],
    ["keygen 파일처럼 따옴표로 감싼 PEM", { SIGNING_PRIVATE_KEY_PEM: `"${SIG.pem}"` }, null],
    ["다른 keygen 묶음의 키 ID", { SIGNING_KEY_ID: OTHER_SIG.id }, "SIGNING_KEY_ID"],
    ["키 ID 끝에 공백", { SIGNING_KEY_ID: `${SIG.id} ` }, "SIGNING_KEY_ID"],
    ["BEGIN·END는 있고 본문이 다른 글", { SIGNING_PRIVATE_KEY_PEM: "-----BEGIN PRIVATE KEY-----\\nPRIVATE-SIG-VALUE\\n-----END PRIVATE KEY-----\\n" }, "SIGNING_PRIVATE_KEY_PEM"],
    ["본문 뒤쪽이 잘림", { SIGNING_PRIVATE_KEY_PEM: `-----BEGIN PRIVATE KEY-----\\n${body.slice(0, 60)}\\n-----END PRIVATE KEY-----\\n` }, "SIGNING_PRIVATE_KEY_PEM"],
    ["ECDSA P-256이 아닌 키(Ed25519)", { SIGNING_PRIVATE_KEY_PEM: otherPkcs8("ed25519") }, "SIGNING_PRIVATE_KEY_PEM"],
    ["ECDSA P-384 키", { SIGNING_PRIVATE_KEY_PEM: otherPkcs8("p384") }, "SIGNING_PRIVATE_KEY_PEM"],
  ] as [string, Record<string, string>, string | null][])("서명 키 %s: 빌드와 서버(loadKey)의 판단이 같다", async (_name, over, failing) => {
    const msg = await buildError(over);
    // 같은 환경변수로 서버의 키 로딩을 돌린다(키 3줄이 모두 있어 환경변수 키로만 읽는다. DATABASE_URL이 있어 개발용 키로 가지 않는다)
    vi.resetModules();
    const { loadKey } = await import("@/server/keys");
    const serverOk = await loadKey("signal").then(
      () => true,
      () => false,
    );
    expect([msg === null, serverOk]).toEqual([failing === null, failing === null]);
    if (failing) {
      expect(msg).toMatch(new RegExp(`^운영 배포에 필요한 환경변수가 없거나 형식이 틀립니다: ${failing}\\((개인키와 짝이 아니거나 앞뒤에 공백이 있음|개인키로 읽을 수 없음)[^)]*\\)\\. `));
      // 값(키 ID·PEM)은 출력하지 않는다
      for (const v of [SIG.id, OTHER_SIG.id, CP.id, "BEGIN", "PRIVATE-SIG-VALUE", body.slice(0, 20)]) expect(msg).not.toContain(v);
    }
  });

  it("체크포인트 키도 같은 규칙: 다른 묶음의 키 ID와 읽을 수 없는 개인키를 함께 알린다", async () => {
    const msg = await buildError({ CHECKPOINT_KEY_ID: OTHER_CP.id, SIGNING_PRIVATE_KEY_PEM: "-----BEGIN PRIVATE KEY-----\\nAAAA\\n-----END PRIVATE KEY-----" });
    expect(msg).toContain("CHECKPOINT_KEY_ID(개인키와 짝이 아니거나 앞뒤에 공백이 있음");
    expect(msg).toContain("SIGNING_PRIVATE_KEY_PEM(개인키로 읽을 수 없음");
    expect(msg).not.toContain("SIGNING_KEY_ID(");
    expect(msg).not.toContain(OTHER_CP.id);
  });
});

describe("보안 헤더", () => {
  it("모든 경로에 iframe 금지·nosniff·Referrer-Policy·Permissions-Policy를 붙이고 X-Powered-By를 끈다", async () => {
    const config = await load();
    expect(config.poweredByHeader).toBe(false);
    const rules = await config.headers!();
    expect(rules).toHaveLength(1);
    expect(rules[0].source).toBe("/:path*");
    expect(Object.fromEntries(rules[0].headers.map((h) => [h.key, h.value]))).toEqual({
      "X-Frame-Options": "DENY",
      "Content-Security-Policy": "frame-ancestors 'none'",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "strict-origin-when-cross-origin",
      "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
    });
    expect(config.outputFileTracingExcludes).toEqual({ "/**": ["./.data/**", "./anchors-out/**"] });
  });
});
