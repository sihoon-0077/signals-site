// 검증 묶음: 시그널 하나를 공개 자료만으로 검증하는 데 필요한 모든 것(03 설계 §4.6, §7.1).
// 원문은 공개 규칙(core/reveal.ts)을 만족할 때만 넣는다: 운영자 기록(청산·만료·무효), 청산 시그널의 외부 고정, 공개 기한 경과.
// 공개 시점이 규칙으로 정해져 있어 운영자가 결과를 보고 골라서 공개할 수 없다.
import "server-only";
import type { ChainLink, SignalBundle } from "@/core/verify";
import type { Db } from "../db";
import { publicKeysFile } from "../keys";
import { type SignalRow, getSignal, getSignalByHash, getSignalBySequence, getTimestamps, listChainSegment, revealOf, rowToFields } from "../repo/signals";
import { getFirstAnchorContaining } from "./anchor";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HASH_RE = /^[0-9a-f]{64}$/;

/** 시그널 ID 또는 지문(content_hash)으로 찾는다. 지문으로 찾으면 ID를 바꿔치기해도 다른 기록을 보여 줄 수 없다. */
export async function findSignal(db: Db, idOrHash: string): Promise<SignalRow | null> {
  const key = idOrHash.toLowerCase();
  if (HASH_RE.test(key)) return getSignalByHash(db, key);
  if (UUID_RE.test(key)) return getSignal(db, key);
  return null;
}

export async function getSignalBundle(db: Db, idOrHash: string): Promise<SignalBundle | null> {
  const s = await findSignal(db, idOrHash);
  if (!s) return null;
  const now = new Date();
  const revealed = revealOf(s, now).revealed;
  const prev = s.sequence_no > 1 ? await getSignalBySequence(db, s.agent_id, s.sequence_no - 1) : null;
  const anchor = await getFirstAnchorContaining(db, s.agent_id, s.sequence_no);
  // 앵커가 이 기록 뒤의 기록까지 묶었으면, 그 사이 사슬(공개된 기록은 원문 포함)을 함께 줘서 앵커의 마지막 지문까지 이어 보게 한다.
  let chainToHead: ChainLink[] | undefined;
  const leaf = anchor?.leaves.find((l) => l.agent_id.toLowerCase() === s.agent_id);
  if (leaf && leaf.chain_length > s.sequence_no) {
    const rows = await listChainSegment(db, s.agent_id, s.sequence_no + 1, leaf.chain_length);
    chainToHead = rows.map((r) => ({
      sequence_no: r.sequence_no,
      prev_hash: r.prev_hash,
      content_hash: r.content_hash,
      fields: revealOf(r, now).revealed ? rowToFields(r) : null,
    }));
  }
  return {
    signal: {
      id: s.id,
      agent_id: s.agent_id,
      sequence_no: s.sequence_no,
      canonical_version: s.canonical_version,
      published_at: s.published_at,
      content_hash: s.content_hash,
      prev_hash: s.prev_hash,
      signature: s.signature,
      key_id: s.key_id,
      revealed,
      fields: revealed ? rowToFields(s) : null,
    },
    previous: prev ? { sequence_no: prev.sequence_no, content_hash: prev.content_hash } : null,
    timestamps: await getTimestamps(db, s.id),
    anchor,
    chain_to_head: chainToHead,
    keys: await publicKeysFile(),
  };
}
