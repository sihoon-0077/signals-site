import { X509Certificate, createHash, createPrivateKey, createPublicKey } from "node:crypto";
import path from "node:path";
import type { NextConfig } from "next";
// 빌드 설정에서 불러오는 앱 코드는 다른 모듈을 끌어오지 않는 순수 함수 파일만 쓴다(src/server/*는 server-only·DB 드라이버를 불러와 여기서 쓸 수 없다).
// Next 15.5의 설정 로더는 아래 상대 경로를 작업 폴더 기준으로 찾으므로 빌드는 프로젝트 폴더에서 한다(npm run build, Vercel은 그렇게 한다).
import { type KeyPurpose, expectedKeyId } from "./src/core/keys";
import { mailServiceProblem } from "./src/lib/mail-service";

// ---- 운영 배포 빌드 검사(Vercel Production 빌드에서만) ----
// 필수 환경변수가 비었거나 형식이 틀리면 빌드를 멈춘다. 검사가 없으면 빌드는 성공하고 그 배포가 곧바로 운영 주소에 붙은 뒤
// 요청마다 500·503이 나고, 처리방침에는 '설정 필요'가 그대로 공개된다. 빌드가 실패한 배포는 운영 주소에 붙지 않아 직전 배포가 유지된다.
// 서버가 요청마다 CONFIG_INVALID로 거부하는 값(주소의 SSL 설정, 읽을 수 없는 DB 인증서, 개인키와 짝이 아닌 키 ID)도 서버와 같은 규칙으로 여기서 막는다
// (src/server/db.ts sslOptions, src/server/keys.ts loadKey. 두 곳이 어긋나지 않게 next-config 테스트가 같은 값을 둘 다에 넣어 본다).
// 로컬 빌드(VERCEL_ENV 없음)와 미리보기 빌드는 검사하지 않는다. 값은 출력하지 않고 이름과 이유만 알린다(빌드 로그에 비밀값이 남지 않게).
const MIN_SECRET_LENGTH = 16; // src/lib/basic-auth.ts와 같은 값(짧으면 런타임에도 /admin·앵커 호출구가 닫힌다)
const LOCAL_HOSTS = ["localhost", "127.0.0.1", "[::1]", "0.0.0.0"];
/** src/server/db.ts sslOptions와 같은 규칙: 주소의 SSL 매개변수는 pg가 TLS 설정을 덮어쓰므로 서버가 모든 DB 요청을 거부한다 */
const DB_URL_SSL_PARAM = /[?&](ssl[a-z]*|uselibpqcompat)=/i;

function isPublicHttpsOrigin(v: string): boolean {
  try {
    const u = new URL(v);
    return u.protocol === "https:" && u.pathname === "/" && !u.search && !u.hash && !u.username && !u.password && !LOCAL_HOSTS.includes(u.hostname);
  } catch {
    return false;
  }
}

/** src/server/db.ts sslOptions와 같은 기준: \n 두 글자를 줄바꿈으로 바꾸고 앞뒤 공백을 뗀 값이 X.509 인증서로 읽혀야 한다 */
function isCertificate(ca: string): boolean {
  try {
    new X509Certificate(ca);
    return true;
  } catch {
    return false;
  }
}

/**
 * 개인키 PEM에서 운영 키 ID(용도 접두 + 공개키 지문 앞 12자리)를 다시 계산한다. 서버가 읽을 수 없는 개인키면 null.
 * 서버(src/core/signature.ts fromPem → WebCrypto)와 같은 순서로 읽는다: \n 두 글자 → 줄바꿈, BEGIN~END 사이만 atob, PKCS#8 ECDSA P-256.
 * PEM 전체를 node:crypto에 바로 넘기지 않는다: keygen 출력처럼 따옴표로 감싼 값을 서버는 받는데 node:crypto는 거부한다.
 */
function keyIdFromPrivatePem(purpose: KeyPurpose, pem: string): string | null {
  const m = /-----BEGIN PRIVATE KEY-----([\s\S]*?)-----END PRIVATE KEY-----/.exec(pem.replace(/\\n/g, "\n"));
  if (!m) return null;
  try {
    const key = createPrivateKey({ key: Buffer.from(atob(m[1].replace(/\s+/g, "")), "latin1"), format: "der", type: "pkcs8" });
    // WebCrypto(ECDSA P-256)가 받지 않는 다른 종류의 키
    if (key.asymmetricKeyType !== "ec" || key.asymmetricKeyDetails?.namedCurve !== "prime256v1") return null;
    const fingerprint = createHash("sha256").update(createPublicKey(key).export({ type: "spki", format: "der" })).digest("hex");
    return expectedKeyId(purpose, fingerprint);
  } catch {
    return null;
  }
}

