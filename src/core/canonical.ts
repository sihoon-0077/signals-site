// 정규 직렬화 v2 (03 설계 §6.1). 이 문자열의 SHA-256이 시그널의 지문(content_hash)이다.
//
// ⚠️ 첫 시그널을 발행한 뒤에는 이 규칙을 절대 바꾸지 않는다. 한 글자만 달라져도 과거 지문을 재현할 수 없다.
//    바꿔야 하면 v3를 새로 만들고, 검증기는 canonical_version으로 규칙을 고른다.
// 정답값은 별도 Python 구현(scripts/gen_canonical_vectors.py)이 만든 test-vectors/canonical_v2.json이다.

import { sha256Hex } from "./encoding";

export const CANONICAL_VERSION = 2;
// signal_id(자기 자신의 ID)도 봉인한다(2026-10-29, 첫 운영 발행 전 확정). ID가 봉인 밖이면 운영자가 행끼리 ID를 맞바꿔
// 공유된 검증 링크가 다른 기록을 보여 주게 하거나, 청산(EXIT)이 가리키는 진입을 바꿔치기해도 드러나지 않는다.
export const CANONICAL_TEMPLATE_V2 =
  "v2|signal_id|agent_id|sequence_no|market|ticker|side|action|target_price|stop_loss_price|suggested_weight|max_holding_days|valid_until|is_paper|entry_signal_id|rule_version|nonce|rationale|published_at|prev_hash";

/** 에이전트의 첫 시그널이 가리키는 직전 지문. */
export const GENESIS_HASH = "0".repeat(64);

export const SIDES = ["LONG", "SHORT"] as const;
export const ACTIONS = ["ENTRY", "EXIT"] as const;
export type Side = (typeof SIDES)[number];
export type Action = (typeof ACTIONS)[number];

/** 봉인되는 필드 전체. 소수는 부동소수 오차를 피하려고 문자열로 받는다. */
export interface SignalFieldsV2 {
  /** 이 시그널 자신의 ID(앱이 발행 전에 만든 UUID) */
  signalId: string;
  agentId: string;
  sequenceNo: number;
  market: string;
  ticker: string;
  side: Side;
  action: Action;
  targetPrice: string | null;
  stopLossPrice: string | null;
  suggestedWeight: string | null;
  maxHoldingDays: number | null;
  validUntil: string | null;
  isPaper: boolean;
  entrySignalId: string | null;
  ruleVersion: string;
  nonce: string;
  rationale: string;
  publishedAt: string;
  prevHash: string;
}

export class CanonicalError extends Error {}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DEC_RE = /^(\d+)(?:\.(\d+))?$/;
const HASH_RE = /^[0-9a-f]{64}$/;
const NONCE_RE = /^[0-9a-f]{32}$/;

/** 백슬래시를 먼저 이스케이프해야 역변환이 하나로 정해진다(필드 경계 위조 방지). */
export function escapeField(v: string): string {
  return v.replace(/\\/g, "\\\\").replace(/\|/g, "\\|");
}

export function normalizeUuid(v: string | null): string {
  if (v === null) return "";
  if (!UUID_RE.test(v)) throw new CanonicalError(`invalid uuid: ${v}`);
  return v.toLowerCase();
}

/**
 * 소수 4자리 고정 문자열. 4자리를 넘으면 반올림하지 않고 거부한다.
 * (JS 이진 근사 반올림과 PostgreSQL NUMERIC 반올림이 달라 저장값과 지문이 어긋나는 것을 막는다.)
 */
export function formatDecimal(v: string | null): string {
  if (v === null) return "";
  const m = DEC_RE.exec(v);
  if (!m) throw new CanonicalError(`invalid decimal: ${v}`);
  const frac = m[2] ?? "";
  if (frac.length > 4) throw new CanonicalError(`more than 4 decimal places: ${v}`);
  const intPart = m[1].replace(/^0+(?=\d)/, "");
  return `${intPart}.${frac.padEnd(4, "0")}`;
}

export function formatInt(v: number | null): string {
  if (v === null) return "";
  if (!Number.isSafeInteger(v)) throw new CanonicalError(`invalid integer: ${v}`);
  return String(v);
}

/** ISO 8601 UTC 밀리초. "+09:00" 표기도 UTC로 바꾼다. */
export function formatTimestamp(v: string | null): string {
  if (v === null) return "";
  const t = Date.parse(v);
  if (Number.isNaN(t)) throw new CanonicalError(`invalid timestamp: ${v}`);
  return new Date(t).toISOString();
}

/** 정규 직렬화 문자열. 해시·서명의 유일한 입력이다. */
export function canonicalizeV2(f: SignalFieldsV2): string {
  if (!SIDES.includes(f.side)) throw new CanonicalError(`invalid side: ${f.side}`);
  if (!ACTIONS.includes(f.action)) throw new CanonicalError(`invalid action: ${f.action}`);
  if (!NONCE_RE.test(f.nonce)) throw new CanonicalError("nonce must be 32 lowercase hex chars");
  if (!HASH_RE.test(f.prevHash)) throw new CanonicalError("prev_hash must be 64 lowercase hex chars");
  if (!Number.isSafeInteger(f.sequenceNo) || f.sequenceNo < 1) throw new CanonicalError("sequence_no must be >= 1");
  if (typeof f.signalId !== "string" || !UUID_RE.test(f.signalId)) throw new CanonicalError("signal_id must be a UUID");
  const fields = [
    "v2",
    normalizeUuid(f.signalId),
    normalizeUuid(f.agentId),
    String(f.sequenceNo),
    f.market,
    f.ticker,
    f.side,
    f.action,
    formatDecimal(f.targetPrice),
    formatDecimal(f.stopLossPrice),
    formatDecimal(f.suggestedWeight),
    formatInt(f.maxHoldingDays),
    formatTimestamp(f.validUntil),
    f.isPaper ? "true" : "false",
    normalizeUuid(f.entrySignalId),
    f.ruleVersion,
    f.nonce,
    f.rationale,
    formatTimestamp(f.publishedAt),
    f.prevHash,
  ];
  return fields.map(escapeField).join("|");
}

/** 지문(content_hash) = SHA-256(정규 직렬화 문자열의 UTF-8). */
export async function contentHashV2(f: SignalFieldsV2): Promise<string> {
  return sha256Hex(canonicalizeV2(f));
}
