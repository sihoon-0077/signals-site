// 관리자 서버 액션을 폼 값(FormData) 그대로 불러 확인한다. DB는 메모리 PGlite, 인증·캐시 갱신은 가짜로 바꾼다.
// - 에이전트 만들기: 공급자 필명·프로필 주소·연락처 차단
// - 발행: 운영자 확인란(identityAck)이 서버까지 전달되는지, 성공 문구에 원문 공개 기한이 나오는지
// - 선택 동의 철회 버튼
// - 앵커 버튼: 시각을 한 번만 잡아 18시 검사와 날짜에 같이 쓴다(자정을 넘긴 요청이 다음 날 앵커를 00시에 만들지 않게)
// 서명 키는 이 파일에서 만든 일회용 키를 환경변수로 준다(개발용 키 파일 .data/keys를 읽거나 만들지 않게).
import { readFileSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { anchorAction, createAgentAction, publishAction } from "@/app/admin/actions";
import { clearOptionalConsentAction } from "@/app/admin/provider-actions";
import { expectedKeyId } from "@/core/keys";
import { exportPrivateKeyPem, exportPublicKeyPem, generateSigningKeyPair, publicKeyFingerprint } from "@/core/signature";
import { type Db, pgliteDb } from "../db";
import { runMigrations } from "../migrate";
import { setProviderStatus } from "../repo/providers";
import { listAgentSignals } from "../repo/signals";
import { registerProvider } from "../services/registration";

const h = vi.hoisted(() => ({ db: undefined as Promise<Db> | undefined, onGetDb: undefined as (() => void) | undefined }));

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/server/admin-auth", () => ({ requireAdmin: async () => {} }));
// getDb를 부를 때 시각을 옮길 수 있게 한다(앵커 버튼을 누른 뒤 DB 연결을 기다리는 사이 자정이 지나는 경우)
vi.mock("@/server/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/db")>()),
  getDb: async () => {
    h.onGetDb?.();
    return h.db!;
  },
}));

async function stubKey(purpose: "signal" | "checkpoint") {
  const prefix = purpose === "signal" ? "SIGNING" : "CHECKPOINT";
  const kp = await generateSigningKeyPair();
  const fp = await publicKeyFingerprint(await exportPublicKeyPem(kp.publicKey));
  vi.stubEnv(`${prefix}_KEY_ID`, expectedKeyId(purpose, fp));
  vi.stubEnv(`${prefix}_PRIVATE_KEY_PEM`, await exportPrivateKeyPem(kp.privateKey));
  vi.stubEnv(`${prefix}_KEY_CREATED_AT`, "2026-01-01T00:00:00.000Z");
}

async function freshDb(): Promise<Db> {
  const d = pgliteDb(new PGlite());
  await runMigrations(d);
  h.db = Promise.resolve(d);
  return d;
}

const formOf = (entries: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
};

async function approvedProvider(d: Db, handle: string, penName: string, extra: Record<string, unknown> = {}): Promise<string> {
  await registerProvider(d, { handle, penName, email: `${handle}@example.com`, strategyType: "RULE", holdingStyle: "SWING", ageConfirmed: true, consentPrivacy: true, ...extra });
  const [p] = await d.query<{ id: string }>("SELECT id FROM providers WHERE handle = $1", [handle]);
  await setProviderStatus(d, p.id, "APPROVED");
  return p.id;
}

const testNodeEnv = process.env.NODE_ENV ?? "test";

beforeAll(async () => {
  await stubKey("signal");
  await stubKey("checkpoint");
});
afterEach(() => {
  h.onGetDb = undefined;
  vi.useRealTimers();
  vi.stubEnv("NODE_ENV", testNodeEnv); // 키 환경변수는 남기고 운영 모드만 되돌린다
});
afterAll(() => {
  vi.unstubAllEnvs();
});

