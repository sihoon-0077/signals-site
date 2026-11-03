// 배포 후 읽기 전용 점검. 운영 도메인에 요청만 보내고, 기록을 만드는 요청은 절대 보내지 않는다.
// 사용: npm run smoke -- https://운영도메인 [--repo 계정/signals-anchors] [--branch main] [--local]
//   --repo   공개 앵커 저장소의 keys.json·최신 앵커가 사이트와 같은지도 대조한다(첫 실행 전이면 '주의')
//   --branch 공개 앵커 저장소 기본 브랜치가 main이 아닐 때(사이트의 ANCHOR_REPO_BRANCH와 같게)
//   --local 로컬 next start 시험용: http 주소·개발용 키·Vercel 헤더 없음·DB 서버 인증서 확인 없음(TLS verify-full 아님)을 실패로 보지 않는다
// 하지 않는 것(영구 기록·통계 오염): 진짜 CRON_SECRET으로 앵커 호출, /admin 버튼, 사전등록 제출, /api/ref 비콘.
// 한 묶음이 요청 실패·시간 초과·JSON 아닌 응답으로 멈춰도 그 묶음만 실패로 적고, 나머지 점검과 결과 출력은 계속한다
// (배포가 망가져 결과가 가장 필요할 때 앞서 모은 결과를 잃지 않게).
// 하나라도 실패면 종료 코드 1, 사용법 오류는 2.
// 시험용: SMOKE_RAW_BASE(공개 저장소 raw 주소, 기본 https://raw.githubusercontent.com)
import { randomUUID } from "node:crypto";
import { publicKeyFingerprint } from "../src/core/signature";

type Level = "PASS" | "WARN" | "FAIL";
const results: { level: Level; label: string; detail: string }[] = [];
const report = (level: Level, label: string, detail: string) => results.push({ level, label, detail });

/** 모은 결과를 출력하고 실패 수를 돌려준다. 정상 종료와 예외 종료 양쪽에서 부른다(process.exit는 finally를 건너뛰므로 finally에 두지 않는다). */
function printResults(): number {
  const mark = { PASS: "통과", WARN: "주의", FAIL: "실패" } as const;
  for (const r of results) console.log(`[${mark[r.level]}] ${r.label} — ${r.detail}`);
  const fails = results.filter((r) => r.level === "FAIL").length;
  const warns = results.filter((r) => r.level === "WARN").length;
  console.log(`종합: 실패 ${fails}, 주의 ${warns}, 통과 ${results.length - fails - warns}`);
  return fails;
}

/** 점검 묶음 하나를 돌린다. 예외가 나면 그 묶음의 남은 항목은 건너뛰고 실패 한 줄로 남긴 뒤 undefined를 돌려준다. */
async function step<T>(label: string, fn: () => Promise<T>): Promise<T | undefined> {
  try {
    return await fn();
  } catch (e) {
    report("FAIL", label, `점검 중단: ${(e as Error).message}`);
    return undefined;
  }
}

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(name);
  if (i < 0) return null;
  const v = args[i + 1];
  args.splice(i, v && !v.startsWith("--") ? 2 : 1);
  return v && !v.startsWith("--") ? v : "";
};
const repo = flag("--repo");
const branch = flag("--branch") || "main";
const local = flag("--local") !== null;
const base = (args[0] ?? "").replace(/\/+$/, "");
const rand = randomUUID().slice(0, 8);

/**
 * 요청을 보내고 본문까지 읽는다. 실패 메시지에 어느 주소였는지를 붙인다(fetch의 'fetch failed'·시간 초과 메시지에는 주소가 없다).
 * json()은 본문이 JSON이 아니면(Vercel 오류·로그인 화면 HTML, 빈 500) 상태 코드·형식·본문 앞부분을 담아 던진다.
 */
