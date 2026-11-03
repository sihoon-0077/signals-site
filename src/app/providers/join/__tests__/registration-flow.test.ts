// 사전등록 화면 흐름(서버 액션 단위):
// - 새 이메일과 이미 등록된 이메일의 응답이 같아야 한다(한 번의 제출로 '이 사람이 공급자로 등록했는가'가 드러나지 않게)
// - 만 19세 확인, 등록 속도 제한(최근 1시간 대기 등록 수, 일괄 거절로 다시 열림, 동시 제출에도 상한 유지), 관리자 일괄 거절(확인 단계 포함)
// DB는 메모리 PGlite를 쓴다(getDb를 바꿔 끼우지 않으면 개발 DB .data/pglite에 쓴다).
import { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { rejectPendingSinceAction } from "@/app/admin/provider-actions";
import { POST as refBeacon } from "@/app/api/ref/route";
import { type Db, pgliteDb } from "@/server/db";
import { runMigrations } from "@/server/migrate";
import { HOURLY_REGISTRATION_LIMIT, REGISTRATION_PAUSED_MESSAGE } from "@/server/services/registration";
import { joinAction } from "../actions";

const h = vi.hoisted(() => ({ db: undefined as Promise<Db> | undefined, refCookie: undefined as string | undefined }));

// redirect()는 Next.js처럼 예외로 끝난다. 이동한 주소를 예외에 실어 확인한다.
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw Object.assign(new Error("NEXT_REDIRECT"), { url });
  },
}));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: (name: string) => (name === "ref" && h.refCookie ? { value: h.refCookie } : undefined) }) }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/server/admin-auth", () => ({ requireAdmin: async () => {} }));
vi.mock("@/server/db", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/server/db")>()), getDb: () => h.db! }));

let db: Db;

beforeAll(async () => {
  db = pgliteDb(new PGlite());
  await runMigrations(db);
  h.db = Promise.resolve(db);
});

function form(fields: Record<string, string>) {
  const f = new FormData();
  const base = { penName: "테스트", strategyType: "RULE", holdingStyle: "SWING", ageConfirmed: "on", consentPrivacy: "on" };
  for (const [k, v] of Object.entries({ ...base, ...fields })) if (v !== "") f.set(k, v);
  return f;
}

/** 이동했으면 그 주소, 폼으로 돌아왔으면 안내 문구·칸별 오류 */
async function submit(fields: Record<string, string>): Promise<{ redirect?: string; message?: string; fields?: Record<string, string> }> {
  try {
    const s = await joinAction({}, form(fields));
    return { message: s.message, fields: s.fields };
  } catch (e) {
    const url = (e as { url?: string }).url;
    if (!url) throw e;
    return { redirect: url };
  }
}

const rowOf = async (handle: string) =>
  (await db.query<{ status: string; referred_by: string | null }>("SELECT status, referred_by FROM providers WHERE handle = $1", [handle]))[0];

describe("사전등록 응답", () => {
  it("새 이메일과 이미 등록된 이메일(대소문자만 달라도)이 같은 주소로 끝난다", async () => {
    const fresh = await submit({ handle: "first-one", email: "a@example.com" });
    expect(fresh).toEqual({ redirect: "/providers/join/done" });
    expect(await submit({ handle: "second-one", email: "a@example.com" })).toEqual(fresh);
    expect(await submit({ handle: "third-one", email: "A@Example.com" })).toEqual(fresh);
    // 중복 이메일로는 행이 생기지 않는다(기존 등록 유지)
    expect(await rowOf("second-one")).toBeUndefined();
  });

  it("이미 있는 주소(handle)는 이메일 등록 여부와 상관없이 같은 폼 안내로 돌려준다", async () => {
    const taken = await submit({ handle: "first-one", email: "b@example.com" });
    expect(taken.message).toContain("이미 사용 중인 주소");
    expect(await submit({ handle: "first-one", email: "a@example.com" })).toEqual(taken);
  });

  it("만 19세 확인을 하지 않으면 칸 오류로 돌려주고 저장하지 않는다", async () => {
    const r = await submit({ handle: "teen-one", email: "teen@example.com", ageConfirmed: "" });
    expect(r.fields?.ageConfirmed).toBe("만 19세 이상만 사전등록할 수 있습니다");
    expect(await rowOf("teen-one")).toBeUndefined();
  });

  it("승인된 공급자의 초대 쿠키로 들어온 등록만 초대 관계를 남긴다", async () => {
    const [inviter] = await db.query<{ id: string; code: string }>("SELECT id, referral_code AS code FROM providers WHERE handle = 'first-one'");
    h.refCookie = inviter.code;
    try {
      await submit({ handle: "invited-early", email: "early@example.com" }); // 초대한 공급자가 아직 대기 중
      await db.query("UPDATE providers SET status = 'APPROVED', approved_at = now() WHERE id = $1", [inviter.id]);
      await submit({ handle: "invited-late", email: "late@example.com" });
    } finally {
      h.refCookie = undefined;
    }
    expect((await rowOf("invited-early")).referred_by).toBeNull();
    expect((await rowOf("invited-late")).referred_by).toBe(inviter.id);
  });
});

describe("초대 링크 방문 비콘(/api/ref)", () => {
  it("다른 사이트에서 쏜 요청·큰 본문·형식 오류는 조용히 무시하고, 승인된 공급자 코드만 센다", async () => {
    const [{ code }] = await db.query<{ code: string }>("SELECT referral_code AS code FROM providers WHERE handle = 'first-one'"); // 위에서 승인됨
    const visits = async () => (await db.query<{ n: number }>("SELECT COALESCE(sum(visits), 0)::int AS n FROM referral_daily WHERE code = $1", [code]))[0].n;
    const post = (body: string, headers: Record<string, string> = {}) => refBeacon(new Request("http://localhost/api/ref", { method: "POST", body, headers }));
    const ok = JSON.stringify({ code, path: "/p/first-one" });
    for (const res of [
      await post(ok, { "sec-fetch-site": "cross-site" }),
      await post(JSON.stringify({ code, path: "/p/" + "x".repeat(2000) })),
      await post("{not json"),
      await post("null"),
      await post(JSON.stringify({ code: 123, path: "/" })),
    ]) {
      expect(res.status).toBe(204);
    }
    expect(await visits()).toBe(0);
    expect((await post(ok, { "sec-fetch-site": "same-origin" })).status).toBe(204);
    expect(await visits()).toBe(1);
  });
});

/** 관리자 '이 시각 이후 대기 등록 모두 거절' 폼 제출 */
const rejectAction = (fields: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return rejectPendingSinceAction(f);
};
/** 지금부터 1시간 전(KST, datetime-local 형식) */
const hourAgoKst = () => new Date(Date.now() + 9 * 3600 * 1000 - 60 * 60 * 1000).toISOString().slice(0, 16);

/** 다른 시나리오와 섞이지 않게 새 메모리 DB로 바꿔 끼운 채 실행한다 */
async function withFreshDb(fn: (d: Db) => Promise<void>) {
  const pg = new PGlite();
  const d = pgliteDb(pg);
  await runMigrations(d);
  const prev = h.db;
  h.db = Promise.resolve(d);
  try {
    await fn(d);
  } finally {
    h.db = prev;
    await pg.close();
  }
}

const statusCounts = async (d: Db) =>
  Object.fromEntries((await d.query<{ status: string; n: number }>("SELECT status, count(*)::int AS n FROM providers GROUP BY status ORDER BY status")).map((r) => [r.status, r.n]));

describe("스팸이 몰릴 때", () => {
  it(`최근 1시간 대기 등록이 ${HOURLY_REGISTRATION_LIMIT}건이면 새 이메일·기존 이메일 모두 같은 안내를 받는다`, async () => {
    // 상한은 최근 1시간에 들어온 대기(PENDING) 등록만 센다(승인·거절한 행과 1시간 전 행은 세지 않음)
    const [{ n }] = await db.query<{ n: number }>("SELECT count(*)::int AS n FROM providers WHERE status = 'PENDING' AND created_at > now() - interval '1 hour'");
    await db.query(
      `INSERT INTO providers (handle, pen_name, email, strategy_type, holding_style, referral_code, consent_privacy_at)
       SELECT 'flood-' || g, '스팸', 'flood' || g || '@example.com', 'RULE', 'SWING', 'flood' || lpad(g::text, 3, '0'), now()
         FROM generate_series(1, ${HOURLY_REGISTRATION_LIMIT - n}) g`,
    );
    const fresh = await submit({ handle: "after-flood", email: "after@example.com" });
    expect(fresh.message).toBe(REGISTRATION_PAUSED_MESSAGE);
    expect(fresh.message).toBe("등록 요청이 몰려 잠시 접수를 멈췄습니다. 잠시 뒤(길게는 1시간쯤) 다시 시도해 주세요.");
    expect(await submit({ handle: "after-flood", email: "a@example.com" })).toEqual(fresh);
    expect(await rowOf("after-flood")).toBeUndefined();
  });

  it("일괄 거절은 확인(confirm=yes)과 올바른 시각이 있을 때만, 그 시각 이후의 대기 등록만 거절한다", async () => {
    const pending = async () => (await db.query<{ n: number }>("SELECT count(*)::int AS n FROM providers WHERE status = 'PENDING'"))[0].n;
    // 기준 시각을 가르기 위해 flood 등록만 지금, 나머지는 2시간 전으로 옮긴다
    await db.query("UPDATE providers SET created_at = now() - interval '2 hours' WHERE handle NOT LIKE 'flood-%'");
    const since = hourAgoKst();
    const before = await pending();
    const action = rejectAction;
    await action({ since }); // 확인 단계 없이 제출(입력칸에서 Enter)
    await action({ since: "2026-02-30T10:00", confirm: "yes" }); // 없는 날짜
    await action({ since: "어제", confirm: "yes" });
    expect(await pending()).toBe(before);
    await action({ since, confirm: "yes" });
    expect(await db.query("SELECT 1 FROM providers WHERE handle LIKE 'flood-%' AND status = 'PENDING'")).toEqual([]);
    expect(await pending()).toBe(before - (await db.query("SELECT 1 FROM providers WHERE handle LIKE 'flood-%'")).length);
    // 기준 시각 전의 대기 등록과 승인된 공급자는 그대로다
    expect([(await rowOf("invited-late")).status, (await rowOf("first-one")).status]).toEqual(["PENDING", "APPROVED"]);
  });

  it(`실제 등록 경로로 ${HOURLY_REGISTRATION_LIMIT}건이 들어와 멈춘 접수는 일괄 거절하면 바로 다시 열린다(거절한 행은 1시간 안이어도 세지 않음)`, async () => {
    await withFreshDb(async (d) => {
      for (let i = 0; i < HOURLY_REGISTRATION_LIMIT; i++) {
        expect(await submit({ handle: `script-${i}`, email: `script${i}@example.com` })).toEqual({ redirect: "/providers/join/done" });
      }
      expect((await submit({ handle: "real-quant", email: "real@example.com" })).message).toBe(REGISTRATION_PAUSED_MESSAGE);
      await rejectAction({ since: hourAgoKst(), confirm: "yes" });
      expect(await statusCounts(d)).toEqual({ REJECTED: HOURLY_REGISTRATION_LIMIT });
      // 예전에는 거절한 행도 세서, 거절해도 1시간 동안 계속 막혔다(공격자가 시간당 30건으로 무기한 닫을 수 있었음)
      expect(await submit({ handle: "real-quant", email: "real@example.com" })).toEqual({ redirect: "/providers/join/done" });
      expect(await d.query("SELECT status FROM providers WHERE handle = 'real-quant'")).toEqual([{ status: "PENDING" }]);
    });
  });

  it(`대기 ${HOURLY_REGISTRATION_LIMIT - 1}건일 때 10건이 동시에 들어와도 상한을 넘지 않는다(건수 확인과 저장을 한 번에 하나씩)`, async () => {
    await withFreshDb(async (d) => {
      await d.query(
        `INSERT INTO providers (handle, pen_name, email, strategy_type, holding_style, referral_code, consent_privacy_at)
         SELECT 'burst-' || g, '스팸', 'burst' || g || '@example.com', 'RULE', 'SWING', 'burst' || lpad(g::text, 3, '0'), now()
           FROM generate_series(1, ${HOURLY_REGISTRATION_LIMIT - 1}) g`,
      );
      const results = await Promise.all(Array.from({ length: 10 }, (_, i) => submit({ handle: `race-${i}`, email: `race${i}@example.com` })));
      // 예전 코드(확인과 INSERT가 따로)는 10건이 모두 확인을 통과해 39행이 됐다.
      // 한계: PGlite는 연결이 하나라 트랜잭션이 저절로 한 줄로 선다. 실제 PostgreSQL에서 advisory lock이 요청을 줄 세우는 것까지 증명하지는 않는다.
      expect(results.filter((r) => r.redirect).length).toBe(1);
      expect(results.filter((r) => r.message === REGISTRATION_PAUSED_MESSAGE).length).toBe(9);
      expect(await statusCounts(d)).toEqual({ PENDING: HOURLY_REGISTRATION_LIMIT });
    });
  });
});