describe("에이전트 만들기: 공급자 필명·프로필 주소·연락처는 받지 않는다(주소는 탈퇴 뒤에도 바꿀 수 없다)", () => {
  it("연락처·주소·필명이 든 주소·이름·설명은 거부하고, 걸린 칸을 알려 준다. 관계없는 이름은 만든다", async () => {
    const d = await freshDb();
    const providerId = await approvedProvider(d, "blue-forest", "파란숲");
    const base = { providerId, slug: "kr-largecap-swing", agentName: "대형주 스윙", description: "20일선 돌파 + 거래량 조건" };
    const cases: [Record<string, string>, string, string][] = [
      [{ description: "문의 t.me/bluefox" }, "description", "연락처 금지"],
      [{ description: "자세히는 https://open.kakao.com/o/abc" }, "description", "연락처 금지"],
      [{ agentName: "bluefox@gmail.com 스윙" }, "agentName", "연락처 금지"],
      [{ slug: "blueforest-swing" }, "slug", "필명·주소 금지"], // 하이픈을 뺀 주소
      [{ agentName: "BlueForest 스윙" }, "agentName", "필명·주소 금지"],
      [{ agentName: "파란 숲 스윙" }, "agentName", "필명·주소 금지"], // 띄어 쓴 필명
      [{ description: `${"파란숲".normalize("NFD")}의 20일선` }, "description", "필명·주소 금지"], // 자모가 분리된 채 붙여 넣은 필명
    ];
    for (const [over, field, why] of cases) {
      const r = await createAgentAction({}, formOf({ ...base, ...over }));
      expect(r.error, JSON.stringify(over)).toBeTruthy();
      expect(r.fields, JSON.stringify(over)).toEqual({ [field]: why });
    }
    expect(await d.query("SELECT 1 FROM agents")).toEqual([]);
    expect(await createAgentAction({}, formOf(base))).toMatchObject({ ok: "에이전트를 만들었습니다." });
    // 플랫폼 에이전트는 공급자 정보가 없어 보지 않는다
    expect(await createAgentAction({}, formOf({ providerId: "platform", slug: "dundeun", agentName: "든든", description: "대형주 20일선" }))).toMatchObject({ ok: "에이전트를 만들었습니다." });
  });

  it("하이픈 없는 주소를 하이픈으로 나누거나 띄어 쓴 주소·이름·설명, 휴대전화 번호도 거부한다", async () => {
    const d = await freshDb();
    const providerId = await approvedProvider(d, "bluefox", "파란여우");
    const base = { providerId, slug: "kr-largecap-swing", agentName: "대형주 스윙", description: "20일선 돌파 + 거래량 조건" };
    const cases: [Record<string, string>, string, string][] = [
      [{ slug: "blue-fox-swing" }, "slug", "필명·주소 금지"],
      [{ agentName: "Blue Fox 스윙" }, "agentName", "필명·주소 금지"],
      [{ description: "blue_fox 20일선" }, "description", "필명·주소 금지"],
      [{ slug: "kr-010-1234-5678" }, "slug", "연락처 금지"],
      [{ description: "문의 010 1234 5678" }, "description", "연락처 금지"],
    ];
    for (const [over, field, why] of cases) {
      const r = await createAgentAction({}, formOf({ ...base, ...over }));
      expect(r.fields, JSON.stringify(over)).toEqual({ [field]: why });
    }
    expect(await d.query("SELECT 1 FROM agents")).toEqual([]);
  });
});

