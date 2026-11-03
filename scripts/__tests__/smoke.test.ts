// 배포 후 점검(scripts/smoke.ts)을 실제 명령처럼 실행한다. 상대는 이 테스트가 127.0.0.1에 띄운 가짜 사이트다.
// --repo 대조도 GitHub 대신 이 서버의 /raw/…를 읽게 해서(SMOKE_RAW_BASE) 외부 네트워크를 쓰지 않는다.
// 확인하는 것:
//  - 정상 사이트면 실패 0, 종료 코드 0(Windows에서 fetch 뒤 process.exit()로 0xC0000409가 나던 문제 포함)
//  - 공유 이미지 404는 진짜 이미지 주소(/p/<주소>/opengraph-image/r0)로 요청하고, 앱 404 HTML이면 실패로 본다(R26)
//  - /api/health의 오류 코드·키 불일치를 그대로 보여 준다(R30)
//  - JSON이 아닌 응답·연결 끊김이 있어도 앞서 모은 결과를 모두 출력하고 종료 코드 1로 끝난다(R31)
//  - 운영 모드(--local 없음)에서 DB 연결이 서버 인증서를 확인하지 않으면(TLS verify-full 아님) 실패로 센다('실패 0'이 배포 통과 조건이다)
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type KeyPurpose, type PublicKeyEntry, expectedKeyId } from "../../src/core/keys";
import { exportPublicKeyPem, generateSigningKeyPair, publicKeyFingerprint } from "../../src/core/signature";
import { runScript } from "./run-script";

type Handler = (req: IncomingMessage, res: ServerResponse) => void;

let server: Server;
let base: string;
let keys: PublicKeyEntry[];
/** 경로별로 정상 응답을 바꿔 끼운다(정규식이 경로에 맞으면 그 처리기를 쓴다) */
let overrides: [RegExp, Handler][] = [];

const html = (res: ServerResponse, status: number, body: string, headers: Record<string, string> = {}) => {
  res.writeHead(status, { "content-type": "text/html; charset=utf-8", ...headers });
  res.end(`<!DOCTYPE html><html><body>${body}</body></html>`);
};
const json = (res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) => {
  res.writeHead(status, { "content-type": "application/json", ...headers });
  res.end(JSON.stringify(body));
};

const healthy = () => ({
  status: "ok",
  deployment: { region: null },
  db: { ok: true, migrations: { pending: [] }, tls: "pglite" },
  keys: { ok: true, signal: { key_id: keys[0].key_id }, checkpoint: { key_id: keys[1].key_id } },
  key_mismatch: { signal: false, checkpoint: false },
});

/** 운영 사이트가 smoke 요청에 주는 응답을 흉내 낸다 */
const site: Handler = (req, res) => {
  const url = req.url ?? "/";
  for (const [re, h] of overrides) if (re.test(url)) return h(req, res);
  const sec = { "x-frame-options": "DENY", "x-content-type-options": "nosniff", "referrer-policy": "strict-origin-when-cross-origin" };
  if (url === "/") return html(res, 200, "SIGNALS", sec);
  if (url === "/providers/join") return html(res, 200, '<input name="consentPrivacy"><input name="ageConfirmed">');
  if (url === "/privacy") return html(res, 200, "보호책임자 홍길동 · privacy@example.com <li><strong>네이버(주)</strong>(대한민국, privacy@example.com) — 운영 메일(본인 확인·승인 안내·시그널 접수·문의 답변)을 주고받고 보관.</li>");
  if (url === "/verify" || url === "/anchors") return html(res, 200, "SIGNALS");
  // 이미지 라우트: generateImageMetadata가 빈 목록이면 Next가 본문 'Not Found'(text/plain, Cache-Control 없음)로 답한다
  if (/^\/p\/[^/]+\/opengraph-image\/r\d+$/.test(url)) {
    res.writeHead(404, { "content-type": "text/plain;charset=UTF-8" });
    return res.end("Not Found");
  }
  if (url === "/keys.json") return json(res, 200, { version: 1, keys }, { "access-control-allow-origin": "*" });
  if (url === "/api/anchors") return json(res, 200, { anchors: [] });
  if (/^\/api\/anchors\/(2026-02-30|2026-13-01|not-a-date)$/.test(url)) return json(res, 400, { error: "invalid_date" });
  if (url.startsWith("/api/anchors/") || url.startsWith("/api/signals/")) return json(res, 404, { error: "not_found" });
  if (url === "/admin" || url === "/%61dmin") return html(res, 401, "인증 필요", { "www-authenticate": 'Basic realm="admin"' });
  if (url === "/admin/") {
    res.writeHead(308, { location: "/admin" });
    return res.end();
  }
  if (url === "/api/cron/anchor") return json(res, 401, { error: "unauthorized" });
  if (url === "/api/health") return json(res, 200, healthy());
  return html(res, 404, "찾을 수 없음");
};