function assertProductionEnv(): void {
  if (process.env.VERCEL_ENV !== "production") return;
  const bad: string[] = [];
  /** 비었거나 규칙에 맞지 않으면 목록에 이름과 이유를 넣는다. 통과하면 true */
  const check = (name: string, ok: (v: string) => boolean = () => true, hint = "형식 오류"): boolean => {
    const v = process.env[name]?.trim() ?? "";
    if (!v) bad.push(`${name}(비어 있음)`);
    else if (!ok(v)) bad.push(`${name}(${hint})`);
    else return true;
    return false;
  };
  check(
    "DATABASE_URL",
    (v) => /^postgres(ql)?:\/\/\S+$/.test(v) && !v.includes("[YOUR-PASSWORD]") && !DB_URL_SSL_PARAM.test(v),
    "postgresql:// 연결 문자열, Supabase의 [YOUR-PASSWORD]는 실제 비밀번호로, 끝에 ?sslmode= 같은 SSL 설정 없이",
  );
  // 선택 값이다(비우면 암호화만 하고 서버 인증서는 확인하지 않음, 배포 뒤 smoke가 실패로 알린다). 넣었다면 서버가 인증서로 읽을 수 있어야 한다:
  // 잘린 값이면 서버는 모든 DB 요청을 CONFIG_INVALID로 거부한다(여러 줄 .env를 한 칸에 몰아 붙이다 잘리는 경우 등).
  const ca = process.env.DATABASE_CA_PEM?.replace(/\\n/g, "\n").trim();
  if (ca && !isCertificate(ca)) bad.push("DATABASE_CA_PEM(인증서로 읽을 수 없음: prod-ca-2021.crt 내용 전체를 이 변수의 값 칸에 따로)");
  for (const [p, purpose, id] of [
    ["SIGNING", "signal", "sig"],
    ["CHECKPOINT", "checkpoint", "cp"],
  ] as const) {
    // 운영 키 ID는 keygen이 만든 '접두-지문 12자리'다(개발용 sig-dev-·cp-dev- 키는 여기서 걸린다)
    const idOk = check(`${p}_KEY_ID`, (v) => new RegExp(`^${id}-[0-9a-f]{12}$`).test(v), `${id}-로 시작하는 운영 키 ID, keygen 출력 그대로`);
    check(`${p}_KEY_CREATED_AT`, (v) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(v) && !Number.isNaN(Date.parse(v)), "keygen 출력 그대로의 ISO 시각");
    if (check(`${p}_PRIVATE_KEY_PEM`, (v) => v.includes("-----BEGIN PRIVATE KEY-----") && v.includes("-----END PRIVATE KEY-----"), "PEM 전체(BEGIN~END)")) {
      // 서버는 키 ID가 개인키의 공개키 지문과 짝이 아니면(다른 키 파일의 줄이 섞임) 키를 쓰지 않는다. 키 ID는 다듬지 않은 값 그대로 비교한다(서버와 같음).
      const derived = keyIdFromPrivatePem(purpose, process.env[`${p}_PRIVATE_KEY_PEM`] ?? "");
      if (derived === null) bad.push(`${p}_PRIVATE_KEY_PEM(개인키로 읽을 수 없음: 잘렸거나 글자가 바뀜, prod-keys.env의 줄 그대로)`);
      else if (idOk && derived !== process.env[`${p}_KEY_ID`]) {
        bad.push(`${p}_KEY_ID(개인키와 짝이 아니거나 앞뒤에 공백이 있음: 같은 prod-keys.env의 6줄 그대로, npm run keys:check로 확인)`);
      }
    }
  }
  check("ADMIN_USER");
  check("ADMIN_PASSWORD", (v) => v.length >= MIN_SECRET_LENGTH, `${MIN_SECRET_LENGTH}자 이상`);
  check("CRON_SECRET", (v) => v.length >= MIN_SECRET_LENGTH, `${MIN_SECRET_LENGTH}자 이상`);
  // 검증 화면(src/core/verify.ts mirrorRawBase)이 받아들이는 형식이어야 공개 저장소 대조가 '확인 못 함'이 되지 않는다
  check(
    "ANCHOR_REPO_URL",
    (v) => {
      // mirrorRawBase(src/core/verify.ts)와 같은 기준: 계정·저장소 이름이 '.'·'..'이면 fetch가 경로에서 접어 다른 저장소를 받는다('.github'은 정상)
      const m = /^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/.exec(v);
      return m !== null && !/^\.+$/.test(m[1]) && !/^\.+$/.test(m[2]);
    },
    "https://github.com/계정/저장소",
  );
  const branch = process.env.ANCHOR_REPO_BRANCH?.trim();
  if (branch && (!/^[\w.-]+(?:\/[\w.-]+)*$/.test(branch) || branch.split("/").some((s) => s.startsWith(".")))) bad.push("ANCHOR_REPO_BRANCH(브랜치 이름 형식)");
  check("PRIVACY_OFFICER");
  check("CONTACT_EMAIL", (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), "이메일 주소");
  // CONTACT_EMAIL 메일함을 운영하는 업체. 처리방침 3항에 그대로 공개된다(없으면 본인 확인 메일이 처리방침에 없는 위탁·국외 이전이 된다).
  // 형식·국가와 메일 주소에 맞는 업체인지는 처리방침과 같은 파일(src/lib/mail-service.ts)이 판단한다
  const mailProblem = mailServiceProblem(process.env.MAIL_SERVICE, process.env.CONTACT_EMAIL);
  check("MAIL_SERVICE", () => mailProblem === null, mailProblem ?? "");
  // SITE_URL은 선택이다(비우면 Vercel 운영 주소). 넣었다면 공개 https 주소여야 한다(src/server/config.ts siteUrl과 같은 기준)
  const site = process.env.SITE_URL?.trim();
  if (site && !isPublicHttpsOrigin(site)) bad.push("SITE_URL(https://로 시작하는 공개 주소, 경로 없이)");
  if (!site && !process.env.VERCEL_PROJECT_PRODUCTION_URL) bad.push("SITE_URL(비어 있고 Vercel 운영 주소도 없음)");
  if (bad.length) {
    throw new Error(
      `운영 배포에 필요한 환경변수가 없거나 형식이 틀립니다: ${bad.join(", ")}. ` +
        "Vercel → Settings → Environment Variables에서 Production 값을 고친 뒤 Deployments에서 Redeploy 하세요.",
    );
  }
}
assertProductionEnv();

