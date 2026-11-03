// 검증 결과 화면을 서버에서 그려 문구를 확인한다: 보장 아님 고지는 상태와 상관없이 늘 보이고,
// 공개 저장소와 대조하지 못하면 '해당 없음'이 아니라 '확인 못 함'으로 드러나며, 명령줄 검증기는 공개 전이라고 적는다.
import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { VerifyResultView } from "@/app/verify/[id]/verify-runner";
import type { SignalFieldsV2 } from "@/core/canonical";
import type { CheckResult, CheckStatus, SignalBundle } from "@/core/verify";

const bundle = {
  signal: {
    id: "3c2b1a09-8f7e-4d6c-9b5a-4f3e2d1c0b9a",
    agent_id: "6f1c2a7e-3b4d-4e5f-8a9b-0c1d2e3f4a5b",
    sequence_no: 1,
    canonical_version: 2,
    published_at: "2026-10-29T06:37:18.253Z",
    content_hash: "a".repeat(64),
    prev_hash: "0".repeat(64),
    signature: "",
    key_id: "sig-test",
    revealed: false,
    fields: null,
  },
  previous: null,
  timestamps: [],
  anchor: null,
  keys: { version: 1, keys: [] },
} satisfies SignalBundle;

const row = (id: CheckResult["id"], status: CheckStatus): CheckResult => ({ id, label: `라벨-${id}`, status, detail: `설명-${id}` });
const render = (results: CheckResult[]) => renderToStaticMarkup(createElement(VerifyResultView, { bundle, results }));
const DISCLAIMER = "수익이나 실력을 보장하지 않으며";

describe("검증 결과 화면", () => {
  it("모두 통과여도, 불일치여도 보장 아님 고지가 큰 글씨 바로 아래에 있다", () => {
    const pass = render([row("hash", "PASS"), row("mirror_keys", "PASS")]);
    expect(pass).toContain("모든 항목이 맞습니다");
    expect(pass).toContain(DISCLAIMER);
    expect(pass.indexOf(DISCLAIMER)).toBeGreaterThan(pass.indexOf("모든 항목이 맞습니다"));
    const fail = render([row("hash", "FAIL"), row("mirror_keys", "UNCHECKED")]);
    expect(fail).toContain("맞지 않는 항목이 있습니다");
    expect(fail).toContain(DISCLAIMER);
    expect(fail).not.toContain("공개 저장소와 대조하지 못했습니다"); // 불일치가 우선
  });

  it("공개 저장소와 대조하지 못하면 종합 문구와 항목 표시로 드러낸다", () => {
    const html = render([row("hash", "SKIP"), row("mirror_keys", "UNCHECKED"), row("mirror_anchor", "UNCHECKED")]);
    expect(html).toContain("공개 저장소와 대조하지 못했습니다");
    expect(html).toContain("사이트가 키를 바꿔 다시 서명한 기록이 아닌지 확인되지 않은");
    expect(html.match(/확인 못 함/g)?.length).toBeGreaterThanOrEqual(2);
    expect(html).not.toContain("확인할 수 있는 항목은 모두 맞습니다");
  });

  it("저장소 반영 대기는 '반영 대기'로, 종합은 '확인할 수 있는 항목은 모두 맞습니다'", () => {
    const html = render([row("hash", "SKIP"), row("mirror_keys", "PASS"), row("mirror_anchor", "PENDING")]);
    expect(html).toContain("반영 대기");
    expect(html).toContain("확인할 수 있는 항목은 모두 맞습니다");
  });

  it("명령줄 검증기는 아직 공개 전이라고 적고, 지금 쓸 수 있는 것처럼 쓰지 않는다", () => {
    const html = render([row("hash", "PASS")]);
    expect(html).toContain("명령줄 검증기는 아직 공개 전입니다");
    expect(html).not.toContain("CLI로 다시 검증 가능");
  });

  // 원본 JSON 링크의 값도 서버가 준 것이다(지문 링크로 열면 ID는 대조하지 않은 값). 다른 주소로 이어지는 값은 링크에 넣지 않는다.
  it("원본 JSON 링크는 서버가 준 값이 ID·지문 형식일 때만 만든다", () => {
    const withSignal = (signal: Partial<SignalBundle["signal"]>) =>
      renderToStaticMarkup(createElement(VerifyResultView, { bundle: { ...bundle, signal: { ...bundle.signal, ...signal } }, results: [row("hash", "PASS")] }));
    expect(render([row("hash", "PASS")])).toContain('href="/api/signals/3c2b1a09-8f7e-4d6c-9b5a-4f3e2d1c0b9a/bundle"');
    const traversal = withSignal({ id: "../../admin" });
    expect(traversal).toContain(`href="/api/signals/${"a".repeat(64)}/bundle"`); // 형식이 맞는 지문으로 대신 연결
    expect(traversal).not.toContain("../");
    const neither = withSignal({ id: "../../admin", content_hash: "../x" });
    expect(neither).not.toContain("원본 JSON 받기");
    expect(neither).not.toContain("/api/signals/");
  });
});