async function smoke(extra: string[] = []) {
  // --repo 대조는 GitHub 대신 이 가짜 서버의 /raw/<계정>/<저장소>/<브랜치>/…를 읽게 한다(SMOKE_RAW_BASE는 시험용)
  return runScript("smoke.ts", [base, "--local", ...extra], { SMOKE_RAW_BASE: `${base}/raw` });
}

/** 앵커 1개가 있는 사이트(목록·문서)와 공개 저장소 사본 */
const ANCHOR_DOC = { version: "1", date: "2026-11-02", merkle_root: "ab".repeat(32), prev_root: null, leaf_count: 0, leaves: [] };
const withOneAnchor = (): [RegExp, Handler][] => [
  [/^\/api\/anchors$/, (_q, s) => json(s, 200, { anchors: [{ date: ANCHOR_DOC.date, merkle_root: ANCHOR_DOC.merkle_root, prev_root: null }] })],
  [/^\/api\/anchors\/2026-11-02$/, (_q, s) => json(s, 200, ANCHOR_DOC)],
];

beforeAll(async () => {
  keys = [];
  for (const purpose of ["signal", "checkpoint"] as KeyPurpose[]) {
    const pub = await exportPublicKeyPem((await generateSigningKeyPair()).publicKey);
    const fingerprint = await publicKeyFingerprint(pub);
    keys.push({ key_id: expectedKeyId(purpose, fingerprint), purpose, algorithm: "ECDSA-P256-SHA256", public_key_pem: pub, fingerprint, created_at: new Date().toISOString(), retired_at: null });
  }
  server = createServer((req, res) => site(req, res));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("smoke: 정상 사이트", () => {
  it("실패 0으로 끝나고, 공유 이미지는 r0 이미지 주소로 확인한다", async () => {
    overrides = [];
    const r = await smoke();
    expect(r.stdout).toContain("종합: 실패 0");
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/\[통과\] 없는 프로필의 공유 이미지는 404 — \/p\/smoke-[0-9a-f]{8}\/opengraph-image\/r0 → 404/);
    expect(r.stdout).toContain("[통과] 개인정보 처리방침");
    expect(r.stdout).toContain("[통과] 상태 점검(/api/health)");
  });
});

describe("smoke: 고장 난 부분을 이유와 함께 보여 준다", () => {
  it("이미지 라우트가 아닌 앱 404, 운영 메일 항목 없는 처리방침, DB·키 오류 코드", async () => {
    overrides = [
      [/\/opengraph-image\//, (_q, s) => html(s, 404, "찾을 수 없음")],
      [/^\/privacy$/, (_q, s) => html(s, 200, "보호책임자 홍길동 · privacy@example.com")],
      [
        /^\/api\/health$/,
        (_q, s) => json(s, 503, { ...healthy(), status: "degraded", db: { ok: false, error: "42P01", tls: "verify-full" }, keys: { ok: false, error: "CONFIG_INVALID" }, key_mismatch: null }),
      ],
    ];
    const r = await smoke();
    expect(r.code).toBe(1);
    expect(r.stdout).toMatch(/\[실패\] 없는 프로필의 공유 이미지는 404 — .*text\/html.*이미지 라우트가 아닌 앱 404/);
    expect(r.stdout).toMatch(/\[실패\] 개인정보 처리방침 — 3항에 운영 메일 업체 항목이 없음/);
    expect(r.stdout).toMatch(/\[실패\] 상태 점검\(\/api\/health\) — .*DB 오류 코드 42P01\(마이그레이션 안 됨\)/);
    expect(r.stdout).toContain("서명 키 오류 코드 CONFIG_INVALID(환경변수 누락·형식 오류)");
  });

  it("풀러가 거절한 XX000은 뜻(풀러 거절)과 함께 적는다", async () => {
    overrides = [[/^\/api\/health$/, (_q, s) => json(s, 503, { ...healthy(), status: "degraded", db: { ok: false, error: "XX000", tls: "verify-full" } })]];
    const r = await smoke();
    expect(r.code).toBe(1);
    expect(r.stdout).toMatch(/\[실패\] 상태 점검\(\/api\/health\) — .*DB 오류 코드 XX000\(풀러 거절/);
  });

  it("DB에 남은 마지막 키와 지금 키가 다르면(key_mismatch) 그 사실을 적는다", async () => {
    overrides = [[/^\/api\/health$/, (_q, s) => json(s, 503, { ...healthy(), status: "degraded", key_mismatch: { signal: true, checkpoint: true } })]];
    const r = await smoke();
    expect(r.code).toBe(1);
    expect(r.stdout).toContain("SIGNING 키가 DB의 마지막 시그널 키와 다름(발행이 거부됨)");
    expect(r.stdout).toContain("CHECKPOINT 키가 DB의 마지막 앵커 키와 다름(앵커가 거부됨)");
  });

  it("2항의 '운영 메일함' 문장만 있고 3항 업체 항목이 없으면 실패, 상태 점검의 mail_service=false도 적는다", async () => {
    overrides = [
      [/^\/privacy$/, (_q, s) => html(s, 200, "보호책임자 홍길동 · privacy@example.com 운영 메일함(3항의 운영 메일 업체)에서 그 등록자와 주고받은 메일도 지웁니다.")],
      [/^\/api\/health$/, (_q, s) => json(s, 200, { ...healthy(), config: { mail_service: false } })],
    ];
    const r = await smoke();
    expect(r.code).toBe(1);
    expect(r.stdout).toMatch(/\[실패\] 개인정보 처리방침 — 3항에 운영 메일 업체 항목이 없음/);
    expect(r.stdout).toContain("MAIL_SERVICE가 없거나 형식이 틀림");
  });

  it("'설정 필요'가 보이면 세 환경변수(MAIL_SERVICE 포함)를 안내한다", async () => {
    overrides = [[/^\/privacy$/, (_q, s) => html(s, 200, "(배포 전 MAIL_SERVICE 설정 필요) privacy@example.com 운영 메일")]];
    const r = await smoke();
    expect(r.code).toBe(1);
    expect(r.stdout).toContain("PRIVACY_OFFICER·CONTACT_EMAIL·MAIL_SERVICE 설정 후 Redeploy");
  });
});

describe("smoke: 응답이 망가져도 결과를 잃지 않는다", () => {
  it("/api/health가 JSON이 아닌 500(HTML)이면 그 항목만 실패로 적고 나머지 결과도 모두 출력한다", async () => {
    overrides = [[/^\/api\/health$/, (_q, s) => html(s, 500, "FUNCTION_INVOCATION_FAILED")]];
    const r = await smoke();
    expect(r.code).toBe(1);
    expect(r.stdout).toContain("[통과] 홈");
    expect(r.stdout).toContain("[통과] 관리자 화면 잠김");
    expect(r.stdout).toMatch(/\[실패\] 상태 점검\(\/api\/health\) — \/api\/health → 500 text\/html.*JSON이 아님: <!DOCTYPE html>/);
    expect(r.stdout).toContain("종합: 실패 1,");
    expect(r.stderr).not.toContain("점검 중단");
  });

  it("빈 500 본문과 연결 끊김도 주소와 함께 실패 한 줄로 남기고 다음 점검을 계속한다", async () => {
    overrides = [
      [/^\/keys\.json$/, (_q, s) => (s.writeHead(500), s.end())],
      [/^\/api\/anchors$/, (q) => q.socket.destroy()],
    ];
    const r = await smoke();
    expect(r.code).toBe(1);
    expect(r.stdout).toMatch(/\[실패\] 공개키\(\/keys\.json\) — → 500/);
    expect(r.stdout).toMatch(/\[실패\] 앵커 목록 — 점검 중단: \/api\/anchors 요청 실패: /);
    // 뒤 묶음도 돌았다
    expect(r.stdout).toContain("[통과] 관리자 화면 잠김");
    // /keys.json을 못 읽었을 때 상태 점검이 '키 ID가 다름'으로 잘못 실패하지 않는다
    expect(r.stdout).toContain("[통과] 상태 점검(/api/health)");
    expect(r.stdout).toMatch(/종합: 실패 2,/);
  });

  it("/keys.json이 200인데 JSON이 아니면(로그인 화면 등) 형식과 본문 앞부분을 보여 준다", async () => {
    overrides = [[/^\/keys\.json$/, (_q, s) => html(s, 200, "Vercel 로그인")]];
    const r = await smoke();
    expect(r.code).toBe(1);
    expect(r.stdout).toMatch(/\[실패\] 공개키\(\/keys\.json\) — 점검 중단: \/keys\.json → 200 text\/html; charset=utf-8, JSON이 아님: <!DOCTYPE html>/);
    expect(r.stdout).toContain("[통과] 상태 점검(/api/health)");
  });
});

describe("smoke 운영 모드(--local 없음): DB 서버 인증서 확인", () => {
  const prod = () => runScript("smoke.ts", [base], { SMOKE_RAW_BASE: `${base}/raw` });
  const withTls = (tls: string): [RegExp, Handler][] => [[/^\/api\/health$/, (_q, s) => json(s, 200, { ...healthy(), db: { ok: true, migrations: { pending: [] }, tls } })]];

  it("encrypt-only(DATABASE_CA_PEM 없음)는 고칠 방법과 함께 실패로 센다", async () => {
    // 이 가짜 사이트는 http라 운영 모드에서는 HTTPS 항목이 늘 실패다. 인증서 항목이 실패 수를 하나 늘리는지로 본다.
    overrides = withTls("verify-full");
    const ok = await prod();
    expect(ok.stdout).toContain("[실패] HTTPS");
    expect(ok.stdout).not.toContain("DB 서버 인증서 확인");
    expect(ok.stdout).toMatch(/종합: 실패 1,/);

    overrides = withTls("encrypt-only");
    const r = await prod();
    expect(r.code).toBe(1);
    expect(r.stdout).toContain("[통과] 상태 점검(/api/health) — DB·키 정상, TLS encrypt-only");
    expect(r.stdout).toMatch(/\[실패\] DB 서버 인증서 확인 — encrypt-only → DATABASE_CA_PEM을 넣으면 verify-full/);
    expect(r.stdout).toMatch(/종합: 실패 2,/);
  });

  it("운영 DB가 아닌 연결(pglite)도 실패로 세고, --local 시험에서는 인증서 항목을 보지 않는다", async () => {
    overrides = withTls("pglite");
    expect((await prod()).stdout).toMatch(/\[실패\] DB 서버 인증서 확인 — pglite → 운영 DB 주소가 아님/);
    overrides = withTls("encrypt-only");
    const local = await smoke();
    expect(local.code).toBe(0);
    expect(local.stdout).not.toContain("DB 서버 인증서 확인");
  });
});

describe("smoke --repo: 공개 저장소 대조", () => {
  it("저장소의 keys.json·최신 앵커가 사이트와 같으면 통과한다", async () => {
    overrides = [
      ...withOneAnchor(),
      [/^\/raw\/o\/r\/main\/keys\.json$/, (_q, s) => json(s, 200, { version: 1, keys })],
      [/^\/raw\/o\/r\/main\/anchors\/2026-11-02\.json$/, (_q, s) => json(s, 200, ANCHOR_DOC)],
    ];
    const r = await smoke(["--repo", "o/r"]);
    expect(r.stdout).toContain("[통과] 공개 저장소 공개키 — 2개가 사이트와 같음");
    expect(r.stdout).toContain("[통과] 공개 저장소 최신 앵커 — 2026-11-02 문서가 사이트와 같음");
    expect(r.code).toBe(0);
  });

  it("저장소 응답이 오류(403)면 키 0개로 '같음'이 되지 않고 실패한다", async () => {
    overrides = [[/^\/raw\/o\/r\/main\/keys\.json$/, (_q, s) => json(s, 403, { message: "rate limited" })]];
    const r = await smoke(["--repo", "o/r"]);
    expect(r.code).toBe(1);
    expect(r.stdout).toMatch(/\[실패\] 공개 저장소 공개키 — .*\/raw\/o\/r\/main\/keys\.json → HTTP 403/);
  });

  it("마지막 점검(저장소 대조)에서 연결이 끊겨도 앞서 모은 결과를 모두 출력한다", async () => {
    overrides = [
      ...withOneAnchor(),
      [/^\/raw\/o\/r\/main\/keys\.json$/, (_q, s) => json(s, 200, { version: 1, keys })],
      [/^\/raw\/o\/r\/main\/anchors\//, (q) => q.socket.destroy()],
    ];
    const r = await smoke(["--repo", "o/r"]);
    expect(r.code).toBe(1);
    expect(r.stdout).toContain("[통과] 홈");
    expect(r.stdout).toContain("[통과] 최신 앵커 문서");
    expect(r.stdout).toContain("[통과] 공개 저장소 공개키");
    expect(r.stdout).toMatch(/\[실패\] 공개 저장소 대조 — 점검 중단: .*\/raw\/o\/r\/main\/anchors\/2026-11-02\.json 요청 실패/);
    expect(r.stdout).toMatch(/종합: 실패 1,/);
  });
});
