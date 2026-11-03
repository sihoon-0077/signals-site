// 사이트가 오래된 기록을 앵커 없이 보내면 앵커 대조가 '해당 없음'(종합 PARTIAL, CLI exit 0)으로 끝나지 않아야 한다(S09).
// 앵커를 빼고 보내는 것은 검증 대상인 사이트가 고를 수 있는 길이다: 두 방향을 봉인해 두고 앵커에 넣은 쪽과 다른 기록을 보여 주거나,
// 나중에 만든 기록을 앵커 없이 보여 주면 앵커 대조가 통째로 빠진다.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { type SignalFieldsV2, contentHashV2 } from "../canonical";
import { toBase64 } from "../encoding";
import type { KeysFile } from "../keys";
import { exportPublicKeyPem, generateSigningKeyPair, publicKeyFingerprint, signMessage } from "../signature";
import { parseTimestampToken } from "../tsa";
import { type MirrorSnapshot, type SignalBundle, overallStatus, verifyAgainstMirror, verifySignalBundle } from "../verify";

const dir = path.join(__dirname, "fixtures");
const LONG: SignalFieldsV2 = JSON.parse(readFileSync(path.join(dir, "signal.json"), "utf8")); // 발행 2026-10-29 KST
const tok = (n: string) => new Uint8Array(readFileSync(path.join(dir, `${n}-token.der`)));

async function bundleOf(f: SignalFieldsV2, opts: { revealed: boolean; tokens: boolean }): Promise<SignalBundle> {
  const sig = await generateSigningKeyPair();
  const pem = await exportPublicKeyPem(sig.publicKey);
  const keys: KeysFile = {
    version: 1,
    keys: [{ key_id: "sig-test", purpose: "signal", algorithm: "ECDSA-P256-SHA256", public_key_pem: pem, fingerprint: await publicKeyFingerprint(pem), created_at: "2026-01-01T00:00:00.000Z", retired_at: null }],
  };
  const h = await contentHashV2(f);
  return {
    signal: { id: f.signalId, agent_id: f.agentId, sequence_no: 1, canonical_version: 2, published_at: f.publishedAt, content_hash: h, prev_hash: f.prevHash, signature: await signMessage(sig.privateKey, h), key_id: "sig-test", revealed: opts.revealed, fields: opts.revealed ? f : null },
    previous: null,
    timestamps: opts.tokens ? ["freetsa", "digicert"].map((n) => ({ tsa: n, token_b64: toBase64(tok(n)), gen_time: parseTimestampToken(tok(n)).genTime.toISOString() })) : [],
    anchor: null,
    keys,
  };
}
const mirrorOf = (b: SignalBundle): MirrorSnapshot => ({ source: "https://github.com/o/r", keys: structuredClone(b.keys), anchor: null });
const at = (b: SignalBundle, iso: string) => verifyAgainstMirror(b, mirrorOf(b), new Date(iso)).find((r) => r.id === "mirror_anchor")!;

describe("사이트가 앵커를 빼고 보낼 때", () => {
  it("발행 후 이틀(KST)까지는 '해당 없음', 그 뒤에는 '확인 못 함'(종합 UNCHECKED → CLI exit 2)", async () => {
    const b = await bundleOf(LONG, { revealed: true, tokens: true });
    expect(at(b, "2026-10-29T12:00:00Z").status).toBe("SKIP");
    expect(at(b, "2026-10-28T15:00:00Z").status).toBe("SKIP"); // 이 기기 시계가 하루 늦어도(10-29 00:00 KST)
    expect(at(b, "2026-10-31T14:59:59Z").status).toBe("SKIP"); // 10-31 23:59 KST
    const late = at(b, "2026-10-31T15:00:00Z"); // 11-01 00:00 KST
    expect(late.status).toBe("UNCHECKED");
    expect(late.detail).toContain("사이트가 이 기록(2026-10-29, KST)을 담은 일일 앵커를 보내지 않았습니다");
    expect(late.detail).toContain("https://github.com/o/r의 anchors/");
    // 사이트가 준 문자열(에이전트 ID 등)은 옮기지 않는다
    expect(late.detail).not.toContain(LONG.agentId);
    const later = [...(await verifySignalBundle(b)), ...verifyAgainstMirror(b, mirrorOf(b), new Date("2026-12-15T00:00:00Z"))];
    expect(overallStatus(later)).toBe("UNCHECKED");
  });

  it("되짚어 만든 기록(발행 2026-09-01, 토큰 없음)은 통과로 끝나지 않는다", async () => {
    const fab: SignalFieldsV2 = { ...LONG, signalId: "11111111-2222-4333-8444-555555555555", side: "SHORT", publishedAt: "2026-09-01T00:10:00.000Z" };
    const b = await bundleOf(fab, { revealed: true, tokens: false });
    const rs = [...(await verifySignalBundle(b)), ...verifyAgainstMirror(b, mirrorOf(b), new Date("2026-10-30T03:00:00Z"))];
    expect(rs.find((r) => r.id === "mirror_anchor")?.status).toBe("UNCHECKED");
    expect(overallStatus(rs)).toBe("UNCHECKED");
  });

  it("원문 공개 전 발행 시각을 늦춰 적어도 토큰 시각(10-29)으로 날짜를 본다", async () => {
    const b = await bundleOf(LONG, { revealed: false, tokens: true });
    b.signal.published_at = "2026-12-14T23:00:00.000Z";
    expect(at(b, "2026-12-15T00:00:00Z").status).toBe("UNCHECKED");
  });

  it("발행 시각이 먼 미래이거나 날짜로 읽히지 않으면 '해당 없음'으로 넘어가지 않는다", async () => {
    const future = await bundleOf({ ...LONG, publishedAt: "2099-01-01T00:00:00.000Z" }, { revealed: true, tokens: false });
    expect(at(future, "2026-12-15T00:00:00Z").status).toBe("UNCHECKED");
    for (const published_at of ["garbage", "+275760-09-13T00:00:00.000Z"]) {
      const b = await bundleOf(LONG, { revealed: false, tokens: false });
      b.signal.published_at = published_at;
      const r = at(b, "2026-11-03T03:00:00Z");
      expect([r.status, r.detail.includes("이 기록(날짜 불명, KST)")], published_at).toEqual(["UNCHECKED", true]);
    }
  });

  it("공개 저장소 주소가 없을 때는 그대로(공개키 대조가 이미 '확인 못 함')", async () => {
    const b = await bundleOf(LONG, { revealed: true, tokens: true });
    const rs = verifyAgainstMirror(b, null, new Date("2026-12-15T00:00:00Z"));
    expect(rs.map((r) => `${r.id}:${r.status}`)).toEqual(["mirror_keys:UNCHECKED", "mirror_anchor:SKIP"]);
  });
});