// 위조·손상된 묶음도 검증은 '불일치'로 끝난다(명령줄 검증기는 exit 1). 그 결과를 그리다 예외가 나면 앱 오류 화면('일시적인 오류')이
// 떠서 불일치가 잠깐의 장애처럼 보인다(S30). 사이트가 준 값이 어떤 모양이든 결과 화면은 그려져야 한다.
describe("규칙에 맞지 않는 공개 자료도 결과 화면으로 그린다", () => {
  const fields: SignalFieldsV2 = JSON.parse(readFileSync(path.join(process.cwd(), "src/core/__tests__/fixtures/signal.json"), "utf8"));
  const revealed = (f: unknown, extra: Record<string, unknown> = {}) =>
    ({ ...bundle, signal: { ...bundle.signal, revealed: true, fields: f as SignalFieldsV2, ...extra } }) as SignalBundle;
  const failRows = [row("hash", "FAIL"), row("signature", "PASS")];
  const draw = (b: SignalBundle, results = failRows) => renderToStaticMarkup(createElement(VerifyResultView, { bundle: b, results }));
  const FALLBACK = "이 원문은 정규 직렬화 규칙에 맞지 않아 문자열을 만들 수 없습니다";

  it("정상 원문은 정규 직렬화 문자열을 보여 준다", () => {
    const html = draw(revealed(fields), [row("hash", "PASS")]);
    expect(html).toContain(`<pre class="overflow-x-auto rounded-lg bg-muted/60 p-3 text-xs whitespace-pre-wrap break-all">v2|${fields.signalId}|`);
    expect(html).not.toContain(FALLBACK);
  });

  it("정규 직렬화할 수 없는 원문(방향 'UP', 숫자 market)이면 예외 없이 불일치 결과와 안내 문장을 그린다", () => {
    for (const bad of [{ ...fields, side: "UP" }, { ...fields, market: 123 }]) {
      const html = draw(revealed(bad));
      expect(html).toContain("맞지 않는 항목이 있습니다");
      expect(html).toContain(FALLBACK);
      expect(html).not.toContain("<pre");
    }
  });

  it("원문 공개 전(revealed=false)인데 원문 칸에 값이 있으면 원문을 그리지 않는다(지문 재계산과 같은 조건)", () => {
    const html = draw({ ...bundle, signal: { ...bundle.signal, fields: { ...fields, side: "UP" } as unknown as SignalFieldsV2 } });
    expect(html).toContain("아직 원문 공개 전입니다");
    expect(html).not.toContain("<pre");
  });

  it("날짜로 읽히지 않는 발행 시각, 문자열이 아닌 순번·키·지문·앵커 날짜도 그린다", () => {
    const weird = {
      ...bundle,
      signal: { ...bundle.signal, published_at: "garbage", sequence_no: {}, key_id: {}, content_hash: 5 },
      timestamps: "x",
      anchor: { date: {} },
    } as unknown as SignalBundle;
    const html = draw(weird);
    expect(html).toContain("맞지 않는 항목이 있습니다");
    expect(html).toContain("발행 -");
    expect(html).toContain("타임스탬프 0건");
  });
});
