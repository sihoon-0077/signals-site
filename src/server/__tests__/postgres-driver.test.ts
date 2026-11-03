// 배포 드라이버(node-postgres, pg) 경로 확인. 다른 테스트는 PGlite 드라이버로만 돌기 때문에, 같은 흐름을 실제
// PostgreSQL 와이어 프로토콜로 돌려 드라이버마다 다른 타입 변환(int8·numeric·date·timestamptz·jsonb·오류 코드)이
// 봉인·검증 결과를 바꾸지 않는지 본다. 실제 사고: jsonb 파라미터를 예전 드라이버(postgres-js)가 한 번 더 JSON 인코딩해
// 공급자 채널 배열이 문자열로 저장됐다(PGlite 테스트로는 드러나지 않음) → SQL에서 $n::text::jsonb로 고정.
// 테스트 안에서 PGlite 소켓 서버(빈 메모리 DB)를 띄우고, 그 앞에 바이트를 그대로 넘기는 관찰용 프록시를 둔다.
// 소켓 서버는 연결마다 메시지를 번갈아 처리해 연결 여러 개가 동시에 쿼리하면 확장 프로토콜이 꼬이므로 풀은 연결 1개로 둔다.
// 서버 쪽 연결 상한은 2: pg 풀은 SQL 오류가 난 연결을 버리고 바로 새로 여는데, 그때 닫히는 중인 연결이 아직 남아 있을 수 있다.
// TEST_DATABASE_URL을 주면 그 빈 DB에 프록시 없이 연결한다(프록시가 필요한 테스트는 건너뜀).
import net from "node:net";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { types } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { verifyAnchorDocument } from "@/core/anchor";
import { contentHashV2 } from "@/core/canonical";
import { type CheckResult, verifySignalBundle } from "@/core/verify";
import { TSA_DEFAULT } from "../config";
import { type Db, pgliteDb, postgresDb } from "../db";
import { publicKeysFile } from "../keys";
import { runMigrations } from "../migrate";
import { createAgent, listAgents } from "../repo/agents";
import { getApprovedProviderByHandle, listProvidersForAdmin, recordReferralVisit, setProviderStatus } from "../repo/providers";
import { listAgentSignals, rowToFields } from "../repo/signals";
import { ConflictError } from "../sql";
import { buildDailyAnchor, listAnchorRoots, listAnchors } from "../services/anchor";
import { getSignalBundle } from "../services/bundle";
import { publishSignal, recordSignalEvent } from "../services/publish";
import { registerProvider } from "../services/registration";

const status = (rs: CheckResult[], id: CheckResult["id"]) => rs.find((r) => r.id === id)?.status;

interface WireProxy {
  port: number;
  /** 보낸 쿼리(Query·Parse) 수와, 그중 앞 쿼리의 ReadyForQuery를 받기 전에 쓴 수(파이프라이닝) */
  stats: { queries: number; pipelined: number };
  reset(): void;
  /** 지나가는 연결을 모두 끊는다(풀러·NAT가 연결을 끊은 상황) */
  killAll(): void;
  close(): Promise<void>;
}

/**
 * 관찰용 TCP 프록시. 바이트는 그대로 넘기고, 클라이언트가 앞 쿼리의 ReadyForQuery를 받기 전에 다음 쿼리를 썼는지 센다.
 * Supabase 트랜잭션 풀러는 응답 하나가 끝나면 백엔드를 다른 클라이언트에 넘기므로, 이렇게 이어 보낸 쿼리는 멈추거나 남의 행을 받는다.
 * (확인: 예전 드라이버 postgres-js는 연결 1개에 동시 20개를 보내면 9개를 이어 보냈고, pg는 0개)
 */
