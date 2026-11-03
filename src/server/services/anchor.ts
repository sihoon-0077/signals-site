// 일일 앵커(03 설계 §4.3). 매일 18시(KST) 무렵 실행한다(공개 앵커 저장소의 GitHub Actions가 KST 18:17·20:47에 /api/cron/anchor 호출,
// 18시 전에는 부르지 않고 운영 호출구도 18시 전 요청은 앵커 없이 끝냄. 관리자 화면 버튼은 자동 실행이 실패한 날의 복구용).
//   1) 모든 에이전트(종료 포함)의 체인 길이·마지막 지문을 모은다
//   2) 직전 체크포인트와 대조: 길이가 줄었거나, 어제의 마지막 지문 자리에 다른 지문이 있으면 즉시 실패(과거가 바뀐 것)
//   3) 머클 루트 → 체크포인트 키 서명 → 루트에 TSA 토큰 → DB 저장
//   4) 문서(JSON)를 공개 앵커 저장소가 받아 커밋하고 OpenTimestamps로 비트코인에 고정한다(deploy/anchors-repo)
import "server-only";
import { type AnchorDocument, type AnchorLeaf, anchorMessage, computeAnchorRoot } from "@/core/anchor";
import { GENESIS_HASH, contentHashV2 } from "@/core/canonical";
import { isRealDate, kstToday } from "@/core/date";
import { toBase64 } from "@/core/encoding";
import { sortCheckpointLeaves } from "@/core/merkle";
import { importPublicKeyPem, signMessage, verifyMessage } from "@/core/signature";
import type { Db } from "../db";
import { loadKey, publicKeysFile } from "../keys";
import { SEAL_SELECT, type SealRow, rowToFields } from "../repo/signals";
import { InputError, isUniqueViolation, iso } from "../sql";
import { obtainTimestamps } from "../tsa-client";

export class AnchorConsistencyError extends Error {}

// KST 날짜 계산은 DB·서버 의존이 없는 core로 옮겼다(앵커 호출구 테스트가 이 모듈을 통째로 바꿔 끼워도 시각 규칙은 그대로 돌게).
// 예전 경로로 가져다 쓰는 곳(상태 점검 등)을 위해 같은 이름으로 다시 내보낸다.
export { kstToday };

export async function currentLeaves(db: Db): Promise<AnchorLeaf[]> {
  const rows = await db.query<{ agent_id: string; chain_length: number; head_hash: string }>(
    `SELECT a.id AS agent_id, COALESCE(h.sequence_no, 0) AS chain_length, COALESCE(h.content_hash, '${GENESIS_HASH}') AS head_hash
       FROM agents a
       LEFT JOIN LATERAL (SELECT sequence_no, content_hash FROM signals s WHERE s.agent_id = a.id ORDER BY sequence_no DESC LIMIT 1) h ON true`,
  );
  return sortCheckpointLeaves(rows.map((r) => ({ agentId: r.agent_id, chainLength: Number(r.chain_length), headHash: r.head_hash }))).map((l) => ({
    agent_id: l.agentId,
    chain_length: l.chainLength,
    head_hash: l.headHash,
  }));
}

/**
 * 모든 에이전트의 사슬을 1번부터 끝까지 걸으며 확인한다: 순번 연속, 직전 지문 연결, 저장된 원문으로 지문 재계산, 서명.
 * 머리 1건만 비교하면 중간 기록을 지우거나(순번 구멍) 바꿔치기해도(재해시·재서명·이후 prev_hash 열 수정) 앵커가 정상으로 만들어진다.
 * 서버에는 청산 전 원문도 있으므로 공개 전 기록까지 재계산할 수 있다.
 */
export async function assertChainsIntact(db: Db): Promise<void> {
  // 공개 여부 열이 없는 SEAL_SELECT를 쓴다: 매일 모든 기록을 읽으므로, 행마다 하위 질의를 돌리면 기록 수의 제곱으로 느려진다.
  const rows = await db.query<SealRow>(`${SEAL_SELECT} ORDER BY s.agent_id, s.sequence_no`);
  const keyFile = await publicKeysFile();
  const keys = new Map<string, CryptoKey>();
  let agent = "";
  let expect = 1;
  let prev = GENESIS_HASH;
  for (const r of rows) {
    if (r.agent_id !== agent) {
      agent = r.agent_id;
      expect = 1;
      prev = GENESIS_HASH;
    }
    const where = `에이전트 ${r.agent_id} 순번 ${r.sequence_no}`;
    if (r.sequence_no !== expect) throw new AnchorConsistencyError(`에이전트 ${r.agent_id}의 순번 ${expect}가 비어 있습니다(다음 기록 ${r.sequence_no}).`);
    if (r.prev_hash !== prev) throw new AnchorConsistencyError(`${where}: 직전 지문이 사슬과 다릅니다.`);
    if ((await contentHashV2(rowToFields(r))) !== r.content_hash) throw new AnchorConsistencyError(`${where}: 저장된 원문으로 다시 계산한 지문이 기록과 다릅니다.`);
    let pub = keys.get(r.key_id);
    if (!pub) {
      const k = keyFile.keys.find((e) => e.key_id === r.key_id && e.purpose === "signal");
      if (!k) throw new AnchorConsistencyError(`${where}: 공개키 목록에 없는 서명 키(${r.key_id})입니다.`);
      pub = await importPublicKeyPem(k.public_key_pem);
      keys.set(r.key_id, pub);
    }
    if (!(await verifyMessage(pub, r.content_hash, r.signature))) throw new AnchorConsistencyError(`${where}: 서명이 맞지 않습니다.`);
    prev = r.content_hash;
    expect++;
  }
}

