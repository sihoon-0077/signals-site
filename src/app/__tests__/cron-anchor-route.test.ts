// 일일 앵커 호출구: 비밀값 확인, 개인정보 파기가 앵커 실패와 무관하게 도는지, 날짜·시각 규칙(운영 18시 전·지난 날짜는 만들지 않음),
// 예상 밖 오류가 공개해도 되는 JSON 500으로 끝나는지 본다.
// 응답 본문은 공개 앵커 저장소의 Actions 기록에 찍히므로 DB 호스트·사용자명·메시지가 새면 안 된다.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => {
  class AnchorConsistencyError extends Error {}
  return { AnchorConsistencyError, getDb: vi.fn(), purge: vi.fn(), build: vi.fn(), order: [] as string[] };
});

vi.mock("@/server/db", () => ({ getDb: m.getDb }));
vi.mock("@/server/repo/providers", () => ({ purgeStaleRegistrations: m.purge }));
vi.mock("@/server/services/anchor", () => ({ AnchorConsistencyError: m.AnchorConsistencyError, buildDailyAnchor: m.build }));

import { ConfigError } from "@/server/config";
import { InputError } from "@/server/sql";
import { GET, POST } from "../api/cron/anchor/route";

const SECRET = "cron-secret-0123456789abcdef";
const req = (auth: string | null = `Bearer ${SECRET}`, query = "") =>
  new Request(`https://site.example/api/cron/anchor${query}`, { method: "POST", headers: auth ? { authorization: auth } : {} });
const doc = { date: "2026-11-02", merkle_root: "a".repeat(64) };

beforeEach(() => {
  vi.stubEnv("CRON_SECRET", SECRET);
  m.order.length = 0;
  m.getDb.mockReset().mockResolvedValue({});
  m.purge.mockReset().mockImplementation(async () => {
    m.order.push("purge");
    return 2;
  });
  m.build.mockReset().mockImplementation(async () => {
    m.order.push("anchor");
    return { created: true, tsaErrors: [], document: doc };
  });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

/** 시계를 정한 시각(UTC ISO)으로 고정한다. Date만 바꾼다(타이머·Promise는 그대로). */
const at = (utc: string) => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(utc));
};

describe("비밀값", () => {
  it("CRON_SECRET이 없으면 503, DB는 건드리지 않는다", async () => {
    vi.stubEnv("CRON_SECRET", "");
    const res = await POST(req());
    expect(res.status).toBe(503);
    expect(m.getDb).not.toHaveBeenCalled();
  });

  it("운영에서 CRON_SECRET이 16자 미만이면 503으로 닫는다", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("CRON_SECRET", "short-secret");
    const res = await POST(req("Bearer short-secret"));
    expect(res.status).toBe(503);
    expect((await res.json()).error).toMatch(/너무 짧아/);
    expect(m.getDb).not.toHaveBeenCalled();
  });

  it("비밀값이 틀리면 401, 파기·앵커 모두 하지 않는다", async () => {
    for (const auth of [null, `Bearer ${SECRET}x`, `Basic ${SECRET}`]) expect((await POST(req(auth))).status).toBe(401);
    expect(m.getDb).not.toHaveBeenCalled();
    expect(m.purge).not.toHaveBeenCalled();
  });
});

describe("앵커와 개인정보 파기", () => {
  it("정상: 파기를 먼저 하고 오늘(KST) 날짜로 앵커를 만든다(GET·POST 같음)", async () => {
    at("2026-11-02T09:30:00Z"); // KST 18:30
    for (const handler of [GET, POST]) {
      m.order.length = 0;
      const res = await handler(req());
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ created: true, tsa_errors: [], purged_registrations: 2, document: doc });
      expect(m.order).toEqual(["purge", "anchor"]);
    }
    expect(m.build).toHaveBeenLastCalledWith({}, "2026-11-02");
  });

  it("앵커가 과거 기록 불일치(409)여도 파기는 돌고, 409 본문에 파기 결과가 있다", async () => {
    m.build.mockRejectedValue(new m.AnchorConsistencyError("에이전트 x의 순번 2가 비어 있습니다(다음 기록 3)."));
    const res = await POST(req());
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "consistency", message: "에이전트 x의 순번 2가 비어 있습니다(다음 기록 3).", purged_registrations: 2 });
    expect(m.purge).toHaveBeenCalledTimes(1);
  });

  it("파기가 실패해도(-1) 앵커는 만든다", async () => {
    m.purge.mockRejectedValue(new Error("db busy"));
    const res = await POST(req());
    expect(res.status).toBe(200);
    expect((await res.json()).purged_registrations).toBe(-1);
    expect(m.build).toHaveBeenCalledTimes(1);
  });
});

