// 타임스탬프 기관(TSA)에 실제로 요청을 보낸다. 실패해도 발행을 되돌리지 않는다(진입 규칙이 다음 앵커로 대체).
import "server-only";
import { buildTimeStampRequest, extractTokenFromResponse, verifyTimestampToken } from "@/core/tsa";
import { type TsaEndpoint, tsaEndpoints } from "./config";

export interface ObtainedToken {
  tsa: string;
  token: Uint8Array;
  genTime: Date;
}

async function requestOne(ep: TsaEndpoint, digestHex: string, timeoutMs: number): Promise<ObtainedToken> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(ep.url, {
      method: "POST",
      headers: { "Content-Type": "application/timestamp-query" },
      body: buildTimeStampRequest(digestHex),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      // 읽지 않은 오류 본문은 연결을 붙잡아, 이 요청을 쓰는 명령줄 작업(anchor --local·seed-dev)이 출력 뒤에도 바로 끝나지 않는다
      await res.body?.cancel().catch(() => {});
      throw new Error(`HTTP ${res.status}`);
    }
    const token = extractTokenFromResponse(new Uint8Array(await res.arrayBuffer()));
    // 받은 토큰을 그대로 믿지 않고, 지문·서명·서명 인증서 용도(타임스탬프 전용)·기관 루트 연결을 바로 확인한 뒤 저장한다
    const v = await verifyTimestampToken(token, digestHex);
    if (!v.ok || !v.genTime) throw new Error(v.reason);
    return { tsa: ep.name, token, genTime: v.genTime };
  } finally {
    clearTimeout(timer);
  }
}

/** 한 번 실패하면 새 논스로 한 번 더 요청한다(일시 오류·기관의 요청 해석 오류 대비). */
async function requestWithRetry(ep: TsaEndpoint, digestHex: string, timeoutMs: number): Promise<ObtainedToken> {
  try {
    return await requestOne(ep, digestHex, timeoutMs);
  } catch {
    return requestOne(ep, digestHex, timeoutMs);
  }
}

/** 설정된 모든 TSA에 병렬로 요청해 성공한 토큰만 돌려준다. */
export async function obtainTimestamps(digestHex: string, timeoutMs = 10_000): Promise<{ tokens: ObtainedToken[]; errors: string[] }> {
  const eps = tsaEndpoints();
  const results = await Promise.allSettled(eps.map((ep) => requestWithRetry(ep, digestHex, timeoutMs)));
  const tokens: ObtainedToken[] = [];
  const errors: string[] = [];
  results.forEach((r, i) => {
    if (r.status === "fulfilled") tokens.push(r.value);
    else errors.push(`${eps[i].name}: ${(r.reason as Error).message}`);
  });
  return { tokens, errors };
}
