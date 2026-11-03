import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { type AnchorDocument, anchorMessage, computeAnchorRoot } from "../anchor";
import { type SignalFieldsV2, contentHashV2 } from "../canonical";
import { toBase64 } from "../encoding";
import type { KeysFile } from "../keys";
import { exportPublicKeyPem, generateSigningKeyPair, publicKeyFingerprint, signMessage } from "../signature";
import { parseTimestampToken } from "../tsa";
import {
  type CheckResult,
  type CheckStatus,
  type MirrorSnapshot,
  type SignalBundle,
  fetchMirror,
  isSignalKey,
  mirrorRawBase,
  overallStatus,
  verifyAgainstMirror,
  verifySignalBundle,
} from "../verify";

const dir = path.join(__dirname, "fixtures");
const fields: SignalFieldsV2 = JSON.parse(readFileSync(path.join(dir, "signal.json"), "utf8"));
const tokenB64 = (n: string) => toBase64(new Uint8Array(readFileSync(path.join(dir, `${n}-token.der`))));

async function makeBundle(opts: { revealed: boolean }) {
  const sig = await generateSigningKeyPair();
  const cp = await generateSigningKeyPair();
  const sigPem = await exportPublicKeyPem(sig.publicKey);
  const cpPem = await exportPublicKeyPem(cp.publicKey);
  const created = "2026-01-01T00:00:00.000Z";
  const keys: KeysFile = {
    version: 1,
    keys: [
      { key_id: "sig-test", purpose: "signal", algorithm: "ECDSA-P256-SHA256", public_key_pem: sigPem, fingerprint: await publicKeyFingerprint(sigPem), created_at: created, retired_at: null },
      { key_id: "cp-test", purpose: "checkpoint", algorithm: "ECDSA-P256-SHA256", public_key_pem: cpPem, fingerprint: await publicKeyFingerprint(cpPem), created_at: created, retired_at: null },
    ],
  };
  const contentHash = await contentHashV2(fields);
  const leaves = [
    { agent_id: fields.agentId, chain_length: 1, head_hash: contentHash },
    { agent_id: "00000000-0000-4000-8000-000000000001", chain_length: 3, head_hash: "a".repeat(64) },
  ].sort((a, b) => (a.agent_id < b.agent_id ? -1 : 1));
  const root = await computeAnchorRoot(leaves);
  const date = new Date(Date.parse(fields.publishedAt) + 9 * 3600e3).toISOString().slice(0, 10);
  const head = { date, merkle_root: root, prev_root: null, leaf_count: leaves.length };
  const anchor: AnchorDocument = {
    version: "anchor-v1",
    ...head,
    leaves,
    checkpoint_key_id: "cp-test",
    root_signature: await signMessage(cp.privateKey, anchorMessage(head)),
    created_at: new Date(Date.parse(fields.publishedAt) + 3600e3).toISOString(),
    timestamps: [],
  };
  const bundle: SignalBundle = {
    signal: {
      id: fields.signalId,
      agent_id: fields.agentId,
      sequence_no: 1,
      canonical_version: 2,
      published_at: fields.publishedAt,
      content_hash: contentHash,
      prev_hash: fields.prevHash,
      signature: await signMessage(sig.privateKey, contentHash),
      key_id: "sig-test",
      revealed: opts.revealed,
      fields: opts.revealed ? fields : null,
    },
    previous: null,
    timestamps: ["freetsa", "digicert"].map((n) => ({ tsa: n, token_b64: tokenB64(n), gen_time: parseTimestampToken(new Uint8Array(readFileSync(path.join(dir, `${n}-token.der`)))).genTime.toISOString() })),
    anchor,
    keys,
  };
  return bundle;
}