function startWireProxy(upstreamPort: number): Promise<WireProxy> {
  const stats = { queries: 0, pipelined: 0 };
  const sockets = new Set<net.Socket>();
  const server = net.createServer((client) => {
    const up = net.connect(upstreamPort, "127.0.0.1");
    let started = false;
    let outstanding = 0;
    let cbuf = Buffer.alloc(0);
    let sbuf = Buffer.alloc(0);
    client.on("data", (chunk) => {
      up.write(chunk);
      cbuf = Buffer.concat([cbuf, chunk]);
      for (;;) {
        if (!started) {
          // 첫 메시지(StartupMessage)는 종류 바이트가 없다. 시작 절차도 ReadyForQuery로 끝난다.
          if (cbuf.length < 4 || cbuf.length < cbuf.readInt32BE(0)) break;
          cbuf = cbuf.subarray(cbuf.readInt32BE(0));
          started = true;
          outstanding = 1;
          continue;
        }
        if (cbuf.length < 5 || cbuf.length < 1 + cbuf.readInt32BE(1)) break;
        const type = String.fromCharCode(cbuf[0]);
        if (type === "Q" || type === "P") {
          stats.queries++;
          if (outstanding > 0) stats.pipelined++;
        }
        if (type === "Q" || type === "S") outstanding++;
        cbuf = cbuf.subarray(1 + cbuf.readInt32BE(1));
      }
    });
    up.on("data", (chunk) => {
      client.write(chunk);
      sbuf = Buffer.concat([sbuf, chunk]);
      while (sbuf.length >= 5 && sbuf.length >= 1 + sbuf.readInt32BE(1)) {
        if (sbuf[0] === 0x5a) outstanding--; // 'Z' ReadyForQuery
        sbuf = sbuf.subarray(1 + sbuf.readInt32BE(1));
      }
    });
    const close = () => {
      client.destroy();
      up.destroy();
    };
    for (const s of [client, up]) {
      sockets.add(s);
      s.on("error", close);
      s.on("close", () => {
        sockets.delete(s);
        close();
      });
    }
  });
  return new Promise((resolve) =>
    server.listen(0, "127.0.0.1", () =>
      resolve({
        port: (server.address() as net.AddressInfo).port,
        stats,
        reset: () => Object.assign(stats, { queries: 0, pipelined: 0 }),
        killAll: () => sockets.forEach((s) => s.destroy()),
        close: () => new Promise((r) => server.close(() => r())),
      }),
    ),
  );
}

async function until(check: () => boolean, ms = 3000): Promise<void> {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error("시간 안에 조건이 맞지 않음");
    await new Promise((r) => setTimeout(r, 20));
  }
}