describe("발행: 운영자 확인란(identityAck)", () => {
  async function rsiAgent(d: Db) {
    const providerId = await approvedProvider(d, "rsi", "돌파");
    const [a] = await d.query<{ id: string }>("INSERT INTO agents (provider_id, slug, name) VALUES ($1, 'kr-breakout', '돌파 전략') RETURNING id", [providerId]);
    const fields = {
      requestId: crypto.randomUUID(),
      agentId: a.id,
      market: "KOSPI",
      ticker: "005930",
      side: "LONG",
      signalAction: "ENTRY",
      maxHoldingDays: "10",
      ruleVersion: "kr-v1",
      rationale: "RSI 30 이탈, 20일선 돌파",
    };
    return { agentId: a.id, fields };
  }

  it("주소·필명과 겹치면 걸린 표기를 모두 알리고 확인을 요구한다. 서버가 준 확인 값(ackFor)으로 같은 요청 번호를 다시 보내면 봉인하고, 연락처는 확인해도 거부한다", async () => {
    const d = await freshDb();
    const { agentId, fields } = await rsiAgent(d);
    const first = await publishAction({}, formOf(fields));
    expect(first.fields).toEqual({ rationale: "프로필 주소·필명과 같은 표기", identityAck: "확인 필요" });
    expect(first.error).toContain("걸린 표기: 근거의 프로필 주소 @rsi, 근거의 필명 돌파");
    expect(first.ackFor).toMatch(/^[0-9a-f]{64}$/); // 확인란의 값
    expect(first.values?.requestId).toBe(fields.requestId); // 다시 그린 폼에 같은 요청 번호가 남는다
    expect(await listAgentSignals(d, agentId)).toEqual([]);

    const contact = await publishAction({}, formOf({ ...fields, rationale: "RSI 30 이탈, t.me/rsi_kr", identityAck: first.ackFor! }));
    expect(contact.fields).toEqual({ rationale: "연락처 금지" });
    expect(contact.ackFor).toBeUndefined();

    // 예전 화면의 값('on')은 확인으로 보지 않는다(같은 확인을 다시 묻는다)
    expect((await publishAction({}, formOf({ ...fields, identityAck: "on" }))).ackFor).toBe(first.ackFor);

    const sealed = await publishAction({}, formOf({ ...fields, identityAck: first.ackFor! }));
    expect(sealed.ok).toMatch(/^봉인 완료 — 순번 1, /);
    // 무효 처리 기한(10분) 안에 확인할 수 있게 원문 공개 기한을 보여 준다(발행일을 1일째로 센 10번째 거래일 15:30)
    expect(sealed.ok).toMatch(/원문 공개 기한 \d{4}-\d{2}-\d{2} 15:30 KST/);
    const rows = await listAgentSignals(d, agentId);
    expect(rows.map((s) => [s.id, s.rationale])).toEqual([[fields.requestId, "RSI 30 이탈, 20일선 돌파"]]);
  });

  it("확인한 채 다른 오류로 돌아오면 확인 값을 돌려주지 않는다(확인란이 풀림). 고쳐서 다시 누르면 다시 묻는다", async () => {
    const d = await freshDb();
    const { agentId, fields } = await rsiAgent(d);
    const first = await publishAction({}, formOf(fields));
    const past = new Date(Date.now() + 9 * 3600 * 1000 - 60 * 60 * 1000).toISOString().slice(0, 16); // 1시간 전(KST, datetime-local 형식)
    const other = await publishAction({}, formOf({ ...fields, maxHoldingDays: "", validUntil: past, identityAck: first.ackFor! }));
    expect(other.fields).toEqual({ validUntil: "공개 기한이 이미 지남" });
    expect(other.ackFor).toBeUndefined();
    expect(other.values).not.toHaveProperty("identityAck");
    expect(other.values?.requestId).toBe(fields.requestId);
    // 기한을 고쳐 다시 누르면(확인란 없음) 같은 표기를 다시 묻고, 그 확인으로 봉인한다
    const again = await publishAction({}, formOf(fields));
    expect(again.ackFor).toBe(first.ackFor);
    expect((await publishAction({}, formOf({ ...fields, identityAck: again.ackFor! }))).ok).toMatch(/^봉인 완료 — 순번 1, /);
    expect((await listAgentSignals(d, agentId)).length).toBe(1);
  });
});

describe("선택 동의 철회 버튼", () => {
  it("정해진 동의만 지우고, 알 수 없는 값이나 형식이 틀린 ID는 아무것도 하지 않는다", async () => {
    const d = await freshDb();
    const id = await approvedProvider(d, "consent-quant", "동의퀀트", { consentMarketing: true, consentInterview: true });
    const consents = async () =>
      (await d.query<{ i: boolean; m: boolean }>("SELECT consent_interview_at IS NOT NULL AS i, consent_marketing_at IS NOT NULL AS m FROM providers WHERE id = $1", [id]))[0];
    await clearOptionalConsentAction(formOf({ providerId: id, kind: "email" }));
    await clearOptionalConsentAction(formOf({ providerId: "not-a-uuid", kind: "interview" }));
    expect(await consents()).toEqual({ i: true, m: true });
    await clearOptionalConsentAction(formOf({ providerId: id, kind: "interview" }));
    expect(await consents()).toEqual({ i: false, m: true });
    await clearOptionalConsentAction(formOf({ providerId: id, kind: "marketing" }));
    expect(await consents()).toEqual({ i: false, m: false });
  });
});