describe("공개 자료만으로 시그널 검증", () => {
  it("공개된 시그널: 6개 항목 모두 PASS", async () => {
    const results = await verifySignalBundle(await makeBundle({ revealed: true }));
    expect(results.map((r) => [r.id, r.status])).toEqual([
      ["hash", "PASS"],
      ["signature", "PASS"],
      ["chain", "PASS"],
      ["timestamp", "PASS"],
      ["anchor", "PASS"],
      ["entry", "PASS"],
    ]);
    expect(overallStatus(results)).toBe("PASS");
  });

  it("청산 전(원문 비공개): 해시 재계산과 사슬 확정은 SKIP, 서명·시각·앵커·진입은 지문만으로 PASS", async () => {
    const results = await verifySignalBundle(await makeBundle({ revealed: false }));
    expect(results.filter((r) => r.status === "SKIP").map((r) => r.id)).toEqual(["hash", "chain"]);
    expect(results.filter((r) => r.id !== "hash" && r.id !== "chain").every((r) => r.status === "PASS")).toBe(true);
    expect(overallStatus(results)).toBe("PARTIAL");
  });

  it("결과를 보고 방향을 바꾸면(LONG→SHORT) 해시 재계산이 FAIL", async () => {
    const b = await makeBundle({ revealed: true });
    b.signal.fields = { ...fields, side: "SHORT" };
    const results = await verifySignalBundle(b);
    expect(results.find((r) => r.id === "hash")?.status).toBe("FAIL");
    expect(overallStatus(results)).toBe("FAIL");
  });

  it("지문 자체를 바꿔치기하면 서명·타임스탬프·앵커가 FAIL", async () => {
    const b = await makeBundle({ revealed: false });
    b.signal.content_hash = "b".repeat(64);
    const results = await verifySignalBundle(b);
    for (const id of ["signature", "timestamp", "anchor"]) expect(results.find((r) => r.id === id)?.status).toBe("FAIL");
  });

  it("앵커의 리프를 지우면(망한 에이전트 삭제) 루트가 맞지 않아 FAIL", async () => {
    const b = await makeBundle({ revealed: true });
    b.anchor = { ...b.anchor!, leaves: b.anchor!.leaves.filter((l) => l.agent_id === fields.agentId), leaf_count: 1 };
    expect((await verifySignalBundle(b)).find((r) => r.id === "anchor")?.status).toBe("FAIL");
  });

  it("공개키 목록에 없는 키로 서명했으면 FAIL", async () => {
    const b = await makeBundle({ revealed: true });
    b.signal.key_id = "unknown";
    expect((await verifySignalBundle(b)).find((r) => r.id === "signature")?.status).toBe("FAIL");
  });

  // 사슬 연결 PASS 문장은 '원문 재계산으로 확인했다'고 말한다. 재계산이 실제로 통과했을 때만 그렇게 적는다(S31).
  it("'공개'라면서 원문이 없거나 원문 재계산이 맞지 않으면 사슬 연결을 PASS로 적지 않는다", async () => {
    const noFields = await makeBundle({ revealed: true });
    noFields.signal.fields = null;
    const a = await verifySignalBundle(noFields);
    expect(a.find((r) => r.id === "hash")?.status).toBe("SKIP");
    expect(a.find((r) => r.id === "chain")).toMatchObject({ status: "SKIP", detail: "이 에이전트의 첫 기록입니다(값 대조). 원문 공개 전이라 이 연결이 원문에 묶였는지는 공개 후 확정됩니다." });

    const flipped = await makeBundle({ revealed: true });
    flipped.signal.fields = { ...fields, side: "SHORT" };
    const f = await verifySignalBundle(flipped);
    expect(f.find((r) => r.id === "hash")?.status).toBe("FAIL");
    expect(f.find((r) => r.id === "chain")).toMatchObject({ status: "SKIP", detail: "이 에이전트의 첫 기록입니다(값 대조). 원문 재계산이 맞지 않아 이 연결이 원문에 묶였는지 확인하지 못했습니다." });
    expect(overallStatus(f)).toBe("FAIL");

    // 정직한 공개 기록은 그대로 PASS
    const ok = (await verifySignalBundle(await makeBundle({ revealed: true }))).find((r) => r.id === "chain")!;
    expect([ok.status, ok.detail]).toEqual(["PASS", "이 에이전트의 첫 기록입니다. 원문 재계산으로 이 연결이 지문에 묶여 있음을 확인했습니다."]);
  });
});

