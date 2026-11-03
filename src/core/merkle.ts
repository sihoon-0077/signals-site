// RFC 6962 머클 트리 (03 설계 §6.3). 하루치 체크포인트를 하나의 값(루트)으로 묶어 외부에 고정한다.
// 리프 해시 = SHA-256(0x00 ‖ 데이터), 내부 노드 = SHA-256(0x01 ‖ 왼쪽 ‖ 오른쪽).
// 0x00/0x01 접두사가 없으면 내부 노드를 리프로 위장하는 공격(2차 원상 공격)이 가능하다.
// 정답값은 Certificate Transparency 구현체들이 공유하는 테스트 벡터(__tests__/merkle.test.ts)다.

import { type Bytes, bytesEqual, concatBytes, sha256, utf8 } from "./encoding";

export async function leafHash(data: Bytes): Promise<Bytes> {
  return sha256(concatBytes(new Uint8Array([0]), data));
}

export async function nodeHash(left: Bytes, right: Bytes): Promise<Bytes> {
  return sha256(concatBytes(new Uint8Array([1]), left, right));
}

/** n보다 작은 가장 큰 2의 거듭제곱 (RFC 6962 분할 지점). */
function split(n: number): number {
  let k = 1;
  while (k << 1 < n) k <<= 1;
  return k;
}

/** Merkle Tree Hash. 빈 트리는 SHA-256(""). */
export async function merkleRoot(leaves: Bytes[]): Promise<Bytes> {
  const n = leaves.length;
  if (n === 0) return sha256(new Uint8Array(0));
  if (n === 1) return leafHash(leaves[0]);
  const k = split(n);
  return nodeHash(await merkleRoot(leaves.slice(0, k)), await merkleRoot(leaves.slice(k)));
}

/** m번째 리프의 포함 증명(감사 경로). */
export async function inclusionProof(m: number, leaves: Bytes[]): Promise<Bytes[]> {
  const n = leaves.length;
  if (n <= 1) return [];
  const k = split(n);
  if (m < k) return [...(await inclusionProof(m, leaves.slice(0, k))), await merkleRoot(leaves.slice(k))];
  return [...(await inclusionProof(m - k, leaves.slice(k))), await merkleRoot(leaves.slice(0, k))];
}

/** RFC 9162 §2.1.3.2 포함 증명 검증. */
export async function verifyInclusion(index: number, size: number, leaf: Bytes, proof: Bytes[], root: Bytes): Promise<boolean> {
  if (index >= size) return false;
  let fn = index;
  let sn = size - 1;
  let r = leaf;
  for (const p of proof) {
    if (sn === 0) return false;
    if (fn & 1 || fn === sn) {
      r = await nodeHash(p, r);
      if (!(fn & 1)) {
        while (!(fn & 1) && fn !== 0) {
          fn >>= 1;
          sn >>= 1;
        }
      }
    } else {
      r = await nodeHash(r, p);
    }
    fn >>= 1;
    sn >>= 1;
  }
  return sn === 0 && bytesEqual(r, root);
}

/** 체크포인트 리프 데이터: "agent_id|chain_length|head_hash". 종료된 에이전트도 포함한다. */
export interface CheckpointLeaf {
  agentId: string;
  chainLength: number;
  headHash: string;
}

export function checkpointLeafData(l: CheckpointLeaf): Bytes {
  return utf8(`${l.agentId.toLowerCase()}|${l.chainLength}|${l.headHash}`);
}

/** 리프를 agent_id 오름차순으로 정렬한다(누가 계산해도 같은 루트가 나오도록). */
export function sortCheckpointLeaves(leaves: CheckpointLeaf[]): CheckpointLeaf[] {
  return [...leaves].sort((a, b) => (a.agentId.toLowerCase() < b.agentId.toLowerCase() ? -1 : a.agentId.toLowerCase() > b.agentId.toLowerCase() ? 1 : 0));
}