describe("날짜·시각 규칙(자정을 넘긴 요청·18시 전 요청은 앵커를 만들지 않는다)", () => {
  it("운영에서 18시(KST) 전(자정 직후 00:00:05, 오전 10시)이면 파기만 하고 앵커는 만들지 않는다(200, skipped)", async () => {
    vi.stubEnv("NODE_ENV", "production");
    for (const utc of ["2026-11-10T15:00:05Z", "2026-11-11T01:00:00Z", "2026-11-11T08:59:59Z"]) {
      at(utc);
      const res = await POST(req());
      expect(res.status, utc).toBe(200);
      expect(await res.json()).toEqual({ created: false, skipped: "before-18-kst", document: null, purged_registrations: 2 });
    }
    expect(m.build).not.toHaveBeenCalled();
    expect(m.purge).toHaveBeenCalledTimes(3); // 처리방침의 파기 약속은 18시 전 요청에서도 지킨다
    // 18:00:00(KST)부터는 만든다
    at("2026-11-11T09:00:00Z");
    expect((await POST(req())).status).toBe(200);
    expect(m.build).toHaveBeenCalledWith({}, "2026-11-11");
  });

  it("개발·테스트에서는 18시 전에도 만든다(로컬 시험)", async () => {
    at("2026-11-11T01:00:00Z"); // KST 10:00
    expect((await POST(req())).status).toBe(200);
    expect(m.build).toHaveBeenCalledWith({}, "2026-11-11");
  });

  it("?date가 오늘(KST)이 아니면(자정을 넘겨 도착한 요청) 422로 끝내고 만들지 않는다. 오늘이면 그 날짜로 만든다", async () => {
    vi.stubEnv("NODE_ENV", "production");
    at("2026-11-10T15:00:05Z"); // 공개 저장소 작업이 11-10 23:59에 보낸 요청이 11-11 00:00:05에 닿음
    const late = await POST(req(undefined, "?date=2026-11-10"));
    expect(late.status).toBe(422);
    expect(await late.json()).toEqual({ error: "date_passed", message: "요청한 날짜가 오늘(KST)이 아니라 만들지 않습니다", purged_registrations: 2 });
    for (const bad of ["?date=2026-11-12", "?date=", "?date=not-a-date"]) expect((await POST(req(undefined, bad))).status, bad).toBe(422);
    expect(m.build).not.toHaveBeenCalled();
    at("2026-11-10T14:59:30Z"); // 23:59:30 KST: 아직 그날
    const ok = await POST(req(undefined, "?date=2026-11-10"));
    expect(ok.status).toBe(200);
    expect(m.build).toHaveBeenCalledExactlyOnceWith({}, "2026-11-10");
  });

  it("DB 연결·파기 도중 자정이 지나 날짜 확인이 실패하면(InputError) 500이 아니라 422로 끝낸다(재시도해도 같으므로)", async () => {
    m.build.mockRejectedValue(new InputError("앵커는 오늘(KST 2026-11-11)만 만들 수 있습니다. 빠진 날은 채우지 않습니다."));
    const res = await POST(req());
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: "invalid_input", message: "앵커는 오늘(KST 2026-11-11)만 만들 수 있습니다. 빠진 날은 채우지 않습니다.", purged_registrations: 2 });
  });

  it("시각은 요청을 받을 때 한 번만 잡는다: DB 연결이 자정을 넘겨 끝나도 받은 날짜로 앵커를 요청한다", async () => {
    at("2026-11-10T14:59:59Z"); // 23:59:59 KST
    m.getDb.mockImplementation(async () => {
      vi.setSystemTime(new Date("2026-11-10T15:00:02Z")); // 연결에 3초 걸려 자정이 지남
      return {};
    });
    await POST(req());
    // 실제 서비스는 이 날짜가 이미 오늘이 아니라서 InputError(→ 422)로 멈춘다(services/anchor.ts). 다음 날 앵커를 00시에 만들지 않는다.
    expect(m.build).toHaveBeenCalledWith({}, "2026-11-10");
  });
});