/** 직전 체크포인트와 비교해 과거가 바뀌었는지 확인한다(03 §6.3 접두 일관성 검사). */
export async function assertConsistentWithPrevious(db: Db, date: string, leaves: AnchorLeaf[]): Promise<void> {
  const prev = await db.query<{ agent_id: string; chain_length: number; head_hash: string }>(
    `SELECT agent_id, chain_length, head_hash FROM chain_checkpoints
      WHERE checkpoint_date = (SELECT max(checkpoint_date) FROM chain_checkpoints WHERE checkpoint_date < $1::text::date)`,
    [date],
  );
  for (const p of prev) {
    const now = leaves.find((l) => l.agent_id === p.agent_id);
    if (!now) throw new AnchorConsistencyError(`에이전트 ${p.agent_id}가 체크포인트에서 사라졌습니다.`);
    if (now.chain_length < p.chain_length) throw new AnchorConsistencyError(`에이전트 ${p.agent_id}의 체인 길이가 ${p.chain_length} → ${now.chain_length}로 줄었습니다.`);
    if (p.chain_length > 0) {
      const at = await db.query<{ content_hash: string }>("SELECT content_hash FROM signals WHERE agent_id = $1 AND sequence_no = $2", [p.agent_id, p.chain_length]);
      if (at[0]?.content_hash !== p.head_hash) throw new AnchorConsistencyError(`에이전트 ${p.agent_id}의 순번 ${p.chain_length} 지문이 직전 체크포인트와 다릅니다(과거 변경).`);
    }
  }
}

export async function getAnchor(db: Db, date: string): Promise<AnchorDocument | null> {
  const rows = await db.query<{ document: AnchorDocument | string }>("SELECT document FROM anchor_records WHERE checkpoint_date = $1::text::date", [date]);
  if (!rows[0]) return null;
  const d = rows[0].document;
  return typeof d === "string" ? (JSON.parse(d) as AnchorDocument) : d;
}

export async function listAnchors(db: Db, limit = 30): Promise<{ date: string; merkle_root: string; leaf_count: number; created_at: string }[]> {
  return db.query(
    `SELECT to_char(checkpoint_date, 'YYYY-MM-DD') AS date, merkle_root, leaf_count, ${iso("created_at")} AS created_at
       FROM anchor_records ORDER BY checkpoint_date DESC LIMIT $1`,
    [limit],
  );
}

/** 모든 앵커의 날짜·루트·직전 루트(오래된 순). 공개 앵커 저장소가 매일 자기 사본과 대조한다. */
export async function listAnchorRoots(db: Db): Promise<{ date: string; merkle_root: string; prev_root: string | null }[]> {
  return db.query(
    `SELECT to_char(checkpoint_date, 'YYYY-MM-DD') AS date, merkle_root, prev_root FROM anchor_records ORDER BY checkpoint_date`,
  );
}

/**
 * 이 기록을 처음 담은 앵커(이 시그널이 처음 외부에 고정된 날).
 * 생성 시각으로 고르면 안 된다: 앵커는 체인 머리를 읽은 뒤 TSA 응답을 기다렸다가 생성 시각을 찍으므로,
 * 그 사이에 발행된 기록은 "발행보다 늦게 만들어졌지만 자신을 담지 않은" 앵커와 짝지어져 거짓 불일치(FAIL)가 난다.
 */
export async function getFirstAnchorContaining(db: Db, agentId: string, sequenceNo: number): Promise<AnchorDocument | null> {
  const rows = await db.query<{ document: AnchorDocument | string }>(
    `SELECT ar.document FROM chain_checkpoints cc JOIN anchor_records ar ON ar.checkpoint_date = cc.checkpoint_date
      WHERE cc.agent_id = $1 AND cc.chain_length >= $2 ORDER BY cc.checkpoint_date LIMIT 1`,
    [agentId, sequenceNo],
  );
  if (!rows[0]) return null;
  const d = rows[0].document;
  return typeof d === "string" ? (JSON.parse(d) as AnchorDocument) : d;
}

