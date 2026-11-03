// 사이트가 TSA 응답을 저장하기 전 확인(server/tsa-client.ts). 검증 화면·CLI와 같은 verifyTimestampToken을 쓰므로
// 실제 기관 토큰은 받아들이고, 기관 오류 응답의 본문은 읽지 않은 채 남기지 않는다(명령줄 작업이 바로 끝나게).
import { readFileSync } from "node:fs";
import path from "node:path";
import * as asn1js from "asn1js";
import * as pkijs from "pkijs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { obtainTimestamps } from "@/server/tsa-client";

const dir = path.join(__dirname, "fixtures");
const digest = readFileSync(path.join(dir, "token-digest.txt"), "utf8").trim();

/** 고정 토큰(실제 DigiCert 응답에서 꺼낸 것)을 TimeStampResp(granted)로 다시 감싼다 */
function grantedResponse(tokenDer: Uint8Array): Uint8Array {
  const resp = new pkijs.TimeStampResp({
    status: new pkijs.PKIStatusInfo({ status: 0 }),
    timeStampToken: new pkijs.ContentInfo({ schema: asn1js.fromBER(tokenDer).result }),
  });
  return new Uint8Array(resp.toSchema().toBER(false));
}

const before = process.env.TSA_URLS;
afterEach(() => {
  process.env.TSA_URLS = before;
  vi.unstubAllGlobals();
});

describe("TSA 응답 받기(서버)", () => {
  it("실제 기관 토큰은 용도·사슬 확인을 통과해 저장 대상이 된다", async () => {
    process.env.TSA_URLS = "digicert=https://tsa.invalid/digicert";
    const der = new Uint8Array(readFileSync(path.join(dir, "digicert-token.der")));
    vi.stubGlobal("fetch", async () => new Response(Buffer.from(grantedResponse(der)), { status: 200 }));
    const r = await obtainTimestamps(digest, 5_000);
    expect(r.errors).toEqual([]);
    expect(r.tokens.map((t) => [t.tsa, t.genTime.toISOString()])).toEqual([["digicert", "2026-10-29T06:37:21.000Z"]]);
  });

  it("기관이 오류(HTTP 503)로 답하면 본문을 취소하고 실패로 남긴다(재시도 포함 두 번)", async () => {
    process.env.TSA_URLS = "freetsa=https://tsa.invalid/freetsa";
    let cancelled = 0;
    vi.stubGlobal("fetch", async () => new Response(new ReadableStream({ cancel: () => void cancelled++ }), { status: 503 }));
    const r = await obtainTimestamps(digest, 5_000);
    expect(r.tokens).toEqual([]);
    expect(r.errors).toEqual(["freetsa: HTTP 503"]);
    expect(cancelled).toBe(2);
  });
});
