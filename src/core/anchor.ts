// 일일 앵커 문서 (03 설계 §4.3, §6.3). 매일 모든 에이전트(종료 포함)의 체인 길이와 마지막 지문을
// 머클 루트 하나로 묶어 서명하고, 루트를 TSA·OpenTimestamps(비트코인)·GitHub 공개 저장소에 남긴다.
// 문서 자체에 리프 전체가 들어 있으므로 누구나 루트를 다시 계산할 수 있다.

import { toHex } from "./encoding";
import { type KeysFile, findKey } from "./keys";
import { type CheckpointLeaf, checkpointLeafData, merkleRoot, sortCheckpointLeaves } from "./merkle";
import { importPublicKeyPem, publicKeyFingerprint, verifyMessage } from "./signature";

export interface AnchorLeaf {
  agent_id: string;
  chain_length: number;
  head_hash: string;
}

export interface AnchorTimestamp {
  tsa: string;
  token_b64: string;
  gen_time: string;
}

export interface AnchorDocument {
  version: "anchor-v1";
  /** KST 기준 날짜 YYYY-MM-DD */
  date: string;
  merkle_root: string;
  /** 어제 루트(루트끼리도 사슬로 연결) */
  prev_root: string | null;
  leaf_count: number;
  leaves: AnchorLeaf[];
  checkpoint_key_id: string;
  /** anchorMessage()에 대한 체크포인트 키 서명(DER base64) */
  root_signature: string;
  created_at: string;
  /** 루트에 대한 RFC 3161 토큰 */
  timestamps: AnchorTimestamp[];
}

export function toCheckpointLeaves(leaves: AnchorLeaf[]): CheckpointLeaf[] {
  return leaves.map((l) => ({ agentId: l.agent_id, chainLength: l.chain_length, headHash: l.head_hash }));
}

export async function computeAnchorRoot(leaves: AnchorLeaf[]): Promise<string> {
  const sorted = sortCheckpointLeaves(toCheckpointLeaves(leaves));
  return toHex(await merkleRoot(sorted.map(checkpointLeafData)));
}

/** 체크포인트 키가 서명하는 메시지. */
export function anchorMessage(d: Pick<AnchorDocument, "date" | "merkle_root" | "prev_root" | "leaf_count">): string {
  return `anchor-v1|${d.date}|${d.merkle_root}|${d.prev_root ?? ""}|${d.leaf_count}`;
}

export interface AnchorVerification {
  rootMatches: boolean;
  signatureValid: boolean;
  sorted: boolean;
}

export async function verifyAnchorDocument(doc: AnchorDocument, keys: KeysFile): Promise<AnchorVerification> {
  const root = await computeAnchorRoot(doc.leaves);
  // 엄격 증가 = 정렬 + 중복 없음. 같은 에이전트 리프가 두 번 들어가면 한쪽에 줄어든 길이를 숨길 수 있다.
  const ids = doc.leaves.map((l) => l.agent_id.toLowerCase());
  const sorted = ids.every((id, i) => i === 0 || ids[i - 1] < id);
  const key = findKey(keys, doc.checkpoint_key_id, "checkpoint", doc.created_at);
  let signatureValid = false;
  if (key && (await publicKeyFingerprint(key.public_key_pem)) === key.fingerprint) {
    signatureValid = await verifyMessage(await importPublicKeyPem(key.public_key_pem), anchorMessage(doc), doc.root_signature);
  }
  return { rootMatches: root === doc.merkle_root && doc.leaf_count === doc.leaves.length, signatureValid, sorted };
}