describe("예상 밖 오류는 공개해도 되는 JSON 500", () => {
  const body500 = async (err: unknown) => {
    m.build.mockRejectedValue(err);
    const res = await POST(req());
    expect(res.status).toBe(500);
    const text = await res.text();
    return { text, json: JSON.parse(text) as { error: string; code: string; message: string; purged_registrations?: number } };
  };

  it("DB 인증 실패: SQLSTATE만 내보내고 메시지 속 프로젝트 ID·호스트는 숨긴다", async () => {
    const err = Object.assign(new Error('password authentication failed for user "postgres.abcdprojectref" at aws-0-ap-northeast-2.pooler.supabase.com'), { code: "28P01" });
    const { text, json } = await body500(err);
    expect(json).toMatchObject({ error: "internal", code: "28P01", purged_registrations: 2 });
    // 공개 저장소 스크립트는 error·message만 찍으므로 코드가 문장에도 들어 있어야 한다
    expect(json.message).toBe("DB가 오류를 돌려주어 처리하지 못했습니다(코드 28P01)");
    expect(text).not.toMatch(/abcdprojectref|pooler|supabase|password/);
    expect(console.error).toHaveBeenCalled(); // 자세한 원인은 서버 로그에 남는다
  });

  it("pg의 연결 시간 초과·풀 대기 초과·끊김(code 없는 고정 문장)은 DB_* 코드로 남긴다", async () => {
    // pg-pool이 만드는 모양 그대로(code 없음, 원인은 cause). 실제 pg 풀로 만든 확인은 server/__tests__/pg-errors.test.ts
    const timeout = await body500(new Error("Connection terminated due to connection timeout", { cause: new Error("Connection terminated unexpectedly") }));
    expect(timeout.json).toMatchObject({ code: "DB_CONNECT_TIMEOUT", message: "DB 등 외부 연결에 실패해 처리하지 못했습니다(코드 DB_CONNECT_TIMEOUT)" });
    expect((await body500(new Error("timeout exceeded when trying to connect"))).json.code).toBe("DB_POOL_TIMEOUT");
    const lost = await body500(new Error("Connection terminated unexpectedly"));
    expect(lost.json).toMatchObject({ code: "DB_CONNECTION_LOST", message: "DB 등 외부 연결에 실패해 처리하지 못했습니다(코드 DB_CONNECTION_LOST)" });
    // 문장 전체가 같을 때만 분류한다: 호스트가 덧붙은 메시지는 분류하지 않고, 어떤 경우에도 원문을 내보내지 않는다
    const withHost = await body500(new Error("Connection terminated unexpectedly db.internal.example:6543"));
    expect(withHost.json.code).toBe("UNKNOWN");
    expect(withHost.text).not.toContain("db.internal.example");
  });

  it("DNS·TLS·코드 없는 오류·이상한 코드도 코드만 남긴다", async () => {
    const dns = await body500(Object.assign(new Error("getaddrinfo ENOTFOUND db.internal.example"), { code: "ENOTFOUND" }));
    expect(dns.json.code).toBe("ENOTFOUND");
    expect(dns.text).not.toContain("db.internal.example");
    expect((await body500(Object.assign(new Error("self-signed certificate in certificate chain"), { code: "SELF_SIGNED_CERT_IN_CHAIN" }))).json.message).toMatch(/인증서/);
    expect((await body500(new TypeError("Cannot read properties of undefined"))).json.code).toBe("TypeError");
    expect((await body500(Object.assign(new Error("x"), { code: "bad code; DROP" }))).json.code).toBe("UNKNOWN");
    expect((await body500("plain string")).json.code).toBe("UNKNOWN");
  });

  it("환경변수 누락(ConfigError)은 CONFIG_MISSING. DB를 열기 전에 실패하면 파기 결과는 없다", async () => {
    m.getDb.mockRejectedValue(new ConfigError("배포 환경에는 DATABASE_URL이 필요합니다."));
    const res = await POST(req());
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json).toEqual({ error: "internal", code: "CONFIG_MISSING", message: expect.stringMatching(/환경변수.*\(코드 CONFIG_MISSING\)$/) });
    expect(JSON.stringify(json)).not.toContain("DATABASE_URL");
  });

  it("공개 저장소 스크립트가 찍는 앞 300바이트 안에 code가 들어간다", async () => {
    const { text } = await body500(Object.assign(new Error("relation does not exist"), { code: "42P01" }));
    expect(Buffer.from(text, "utf8").subarray(0, 300).toString("utf8")).toContain('"code":"42P01"');
  });
});