// 모든 응답에 붙는 보안 헤더. 다른 사이트가 /admin 등을 iframe으로 띄워 클릭을 유도하지 못하게 한다(클릭재킹).
// 전체 CSP(script-src)는 Next 인라인 스크립트 nonce와 검증 화면의 raw.githubusercontent.com 요청(connect-src)까지 맞춰야 해서 넣지 않는다.
const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

const nextConfig: NextConfig = {
  // 상위 폴더의 다른 package-lock.json을 루트로 오인하지 않도록 이 프로젝트를 추적 루트로 고정한다.
  outputFileTracingRoot: path.join(__dirname),
  // PGlite(개발용 내장 PostgreSQL)는 WASM 파일을 런타임에 읽으므로 번들하지 않고 node_modules에서 불러온다.
  serverExternalPackages: ["@electric-sql/pglite"],
  // 서버에서 db/migrations/*.sql을 읽어 개발 DB를 자동 마이그레이션한다.
  outputFileTracingIncludes: { "/**": ["./db/migrations/*.sql"] },
  // 로컬 개발용 키·DB(.data)와 수동 앵커 출력은 함수 번들에 넣지 않는다(CLI·prebuilt 배포로 올라가는 것 방지).
  // Next 15.5는 이 경로를 path.join으로 이어 Windows에서는 역슬래시가 되어 맞지 않는다: Linux 빌드(Vercel)에서만 효과가 있다.
  outputFileTracingExcludes: { "/**": ["./.data/**", "./anchors-out/**"] },
  // 응답마다 'X-Powered-By: Next.js'를 붙이지 않는다
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