/**
 * 일일 앵커 생성. 날짜는 오늘(KST)만 받는다: 빠진 날을 나중에 채우면 이후 앵커의 prev_root 사슬이 깨지거나,
 * 실제보다 이른 날짜의 앵커에 기록이 담긴 것처럼 보이게 된다. (allowOtherDate는 테스트 전용)
 */
export async function buildDailyAnchor(
  db: Db,
  date = kstToday(),
  opts: { allowOtherDate?: boolean } = {},
): Promise<{ document: AnchorDocument; created: boolean; tsaErrors: string[] }> {
  if (!isRealDate(date)) throw new InputError(`앵커 날짜 형식이 올바르지 않습니다: ${date}`);
  if (!opts.allowOtherDate && date !== kstToday()) throw new InputError(`앵커는 오늘(KST ${kstToday()})만 만들 수 있습니다. 빠진 날은 채우지 않습니다.`);
  const existing = await getAnchor(db, date);
  if (existing) return { document: existing, created: false, tsaErrors: [] };
  const later = await db.query<{ d: string }>("SELECT to_char(checkpoint_date, 'YYYY-MM-DD') AS d FROM anchor_records WHERE checkpoint_date > $1::text::date LIMIT 1", [date]);
  if (later[0]) throw new AnchorConsistencyError(`이후 날짜(${later[0].d}) 앵커가 이미 있어 ${date} 앵커를 만들 수 없습니다.`);

  await assertChainsIntact(db);
  const leaves = await currentLeaves(db);
  await assertConsistentWithPrevious(db, date, leaves);
  const prevRow = await db.query<{ merkle_root: string }>("SELECT merkle_root FROM anchor_records WHERE checkpoint_date < $1::text::date ORDER BY checkpoint_date DESC LIMIT 1", [date]);
  const key = await loadKey("checkpoint");
  // 체크포인트 키가 직전 앵커와 다르면 멈춘다(잘못된 키로 만든 앵커는 지울 수 없고, 공개 저장소 검증이 매일 실패하게 된다).
  const lastKey = await db.query<{ checkpoint_key_id: string }>("SELECT checkpoint_key_id FROM anchor_records ORDER BY checkpoint_date DESC LIMIT 1");
  if (lastKey[0] && lastKey[0].checkpoint_key_id !== key.keyId) {
    throw new AnchorConsistencyError(`체크포인트 키(${key.keyId})가 직전 앵커의 키(${lastKey[0].checkpoint_key_id})와 다릅니다. 환경변수의 키를 확인하세요.`);
  }
  const head = { date, merkle_root: await computeAnchorRoot(leaves), prev_root: prevRow[0]?.merkle_root ?? null, leaf_count: leaves.length };
  const { tokens, errors } = await obtainTimestamps(head.merkle_root);
  const createdAt = (await db.query<{ now: string }>(`SELECT ${iso("date_trunc('milliseconds', clock_timestamp())")} AS now`))[0].now;
  const document: AnchorDocument = {
    version: "anchor-v1",
    ...head,
    leaves,
    checkpoint_key_id: key.keyId,
    root_signature: await signMessage(key.privateKey, anchorMessage(head)),
    created_at: createdAt,
    timestamps: tokens.map((tk) => ({ tsa: tk.tsa, token_b64: toBase64(tk.token), gen_time: tk.genTime.toISOString() })),
  };
  try {
    await db.tx(async (t) => {
      for (const l of leaves) {
        await t.query("INSERT INTO chain_checkpoints (checkpoint_date, agent_id, chain_length, head_hash) VALUES ($1::text::date, $2, $3, $4)", [date, l.agent_id, l.chain_length, l.head_hash]);
      }
      await t.query(
        `INSERT INTO anchor_records (checkpoint_date, merkle_root, leaf_count, prev_root, root_signature, checkpoint_key_id, document, created_at)
         VALUES ($1::text::date, $2, $3, $4, $5, $6, $7::text::jsonb, $8::timestamptz)`,
        [date, document.merkle_root, document.leaf_count, document.prev_root, document.root_signature, document.checkpoint_key_id, JSON.stringify(document), createdAt],
      );
    });
  } catch (e) {
    // 자동 실행과 관리자 버튼이 동시에 같은 날짜를 만들면 한쪽만 저장된다. 진 쪽은 저장된 앵커를 돌려준다.
    const saved = isUniqueViolation(e) ? await getAnchor(db, date) : null;
    if (saved) return { document: saved, created: false, tsaErrors: [] };
    throw e;
  }
  return { document, created: true, tsaErrors: errors };
}