async function request(url: string, label: string, init: RequestInit = {}) {
  let res: Response;
  let body: string;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(30_000), ...init });
    body = await res.text();
  } catch (e) {
    const cause = (e as { cause?: { code?: unknown } }).cause?.code;
    throw new Error(`${label} 요청 실패: ${(e as Error).message}${typeof cause === "string" ? ` (${cause})` : ""}`);
  }
  const json = (): unknown => {
    try {
      return JSON.parse(body);
    } catch {
      const head = body.replace(/\s+/g, " ").trim().slice(0, 120) || "(빈 본문)";
      throw new Error(`${label} → ${res.status} ${res.headers.get("content-type") ?? "(형식 없음)"}, JSON이 아님: ${head}`);
    }
  };
  return { res, body, json };
}

const get = (path: string, init: RequestInit = {}) => request(`${base}${path}`, path, { redirect: "manual", ...init });

/** 키 순서와 관계없이 같은 JSON인지 비교하려고 키를 정렬해 직렬화한다. */
function stable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stable).join(",")}]`;
  if (v && typeof v === "object") {
    return `{${Object.keys(v)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stable((v as Record<string, unknown>)[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(v);
}

async function expectStatus(label: string, path: string, want: number, init: RequestInit = {}) {
  try {
    const { res } = await get(path, init);
    report(res.status === want ? "PASS" : "FAIL", label, `${path} → ${res.status}${res.status === want ? "" : ` (기대 ${want})`}`);
  } catch (e) {
    report("FAIL", label, (e as Error).message); // get()이 주소를 붙여 둔다
  }
}

interface KeyEntry {
  key_id: string;
  purpose: string;
  algorithm: string;
  public_key_pem: string;
  fingerprint: string;
  created_at: string;
  retired_at: string | null;
}
interface AnchorRow {
  date: string;
  merkle_root: string;
  prev_root: string | null;
}

async function checkPages() {
  const home = await get("/");
  const htmlOk = home.res.status === 200 && (home.res.headers.get("content-type") ?? "").includes("text/html") && home.body.includes("SIGNALS");
  report(htmlOk ? "PASS" : "FAIL", "홈", `/ → ${home.res.status}`);

  // 보안 헤더: 클릭재킹(다른 사이트가 /admin을 숨겨 띄우기)·MIME 추측 방지. 없으면 next.config.ts의 headers()를 확인한다.
  const h = home.res.headers;
  const frame = h.get("x-frame-options") === "DENY" || /frame-ancestors\s+'none'/.test(h.get("content-security-policy") ?? "");
  const missing = [
    frame ? null : "X-Frame-Options/frame-ancestors",
    h.get("x-content-type-options") === "nosniff" ? null : "X-Content-Type-Options",
    h.get("referrer-policy") ? null : "Referrer-Policy",
  ].filter(Boolean);
  report(missing.length ? "FAIL" : "PASS", "보안 헤더", missing.length ? `없음: ${missing.join(", ")}` : "프레임 차단·nosniff·Referrer-Policy 있음");
  report(h.get("x-powered-by") ? "WARN" : "PASS", "X-Powered-By 숨김", h.get("x-powered-by") ? `노출: ${h.get("x-powered-by")}` : "없음");

  const join = await get("/providers/join");
  const fields = ["consentPrivacy", "ageConfirmed"].filter((n) => !join.body.includes(`name="${n}"`));
  report(join.res.status === 200 && !fields.length ? "PASS" : "FAIL", "사전등록 화면", fields.length ? `필드 없음: ${fields.join(", ")} (/providers/join → ${join.res.status})` : "필수 동의·만 19세 확인 칸 있음(제출하지 않음)");

  const privacy = await get("/privacy");
  const placeholder = privacy.body.includes("설정 필요");
  const email = /[\w.+-]+@[\w-]+(\.[\w-]+)+/.test(privacy.body.replace(/<[^>]+>/g, " "));
  // 3항의 운영 메일 업체 항목(MAIL_SERVICE). 본인 확인 메일을 주고받는 회사라 첫 공개판부터 있어야 한다(8항의 30일 고지).
  // '운영 메일'만 찾으면 2항의 '운영 메일함' 문장 때문에 항상 맞으므로, MAIL_SERVICE를 읽었을 때만 그리는 문장을 찾는다.
  const mail = privacy.body.includes("운영 메일(본인 확인·승인 안내·시그널 접수·문의 답변)을 주고받고 보관");
  report(
    privacy.res.status === 200 && !placeholder && email && mail ? "PASS" : "FAIL",
    "개인정보 처리방침",
    placeholder
      ? "'설정 필요'가 공개됨 → PRIVACY_OFFICER·CONTACT_EMAIL·MAIL_SERVICE 설정 후 Redeploy"
      : !email
        ? `연락처 이메일이 안 보임(/privacy → ${privacy.res.status})`
        : !mail
          ? "3항에 운영 메일 업체 항목이 없음(MAIL_SERVICE를 반영한 코드가 배포됐는지 확인)"
          : "보호책임자 연락처·운영 메일 업체 있음",
  );

  await expectStatus("검증 화면", "/verify", 200);
  await expectStatus("앵커 화면", "/anchors", 200);
  await expectStatus("없는 프로필은 404", `/p/smoke-${rand}`, 404);
  await expectStatus("없는 에이전트는 404", `/a/smoke-${rand}`, 404);
  await expectStatus("없는 주소는 404", `/smoke-${rand}`, 404);

  // 승인 전·없는 주소에 일반 카드를 주면 공유 미리보기가 그 카드로 굳는다(F11).
  // generateImageMetadata 때문에 이미지 주소는 /p/<주소>/opengraph-image/<id>(id는 r<기록 수>)뿐이다.
  // id 없는 /p/<주소>/opengraph-image는 라우트가 없어 앱 404 HTML이 나오므로 이미지 처리 코드를 전혀 확인하지 못한다.
  // 기록 0건 카드의 id(r0)로 요청하고, 앱 404 페이지가 아니라 이미지 라우트의 'Not Found'(text/plain)인지 본다.
  // no-store는 기대하지 않는다: 이 404는 Next의 이미지 라우트 래퍼가 만들어 Cache-Control이 없다.
  const ogPath = `/p/smoke-${rand}/opengraph-image/r0`;
  const og = await get(ogPath);
  const ogType = og.res.headers.get("content-type") ?? "";
  const ogOk = og.res.status === 404 && !ogType.includes("text/html") && og.body.trim() === "Not Found";
  const ogWhy = og.res.status === 404 ? " (이미지 라우트가 아닌 앱 404: opengraph-image 주소 모양이 바뀌었는지 확인)" : " (기대 404)";
  report(ogOk ? "PASS" : "FAIL", "없는 프로필의 공유 이미지는 404", `${ogPath} → ${og.res.status} ${ogType}${ogOk ? "" : ogWhy}`);
}

async function checkKeys(): Promise<KeyEntry[]> {
  const { res, json } = await get("/keys.json");
  if (res.status !== 200) {
    report("FAIL", "공개키(/keys.json)", `→ ${res.status}. 서명 키 환경변수 6줄을 확인`);
    return [];
  }
  const file = json() as { version?: number; keys?: KeyEntry[] };
  const keys = file.keys ?? [];
  const problems: string[] = [];
  if (file.version !== 1) problems.push(`version ${file.version}`);
  for (const [purpose, prefix] of [["signal", "sig-"], ["checkpoint", "cp-"]] as const) {
    const k = keys.find((x) => x.purpose === purpose);
    if (!k) {
      problems.push(`${purpose} 키 없음`);
      continue;
    }
    if (!k.key_id.startsWith(prefix)) problems.push(`${k.key_id}가 ${prefix}로 시작하지 않음`);
    if (k.key_id.includes("-dev-") && !local) problems.push(`${k.key_id}는 개발용 키`);
    if (k.algorithm !== "ECDSA-P256-SHA256") problems.push(`${k.key_id} 알고리즘 ${k.algorithm}`);
    if (k.retired_at !== null) problems.push(`${k.key_id} retired_at 있음`);
    // 지문을 공개키에서 다시 계산한다: 목록의 지문과 키가 짝이 맞아야 검증 화면·공개 저장소 대조가 의미가 있다
    const fp = await publicKeyFingerprint(k.public_key_pem).catch(() => null);
    if (fp === null) problems.push(`${k.key_id} 공개키를 PEM으로 읽을 수 없음`);
    else if (fp !== k.fingerprint) problems.push(`${k.key_id} 지문이 공개키와 다름`);
  }
  report(problems.length ? "FAIL" : "PASS", "공개키(/keys.json)", problems.length ? problems.join("; ") : keys.map((k) => `${k.key_id} ${k.fingerprint.slice(0, 12)}…`).join(", "));
  report(res.headers.get("access-control-allow-origin") === "*" ? "PASS" : "WARN", "공개키 CORS", "다른 사이트의 검증기가 읽을 수 있는지(Access-Control-Allow-Origin: *)");

  // x-vercel-id = "<진입 PoP>::<함수 리전>::<요청 ID>". 한국에서 부르면 진입 PoP도 icn1이라 끝에서 두 번째 칸을 본다.
  const vid = res.headers.get("x-vercel-id");
  if (vid) {
    const parts = vid.split("::");
    const region = parts.length >= 3 ? parts[parts.length - 2] : parts[0];
    report(region === "icn1" ? "PASS" : "WARN", "함수 리전", `${region}${region === "icn1" ? "" : " (vercel.json의 icn1이 아님: DB와 멀어 느려짐)"}`);
  } else if (!local) {
    report("WARN", "함수 리전", "x-vercel-id 헤더 없음(Vercel이 아닌 주소인지 확인)");
  }
  return keys;
}

async function checkAnchors(): Promise<{ latest: AnchorRow | null; doc: unknown }> {
  const { res, json } = await get("/api/anchors");
  if (res.status !== 200) {
    report("FAIL", "앵커 목록", `/api/anchors → ${res.status}`);
    return { latest: null, doc: null };
  }
  const rows = ((json() as { anchors?: AnchorRow[] }).anchors ?? []).slice();
  const broken = rows.findIndex((r, i) => i > 0 && (r.date <= rows[i - 1].date || r.prev_root !== rows[i - 1].merkle_root));
  report(broken < 0 ? "PASS" : "FAIL", "앵커 목록", broken < 0 ? (rows.length ? `${rows.length}개, prev_root 사슬 연결` : "아직 앵커 없음") : `${rows[broken].date}에서 날짜 순서나 prev_root 사슬이 끊김`);

  let doc: unknown = null;
  const latest = rows.at(-1) ?? null;
  if (latest) {
    const r = await get(`/api/anchors/${latest.date}`);
    const d = (r.res.status === 200 ? r.json() : null) as { version?: string; date?: string; merkle_root?: string; leaf_count?: number; leaves?: unknown[] } | null;
    const ok = d && d.date === latest.date && d.merkle_root === latest.merkle_root && d.leaf_count === (d.leaves ?? []).length;
    report(ok ? "PASS" : "FAIL", "최신 앵커 문서", ok ? `${latest.date} 리프 ${d?.leaf_count}개, 목록의 루트와 같음` : `/api/anchors/${latest.date} → ${r.res.status}`);
    doc = d;
  }

  await expectStatus("없는 날짜(2월 30일)는 400", "/api/anchors/2026-02-30", 400);
  await expectStatus("없는 날짜(13월)는 400", "/api/anchors/2026-13-01", 400);
  await expectStatus("날짜 형식 아님은 400", "/api/anchors/not-a-date", 400);
  await expectStatus("앵커 없는 날은 404", "/api/anchors/1999-01-01", 404);
  await expectStatus("없는 시그널 묶음은 404", "/api/signals/00000000-0000-4000-8000-000000000000/bundle", 404);
  return { latest, doc };
}

async function checkProtected() {
  const admin = await get("/admin");
  const basic = (admin.res.headers.get("www-authenticate") ?? "").startsWith("Basic");
  report(
    admin.res.status === 401 && basic && !admin.body.includes("운영자 화면") ? "PASS" : "FAIL",
    "관리자 화면 잠김",
    admin.res.status === 503 ? "503: ADMIN_USER·ADMIN_PASSWORD 없음(또는 16자 미만)" : `/admin → ${admin.res.status}${basic ? "" : ", Basic 인증 요청 없음(Vercel 배포 보호 화면일 수 있음)"}`,
  );
  const wrong = `Basic ${Buffer.from(`smoke-${rand}:${randomUUID()}`).toString("base64")}`;
  await expectStatus("틀린 관리자 비밀번호는 401", "/admin", 401, { headers: { authorization: wrong } });
  await expectStatus("인코딩한 관리자 주소도 401", "/%61dmin", 401);
  const slash = await get("/admin/");
  report(slash.res.status === 308 && (slash.res.headers.get("location") ?? "").endsWith("/admin") ? "PASS" : "WARN", "관리자 주소 끝 /", `/admin/ → ${slash.res.status} ${slash.res.headers.get("location") ?? ""}`);

  // 진짜 비밀값으로는 부르지 않는다: 그 순간 오늘 앵커가 영구로 생긴다
  for (const [label, init] of [
    ["앵커 호출구: 비밀값 없음", { method: "POST" }],
    ["앵커 호출구: 틀린 비밀값", { method: "POST", headers: { authorization: `Bearer ${randomUUID()}` } }],
    ["앵커 호출구: GET 비밀값 없음", { method: "GET" }],
  ] as const) {
    const r = await get("/api/cron/anchor", init);
    const ok = r.res.status === 401 && r.body.includes("unauthorized");
    report(ok ? "PASS" : "FAIL", label, r.res.status === 503 ? "503: CRON_SECRET 없음" : `→ ${r.res.status}${ok ? "" : " (앱의 401 JSON이 아님: Vercel 배포 보호를 확인)"}`);
  }
}

async function checkTransport() {
  const url = new URL(base);
  if (url.protocol !== "https:") {
    report(local ? "WARN" : "FAIL", "HTTPS", `${base}는 https가 아님`);
    return;
  }
  const { res: plain } = await request(`http://${url.host}/`, `http://${url.host}/`, { redirect: "manual" });
  const loc = plain.headers.get("location") ?? "";
  report([301, 308].includes(plain.status) && loc.startsWith("https://") ? "PASS" : "FAIL", "http → https 이동", `→ ${plain.status} ${loc}`);
  const home = await get("/");
  report(home.res.headers.get("strict-transport-security") ? "PASS" : "WARN", "HSTS", home.res.headers.get("strict-transport-security") ?? "없음");
}

/** /api/health 응답(src/app/api/health/route.ts). 오류는 메시지가 아니라 코드만 온다(src/server/sql.ts publicError). */
interface Health {
  status?: string;
  deployment?: { region?: string | null };
  db?: { ok?: boolean; error?: string; migrations?: { pending?: string[] }; tls?: string };
  keys?: { ok?: boolean; error?: string; signal?: { key_id?: string }; checkpoint?: { key_id?: string } };
  key_mismatch?: { signal?: boolean; checkpoint?: boolean } | null;
  config?: { mail_service?: boolean };
}

/** 자주 나오는 오류 코드의 뜻(전체는 DEPLOY.md 9절 코드 표). 모르는 코드는 빈 문자열. */
function codeMeaning(code: string): string {
  if (code === "28P01") return "DB 비밀번호";
  if (code === "42P01") return "마이그레이션 안 됨";
  if (code === "CONFIG_MISSING" || code === "CONFIG_INVALID") return "환경변수 누락·형식 오류";
  if (code === "PREVIEW_BLOCKED") return "미리보기 배포";
  if (/CERT|TLS|SSL|SIGNED|VERIFY/.test(code)) return "DB 서버 인증서(DATABASE_CA_PEM)";
  if (/^E[A-Z]+$/.test(code) || code.startsWith("DB_") || code.includes("TIMEOUT")) return "DB 연결(주소·포트·Supabase 일시정지)";
  if (code === "XX000") return "풀러 거절: 사용자 postgres.<ref>·호스트(Connect 화면) 또는 풀러 일시 문제";
  return "";
}
const withMeaning = (code: string | undefined) => {
  const c = code ?? "?";
  const m = codeMeaning(c);
  return m ? `${c}(${m})` : c;
};

async function checkHealth(keys: KeyEntry[]) {
  const { res, json } = await get("/api/health");
  if (res.status === 404) {
    report("WARN", "상태 점검(/api/health)", "없음");
    return;
  }
  let h: Health;
  try {
    h = json() as Health;
  } catch (e) {
    report("FAIL", "상태 점검(/api/health)", `${(e as Error).message} → 운영 도메인으로 점검했는지(배포 보호 화면), Vercel Logs(함수 오류)를 확인`);
    return;
  }
  const problems: string[] = [];
  if (h.status !== "ok") problems.push(`status ${h.status} (HTTP ${res.status})`);
  if (!h.db?.ok) problems.push(`DB 오류 코드 ${withMeaning(h.db?.error)} — DEPLOY.md 9절 코드 표`);
  if (h.db?.migrations?.pending?.length) problems.push(`적용 안 된 마이그레이션: ${h.db.migrations.pending.join(", ")}`);
  if (h.keys && h.keys.ok === false) problems.push(`서명 키 오류 코드 ${withMeaning(h.keys.error)} — 키 환경변수 6줄 확인`);
  // DB에 남은 마지막 시그널·앵커의 키와 지금 환경변수 키가 다르면 발행·앵커가 거부된다. /keys.json과 비교해서는 드러나지 않는다(둘 다 환경변수에서 옴).
  if (h.key_mismatch?.signal) problems.push("SIGNING 키가 DB의 마지막 시그널 키와 다름(발행이 거부됨)");
  if (h.key_mismatch?.checkpoint) problems.push("CHECKPOINT 키가 DB의 마지막 앵커 키와 다름(앵커가 거부됨)");
  if (h.config?.mail_service === false) problems.push("MAIL_SERVICE가 없거나 형식이 틀림(처리방침 3항에 '설정 필요') — 4단계 표의 형식으로 넣고 Redeploy");
  const ids = keys.map((k) => k.key_id);
  // /keys.json을 읽지 못했으면(이미 실패로 적힘) 비교하지 않는다
  if (ids.length && h.keys?.ok && (!ids.includes(h.keys.signal?.key_id ?? "") || !ids.includes(h.keys.checkpoint?.key_id ?? ""))) problems.push("상태 점검의 키 ID가 /keys.json과 다름");
  report(problems.length ? "FAIL" : "PASS", "상태 점검(/api/health)", problems.length ? problems.join("; ") : `DB·키 정상, TLS ${h.db?.tls ?? "?"}, 리전 ${h.deployment?.region ?? "?"}`);
  const tls = h.db?.tls;
  if (!local && tls && tls !== "verify-full") {
    const fix =
      tls === "invalid"
        ? "DATABASE_URL 끝의 ?sslmode=… 를 지우거나 DATABASE_CA_PEM에 인증서 파일 내용 전체를 다시 넣기"
        : tls === "encrypt-only"
          ? "DATABASE_CA_PEM을 넣으면 verify-full"
          : "운영 DB 주소가 아님(DATABASE_URL 확인)";
    // 운영 DB 연결이 서버 인증서를 확인하지 않으면(중간자가 DB 비밀번호·공급자 이메일을 받아 갈 수 있음) 배포 점검을 통과시키지 않는다.
    // 사이트는 그대로 동작한다(DEPLOY.md 9절 비상 절차가 인증서 없이 Redeploy하는 상태에 기댄다). 고칠 때까지 이 줄이 실패로 남는다.
    report("FAIL", "DB 서버 인증서 확인", `${tls} → ${fix}`);
  }
}

async function checkMirror(keys: KeyEntry[], latest: AnchorRow | null, doc: unknown) {
  if (repo === null) return;
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) {
    report("FAIL", "공개 저장소 대조", `--repo는 계정/저장소 형식이어야 합니다: ${repo}`);
    return;
  }
  if (!/^[\w.-]+(?:\/[\w.-]+)*$/.test(branch)) {
    report("FAIL", "공개 저장소 대조", `--branch 형식이 이상합니다: ${branch}`);
    return;
  }
  const raw = `${(process.env.SMOKE_RAW_BASE || "https://raw.githubusercontent.com").replace(/\/+$/, "")}/${repo}/${branch}`;
  const k = await request(`${raw}/keys.json`, `${raw}/keys.json`);
  if (k.res.status === 404) {
    report("WARN", "공개 저장소 공개키", "아직 keys.json 없음(앵커 작업 첫 실행 전이면 정상)");
  } else if (k.res.status !== 200) {
    // 오류 응답 본문을 keys.json으로 읽으면 키 0개로 보여 '같음'이 나올 수 있다
    report("FAIL", "공개 저장소 공개키", `${raw}/keys.json → HTTP ${k.res.status}(저장소 공개 여부·주소·브랜치 확인)`);
  } else if (!keys.length) {
    report("WARN", "공개 저장소 공개키", "사이트 /keys.json을 읽지 못해 대조하지 않음(위 공개키 항목 확인)");
  } else {
    const mirrored = (k.json() as { keys?: KeyEntry[] }).keys ?? [];
    const pick = (x: KeyEntry) => stable({ purpose: x.purpose, algorithm: x.algorithm, public_key_pem: x.public_key_pem, fingerprint: x.fingerprint, created_at: x.created_at });
    const diff = mirrored.filter((m) => {
      const s = keys.find((x) => x.key_id === m.key_id);
      return !s || pick(s) !== pick(m);
    });
    report(diff.length ? "FAIL" : "PASS", "공개 저장소 공개키", diff.length ? `사이트와 다른 키: ${diff.map((d) => d.key_id).join(", ")}` : `${mirrored.length}개가 사이트와 같음`);
  }
  if (!latest) return;
  const a = await request(`${raw}/anchors/${latest.date}.json`, `${raw}/anchors/${latest.date}.json`);
  if (a.res.status === 404) {
    report("WARN", "공개 저장소 최신 앵커", `${latest.date}.json 아직 없음(오늘 작업 전이거나 raw CDN 반영 대기, 몇 분 뒤 다시)`);
    return;
  }
  if (a.res.status !== 200) {
    report("FAIL", "공개 저장소 최신 앵커", `${raw}/anchors/${latest.date}.json → HTTP ${a.res.status}`);
    return;
  }
  const same = stable(a.json()) === stable(doc);
  report(same ? "PASS" : "FAIL", "공개 저장소 최신 앵커", same ? `${latest.date} 문서가 사이트와 같음` : `${latest.date} 문서가 사이트와 다름(과거 변경 의심, 앵커 작업 기록 확인)`);
}

async function main() {
  if (!/^https?:\/\/[^/\s]+$/.test(base)) {
    console.error("사용법: npm run smoke -- https://운영도메인 [--repo 계정/signals-anchors] [--branch main] [--local]");
    process.exitCode = 2;
    return;
  }
  // 배포별 주소(…-<해시>-….vercel.app, -git-)는 Vercel 로그인 화면이 401을 줘서 앱의 401과 헷갈린다
  if (/-git-|-[a-z0-9]{9}-[\w-]+\.vercel\.app$/.test(new URL(base).hostname)) report("WARN", "점검 주소", "배포별 주소로 보입니다. Settings → Domains의 운영 도메인으로 점검하세요");
  await step("화면 점검", checkPages);
  const keys = (await step("공개키(/keys.json)", checkKeys)) ?? [];
  const { latest, doc } = (await step("앵커 목록", checkAnchors)) ?? { latest: null, doc: null };
  await step("관리자·앵커 호출구 잠김", checkProtected);
  await step("HTTPS", checkTransport);
  await step("상태 점검(/api/health)", () => checkHealth(keys));
  await step("공개 저장소 대조", () => checkMirror(keys, latest, doc));
  // process.exit()를 부르지 않고 종료 코드만 정한다: Windows(Node 24)에서 fetch를 여러 번 한 직후 process.exit()를 부르면
  // libuv 검사(UV_HANDLE_CLOSING)에 걸려 0xC0000409(3221226505)로 죽어 0·1 대신 엉뚱한 종료 코드가 나온다.
  // 남은 연결·시간 제한 타이머는 프로세스를 붙잡지 않으므로 곧바로 끝난다.
  process.exitCode = printResults() ? 1 : 0;
}

main().catch((e) => {
  printResults();
  console.error(`점검 중단: ${(e as Error).message}`);
  process.exitCode = 1;
});
