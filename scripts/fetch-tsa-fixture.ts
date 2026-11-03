// 테스트용 RFC 3161 토큰을 실제 TSA에서 받아 저장한다(네트워크 필요, 한 번만 실행).
// 발행 시각이 "지금"인 검증용 시그널을 만들고, 그 지문으로 토큰을 받는다.
// (토큰 시각은 발행 시각보다 늦어야 하므로, 미래 날짜인 골든 벡터 시그널은 쓸 수 없다.)
// 실행: npx tsx scripts/fetch-tsa-fixture.ts

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { GENESIS_HASH, type SignalFieldsV2, contentHashV2 } from "../src/core/canonical";
import { randomHex } from "../src/core/encoding";
import { buildTimeStampRequest, extractTokenFromResponse, parseTimestampToken } from "../src/core/tsa";

const TSAS = [
  { name: "freetsa", url: "https://freetsa.org/tsr" },
  { name: "digicert", url: "http://timestamp.digicert.com" },
];

async function main() {
  const fields: SignalFieldsV2 = {
    signalId: "3c2b1a09-8f7e-4d6c-9b5a-4f3e2d1c0b9a",
    agentId: "6f1c2a7e-3b4d-4e5f-8a9b-0c1d2e3f4a5b",
    sequenceNo: 1,
    market: "KOSPI",
    ticker: "005930",
    side: "LONG",
    action: "ENTRY",
    targetPrice: "78000",
    stopLossPrice: "71500.5",
    suggestedWeight: "0.1",
    maxHoldingDays: 10,
    validUntil: null,
    isPaper: true,
    entrySignalId: null,
    ruleVersion: "fixture-v1",
    nonce: randomHex(16),
    rationale: "테스트 고정 시그널",
    publishedAt: new Date(Date.now() - 1000).toISOString(),
    prevHash: GENESIS_HASH,
  };
  const digest = await contentHashV2(fields);
  const outDir = path.join(__dirname, "../src/core/__tests__/fixtures");
  mkdirSync(outDir, { recursive: true });
  for (const t of TSAS) {
    const res = await fetch(t.url, { method: "POST", headers: { "Content-Type": "application/timestamp-query" }, body: buildTimeStampRequest(digest) });
    if (!res.ok) throw new Error(`${t.name}: HTTP ${res.status}`);
    const token = extractTokenFromResponse(new Uint8Array(await res.arrayBuffer()));
    const info = parseTimestampToken(token);
    writeFileSync(path.join(outDir, `${t.name}-token.der`), token);
    console.log(`${t.name}: genTime=${info.genTime.toISOString()} digest=${info.digestHex === digest ? "match" : "MISMATCH"}`);
  }
  writeFileSync(path.join(outDir, "token-digest.txt"), digest + "\n");
  writeFileSync(path.join(outDir, "signal.json"), JSON.stringify(fields, null, 2) + "\n");
  console.log(`signal published_at=${fields.publishedAt} content_hash=${digest}`);
}

main().catch((e) => {
  console.error(e);
  // process.exit()를 부르지 않는다(scripts/verify.ts와 같은 이유: Windows Node 24에서 fetch 직후 process.exit()는 0xC0000409로 죽을 수 있음)
  process.exitCode = 1;
});
