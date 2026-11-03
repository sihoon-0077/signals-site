// 에이전트별 해시체인. 각 시그널은 직전 시그널의 지문(prev_hash)을 봉인 필드에 넣는다.
// 중간 시그널 하나를 지우거나 바꾸면 다음 시그널의 prev_hash와 맞지 않아 위치까지 드러난다.

import { GENESIS_HASH } from "./canonical";

export interface ChainLink {
  sequenceNo: number;
  prevHash: string;
  contentHash: string;
}

/** 처음 깨진 위치(1부터)를 돌려준다. 문제가 없으면 0. 순번이 1부터 빈틈없이 이어져야 한다. */
export function findChainBreak(links: ChainLink[]): number {
  let expectedPrev = GENESIS_HASH;
  for (let i = 0; i < links.length; i++) {
    const l = links[i];
    if (l.sequenceNo !== i + 1 || l.prevHash !== expectedPrev) return i + 1;
    expectedPrev = l.contentHash;
  }
  return 0;
}
