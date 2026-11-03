// 실제 PostgreSQL(PGlite, 메모리)로 사전등록 → 발행·봉인 → 앵커 → 공개 → 검증 전체 흐름을 확인한다.
// 운영자가 DB 트리거를 끄고 과거를 고치는 공격도 흉내 내, 바깥 검증·다음 앵커에서 드러나는지 본다.
import { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { contentHashV2 } from "@/core/canonical";
import { findChainBreak } from "@/core/chain";
import { type CheckResult, verifySignalBundle } from "@/core/verify";
import { type Db, pgliteDb } from "../db";
import { runMigrations } from "../migrate";
import { createAgent, getAgent } from "../repo/agents";
import {
  anonymizeProvider,
  clearOptionalConsent,
  countProvidersForAdmin,
  getApprovedProviderByHandle,
  listApprovedProviders,
  listProvidersForAdmin,
  purgeStaleRegistrations,
  recordReferralVisit,
  rejectPendingSince,
  setProviderStatus,
} from "../repo/providers";
import { listAgentSignals, rowToFields } from "../repo/signals";
import { ConflictError, InputError, iso } from "../sql";
import { AnchorConsistencyError, buildDailyAnchor, kstToday } from "../services/anchor";
import { getSignalBundle } from "../services/bundle";
import { publishSignal, recordSignalEvent } from "../services/publish";
import { HOURLY_REGISTRATION_LIMIT, REGISTRATION_PAUSED_MESSAGE, TooManyRegistrationsError, registerProvider } from "../services/registration";

const MIGRATIONS = ["0001_init.sql", "0002_rls.sql", "0003_hardening.sql", "0004_providers_privacy.sql", "0005_indexes.sql"];

/** 마이그레이션까지 마친 새 메모리 DB(서로 영향을 주지 않아야 하는 시나리오용) */
async function freshDb(): Promise<Db> {
  const d = pgliteDb(new PGlite());
  await runMigrations(d);
  return d;
}

const idOf = async (d: Db, handle: string) => (await d.query<{ id: string }>("SELECT id FROM providers WHERE handle = $1", [handle]))[0]?.id;

// 아래 전역 DB 흐름의 앵커 날짜. 시그널은 테스트를 돌리는 날(KST)에 발행되므로, 그보다 이른 고정 날짜(예전 '2026-11-02')로
// 앵커를 만들면 검증의 '발행일보다 이른 날짜의 앵커' 검사(core/verify.ts)에 걸려 그날이 지난 뒤부터 테스트가 실패한다.
const ANCHOR_DAY = kstToday();
const NEXT_DAY = kstToday(new Date(Date.now() + 24 * 3600 * 1000));

let db: Db;
let pg: PGlite;
let providerId: string;
let agentId: string;
const status = (rs: CheckResult[], id: CheckResult["id"]) => rs.find((r) => r.id === id)?.status;

const baseProvider = {
  handle: "blue-forest",
  penName: "파란숲",
  email: "blue@example.com",
  strategyType: "RULE",
  holdingStyle: "SWING",
  description: "20일선 돌파 스윙",
  channels: ["https://blog.example.com/blue"],
  ageConfirmed: true,
  consentPrivacy: true,
};

const baseSignal = (over: Record<string, unknown> = {}) => ({
  agentId,
  market: "KOSPI",
  ticker: "005930",
  side: "LONG",
  action: "ENTRY",
  targetPrice: "78000",
  stopLossPrice: "71500.5",
  suggestedWeight: "0.1",
  maxHoldingDays: 10,
  ruleVersion: "momo-v1.0",
  rationale: "20일선 돌파 | 거래량 2배",
  ...over,
});

beforeAll(async () => {
  pg = new PGlite();
  db = pgliteDb(pg);
  expect(await runMigrations(db)).toEqual(MIGRATIONS);
});

describe("공급자 사전등록", () => {
  it("등록하면 추천 코드가 생기고, 승인 전에는 공개되지 않는다", async () => {
    const r = await registerProvider(db, baseProvider);
    expect(r.handle).toBe("blue-forest");
    expect(r.referralCode).toMatch(/^[0-9a-f]{8}$/);
    expect(await getApprovedProviderByHandle(db, "blue-forest")).toBeNull();
    providerId = (await db.query<{ id: string }>("SELECT id FROM providers WHERE handle = 'blue-forest'"))[0].id;
    await setProviderStatus(db, providerId, "APPROVED");
    const pub = await getApprovedProviderByHandle(db, "blue-forest");
    expect(pub?.pen_name).toBe("파란숲");
    expect(pub && "email" in pub).toBe(false);
  });

  it("같은 주소·이메일은 거부, 동의 없으면 거부, 형식 오류는 칸별로 알려 준다", async () => {
    await expect(registerProvider(db, { ...baseProvider, email: "other@example.com" })).rejects.toBeInstanceOf(ConflictError);
    await expect(registerProvider(db, { ...baseProvider, handle: "another" })).rejects.toBeInstanceOf(ConflictError);
    await expect(registerProvider(db, { ...baseProvider, handle: "x2", email: "x2@example.com", consentPrivacy: false })).rejects.toBeInstanceOf(InputError);
    const err = await registerProvider(db, { ...baseProvider, handle: "Bad Handle!", email: "nope" }).catch((e) => e);
    expect(err).toBeInstanceOf(InputError);
    expect(Object.keys((err as InputError).fields)).toEqual(expect.arrayContaining(["handle", "email"]));
  });

  it("스팸 방지 숨김 칸을 채우면 거부한다", async () => {
    await expect(registerProvider(db, { ...baseProvider, handle: "bot-1", email: "bot@example.com", website: "http://spam" })).rejects.toBeInstanceOf(InputError);
  });

  it("만 19세 이상 확인이 없거나 거짓이면 거부하고 아무것도 저장하지 않는다", async () => {
    const missing: Record<string, unknown> = { ...baseProvider };
    delete missing.ageConfirmed;
    for (const input of [{ ...baseProvider, ageConfirmed: false }, missing]) {
      const err = await registerProvider(db, { ...input, handle: "teen-quant", email: "teen@example.com" }).catch((e) => e);
      expect(err).toBeInstanceOf(InputError);
      expect((err as InputError).fields.ageConfirmed).toBe("만 19세 이상만 사전등록할 수 있습니다");
    }
    expect(await db.query("SELECT 1 FROM providers WHERE handle = 'teen-quant'")).toEqual([]);
  });

  it("이메일은 254자까지만 받는다(앱 검증과 DB 제약 둘 다)", async () => {
    const long = `${"a".repeat(243)}@example.com`; // 255자
    const err = await registerProvider(db, { ...baseProvider, handle: "long-mail", email: long }).catch((e) => e);
    expect(err).toBeInstanceOf(InputError);
    expect((err as InputError).fields.email).toBe("254자 이하");
    // 앱을 거치지 않은 INSERT도 DB가 거부한다
    await expect(
      db.query("INSERT INTO providers (handle, pen_name, email, strategy_type, holding_style, referral_code, consent_privacy_at) VALUES ('long-db', 'x', $1, 'RULE', 'SWING', 'longdb01', now())", [long]),
    ).rejects.toThrow(/providers_email_len/);
    // 앞뒤 공백·대문자는 정리해서 받는다
    await registerProvider(db, { ...baseProvider, handle: "trim-mail", email: "  Trim@Example.COM " });
    expect((await db.query<{ email: string }>("SELECT email FROM providers WHERE handle = 'trim-mail'"))[0].email).toBe("trim@example.com");
  });

  it("판매 경험·신고 여부는 받지도 저장하지도 않는다(열이 없음)", async () => {
    const cols = await db.query<{ column_name: string }>(
      "SELECT column_name FROM information_schema.columns WHERE table_name = 'providers' AND column_name IN ('has_sold_before', 'has_filed_advisory')",
    );
    expect(cols).toEqual([]);
    // 예전 폼처럼 값을 보내도 무시하고 등록된다
    await registerProvider(db, { ...baseProvider, handle: "old-form", email: "old-form@example.com", hasSoldBefore: true, hasFiledAdvisory: false });
    expect(await idOf(db, "old-form")).toBeTruthy();
  });

  it("추천 코드로 들어온 등록은 추천인에게 집계된다", async () => {
    const code = (await getApprovedProviderByHandle(db, "blue-forest"))!.referral_code;
    await registerProvider(db, { ...baseProvider, handle: "friend-quant", email: "friend@example.com", referralCode: code });
    // 공개 수치는 승인된 등록만 센다(거절·대기 등록으로 부풀리지 못하게)
    expect((await getApprovedProviderByHandle(db, "blue-forest"))!.referred_signups).toBe(0);
    const friendId = (await db.query<{ id: string }>("SELECT id FROM providers WHERE handle = 'friend-quant'"))[0].id;
    await setProviderStatus(db, friendId, "APPROVED");
    expect((await getApprovedProviderByHandle(db, "blue-forest"))!.referred_signups).toBe(1);
  });

  it("승인되지 않은 공급자의 코드로 들어온 등록은 초대 관계를 만들지 않는다", async () => {
    const pendingCode = (await db.query<{ c: string }>("SELECT referral_code AS c FROM providers WHERE handle = 'trim-mail'"))[0].c;
    await registerProvider(db, { ...baseProvider, handle: "via-pending", email: "via-pending@example.com", referralCode: pendingCode });
    expect((await db.query<{ r: string | null }>("SELECT referred_by AS r FROM providers WHERE handle = 'via-pending'"))[0].r).toBeNull();
  });
});

describe("스팸 대비: 등록 속도 제한·관리자 목록", () => {
  it(`최근 1시간 대기 등록이 ${HOURLY_REGISTRATION_LIMIT}건이면 새 이메일·기존 이메일 모두 같은 안내로 거부하고 저장하지 않는다`, async () => {
    const d = await freshDb();
    await d.query(
      `INSERT INTO providers (handle, pen_name, email, strategy_type, holding_style, referral_code, consent_privacy_at)
       SELECT 'spam-' || g, '스팸', 'spam' || g || '@example.com', 'RULE', 'SWING', 'spam' || lpad(g::text, 4, '0'), now()
         FROM generate_series(1, ${HOURLY_REGISTRATION_LIMIT}) g`,
    );
    for (const email of ["late@example.com", "spam1@example.com"]) {
      const err = await registerProvider(d, { ...baseProvider, handle: "legit-late", email }).catch((e) => e);
      expect(err).toBeInstanceOf(TooManyRegistrationsError);
      expect((err as Error).message).toBe(REGISTRATION_PAUSED_MESSAGE);
      expect((err as Error).message).not.toMatch(/10분/); // 언제 열린다고 약속하지 않는다(공격이 이어지면 더 길어진다)
    }
    expect((await countProvidersForAdmin(d)).lastHour).toBe(HOURLY_REGISTRATION_LIMIT);
    // 1시간이 지나면 다시 받는다
    await d.query("UPDATE providers SET created_at = now() - interval '61 minutes'");
    await registerProvider(d, { ...baseProvider, handle: "legit-late", email: "late@example.com" });
    expect(await idOf(d, "legit-late")).toBeTruthy();
  });

  it("관리자 화면의 '최근 1시간' 건수는 대기 등록만 센다: 스팸을 일괄 거절하면 바로 0이 되고 접수가 다시 열린다", async () => {
    const d = await freshDb();
    await d.query(
      `INSERT INTO providers (handle, pen_name, email, strategy_type, holding_style, referral_code, consent_privacy_at)
       SELECT 'flood-' || g, '스팸', 'flood' || g || '@example.com', 'RULE', 'SWING', 'flood' || lpad(g::text, 3, '0'), now()
         FROM generate_series(1, ${HOURLY_REGISTRATION_LIMIT}) g`,
    );
    expect((await countProvidersForAdmin(d)).lastHour).toBe(HOURLY_REGISTRATION_LIMIT); // 배너가 보이는 상태
    await expect(registerProvider(d, { ...baseProvider, handle: "after-flood", email: "after-flood@example.com" })).rejects.toBeInstanceOf(TooManyRegistrationsError);
    const [since] = await d.query<{ t: string }>(`SELECT ${iso("(now() - interval '1 hour')")} AS t`);
    expect(await rejectPendingSince(d, since.t)).toBe(HOURLY_REGISTRATION_LIMIT);
    const after = await countProvidersForAdmin(d);
    expect([after.lastHour, after.PENDING, after.REJECTED]).toEqual([0, 0, HOURLY_REGISTRATION_LIMIT]); // 배너가 사라진다(거절한 행은 세지 않음)
    await registerProvider(d, { ...baseProvider, handle: "after-flood", email: "after-flood@example.com" });
    expect((await countProvidersForAdmin(d)).lastHour).toBe(1);
  });

  it("대기 300건이 쌓여도 개수는 전체를 세고, 목록은 100건씩 나누며, 승인된 공급자는 따로 남는다", async () => {
    const d = await freshDb();
    await registerProvider(d, { ...baseProvider, handle: "approved-one", email: "approved@example.com" });
    await setProviderStatus(d, (await idOf(d, "approved-one"))!, "APPROVED");
    await d.query(
      `INSERT INTO providers (handle, pen_name, email, strategy_type, holding_style, referral_code, consent_privacy_at, created_at)
       SELECT 'bulk-' || g, '스팸', 'bulk' || g || '@example.com', 'RULE', 'SWING', 'bulk' || lpad(g::text, 4, '0'), now(),
              now() - interval '3 hours' + g * interval '1 second'
         FROM generate_series(1, 300) g`,
    );
    const counts = await countProvidersForAdmin(d);
    expect([counts.PENDING, counts.APPROVED, counts.REJECTED, counts.WITHDRAWN]).toEqual([300, 1, 0, 0]);
    const pages = await Promise.all([0, 1, 2, 3].map((p) => listProvidersForAdmin(d, "PENDING", p)));
    expect(pages.map((p) => p.length)).toEqual([100, 100, 100, 0]);
    expect(pages[0][0].handle).toBe("bulk-300"); // 최근 등록순
    expect(new Set(pages.flat().map((p) => p.id)).size).toBe(300); // 쪽끼리 겹치거나 빠지지 않는다
    expect((await listProvidersForAdmin(d, "APPROVED")).map((p) => p.handle)).toEqual(["approved-one"]);
    expect((await listApprovedProviders(d)).map((p) => p.handle)).toEqual(["approved-one"]); // 에이전트 소유자 목록
    // 일괄 거절: 기준 시각(bulk-201의 등록 시각) 이후 대기 등록만, 승인된 공급자는 그대로
    const [cut] = await d.query<{ t: string }>(`SELECT ${iso("created_at")} AS t FROM providers WHERE handle = 'bulk-201'`);
    expect(await rejectPendingSince(d, cut.t)).toBe(100);
    const after = await countProvidersForAdmin(d);
    expect([after.PENDING, after.APPROVED, after.REJECTED]).toEqual([200, 1, 100]);
    expect((await listProvidersForAdmin(d, "PENDING", 0))[0].handle).toBe("bulk-200");
  });
});

describe("탈퇴 처리와 미승인 등록 1년 파기", () => {
  it("탈퇴하면 연락처·소개·초대 관계를 지우고 에이전트 이름을 바꾸되, 주소는 사칭 방지로 남기고 봉인 기록 검증은 그대로다", async () => {
    const d = await freshDb();
    await registerProvider(d, { ...baseProvider, handle: "leaving-quant", penName: "떠나는퀀트", email: "leaving@example.com", consentMarketing: true, consentInterview: true });
    const leavingId = (await idOf(d, "leaving-quant"))!;
    await setProviderStatus(d, leavingId, "APPROVED");
    const oldCode = (await getApprovedProviderByHandle(d, "leaving-quant"))!.referral_code;
    // 이 공급자가 초대한 공급자, 이 공급자를 초대한 공급자
    await registerProvider(d, { ...baseProvider, handle: "invited-one", email: "invited@example.com", referralCode: oldCode });
    await setProviderStatus(d, (await idOf(d, "invited-one"))!, "APPROVED");
    await recordReferralVisit(d, oldCode, "/p/leaving-quant");
    const agent = await createAgent(d, { providerId: leavingId, slug: "leaving-swing", name: "떠나는퀀트 스윙", description: "떠나는퀀트의 20일선" });
    const s = await publishSignal(d, baseSignal({ agentId: agent }));
    await buildDailyAnchor(d, ANCHOR_DAY, { allowOtherDate: true });
    const statuses = async () => (await verifySignalBundle((await getSignalBundle(d, s.signal.content_hash))!)).map((r) => `${r.id}:${r.status}`);
    const before = await statuses();

    expect(await anonymizeProvider(d, leavingId)).toBe(true);
    expect(await anonymizeProvider(d, leavingId)).toBe(false); // 두 번째는 아무것도 바꾸지 않는다

    const [row] = await d.query<Record<string, unknown>>(
      "SELECT handle, pen_name, email, description, channels, referred_by, referral_code, consent_marketing_at, consent_interview_at, status, approved_at FROM providers WHERE id = $1",
      [leavingId],
    );
    expect(row).toMatchObject({ handle: "leaving-quant", pen_name: "탈퇴한 공급자", email: `withdrawn+${leavingId}@invalid`, description: "", channels: [], referred_by: null, consent_marketing_at: null, consent_interview_at: null, status: "REJECTED", approved_at: null });
    expect(row.referral_code).toMatch(/^w[0-9a-f]{15}$/);
    expect(row.referral_code).not.toBe(oldCode);
    const renamed = (await getAgent(d, agent))!;
    expect(renamed.name).toMatch(/^탈퇴한 공급자의 에이전트 [0-9a-f]{4}$/);
    expect(renamed.description).toBe("");
    expect(renamed.provider_pen_name).toBe("탈퇴한 공급자");
    // 초대 관계·옛 코드의 방문 집계도 지운다
    expect((await d.query<{ r: string | null }>("SELECT referred_by AS r FROM providers WHERE handle = 'invited-one'"))[0].r).toBeNull();
    expect(await d.query("SELECT 1 FROM referral_daily WHERE code = $1", [oldCode])).toEqual([]);
    // 공개 프로필은 닫히고, 승인으로 되살릴 수 없으며, 같은 주소로 다시 등록해 사칭할 수 없다
    expect(await getApprovedProviderByHandle(d, "leaving-quant")).toBeNull();
    expect(await setProviderStatus(d, leavingId, "APPROVED")).toBe(false);
    expect(await getApprovedProviderByHandle(d, "leaving-quant")).toBeNull();
    await expect(registerProvider(d, { ...baseProvider, handle: "leaving-quant", email: "impostor@example.com" })).rejects.toBeInstanceOf(ConflictError);
    // 관리자 목록에서는 탈퇴 구분에만 보인다
    expect((await listProvidersForAdmin(d, "WITHDRAWN")).map((p) => [p.handle, p.withdrawn])).toEqual([["leaving-quant", true]]);
    expect((await listProvidersForAdmin(d, "REJECTED")).length).toBe(0);
    // 봉인 기록 검증 결과와 다음 앵커는 그대로다(이름은 앵커 리프·봉인 원문에 들어가지 않는다)
    expect(await statuses()).toEqual(before);
    expect((await buildDailyAnchor(d, NEXT_DAY, { allowOtherDate: true })).created).toBe(true);
  });

  it("등록일부터 1년이 지난, 한 번도 승인되지 않은 등록만 행째 지우고(대기·거절 모두), 승인된 뒤 거절된 등록은 그대로 두며, 다시 돌리면 0건이다", async () => {
    const d = await freshDb();
    for (const h of ["stale-pending", "stale-never", "stale-rejected", "stale-approved", "fresh-pending"]) {
      await registerProvider(d, { ...baseProvider, handle: h, email: `${h}@example.com` });
    }
    await setProviderStatus(d, (await idOf(d, "stale-never"))!, "REJECTED"); // 승인 없이 거절(스팸 등)
    const rejectedId = (await idOf(d, "stale-rejected"))!;
    await setProviderStatus(d, rejectedId, "APPROVED");
    const agent = await createAgent(d, { providerId: rejectedId, slug: "stale-agent", name: "거절된 공급자 스윙" });
    await setProviderStatus(d, rejectedId, "REJECTED"); // 운영자가 프로필을 닫음(본인은 탈퇴하지 않음)
    await setProviderStatus(d, (await idOf(d, "stale-approved"))!, "APPROVED");
    await d.query("UPDATE providers SET created_at = now() - interval '13 months' WHERE handle LIKE 'stale-%'");

    expect(await purgeStaleRegistrations(d)).toBe(2);
    expect(await purgeStaleRegistrations(d)).toBe(0);
    const rows = await d.query<{ handle: string; pen_name: string; status: string; withdrawn: boolean }>(
      "SELECT handle, pen_name, status, email LIKE '%@invalid' AS withdrawn FROM providers ORDER BY handle",
    );
    // stale-pending·stale-never는 공개 프로필이 열린 적 없어 행째 지운다. stale-rejected는 승인된 적이 있어 1년 파기 대상이 아니다
    // (탈퇴를 요청할 때까지 보유: 처리방침 2항). 이메일·필명·에이전트 이름이 그대로 남고, 다시 승인하면 프로필이 열린다.
    expect(rows).toEqual([
      { handle: "fresh-pending", pen_name: "파란숲", status: "PENDING", withdrawn: false },
      { handle: "stale-approved", pen_name: "파란숲", status: "APPROVED", withdrawn: false },
      { handle: "stale-rejected", pen_name: "파란숲", status: "REJECTED", withdrawn: false },
    ]);
    expect((await d.query<{ email: string }>("SELECT email FROM providers WHERE id = $1", [rejectedId]))[0].email).toBe("stale-rejected@example.com");
    expect((await getAgent(d, agent))!.name).toBe("거절된 공급자 스윙");
    expect(await setProviderStatus(d, rejectedId, "APPROVED")).toBe(true);
    expect(await getApprovedProviderByHandle(d, "stale-rejected")).not.toBeNull();
    // 지운 등록의 주소는 다시 쓸 수 있다
    await registerProvider(d, { ...baseProvider, handle: "stale-never", email: "stale-never-again@example.com" });
  });

  it("공개된 적 없는 등록(대기·거절, 승인된 적 없음)은 탈퇴·1년 파기 때 행을 지우고, 한 번이라도 승인된 등록은 주소를 남긴다", async () => {
    const d = await freshDb();
    for (const h of ["teen-quant", "teen-rejected", "spam-one", "flip-flop", "invited-x"]) await registerProvider(d, { ...baseProvider, handle: h, email: `${h}@example.com` });
    const teenId = (await idOf(d, "teen-quant"))!;
    const teen2Id = (await idOf(d, "teen-rejected"))!;
    const flipId = (await idOf(d, "flip-flop"))!;
    // 지울 행을 다른 등록이 초대 관계로 가리켜도(외래키) 같은 문장에서 관계를 끊고 지운다
    await d.query("UPDATE providers SET referred_by = $1 WHERE handle = 'invited-x'", [teenId]);
    expect(await anonymizeProvider(d, teenId)).toBe(true); // 대기 중 탈퇴(만 19세 미만·'본인 아님' 회신)
    expect(await anonymizeProvider(d, teenId)).toBe(false); // 이미 지운 행
    expect((await d.query<{ r: string | null }>("SELECT referred_by AS r FROM providers WHERE handle = 'invited-x'"))[0].r).toBeNull();
    await setProviderStatus(d, teen2Id, "REJECTED");
    expect(await anonymizeProvider(d, teen2Id)).toBe(true); // 거절한 뒤 탈퇴
    await setProviderStatus(d, flipId, "APPROVED"); // 프로필이 한 번 열림
    await setProviderStatus(d, flipId, "REJECTED");
    // 거절해도 approved_at은 남는다('승인된 적 있음'의 기준)
    expect((await d.query<{ a: boolean }>("SELECT approved_at IS NOT NULL AS a FROM providers WHERE id = $1", [flipId]))[0].a).toBe(true);
    expect(await rejectPendingSince(d, "2000-01-01T00:00:00.000Z")).toBe(2); // 스팸 일괄 거절(spam-one, invited-x)
    await d.query("UPDATE providers SET created_at = now() - interval '13 months' WHERE handle IN ('spam-one', 'flip-flop')");
    // 1년 파기는 승인된 적 없는 spam-one만 지운다. 한 번 승인된 flip-flop은 거절된 채 1년이 지나도 탈퇴할 때까지 남는다
    expect(await purgeStaleRegistrations(d)).toBe(1);
    expect(await purgeStaleRegistrations(d)).toBe(0);
    const withdrawnRows = () => d.query<{ handle: string; withdrawn: boolean }>("SELECT handle, email LIKE '%@invalid' AS withdrawn FROM providers ORDER BY handle");
    expect(await withdrawnRows()).toEqual([
      { handle: "flip-flop", withdrawn: false },
      { handle: "invited-x", withdrawn: false },
    ]);
    // 본인이 탈퇴하면 행을 지우지 않고 익명화해 주소(handle)를 남긴다
    expect(await anonymizeProvider(d, flipId)).toBe(true);
    expect(await withdrawnRows()).toEqual([
      { handle: "flip-flop", withdrawn: true },
      { handle: "invited-x", withdrawn: false },
    ]);
    // 공개된 적 없는 주소는 다시 쓸 수 있고, 공개된 적 있는 주소는 사칭 방지로 막힌다
    await registerProvider(d, { ...baseProvider, handle: "teen-quant", email: "adult@example.com" });
    await registerProvider(d, { ...baseProvider, handle: "spam-one", email: "real-spam-one@example.com" });
    await expect(registerProvider(d, { ...baseProvider, handle: "flip-flop", email: "impostor@example.com" })).rejects.toBeInstanceOf(ConflictError);
  });

  it("선택 동의만 철회한다(인터뷰·소식 메일): 다른 동의와 등록은 그대로, 다시 하거나 탈퇴 처리한 행에는 아무것도 바꾸지 않는다", async () => {
    const d = await freshDb();
    await registerProvider(d, { ...baseProvider, handle: "consent-both", email: "both@example.com", consentMarketing: true, consentInterview: true });
    await registerProvider(d, { ...baseProvider, handle: "consent-gone", email: "gone@example.com", consentMarketing: true, consentInterview: true });
    const id = (await idOf(d, "consent-both"))!;
    const goneId = (await idOf(d, "consent-gone"))!;
    await setProviderStatus(d, id, "APPROVED");
    await setProviderStatus(d, goneId, "APPROVED");
    const consents = async (pid: string) =>
      (await d.query<{ interview: boolean; marketing: boolean; status: string }>(
        "SELECT consent_interview_at IS NOT NULL AS interview, consent_marketing_at IS NOT NULL AS marketing, status FROM providers WHERE id = $1",
        [pid],
      ))[0];

    expect(await clearOptionalConsent(d, id, "interview")).toBe(true);
    expect(await consents(id)).toEqual({ interview: false, marketing: true, status: "APPROVED" });
    expect(await clearOptionalConsent(d, id, "interview")).toBe(false); // 이미 없는 동의
    expect(await clearOptionalConsent(d, id, "marketing")).toBe(true);
    expect(await consents(id)).toEqual({ interview: false, marketing: false, status: "APPROVED" });
    // 관리자 목록도 바뀐 값을 보인다(화면의 '-' 표시)
    const listed = (await listProvidersForAdmin(d, "APPROVED")).find((p) => p.id === id)!;
    expect([listed.consent_interview_at, listed.consent_marketing_at]).toEqual([null, null]);
    // 탈퇴 처리한 행은 건드리지 않는다
    await anonymizeProvider(d, goneId);
    expect(await clearOptionalConsent(d, goneId, "marketing")).toBe(false);
    // 열 이름은 고정 표에서만 고른다(그 밖의 값은 SQL에 닿기 전에 거부)
    await expect(clearOptionalConsent(d, id, "toString" as never)).rejects.toThrow(/알 수 없는 선택 동의/);
  });
});

describe("공유·초대 링크 방문 집계", () => {
  it("코드별 하루 합계는 200회에서 멈추고, 승인되지 않은 코드는 세지 않는다", async () => {
    const d = await freshDb();
    await registerProvider(d, { ...baseProvider, handle: "visit-cap", email: "visit-cap@example.com" });
    await registerProvider(d, { ...baseProvider, handle: "visit-pending", email: "visit-pending@example.com" });
    await setProviderStatus(d, (await idOf(d, "visit-cap"))!, "APPROVED");
    const [code, pendingCode] = await Promise.all(
      ["visit-cap", "visit-pending"].map(async (h) => (await d.query<{ c: string }>("SELECT referral_code AS c FROM providers WHERE handle = $1", [h]))[0].c),
    );
    const paths = ["/p/visit-cap", "/providers/join", "/"];
    for (let i = 0; i < 250; i++) await recordReferralVisit(d, code, paths[i % 3]);
    for (let i = 0; i < 5; i++) await recordReferralVisit(d, pendingCode, "/p/visit-pending");
    expect((await getApprovedProviderByHandle(d, "visit-cap"))!.referral_visits).toBe(200);
    expect(await d.query("SELECT 1 FROM referral_daily WHERE code = $1", [pendingCode])).toEqual([]);
  });

  it("방문 날짜는 DB 세션 시간대와 상관없이 KST 날짜다", async () => {
    const d = await freshDb();
    await registerProvider(d, { ...baseProvider, handle: "tz-check", email: "tz-check@example.com" });
    await setProviderStatus(d, (await idOf(d, "tz-check"))!, "APPROVED");
    const code = (await getApprovedProviderByHandle(d, "tz-check"))!.referral_code;
    // UTC+14와 UTC-12를 함께 쓰면 하루 중 어느 시각에 돌려도 (now() + 9시간)::date 같은 세션 의존 식은 둘 중 하나에서 날짜가 어긋난다
    for (const tz of ["UTC", "Asia/Seoul", "Pacific/Kiritimati", "Etc/GMT+12"]) {
      await d.tx(async (t) => {
        await t.exec(`SET LOCAL TimeZone = '${tz}'`);
        await recordReferralVisit(t, code, "/p/tz-check");
      });
    }
    const [now] = await d.query<{ t: string }>(`SELECT ${iso("now()")} AS t`);
    const days = await d.query<{ day: string; n: number }>("SELECT day::text AS day, sum(visits)::int AS n FROM referral_daily WHERE code = $1 GROUP BY day", [code]);
    expect(days).toEqual([{ day: kstToday(new Date(now.t)), n: 4 }]);
  });
});

describe("발행·봉인", () => {
  it("에이전트를 만들고 시그널 3건을 발행하면 순번·사슬이 이어진다", async () => {
    agentId = await createAgent(db, { providerId, slug: "blue-forest-swing", name: "파란숲 스윙" });
    await createAgent(db, { providerId: null, slug: "platform-momo", name: "든든(플랫폼 운영)" });
    for (let i = 0; i < 3; i++) {
      const r = await publishSignal(db, baseSignal({ ticker: ["005930", "000660", "035420"][i] }));
      expect(r.signal.sequence_no).toBe(i + 1);
      expect(r.timestamps).toEqual([]); // 테스트는 TSA_URLS=off
    }
    const rows = await listAgentSignals(db, agentId);
    const links = rows.reverse().map((r) => ({ sequenceNo: r.sequence_no, prevHash: r.prev_hash, contentHash: r.content_hash }));
    expect(findChainBreak(links)).toBe(0);
    for (const r of rows) expect(await contentHashV2(rowToFields(r))).toBe(r.content_hash);
  });

  it("소수 5자리 가격·잘못된 종목은 거부(반올림하지 않음)", async () => {
    await expect(publishSignal(db, baseSignal({ targetPrice: "78000.12345" }))).rejects.toBeInstanceOf(InputError);
    await expect(publishSignal(db, baseSignal({ ticker: "삼성전자" }))).rejects.toBeInstanceOf(InputError);
  });

  it("청산(EXIT)은 같은 에이전트의 ENTRY만 가리킬 수 있다", async () => {
    const entry = (await listAgentSignals(db, agentId)).find((s) => s.sequence_no === 1)!;
    const r = await publishSignal(db, baseSignal({ action: "EXIT", entrySignalId: entry.id, targetPrice: "", stopLossPrice: "", suggestedWeight: "" }));
    expect(r.signal.entry_signal_id).toBe(entry.id);
    await expect(publishSignal(db, baseSignal({ action: "EXIT" }))).rejects.toBeInstanceOf(InputError);
  });

  it("DB가 봉인 기록의 수정·삭제·비우기를 거부한다", async () => {
    await expect(db.query("UPDATE signals SET ticker = 'XXXX' WHERE sequence_no = 1")).rejects.toThrow(/immutable/);
    await expect(db.query("DELETE FROM signals WHERE sequence_no = 1")).rejects.toThrow(/immutable/);
    await expect(db.query("TRUNCATE signals CASCADE")).rejects.toThrow(/immutable/);
  });
});

describe("공개 자료만으로 검증", () => {
  it("청산 전: 원문은 비공개, 서명은 PASS, 해시 재계산·사슬 확정은 공개 후(SKIP)", async () => {
    const s = (await listAgentSignals(db, agentId)).find((x) => x.sequence_no === 2)!;
    const b = (await getSignalBundle(db, s.id))!;
    expect(b.signal.fields).toBeNull();
    const rs = await verifySignalBundle(b);
    expect([status(rs, "hash"), status(rs, "signature"), status(rs, "chain"), status(rs, "anchor")]).toEqual(["SKIP", "PASS", "SKIP", "SKIP"]);
  });

  it("일일 앵커: 뒤에 청산 전 기록이 있으면 포함은 공개 후 확정(SKIP), 모두 공개되면 원문 재계산으로 PASS", async () => {
    const a = await buildDailyAnchor(db, ANCHOR_DAY, { allowOtherDate: true });
    expect(a.created).toBe(true);
    expect(a.document.leaf_count).toBe(2);
    const rows = await listAgentSignals(db, agentId);
    const s2 = rows.find((x) => x.sequence_no === 2)!;
    await recordSignalEvent(db, s2.id, "CLOSED", "목표가 도달");
    await expect(recordSignalEvent(db, s2.id, "VOID")).rejects.toBeInstanceOf(ConflictError);
    let rs = await verifySignalBundle((await getSignalBundle(db, s2.id))!);
    // 앵커는 순번 4까지 묶었다. 순번 3(진입, 공개 기한 전)이 비공개라 순번 2의 포함은 아직 확정할 수 없다.
    // 진입 기준도 시그널 토큰·앵커 기관 시각이 없으니(테스트는 TSA off) 정하지 않는다(서명 안 된 생성 시각은 쓰지 않음).
    expect(rs.map((r) => [r.id, r.status])).toEqual([
      ["hash", "PASS"],
      ["signature", "PASS"],
      ["chain", "PASS"],
      ["timestamp", "SKIP"],
      ["anchor", "SKIP"],
      ["entry", "SKIP"],
    ]);
    // 순번 4는 청산(EXIT)이라 앵커에 고정되자 자동 공개됐고, 짝인 순번 1(진입)도 함께 공개됐다.
    const b1 = (await getSignalBundle(db, rows.find((x) => x.sequence_no === 1)!.id))!;
    expect(b1.signal.revealed).toBe(true);
    // 순번 3까지 공개되면 순번 2에서 앵커의 마지막 지문까지 원문으로 다시 계산해 이어진다
    await recordSignalEvent(db, rows.find((x) => x.sequence_no === 3)!.id, "CLOSED", "기한 전 청산");
    rs = await verifySignalBundle((await getSignalBundle(db, s2.id))!);
    expect(status(rs, "anchor")).toBe("PASS");
  });

  it("앵커는 오늘(KST)만 만들고, 이후 날짜 앵커가 있으면 과거 날짜를 채우지 않는다", async () => {
    await expect(buildDailyAnchor(db, "2026-10-01")).rejects.toThrow(/오늘/);
    await expect(buildDailyAnchor(db, "2026-10-01", { allowOtherDate: true })).rejects.toBeInstanceOf(AnchorConsistencyError);
    await expect(buildDailyAnchor(db, "2026-02-30", { allowOtherDate: true })).rejects.toThrow(/형식/);
  });

  it("같은 날 앵커를 다시 만들면 새로 만들지 않는다", async () => {
    expect((await buildDailyAnchor(db, ANCHOR_DAY, { allowOtherDate: true })).created).toBe(false);
  });
});

describe("운영자가 몰래 과거를 고치면", () => {
  it("트리거를 끄고 공개된 원문(종목)을 바꾸면 해시 재계산이 FAIL", async () => {
    const s = (await listAgentSignals(db, agentId)).find((x) => x.sequence_no === 2)!;
    await pg.exec("ALTER TABLE signals DISABLE TRIGGER signals_no_update");
    await pg.query("UPDATE signals SET ticker = '999999' WHERE id = $1", [s.id]);
    await pg.exec("ALTER TABLE signals ENABLE TRIGGER signals_no_update");
    const rs = await verifySignalBundle((await getSignalBundle(db, s.id))!);
    expect(status(rs, "hash")).toBe("FAIL");
  });

  it("트리거·외래키를 끄고 공개된 두 기록의 ID를 맞바꾸면 원문 속 봉인된 ID와 달라 FAIL", async () => {
    const rows = await listAgentSignals(db, agentId);
    const a = rows.find((x) => x.sequence_no === 1)!;
    const b = rows.find((x) => x.sequence_no === 3)!;
    const tmp = "00000000-0000-4000-8000-00000000abcd";
    // session_replication_role=replica: 사용자 트리거와 외래키 검사를 모두 끈다(테이블 소유자가 할 수 있는 최대치)
    await pg.exec("SET session_replication_role = replica");
    await pg.query("UPDATE signals SET id = $1 WHERE id = $2", [tmp, a.id]);
    await pg.query("UPDATE signals SET id = $1 WHERE id = $2", [a.id, b.id]);
    await pg.query("UPDATE signals SET id = $1 WHERE id = $2", [b.id, tmp]);
    await pg.exec("SET session_replication_role = origin");
    // 공유돼 있던 a의 검증 링크가 이제 순번 3의 내용을 보여 주지만, 봉인된 signalId가 링크의 ID와 달라 드러난다
    const rs = await verifySignalBundle((await getSignalBundle(db, a.id))!);
    expect(status(rs, "hash")).toBe("FAIL");
    // 지문으로 만든 링크는 바꿔치기와 상관없이 원래 기록을 가리킨다
    expect((await getSignalBundle(db, a.content_hash))!.signal.content_hash).toBe(a.content_hash);
  });

  it("트리거를 끄고 마지막 시그널을 지우면 다음 날 앵커가 만들어지지 않고 실패한다", async () => {
    const last = (await listAgentSignals(db, agentId))[0];
    await pg.exec("ALTER TABLE signals DISABLE TRIGGER signals_no_delete");
    await pg.query("DELETE FROM signals WHERE id = $1", [last.id]);
    await pg.exec("ALTER TABLE signals ENABLE TRIGGER signals_no_delete");
    await expect(buildDailyAnchor(db, NEXT_DAY, { allowOtherDate: true })).rejects.toBeInstanceOf(AnchorConsistencyError);
  });
});

describe("중간 기록 삭제(이전에는 머리 1건만 비교해 놓쳤던 공격)", () => {
  it("트리거를 끄고 앵커된 사슬의 중간 기록을 지우면 다음 앵커가 순번 구멍으로 실패한다", async () => {
    const pg3 = new PGlite();
    const db3 = pgliteDb(pg3);
    await runMigrations(db3);
    const agent = await createAgent(db3, { providerId: null, slug: "gap-test", name: "구멍 테스트" });
    for (const t of ["005930", "000660", "035420"]) await publishSignal(db3, baseSignal({ agentId: agent, ticker: t }));
    await buildDailyAnchor(db3, "2026-11-20", { allowOtherDate: true });
    const mid = (await listAgentSignals(db3, agent)).find((x) => x.sequence_no === 2)!;
    await pg3.exec("ALTER TABLE signals DISABLE TRIGGER signals_no_delete");
    await pg3.query("DELETE FROM signals WHERE id = $1", [mid.id]);
    await pg3.exec("ALTER TABLE signals ENABLE TRIGGER signals_no_delete");
    // 머리(순번 3)와 길이 최대값은 그대로라 예전 검사로는 통과했다
    await expect(buildDailyAnchor(db3, "2026-11-21", { allowOtherDate: true })).rejects.toThrow(/순번 2가 비어/);
  });
});

describe("앵커를 만드는 도중 발행된 기록", () => {
  it("생성 시각이 발행보다 늦어도, 그 기록을 담지 않은 앵커는 고르지 않는다(거짓 불일치 방지)", async () => {
    const db2 = pgliteDb(new PGlite());
    await runMigrations(db2);
    const agent = await createAgent(db2, { providerId: null, slug: "race-test", name: "경합 테스트" });
    const s1 = await publishSignal(db2, baseSignal({ agentId: agent }));
    const d1 = await buildDailyAnchor(db2, "2026-11-10", { allowOtherDate: true });
    const s2 = await publishSignal(db2, baseSignal({ agentId: agent, ticker: "000660" }));
    // 경합 재현: 체인 머리는 s2 발행 전에 읽었고(= s1까지만 담음) 생성 시각은 s2 발행 뒤에 찍힌 앵커
    const stale = { ...d1.document, date: "2026-11-11", created_at: new Date(Date.parse(s2.signal.published_at) + 1000).toISOString() };
    await db2.tx(async (t) => {
      await t.query("INSERT INTO chain_checkpoints (checkpoint_date, agent_id, chain_length, head_hash) VALUES ('2026-11-11', $1, 1, $2)", [agent, s1.signal.content_hash]);
      await t.query(
        `INSERT INTO anchor_records (checkpoint_date, merkle_root, leaf_count, prev_root, root_signature, checkpoint_key_id, document, created_at)
         VALUES ('2026-11-11', $1, $2, $3, $4, $5, $6::jsonb, $7::timestamptz)`,
        [stale.merkle_root, stale.leaf_count, d1.document.merkle_root, stale.root_signature, stale.checkpoint_key_id, JSON.stringify(stale), stale.created_at],
      );
    });
    const b2 = (await getSignalBundle(db2, s2.signal.id))!;
    expect(b2.anchor).toBeNull(); // 시각 기준으로 고르면 2026-11-11 앵커가 잡혀 "체인 길이가 순번보다 짧다"는 FAIL이 났다
    expect(status(await verifySignalBundle(b2), "anchor")).toBe("SKIP");
    await buildDailyAnchor(db2, "2026-11-12", { allowOtherDate: true });
    expect((await getSignalBundle(db2, s2.signal.id))!.anchor?.date).toBe("2026-11-12");
    expect((await getSignalBundle(db2, s1.signal.id))!.anchor?.date).toBe("2026-11-10");
  });
});

describe("Supabase REST API 차단(RLS)", () => {
  it("anon 역할에 SELECT 권한이 있어도 정책이 없으니 공급자 이메일을 한 줄도 못 읽는다", async () => {
    // Supabase는 public 스키마 테이블에 anon 권한을 기본으로 준다. 그 상황을 그대로 흉내 낸다.
    await pg.exec("CREATE ROLE anon NOLOGIN; GRANT SELECT ON providers TO anon;");
    expect(Number((await pg.query<{ n: number }>("SELECT count(*)::int AS n FROM providers")).rows[0].n)).toBeGreaterThan(0);
    await pg.exec("SET ROLE anon");
    try {
      expect((await pg.query("SELECT email FROM providers")).rows).toEqual([]);
    } finally {
      await pg.exec("RESET ROLE");
    }
  });
});
