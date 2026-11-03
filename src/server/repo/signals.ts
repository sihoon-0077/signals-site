// 시그널 조회. 공개 범위(원문을 보여 줄지)는 서비스 계층에서 결정한다.
import "server-only";
import type { Action, SignalFieldsV2, Side } from "@/core/canonical";
import { revealState } from "@/core/reveal";
import type { Db } from "../db";
import { iso } from "../sql";

export interface SignalRow {
  id: string;
  agent_id: string;
  sequence_no: number;
  canonical_version: number;
  market: string;
  ticker: string;
  side: Side;
  action: Action;
  target_price: string | null;
  stop_loss_price: string | null;
  suggested_weight: string | null;
  max_holding_days: number | null;
  valid_until: string | null;
  is_paper: boolean;
  entry_signal_id: string | null;
  rule_version: string;
  nonce: string;
  rationale: string;
  published_at: string;
  prev_hash: string;
  content_hash: string;
  signature: string;
  key_id: string;
  event: "CLOSED" | "EXPIRED" | "VOID" | null;
  event_at: string | null;
  /** 이 기록이 일일 앵커에 포함됨 */
  anchored: boolean;
  /** (ENTRY) 이 진입을 가리키는 EXIT가 일일 앵커에 포함됨 */
  exit_anchored: boolean;
}

/** 봉인 필드만(지문 재계산·서명 확인에 필요한 열) */
export type SealRow = Omit<SignalRow, "event" | "event_at" | "anchored" | "exit_anchored">;

const SEAL_COLUMNS = `s.id, s.agent_id, s.sequence_no, s.canonical_version, s.market, s.ticker, s.side, s.action,
         s.target_price::text AS target_price, s.stop_loss_price::text AS stop_loss_price,
         s.suggested_weight::text AS suggested_weight, s.max_holding_days, ${iso("s.valid_until")} AS valid_until,
         s.is_paper, s.entry_signal_id, s.rule_version, s.nonce, s.rationale,
         ${iso("s.published_at")} AS published_at, s.prev_hash, s.content_hash, s.signature, s.key_id`;

/** 사슬 전체 검사(anchor.ts assertChainsIntact)용. 공개 여부 열을 계산하지 않아 비용이 기록 수에만 비례한다. */
export const SEAL_SELECT = `SELECT ${SEAL_COLUMNS} FROM signals s`;

// anchored: 'chain_length >= 순번인 체크포인트가 있다' = '에이전트의 최대 chain_length >= 순번'(chain_length는 NOT NULL이라 같은 뜻).
// max()는 (agent_id, chain_length) 인덱스(0005)에서 한 칸만 읽는다. EXISTS 형태는 체크포인트가 쌓이면 행마다 표를 훑었다.
export const SIGNAL_SELECT = `
  SELECT ${SEAL_COLUMNS},
         e.event, ${iso("e.occurred_at")} AS event_at,
         COALESCE((SELECT max(c.chain_length) FROM chain_checkpoints c WHERE c.agent_id = s.agent_id) >= s.sequence_no, false) AS anchored,
         EXISTS (SELECT 1 FROM signals x
                  WHERE x.entry_signal_id = s.id
                    AND (SELECT max(c.chain_length) FROM chain_checkpoints c WHERE c.agent_id = x.agent_id) >= x.sequence_no) AS exit_anchored
    FROM signals s
    LEFT JOIN signal_events e ON e.signal_id = s.id`;

export function rowToFields(r: SealRow): SignalFieldsV2 {
  return {
    signalId: r.id,
    agentId: r.agent_id,
    sequenceNo: r.sequence_no,
    market: r.market,
    ticker: r.ticker,
    side: r.side,
    action: r.action,
    targetPrice: r.target_price,
    stopLossPrice: r.stop_loss_price,
    suggestedWeight: r.suggested_weight,
    maxHoldingDays: r.max_holding_days,
    validUntil: r.valid_until,
    isPaper: r.is_paper,
    entrySignalId: r.entry_signal_id,
    ruleVersion: r.rule_version,
    nonce: r.nonce,
    rationale: r.rationale,
    publishedAt: r.published_at,
    prevHash: r.prev_hash,
  };
}

/** 공개 규칙에 따른 원문 공개 여부와 공개 기한(core/reveal.ts). 서버의 공개 판단은 모두 이 함수를 거친다. */
export function revealOf(r: SignalRow, now = new Date()) {
  return revealState(
    { action: r.action, publishedAt: r.published_at, validUntil: r.valid_until, maxHoldingDays: r.max_holding_days, event: r.event, anchored: r.anchored, exitAnchored: r.exit_anchored },
    now,
  );
}

/** 지문으로 찾기(검증 링크가 ID 대신 지문을 쓰면, ID를 바꿔치기해도 다른 기록을 보여 줄 수 없다). */
export async function getSignalByHash(db: Db, contentHash: string): Promise<SignalRow | null> {
  const rows = await db.query<SignalRow>(`${SIGNAL_SELECT} WHERE s.content_hash = $1`, [contentHash]);
  return rows[0] ?? null;
}

/** 같은 에이전트의 순번 from~to 구간(오름차순). 앵커의 마지막 지문까지 사슬을 이어 보이는 데 쓴다. */
export async function listChainSegment(db: Db, agentId: string, from: number, to: number): Promise<SignalRow[]> {
  if (to < from) return [];
  return db.query<SignalRow>(`${SIGNAL_SELECT} WHERE s.agent_id = $1 AND s.sequence_no BETWEEN $2 AND $3 ORDER BY s.sequence_no`, [agentId, from, to]);
}

export async function getSignal(db: Db, id: string): Promise<SignalRow | null> {
  const rows = await db.query<SignalRow>(`${SIGNAL_SELECT} WHERE s.id = $1`, [id]);
  return rows[0] ?? null;
}

export async function listAgentSignals(db: Db, agentId: string): Promise<SignalRow[]> {
  return db.query<SignalRow>(`${SIGNAL_SELECT} WHERE s.agent_id = $1 ORDER BY s.sequence_no DESC`, [agentId]);
}

export async function getSignalBySequence(db: Db, agentId: string, sequenceNo: number): Promise<SignalRow | null> {
  const rows = await db.query<SignalRow>(`${SIGNAL_SELECT} WHERE s.agent_id = $1 AND s.sequence_no = $2`, [agentId, sequenceNo]);
  return rows[0] ?? null;
}

/** 에이전트의 시그널별 타임스탬프 토큰 수 */
export async function countTimestampsByAgent(db: Db, agentId: string): Promise<Map<string, number>> {
  const rows = await db.query<{ signal_id: string; n: number }>(
    "SELECT t.signal_id, count(*)::int AS n FROM signal_timestamps t JOIN signals s ON s.id = t.signal_id WHERE s.agent_id = $1 GROUP BY t.signal_id",
    [agentId],
  );
  return new Map(rows.map((r) => [r.signal_id, r.n]));
}

export interface TimestampRow {
  tsa: string;
  token_b64: string;
  gen_time: string;
}

export async function getTimestamps(db: Db, signalId: string): Promise<TimestampRow[]> {
  return db.query<TimestampRow>(
    `SELECT tsa, encode(token, 'base64') AS token_b64, ${iso("gen_time")} AS gen_time FROM signal_timestamps WHERE signal_id = $1 ORDER BY gen_time`,
    [signalId],
  );
}