describe("pg 드라이버(배포 경로)", () => {
  let db: Db;
  let agentId: string;
  let pg: PGlite | undefined;
  let server: PGLiteSocketServer | undefined;
  let proxy: WireProxy | undefined;

  beforeAll(async () => {
    let url = process.env.TEST_DATABASE_URL;
    if (!url) {
      pg = new PGlite();
      server = new PGLiteSocketServer({ db: pg, port: 0, host: "127.0.0.1", maxConnections: 2 });
      await server.start();
      proxy = await startWireProxy(Number(server.getServerConn().split(":")[1]));
      url = `postgres://postgres:postgres@127.0.0.1:${proxy.port}/postgres`;
    }
    db = postgresDb(url, { max: 1 });
  });
  afterAll(async () => {
    await db?.end?.();
    await proxy?.close();
    await server?.stop();
    await pg?.close();
  });

  it("마이그레이션(다중 문장·트리거 함수·RLS)이 적용되고, 다시 돌리면 아무것도 하지 않는다", async () => {
    expect(await runMigrations(db)).toEqual(["0001_init.sql", "0002_rls.sql", "0003_hardening.sql", "0004_providers_privacy.sql", "0005_indexes.sql"]);
    expect(await runMigrations(db)).toEqual([]);
    const sums = await db.query<{ n: number }>("SELECT count(*)::int AS n FROM schema_migrations WHERE checksum ~ '^[0-9a-f]{64}$'");
    expect(sums[0].n).toBe(5);
  });

  it("결과 타입이 개발·테스트용 PGlite와 같다(date·interval·numeric[]는 이 풀에서 맞춤)", async () => {
    // pg 기본 변환은 date를 Node 시간대의 자정으로 읽는다. 한국 시간대에서 그대로 두면 하루 앞 날짜로 보인다.
    vi.stubEnv("TZ", "Asia/Seoul");
    try {
      expect((pgDefaultDate("2026-11-20") as Date).toISOString()).toBe("2026-11-19T15:00:00.000Z");
      const SQL = `SELECT 7::int2 AS i2, 8::int4 AS i4, 1.5::numeric(18,4) AS num, 2.5::float8 AS f8, true AS b, 'x'::text AS t, 'ab'::char(4) AS ch,
                          '00000000-0000-4000-8000-000000000001'::uuid AS u, '2026-11-20'::date AS d, ARRAY['2026-11-20', NULL]::date[] AS da,
                          '2026-11-20 10:00:00.123+09'::timestamptz AS tstz, interval '10 minutes' AS iv, ARRAY[interval '1 day'] AS iva,
                          ARRAY[1.5, 78000.0001]::numeric[] AS na, '{"a":[1,2]}'::jsonb AS jb, '[1]'::json AS js, NULL::date AS nd`;
      const lite = new PGlite();
      try {
        const [want] = await pgliteDb(lite).query(SQL);
        const [got] = await db.query(SQL);
        expect(got).toEqual(want);
        expect((got.d as Date).toISOString()).toBe("2026-11-20T00:00:00.000Z");
        expect(got.na).toEqual(["1.5", "78000.0001"]);
      } finally {
        await lite.close();
      }
    } finally {
      vi.unstubAllEnvs();
    }
    // 앱이 그대로 읽지 않는 두 타입: int8은 문자열(예전 드라이버와 같음, 앱은 count(*)::int로 읽음), bytea는 바이트(앱은 encode()로 읽음)
    const [x] = await db.query<{ n: unknown; ba: Uint8Array }>("SELECT count(*) AS n, '\\x0102'::bytea AS ba");
    expect(x.n).toBe("1");
    expect([...x.ba]).toEqual([1, 2]);
  });

  it("등록·중복 거부(오류 코드 23505 판별)·승인 후 공개 프로필의 숫자·배열 타입", async () => {
    const base = { handle: "pg-quant", penName: "피지", email: "pg@example.com", strategyType: "LLM", holdingStyle: "SWING", channels: ["https://blog.example.com/pg"], ageConfirmed: true, consentPrivacy: true };
    const r = await registerProvider(db, base);
    await expect(registerProvider(db, { ...base, email: "pg2@example.com" })).rejects.toBeInstanceOf(ConflictError);
    const id = (await db.query<{ id: string }>("SELECT id FROM providers WHERE handle = 'pg-quant'"))[0].id;
    await setProviderStatus(db, id, "APPROVED");
    await registerProvider(db, { ...base, handle: "pg-friend", email: "friend@example.com", referralCode: r.referralCode, consentMarketing: true });
    await setProviderStatus(db, (await db.query<{ id: string }>("SELECT id FROM providers WHERE handle = 'pg-friend'"))[0].id, "APPROVED");
    await recordReferralVisit(db, r.referralCode, "/p/pg-quant");
    const pub = (await getApprovedProviderByHandle(db, "pg-quant"))!;
    expect(pub.channels).toEqual(["https://blog.example.com/pg"]);
    expect(pub.referred_signups).toBe(1);
    expect(pub.referral_visits).toBe(1);
    expect(pub.approved_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    const admin = await listProvidersForAdmin(db, "APPROVED");
    expect(admin.map((p) => p.handle).sort()).toEqual(["pg-friend", "pg-quant"]);
    expect(typeof admin[0].withdrawn).toBe("boolean");
    expect(admin.find((p) => p.handle === "pg-friend")!.consent_marketing_at).toMatch(/Z$/);
    agentId = await createAgent(db, { providerId: id, slug: "pg-agent", name: "피지 에이전트" });
    // 고유 제약 위반은 pg 오류 객체의 code(23505)로 판별한다(isUniqueViolation)
    await expect(createAgent(db, { providerId: null, slug: "pg-agent", name: "중복" })).rejects.toBeInstanceOf(ConflictError);
  });

  it("발행한 기록을 다시 읽어 지문을 재계산하면 저장값과 같다(소수·빈 값·특수문자·청산 참조)", async () => {
    await publishSignal(db, { agentId, market: "KOSPI", ticker: "005930", side: "LONG", action: "ENTRY", targetPrice: "78000", stopLossPrice: "71500.5", suggestedWeight: "0.0125", maxHoldingDays: 10, ruleVersion: "pg-v1", rationale: "돌파 | 거래량 \\ 2배" });
    const entry = (await listAgentSignals(db, agentId))[0];
    await publishSignal(db, { agentId, market: "KOSPI", ticker: "005930", side: "LONG", action: "EXIT", entrySignalId: entry.id, ruleVersion: "pg-v1" });
    const rows = await listAgentSignals(db, agentId);
    expect(rows.map((r) => r.sequence_no).sort()).toEqual([1, 2]);
    for (const row of rows) expect(await contentHashV2(rowToFields(row))).toBe(row.content_hash);
    expect(rows.map((r) => [typeof r.sequence_no, typeof r.canonical_version, typeof r.is_paper, r.target_price])).toContainEqual(["number", "number", "boolean", "78000.0000"]);
    const agents = await listAgents(db);
    const a = agents.find((x) => x.id === agentId)!;
    expect(a.chain_length).toBe(2);
    expect(typeof a.is_platform_owned).toBe("boolean");
  });

  it("앵커: 리프 숫자 타입·루트·서명이 맞고 목록 API 값도 숫자/문자열로 온다", async () => {
    const r = await buildDailyAnchor(db, "2026-11-20", { allowOtherDate: true });
    expect(r.created).toBe(true);
    expect(typeof r.document.leaves[0].chain_length).toBe("number");
    const v = await verifyAnchorDocument(r.document, await publicKeysFile());
    expect(v).toEqual({ rootMatches: true, signatureValid: true, sorted: true });
    expect((await buildDailyAnchor(db, "2026-11-20", { allowOtherDate: true })).created).toBe(false);
    const [row] = await listAnchors(db);
    expect(row.leaf_count).toBe(r.document.leaf_count);
    expect(row.date).toBe("2026-11-20");
    expect(await listAnchorRoots(db)).toEqual([{ date: "2026-11-20", merkle_root: r.document.merkle_root, prev_root: null }]);
    // DB 안에서도 JSON 문자열이 아니라 객체·배열로 저장됐는지(이중 인코딩 방지 확인)
    expect((await db.query<{ t: string }>("SELECT jsonb_typeof(document) AS t FROM anchor_records"))[0].t).toBe("object");
    expect((await db.query<{ t: string }>("SELECT DISTINCT jsonb_typeof(channels) AS t FROM providers"))[0].t).toBe("array");
    // 앵커에 담긴 기록은 공개 여부 계산(anchored)에서도 앵커됨으로 보인다
    expect((await listAgentSignals(db, agentId)).map((s) => s.anchored)).toEqual([true, true]);
  });

  it("청산 후 공개 자료만으로 검증하면 지문·서명·사슬·앵커가 통과한다(진입 기준은 기관 시각이 없어 보류)", async () => {
    const s = (await listAgentSignals(db, agentId)).find((x) => x.sequence_no === 2)!;
    await recordSignalEvent(db, s.id, "CLOSED", "드라이버 확인");
    const rs = await verifySignalBundle((await getSignalBundle(db, s.id))!);
    expect([status(rs, "hash"), status(rs, "signature"), status(rs, "chain"), status(rs, "anchor"), status(rs, "entry")]).toEqual(["PASS", "PASS", "PASS", "PASS", "SKIP"]);
  });

  it("불변 트리거 오류가 그대로 올라오고, 트랜잭션은 예외 때 되돌린다", async () => {
    await expect(db.query("UPDATE signals SET ticker = 'XXXX'")).rejects.toThrow(/immutable/);
    const before = (await db.query<{ n: number }>("SELECT count(*)::int AS n FROM referral_visits"))[0].n;
    await expect(
      db.tx(async (t) => {
        await t.query("INSERT INTO referral_visits (code, path) VALUES ('x', '/')");
        throw new Error("rollback");
      }),
    ).rejects.toThrow("rollback");
    // 트랜잭션 안의 DB 오류도 되돌리고 연결을 풀에 돌려준다(돌려주지 않으면 연결 1개짜리 풀에서 다음 쿼리가 멈춘다)
    await expect(db.tx((t) => t.query("INSERT INTO signal_events (signal_id, event) VALUES ('00000000-0000-4000-8000-000000000000', 'CLOSED')"))).rejects.toMatchObject({ code: "23503" });
    expect((await db.query<{ n: number }>("SELECT count(*)::int AS n FROM referral_visits"))[0].n).toBe(before);
  });

  it("실제 TSA 토큰을 bytea로 저장하고 base64로 다시 읽어도 검증된다(오프라인이면 건너뜀)", async (ctx) => {
    const agent2 = await createAgent(db, { providerId: null, slug: "pg-tsa", name: "TSA 확인" });
    const tsaBefore = process.env.TSA_URLS;
    process.env.TSA_URLS = TSA_DEFAULT;
    const r = await publishSignal(db, { agentId: agent2, market: "KOSPI", ticker: "000660", side: "LONG", action: "ENTRY", maxHoldingDays: 5, ruleVersion: "pg-v1" }).finally(() => {
      process.env.TSA_URLS = tsaBefore;
    });
    if (r.timestamps.length === 0) ctx.skip(`타임스탬프 기관에 연결할 수 없음: ${r.tsaErrors.join("; ")}`);
    expect(status(await verifySignalBundle((await getSignalBundle(db, r.signal.id))!), "timestamp")).toBe("PASS");
  });

  it("같은 요청 번호로 다시 발행하면 새로 봉인하지 않고 그 기록을 돌려준다(내용이 다르면 거부)", async () => {
    const agent3 = await createAgent(db, { providerId: null, slug: "pg-idem", name: "재시도 확인" });
    const input = { requestId: crypto.randomUUID(), agentId: agent3, market: "KOSPI", ticker: "035720", side: "LONG", action: "ENTRY", targetPrice: "61000.5", maxHoldingDays: 5, ruleVersion: "pg-v1" };
    const first = await publishSignal(db, input);
    expect([first.alreadySealed, first.signal.id]).toEqual([false, input.requestId]);
    const again = await publishSignal(db, input);
    expect([again.alreadySealed, again.signal.id, again.signal.sequence_no, again.signal.content_hash]).toEqual([true, first.signal.id, 1, first.signal.content_hash]);
    await expect(publishSignal(db, { ...input, ticker: "000270" })).rejects.toBeInstanceOf(ConflictError);
    expect((await listAgentSignals(db, agent3)).length).toBe(1);
  });

  it("무효 처리는 발행 25일·400일 지난 기록도 오류 대신 '10분 안에만' 안내로 거부한다(int4 넘침 회귀)", async () => {
    const [a] = await db.query<{ id: string }>("INSERT INTO agents (slug, name, is_platform_owned) VALUES ('pg-void', '무효 확인', true) RETURNING id");
    const ids: string[] = [];
    for (const [i, age] of ["1 minute", "11 minutes", "25 days", "400 days"].entries()) {
      const [s] = await db.query<{ id: string }>(
        `INSERT INTO signals (agent_id, sequence_no, market, ticker, side, action, max_holding_days, is_paper, rule_version, nonce,
                              published_at, prev_hash, content_hash, signature, key_id)
         VALUES ($1, $2, 'KOSPI', '005930', 'LONG', 'ENTRY', 250, true, 'r1', md5($3), date_trunc('milliseconds', clock_timestamp() - $4::interval),
                 repeat('0', 64), md5($3) || md5($3 || 'x'), 'sig', 'k') RETURNING id`,
        [a.id, i + 1, `void-${i}`, age],
      );
      ids.push(s.id);
    }
    await recordSignalEvent(db, ids[0], "VOID", "오타");
    for (const id of ids.slice(1)) await expect(recordSignalEvent(db, id, "VOID", "늦은 무효")).rejects.toBeInstanceOf(ConflictError);
    expect((await db.query<{ n: number }>("SELECT count(*)::int AS n FROM signal_events WHERE signal_id = ANY($1::uuid[])", [ids]))[0].n).toBe(1);
  });

  describe("연결 하나에 쿼리 하나(트랜잭션 풀러 호환)·끊긴 연결", () => {
    it("동시 요청 20개(매개변수 있음·없음·트랜잭션 섞음)를 이어 보내지 않고 각자 맞는 결과를 받는다", async (ctx) => {
      if (!proxy) ctx.skip("프록시 없이 실행(TEST_DATABASE_URL)");
      await db.exec("CREATE TABLE IF NOT EXISTS burst_probe (k TEXT PRIMARY KEY)");
      proxy!.reset();
      const jobs = Array.from({ length: 20 }, (_, i): Promise<unknown> => {
        if (i % 5 === 4) {
          return db.tx(async (t) => {
            await t.query("INSERT INTO burst_probe (k) VALUES ($1)", [`k${i}`]);
            return (await t.query<{ n: number }>("SELECT count(*)::int AS n FROM burst_probe WHERE k = $1", [`k${i}`]))[0].n;
          });
        }
        if (i % 2 === 0) return db.query<{ v: string }>(`SELECT 'plain-${i}' AS v`).then((r) => r[0].v);
        return db.query<{ v: number }>("SELECT $1::int * 2 AS v", [i]).then((r) => r[0].v);
      });
      const want = Array.from({ length: 20 }, (_, i) => (i % 5 === 4 ? 1 : i % 2 === 0 ? `plain-${i}` : i * 2));
      expect(await Promise.all(jobs)).toEqual(want);
      expect(proxy!.stats.queries).toBeGreaterThanOrEqual(20);
      expect(proxy!.stats.pipelined).toBe(0);
    });

    it("트랜잭션 도중 연결이 끊기면 그 연결은 버리고(프로세스는 살아 있음) 다음 쿼리는 새 연결로 성공한다", async (ctx) => {
      if (!proxy) ctx.skip("프록시 없이 실행(TEST_DATABASE_URL)");
      await db.exec("CREATE TABLE IF NOT EXISTS burst_probe (k TEXT PRIMARY KEY)");
      const err = await db
        .tx(async (t) => {
          await t.query("INSERT INTO burst_probe (k) VALUES ('cut')");
          proxy!.killAll();
          await t.query("SELECT 1");
        })
        .then(
          () => null,
          (e: Error) => e,
        );
      expect(err).toBeInstanceOf(Error);
      expect((await db.query<{ v: number }>("SELECT 3::int AS v"))[0].v).toBe(3);
      expect(await db.query("SELECT 1 FROM burst_probe WHERE k = 'cut'")).toEqual([]); // 끊긴 트랜잭션은 반영되지 않음
    });

    it("쉬고 있던 연결이 끊겨 풀이 오류를 내도 로그만 남기고, 다음 쿼리는 새 연결로 성공한다", async (ctx) => {
      if (!proxy) ctx.skip("프록시 없이 실행(TEST_DATABASE_URL)");
      await db.query("SELECT 1");
      const log = vi.spyOn(console, "error").mockImplementation(() => {});
      try {
        proxy!.killAll();
        await until(() => log.mock.calls.some((c) => String(c[0]).startsWith("[db] 유휴 연결 오류")));
        expect((await db.query<{ v: number }>("SELECT 4::int AS v"))[0].v).toBe(4);
      } finally {
        log.mockRestore();
      }
    });
  });
});

/** pg 전역 기본 변환(이 프로젝트 풀은 쓰지 않음): 위 테스트가 왜 풀 단위 변환이 필요한지 보여 준다. */
function pgDefaultDate(v: string): unknown {
  return (types.getTypeParser as (oid: number) => (s: string) => unknown)(1082)(v);
}