describe("진입 기준 시각(가격 검증이 아님)", () => {
  const entryOf = async (b: SignalBundle) => (await verifySignalBundle(b)).find((r) => r.id === "entry")!;

  it("가격을 확인했다고 쓰지 않고, 나중에 쓸 진입 기준 시점만 보여 준다", async () => {
    const e = await entryOf(await makeBundle({ revealed: true }));
    expect(e.status).toBe("PASS");
    expect(e.label).toBe("진입 기준 시각(타임스탬프 이후)");
    // 고정 토큰 시각은 10-29 15:37 KST(15:10 이후) → 다음 거래일 시가
    expect(e.detail).toMatch(/^나중에 성과를 계산할 때 쓸 진입 기준: 2026-10-30 시가\(/);
    expect(e.detail).toContain("수익률은 시세 데이터 이용계약 전이라 아직 표시하지 않습니다");
    expect(`${e.label} ${e.detail}`).not.toMatch(/진입가가|확인합니다/);
  });

  it("청산 전(원문 비공개)에는 진입·청산을 알 수 없으므로 '진입 시그널이면'으로 한정한다", async () => {
    expect((await entryOf(await makeBundle({ revealed: false }))).detail).toMatch(/^진입 시그널이면 나중에 성과를/);
  });

  it("청산(EXIT) 시그널에는 진입 기준을 정하지 않는다", async () => {
    const b = await makeBundle({ revealed: true });
    b.signal.fields = { ...fields, action: "EXIT" };
    const e = await entryOf(b);
    expect([e.status, e.detail]).toEqual(["SKIP", "청산 시그널이라 진입 기준을 정하지 않습니다."]);
  });
});

describe("공개 저장소(GitHub) 사본과 대조", () => {
  const mirrorOf = (b: SignalBundle): MirrorSnapshot => ({ source: "https://github.com/o/r", keys: structuredClone(b.keys), anchor: structuredClone(b.anchor) });
  const statusOf = (rs: { id: string; status: string }[]) => rs.map((r) => `${r.id}:${r.status}`);

  it("사이트가 준 공개키·앵커가 저장소 사본과 같으면 둘 다 PASS", async () => {
    const b = await makeBundle({ revealed: true });
    expect(statusOf(verifyAgainstMirror(b, mirrorOf(b)))).toEqual(["mirror_keys:PASS", "mirror_anchor:PASS"]);
  });

  it("사이트가 새 키로 다시 서명한 가짜 묶음: 묶음 안에서는 서명이 PASS여도 저장소 대조에서 FAIL", async () => {
    const real = await makeBundle({ revealed: true });
    const fake = await makeBundle({ revealed: true }); // 같은 원문을 다른 키로 서명(사이트가 키를 바꿔치기한 상황)
    expect((await verifySignalBundle(fake)).find((r) => r.id === "signature")?.status).toBe("PASS");
    expect(statusOf(verifyAgainstMirror(fake, mirrorOf(real)))).toEqual(["mirror_keys:FAIL", "mirror_anchor:FAIL"]);
  });

  it("서명만 다른 앵커 사본이면 어느 항목이 다른지 적는다", async () => {
    const b = await makeBundle({ revealed: true });
    const m = mirrorOf(b);
    m.anchor = { ...m.anchor!, root_signature: "MEUCIQ" + "A".repeat(60) };
    const r = verifyAgainstMirror(b, m).find((x) => x.id === "mirror_anchor")!;
    expect(r.status).toBe("FAIL");
    expect(r.detail).toContain("다른 항목: root_signature");
  });

  // 앵커 날짜는 2026-10-29(KST). 저장소에는 보통 그날 18시 무렵 올라가고, 하루 늦어져도 다음 실행이 채운다.
  it("저장소에 아직 앵커가 없으면 그날·다음 날까지는 '반영 대기', 그 뒤에는 '확인 못 함'(불일치로 만들지는 않음)", async () => {
    const b = await makeBundle({ revealed: true });
    const m = { ...mirrorOf(b), anchor: null };
    expect(statusOf(verifyAgainstMirror(b, m, new Date("2026-10-29T12:00:00Z")))).toEqual(["mirror_keys:PASS", "mirror_anchor:PENDING"]);
    expect(statusOf(verifyAgainstMirror(b, m, new Date("2026-10-30T14:59:59Z")))).toEqual(["mirror_keys:PASS", "mirror_anchor:PENDING"]); // 10-30 23:59 KST
    const late = verifyAgainstMirror(b, m, new Date("2026-10-30T15:00:00Z")); // 10-31 00:00 KST
    expect(statusOf(late)).toEqual(["mirror_keys:PASS", "mirror_anchor:UNCHECKED"]);
    expect(late[1].detail).toContain("Actions 기록");
    expect(overallStatus([...(await verifySignalBundle(b)), ...verifyAgainstMirror(b, m, new Date("2026-10-29T12:00:00Z"))])).toBe("PARTIAL");
  });

  it("저장소 주소가 없거나 받지 못하면 조용히 넘기지 않고 '확인 못 함'으로 드러낸다(종합도 UNCHECKED)", async () => {
    const b = await makeBundle({ revealed: true });
    const none = verifyAgainstMirror(b, null);
    expect(statusOf(none)).toEqual(["mirror_keys:UNCHECKED", "mirror_anchor:UNCHECKED"]);
    expect(none[0].detail).toContain("키를 바꿔 다시 서명한 기록이 아닌지 확인되지 않은");
    expect(overallStatus([...(await verifySignalBundle(b)), ...none])).toBe("UNCHECKED");

    const down = verifyAgainstMirror(b, { source: "https://github.com/o/r", keys: null, anchor: null, keysError: "HTTP 404" });
    expect(statusOf(down)).toEqual(["mirror_keys:UNCHECKED", "mirror_anchor:UNCHECKED"]);
    expect(down[0].detail).toContain("(HTTP 404)");

    const flaky = verifyAgainstMirror(b, { ...mirrorOf(b), anchor: null, anchorError: "HTTP 503" }, new Date("2026-10-29T12:00:00Z"));
    expect(statusOf(flaky)).toEqual(["mirror_keys:PASS", "mirror_anchor:UNCHECKED"]);

    // 이 기록을 담은 앵커가 아직 없으면 앵커 대조는 할 것이 없다(SKIP)
    const noAnchor = { ...b, anchor: null };
    expect(statusOf(verifyAgainstMirror(noAnchor, null))).toEqual(["mirror_keys:UNCHECKED", "mirror_anchor:SKIP"]);
  });

  it("불일치가 있으면 '확인 못 함'보다 불일치(FAIL)가 종합 결과다", () => {
    const r = (status: CheckStatus): CheckResult => ({ id: "hash", label: "", detail: "", status });
    expect(overallStatus([r("PASS"), r("UNCHECKED"), r("FAIL")])).toBe("FAIL");
    expect(overallStatus([r("PASS"), r("UNCHECKED"), r("SKIP")])).toBe("UNCHECKED");
    expect(overallStatus([r("PASS"), r("PENDING")])).toBe("PARTIAL");
    expect(overallStatus([r("PASS"), r("PASS")])).toBe("PASS");
  });

  it("저장소 주소·브랜치를 raw 주소로 바꾼다(기본 main, 형식이 다르면 null)", () => {
    expect(mirrorRawBase("https://github.com/acme/signals-anchors")).toBe("https://raw.githubusercontent.com/acme/signals-anchors/main");
    expect(mirrorRawBase("https://github.com/acme/signals-anchors.git/")).toBe("https://raw.githubusercontent.com/acme/signals-anchors/main");
    expect(mirrorRawBase("https://github.com/acme/signals-anchors", "master")).toBe("https://raw.githubusercontent.com/acme/signals-anchors/master");
    expect(mirrorRawBase("https://evil.example.com/acme/x")).toBeNull();
    expect(mirrorRawBase("https://github.com/acme/signals-anchors/tree/main")).toBeNull();
    for (const bad of ["../x", "a/../b", ".hidden", "has space", ""]) expect(mirrorRawBase("https://github.com/acme/r", bad), bad).toBeNull();
  });

  // 계정·저장소 자리의 '.'·'..'은 fetch가 경로에서 접어 다른 저장소를 받게 하면서, 결과 문장에는 입력한(공식) 주소가 찍힌다(S28)
  it("계정·저장소 이름이 '.'·'..'이면 받지 않는다('.github' 같은 정상 이름은 받음)", async () => {
    const cases = [
      ["https://github.com/sihoon-0077/..", "attacker/fake-anchors/main"],
      ["https://github.com/sihoon-0077/...git", "attacker/fake-anchors/main"],
      ["https://github.com/sihoon-0077/../", "attacker/fake-anchors/main"],
      ["https://github.com/../attacker", "fake-anchors/main"],
      ["https://github.com/./acme", "r/main"],
      ["https://github.com/acme/.", "main"],
      ["https://github.com/acme/..git", "main"],
    ] as const;
    for (const [u, br] of cases) expect(mirrorRawBase(u, br), u).toBeNull();
    expect(mirrorRawBase("https://github.com/acme/.github")).toBe("https://raw.githubusercontent.com/acme/.github/main");
    expect(mirrorRawBase("https://github.com/acme/signals.anchors")).toBe("https://raw.githubusercontent.com/acme/signals.anchors/main");

    const seen: string[] = [];
    const m = await fetchMirror("https://github.com/sihoon-0077/..", "2026-10-29", {
      branch: "attacker/fake-anchors/main",
      fetchFn: (async (url: string) => {
        seen.push(url);
        return new Response("{}");
      }) as unknown as typeof fetch,
    });
    expect(seen).toEqual([]);
    expect(m.keysError).toContain("형식");
  });

  it("받은 결과와 받지 못한 이유를 함께 돌려준다(앵커 404는 오류가 아니라 반영 대기)", async () => {
    const seen: string[] = [];
    const fakeFetch = (routes: Record<string, number | string | Error>) =>
      (async (url: string) => {
        seen.push(url);
        const hit = Object.entries(routes).find(([suffix]) => url.endsWith(suffix))?.[1] ?? 404;
        if (hit instanceof Error) throw hit;
        return typeof hit === "number" ? new Response("x", { status: hit }) : new Response(hit, { status: 200 });
      }) as unknown as typeof fetch;
    const repo = "https://github.com/acme/signals-anchors";
    const keysJson = JSON.stringify({ version: 1, keys: [] });

    const m = await fetchMirror(repo, "2026-11-02", { fetchFn: fakeFetch({ "keys.json": keysJson }) });
    expect(m).toEqual({ source: repo, keys: { version: 1, keys: [] }, anchor: null });
    expect(seen).toEqual(["https://raw.githubusercontent.com/acme/signals-anchors/main/keys.json", "https://raw.githubusercontent.com/acme/signals-anchors/main/anchors/2026-11-02.json"]);

    seen.length = 0;
    await fetchMirror(repo, null, { branch: "master", fetchFn: fakeFetch({ "keys.json": keysJson }) });
    expect(seen).toEqual(["https://raw.githubusercontent.com/acme/signals-anchors/master/keys.json"]);

    expect(await fetchMirror(repo, "2026-11-02", { fetchFn: fakeFetch({}) })).toMatchObject({ keys: null, keysError: "HTTP 404", anchor: null });
    expect((await fetchMirror(repo, "2026-11-02", { fetchFn: fakeFetch({}) })).anchorError).toBeUndefined();
    expect(await fetchMirror(repo, "2026-11-02", { fetchFn: fakeFetch({ "keys.json": keysJson, "2026-11-02.json": 503 }) })).toMatchObject({ anchorError: "HTTP 503" });
    expect(await fetchMirror(repo, null, { fetchFn: fakeFetch({ "keys.json": new TypeError("fetch failed") }) })).toMatchObject({ keysError: "네트워크 오류" });
    expect(await fetchMirror(repo, null, { fetchFn: fakeFetch({ "keys.json": '{"keys":[{"key_id":1}]}' }) })).toMatchObject({ keys: null, keysError: "파일 형식이 다름" });
    expect(await fetchMirror(repo, null, { fetchFn: fakeFetch({ "keys.json": "<html>" }) })).toMatchObject({ keys: null, keysError: "파일 형식이 다름" });

    seen.length = 0;
    const bad = await fetchMirror("https://github.com/acme/r/tree/main", "2026-11-02", { fetchFn: fakeFetch({}) });
    expect(seen).toEqual([]); // 형식이 틀린 주소로는 요청하지 않는다
    expect(bad.keysError).toContain("형식");
    expect(statusOf(verifyAgainstMirror(await makeBundle({ revealed: true }), bad))).toEqual(["mirror_keys:UNCHECKED", "mirror_anchor:UNCHECKED"]);
  });

  // 명령줄 검증기는 process.exit() 대신 exitCode로 끝난다. 그래서 읽지 않은 오류 본문이나 응답을 멈춘 서버가 있으면
  // 결과를 찍은 뒤에도 끝나지 않았다(S27). 요청마다 시간 제한을 걸고, 오류 응답의 본문은 바로 취소한다.
  it("저장소 요청마다 시간 제한을 걸고, 오류 응답 본문은 취소하며, 시간 초과는 '파일 형식'이 아니라 시간 초과로 적는다", async () => {
    const signals: unknown[] = [];
    let cancelled = 0;
    const repo = "https://github.com/acme/signals-anchors";
    const m = await fetchMirror(repo, "2026-11-02", {
      fetchFn: (async (_url: string, init?: RequestInit) => {
        signals.push(init?.signal);
        return new Response(new ReadableStream({ cancel: () => void cancelled++ }), { status: 503 });
      }) as unknown as typeof fetch,
    });
    expect(m).toMatchObject({ keys: null, keysError: "HTTP 503", anchorError: "HTTP 503" });
    expect(cancelled).toBe(2);
    expect(signals.length).toBe(2);
    for (const s of signals) expect(s).toBeInstanceOf(AbortSignal);

    const timeout = () => Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" });
    const stalled = await fetchMirror(repo, null, { fetchFn: (async () => Promise.reject(timeout())) as unknown as typeof fetch });
    expect(stalled.keysError).toBe("네트워크 오류(시간 초과)");
    // 머리는 왔지만 본문을 받다 끊긴 경우(조금씩만 보내는 서버)
    const trickle = await fetchMirror(repo, null, {
      fetchFn: (async () => new Response(new ReadableStream({ start: (c) => c.error(timeout()) }), { status: 200 })) as unknown as typeof fetch,
    });
    expect(trickle.keysError).toBe("네트워크 오류(시간 초과)");
  });

  // 서명·앵커 확인(findKey)은 사이트가 준 유효기간을 쓴다. 저장소에 고정된 생성·폐기 시각과 다르면 불일치다(S29, pull-anchor.sh와 같은 규칙).
  describe("공개키 유효기간도 저장소 사본과 대조", () => {
    const withRepoKey = (b: SignalBundle, keyId: string, patch: Partial<KeysFile["keys"][number]>): MirrorSnapshot => {
      const m = mirrorOf(b);
      m.keys = { ...m.keys!, keys: m.keys!.keys.map((k) => (k.key_id === keyId ? { ...k, ...patch } : k)) };
      return m;
    };
    const keysRow = (b: SignalBundle, m: MirrorSnapshot) => verifyAgainstMirror(b, m).find((r) => r.id === "mirror_keys")!;

    it("저장소가 폐기한 서명 키를 사이트가 폐기 전으로 적어 보내면 불일치", async () => {
      const b = await makeBundle({ revealed: true }); // 발행 2026-10-29
      const r = keysRow(b, withRepoKey(b, "sig-test", { retired_at: "2026-10-15T00:00:00.000Z" }));
      expect(r.status).toBe("FAIL");
      expect(r.detail).toBe("sig-test 공개키 또는 그 유효기간(생성·폐기 시각)이 https://github.com/o/r에 고정된 값과 다르거나 그곳에 없습니다.");
      // 폐기 시각을 다른 값으로 바꿔 보내도 불일치
      const moved = structuredClone(b);
      moved.keys.keys[0].retired_at = "2026-12-01T00:00:00.000Z";
      expect(keysRow(moved, withRepoKey(b, "sig-test", { retired_at: "2026-10-15T00:00:00.000Z" })).status).toBe("FAIL");
    });

    it("저장소가 폐기한 체크포인트 키를 사이트가 폐기하지 않은 것으로 보내면 불일치", async () => {
      const b = await makeBundle({ revealed: true });
      const r = keysRow(b, withRepoKey(b, "cp-test", { retired_at: "2026-10-20T00:00:00.000Z" }));
      expect([r.status, r.detail.startsWith("cp-test ")]).toEqual(["FAIL", true]);
    });

    it("생성 시각이 저장소와 다르면(소급 기록을 통과시키려 앞당긴 경우) 불일치", async () => {
      const b = await makeBundle({ revealed: true });
      const backdated = structuredClone(b);
      backdated.keys.keys[0].created_at = "2025-01-01T00:00:00.000Z";
      expect(keysRow(backdated, mirrorOf(b)).status).toBe("FAIL");
    });

    it("사이트가 방금 폐기 시각을 적었고 저장소가 아직 받기 전이면 통과(정상 폐기 직후 하루 동안 거짓 경보 없음)", async () => {
      const b = await makeBundle({ revealed: true });
      const m = mirrorOf(b);
      b.keys.keys[0].retired_at = "2026-12-01T00:00:00.000Z";
      expect(keysRow(b, m).status).toBe("PASS");
    });
  });
});

// 저장소 대조가 막으려는 상대는 사이트 자신이다. 사이트가 준 앵커 날짜가 저장소 파일 주소에 그대로 들어가면
// '9999/../../…'로 다른 저장소의 파일을 받게 되어, 공식 저장소 이름으로 '같습니다'가 나온다(R07).
describe("사이트가 준 앵커 날짜를 저장소 주소에 넣기 전에 확인", () => {
  const TRAVERSAL = "9999/../../../../../attacker/fake-anchors/main/anchors/2026-10-29";
  const repo = "https://github.com/acme/signals-anchors";
  const recordingFetch = (seen: string[]) =>
    (async (url: string) => {
      seen.push(url);
      return new Response(url.endsWith("/keys.json") ? JSON.stringify({ version: 1, keys: [] }) : '{"merkle_root":"x"}', { status: 200 });
    }) as unknown as typeof fetch;
  const snapshot = (b: SignalBundle, anchor: AnchorDocument | null, extra: Partial<MirrorSnapshot> = {}): MirrorSnapshot => ({
    source: "https://github.com/o/r",
    keys: structuredClone(b.keys),
    anchor,
    ...extra,
  });

  it("실제 날짜(YYYY-MM-DD)가 아니면 앵커 사본을 요청하지 않고 이유를 남긴다(공개키 목록만 받음)", async () => {
    for (const bad of [TRAVERSAL, "2026-10-29/../../x", "%2e%2e/%2e%2e/x", "2026-02-30", "2026-1-5", "20261029", " 2026-10-29"]) {
      const seen: string[] = [];
      const m = await fetchMirror(repo, bad, { fetchFn: recordingFetch(seen) });
      expect(seen, bad).toEqual(["https://raw.githubusercontent.com/acme/signals-anchors/main/keys.json"]);
      expect(m.anchor, bad).toBeNull();
      expect(m.anchorError, bad).toBe("앵커 날짜 형식이 다름");
    }
  });

  it("그런 날짜의 묶음은 앵커·저장소 대조 모두 불일치이고, 그 값을 결과 문장에 옮기지 않는다", async () => {
    for (const date of [TRAVERSAL, 20261029 as unknown as string]) {
      const b = await makeBundle({ revealed: true });
      b.anchor = { ...b.anchor!, date };
      const m = await fetchMirror(repo, b.anchor.date, { fetchFn: recordingFetch([]) });
      const results = [...(await verifySignalBundle(b)), ...verifyAgainstMirror(b, m)];
      expect(results.find((r) => r.id === "anchor")).toMatchObject({ status: "FAIL", detail: "앵커 날짜가 YYYY-MM-DD 형식의 실제 날짜가 아닙니다." });
      expect(results.find((r) => r.id === "mirror_anchor")?.status).toBe("FAIL");
      expect(overallStatus(results)).toBe("FAIL");
      expect(results.map((r) => r.detail).join("\n")).not.toMatch(/attacker|20261029/);
    }
  });

  // 앵커 날짜는 2026-10-29(KST). 앵커는 만든 날 날짜로만 만들어지므로 그보다 이른 '오늘'에는 있을 수 없다.
  it("오늘(KST)보다 늦은 날짜의 앵커가 저장소에 없으면 '반영 대기'가 아니라 불일치", async () => {
    const b = await makeBundle({ revealed: true });
    const missing = snapshot(b, null);
    const early = verifyAgainstMirror(b, missing, new Date("2026-10-28T12:00:00Z")); // 10-28 21:00 KST
    expect(early[1]).toMatchObject({ id: "mirror_anchor", status: "FAIL" });
    expect(early[1].detail).toContain("오늘(이 기기 시계로 KST 2026-10-28)보다 늦은 날짜");
    expect(overallStatus([...(await verifySignalBundle(b)), ...early])).toBe("FAIL");
    // 저장소를 받지 못했어도 날짜만으로 판정한다
    expect(verifyAgainstMirror(b, snapshot(b, null, { anchorError: "HTTP 503" }), new Date("2026-10-28T12:00:00Z"))[1].status).toBe("FAIL");
    // 그날이 되면(KST 0시부터) 정상적인 '반영 대기'
    expect(verifyAgainstMirror(b, missing, new Date("2026-10-28T15:00:00Z"))[1].status).toBe("PENDING"); // 10-29 00:00 KST
    expect(verifyAgainstMirror(b, missing, new Date("2026-10-29T09:00:00Z"))[1].status).toBe("PENDING"); // 10-29 18:00 KST
    // 저장소에 같은 사본이 있으면 대조 결과를 따른다(시계가 늦은 기기에서 거짓 경보를 내지 않게)
    expect(verifyAgainstMirror(b, snapshot(b, structuredClone(b.anchor)), new Date("2026-10-28T12:00:00Z"))[1].status).toBe("PASS");
  });

  it("요청 주소에 넣을 수 있는 기록 식별자는 시그널 ID(UUID)와 지문(64자리 16진수)뿐이다", () => {
    for (const ok of ["3c2b1a09-8f7e-4d6c-9b5a-4f3e2d1c0b9a", "3C2B1A09-8F7E-4D6C-9B5A-4F3E2D1C0B9A", "a".repeat(64), "A".repeat(64)]) {
      expect(isSignalKey(ok), ok).toBe(true);
    }
    for (const bad of ["", "../../admin", "a".repeat(63), "a".repeat(65), "g".repeat(64), "3c2b1a09-8f7e-4d6c-9b5a-4f3e2d1c0b9a/..", " 3c2b1a09-8f7e-4d6c-9b5a-4f3e2d1c0b9a", "3c2b1a098f7e4d6c9b5a4f3e2d1c0b9a"]) {
      expect(isSignalKey(bad), bad).toBe(false);
    }
  });
});
