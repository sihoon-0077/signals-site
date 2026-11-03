// 시그널 조회의 공개 여부 열(anchored·exit_anchored)을 인덱스 한 칸만 읽는 max() 형태로 바꿨다(0005 인덱스와 함께).
// 예전 EXISTS 형태와 모든 행에서 같은 값인지, 체크포인트가 쌓이는 단계마다 비교한다. 봉인 열만 읽는 SEAL_SELECT도 확인한다.
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Db, pgliteDb } from "../db";
import { runMigrations } from "../migrate";
import { SEAL_SELECT, SIGNAL_SELECT, type SignalRow } from "../repo/signals";

// 바꾸기 전 형태(정답 기준)
const OLD_FLAGS = `
  SELECT s.id,
         EXISTS (SELECT 1 FROM chain_checkpoints c WHERE c.agent_id = s.agent_id AND c.chain_length >= s.sequence_no) AS anchored,
         EXISTS (SELECT 1 FROM signals x JOIN chain_checkpoints c ON c.agent_id = x.agent_id AND c.chain_length >= x.sequence_no
                  WHERE x.entry_signal_id = s.id) AS exit_anchored
    FROM signals s ORDER BY s.id`;
const NEW_FLAGS = `SELECT q.id, q.anchored, q.exit_anchored FROM (${SIGNAL_SELECT}) q ORDER BY q.id`;

let pg: PGlite;
let db: Db;
const agents: Record<string, string> = {};
const signalIds: Record<string, string> = {};

async function insertSignal(agent: string, seq: number, action: "ENTRY" | "EXIT", entryOf?: string) {
  const key = `${agent}${seq}`;
  const [r] = await db.query<{ id: string }>(
    `INSERT INTO signals (agent_id, sequence_no, market, ticker, side, action, max_holding_days, is_paper, entry_signal_id, rule_version, nonce,
                          published_at, prev_hash, content_hash, signature, key_id)
     VALUES ($1, $2, 'KOSPI', '005930', 'LONG', $3, 10, true, $4, 'r1', md5($5), date_trunc('milliseconds', clock_timestamp()),
             repeat('0', 64), md5($5) || md5($5 || 'x'), 'sig', 'k') RETURNING id`,
    [agents[agent], seq, action, entryOf ? signalIds[entryOf] : null, key],
  );
  signalIds[key] = r.id;
}

async function checkpoint(date: string, lengths: Record<string, number>) {
  for (const [agent, len] of Object.entries(lengths)) {
    await db.query("INSERT INTO chain_checkpoints (checkpoint_date, agent_id, chain_length, head_hash) VALUES ($1::text::date, $2, $3, repeat('a', 64))", [date, agents[agent], len]);
  }
}

beforeAll(async () => {
  pg = new PGlite();
  db = pgliteDb(pg);
  await runMigrations(db);
  for (const slug of ["sel-a", "sel-b", "sel-c"]) {
    agents[slug.slice(-1)] = (await db.query<{ id: string }>("INSERT INTO agents (slug, name, is_platform_owned) VALUES ($1, $1, true) RETURNING id", [slug]))[0].id;
  }
  await insertSignal("a", 1, "ENTRY");
  await insertSignal("a", 2, "EXIT", "a1");
  await insertSignal("a", 3, "ENTRY");
  await insertSignal("a", 4, "ENTRY");
  await insertSignal("a", 5, "EXIT", "a3");
  await insertSignal("b", 1, "ENTRY");
  await insertSignal("b", 2, "EXIT", "b1");
});
afterAll(async () => {
  await pg.close();
});

describe("공개 여부 열(anchored·exit_anchored)", () => {
  it("체크포인트가 쌓이는 단계마다 예전 EXISTS 형태와 모든 행이 같다", async () => {
    const steps: [string, Record<string, number>][] = [
      ["2026-11-02", { a: 1, b: 0, c: 0 }],
      ["2026-11-03", { a: 2, b: 1, c: 0 }],
      ["2026-11-04", { a: 4, b: 2, c: 0 }],
      ["2026-11-05", { a: 5, b: 2, c: 0 }],
    ];
    const seen = new Set<string>();
    expect(await db.query(NEW_FLAGS)).toEqual(await db.query(OLD_FLAGS)); // 체크포인트 없음
    for (const [date, lengths] of steps) {
      await checkpoint(date, lengths);
      const old = await db.query<{ anchored: boolean; exit_anchored: boolean }>(OLD_FLAGS);
      expect(await db.query(NEW_FLAGS)).toEqual(old);
      for (const r of old) seen.add(`${r.anchored}/${r.exit_anchored}`);
    }
    // 가능한 세 조합이 모두 나와야 비교가 의미 있다(앵커 안 됨, 진입만 앵커됨, 진입과 그 청산 모두 앵커됨)
    expect([...seen].sort()).toEqual(["false/false", "true/false", "true/true"]);
  });

  it("SEAL_SELECT는 SIGNAL_SELECT의 봉인 열과 같은 값을 돌려준다(사슬 검사가 쓰는 열)", async () => {
    const full = await db.query<SignalRow>(`${SIGNAL_SELECT} ORDER BY s.agent_id, s.sequence_no`);
    const seal = await db.query(`${SEAL_SELECT} ORDER BY s.agent_id, s.sequence_no`);
    const keys = Object.keys(seal[0]);
    expect(keys).not.toEqual(expect.arrayContaining(["event"]));
    expect(keys).toHaveLength(Object.keys(full[0]).length - 4); // event, event_at, anchored, exit_anchored 제외
    expect(seal).toEqual(full.map((r) => Object.fromEntries(keys.map((k) => [k, r[k as keyof SignalRow]]))));
  });

  it("0005 인덱스가 만들어진다", async () => {
    const rows = await db.query<{ indexname: string }>(
      "SELECT indexname FROM pg_indexes WHERE indexname IN ('signals_entry_signal_id_idx', 'chain_checkpoints_agent_len_idx', 'agents_provider_id_idx') ORDER BY indexname",
    );
    expect(rows.map((r) => r.indexname)).toEqual(["agents_provider_id_idx", "chain_checkpoints_agent_len_idx", "signals_entry_signal_id_idx"]);
  });
});