describe("운영자 화면(사전등록 목록)", () => {
  // 서버 컴포넌트를 함수로 불러 나온 화면을 HTML로 그린다(관리자 인증·DB는 위의 가짜).
  async function renderAdmin(view: string): Promise<string> {
    const { default: AdminPage } = await import("@/app/admin/page");
    const { renderToStaticMarkup } = await import("react-dom/server");
    return renderToStaticMarkup(await AdminPage({ searchParams: Promise.resolve({ view }) })).replace(/<!-- -->/g, "");
  }
  const count = (html: string, s: string) => html.split(s).length - 1;

  it("선택 동의 철회 버튼은 그 동의가 있는 행에만 보이고, 소식 동의는 발송 전 기록표 확인을 안내한다", async () => {
    const d = await freshDb();
    await approvedProvider(d, "both-quant", "둘다", { consentMarketing: true, consentInterview: true });
    await approvedProvider(d, "news-quant", "소식만", { consentMarketing: true });
    await approvedProvider(d, "none-quant", "없음");
    const html = await renderAdmin("approved");
    expect(count(html, "인터뷰 동의 철회</button>")).toBe(1);
    expect(count(html, "소식 수신 거부</button>")).toBe(2);
    expect(count(html, "동의(발송 전 기록표의 회신 확인)")).toBe(2);
    expect(html).not.toContain("수신 확인 전");
  });

  it("최근 1시간 대기 등록이 상한이면 배너가 '거절하면 바로 다시 열린다'고 안내한다", async () => {
    const d = await freshDb();
    await d.query(
      `INSERT INTO providers (handle, pen_name, email, strategy_type, holding_style, referral_code, consent_privacy_at)
       SELECT 'flood-' || g, '스팸', 'flood' || g || '@example.com', 'RULE', 'SWING', 'flood' || lpad(g::text, 3, '0'), now()
         FROM generate_series(1, 30) g`,
    );
    const html = await renderAdmin("pending");
    expect(html).toContain("최근 1시간 대기 등록이 30건이라 새 등록을 자동으로 받지 않고 있습니다");
    expect(html).toContain("거절하면 바로 다시 열립니다");
    await d.query("UPDATE providers SET status = 'REJECTED'");
    expect(await renderAdmin("pending")).not.toContain("새 등록을 자동으로 받지 않고 있습니다");
  });

  it("발행 칸은 1R이 KOSPI·KOSDAQ만 봉인하고 기록 시각은 봉인한 때라고 알리며, 시장 선택지도 둘뿐이다", async () => {
    const d = await freshDb();
    await d.query("INSERT INTO agents (slug, name, is_platform_owned) VALUES ('market-note', '시장 안내', true)");
    const html = await renderAdmin("pending");
    expect(html).toContain("1R은 KOSPI·KOSDAQ 시그널만 봉인합니다(공개 기한·진입 기준이 KRX 시간 기준)");
    expect(html).toContain("기록 시각은 메일을 보낸 때가 아니라 봉인한 때이고");
    const select = /<select name="market"[^>]*>([\s\S]*?)<\/select>/.exec(html)?.[1] ?? "";
    expect([...select.matchAll(/<option[^>]*>([^<]*)<\/option>/g)].map((m) => m[1])).toEqual(["KOSPI", "KOSDAQ"]);
  });

  it("탈퇴 처리 확인 문구는 익명화만이 아니라 행 삭제도 뜻한다(확인 단계 문구는 클릭 뒤에만 그려져 소스로 본다)", () => {
    const src = readFileSync(path.join(process.cwd(), "src", "app", "admin", "page.tsx"), "utf8");
    expect(src).toContain('<ConfirmSubmit label="탈퇴 처리" confirmLabel="탈퇴 처리 확인(되돌릴 수 없음)" />');
    expect(src).not.toContain("익명화 확인");
  });
});

describe("앵커 버튼(운영)", () => {
  const anchors = async (d: Db) => (await d.query<{ d: string }>("SELECT to_char(checkpoint_date, 'YYYY-MM-DD') AS d FROM anchor_records")).map((r) => r.d);

  it("23:59:59에 누르고 DB 연결을 기다리는 사이 자정이 지나면 다음 날 앵커를 만들지 않는다(그날은 빈 날)", async () => {
    const d = await freshDb();
    await d.query("INSERT INTO agents (slug, name, is_platform_owned) VALUES ('anchor-a', '앵커 확인', true)");
    vi.stubEnv("NODE_ENV", "production");
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-10T14:59:59.900Z")); // 11/10 23:59:59.900 KST
    h.onGetDb = () => vi.setSystemTime(new Date("2026-11-10T15:00:00.100Z")); // 11/11 00:00:00.100 KST
    const r = await anchorAction();
    expect(r.ok).toBeUndefined();
    expect(r.error).toMatch(/오늘\(KST 2026-11-11\)만/);
    expect(await anchors(d)).toEqual([]);
  });

  it("18시 전에는 만들지 않고, 18시 뒤에는 누른 시각의 날짜로 만든다", async () => {
    const d = await freshDb();
    await d.query("INSERT INTO agents (slug, name, is_platform_owned) VALUES ('anchor-b', '앵커 확인', true)");
    vi.stubEnv("NODE_ENV", "production");
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-10T08:59:00.000Z")); // 17:59 KST
    expect((await anchorAction()).error).toMatch(/18시\(KST\) 전에는 만들지 않습니다/);
    expect(await anchors(d)).toEqual([]);
    vi.setSystemTime(new Date("2026-11-10T10:00:00.000Z")); // 19:00 KST
    expect((await anchorAction()).ok).toMatch(/^만들었습니다 — 2026-11-10, /);
    expect(await anchors(d)).toEqual(["2026-11-10"]);
  });
});
