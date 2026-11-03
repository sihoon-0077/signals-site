// 관리자 폼의 서버 액션 감싸기: 새 배포 뒤 예전 화면에서 누른 경우(서버에 액션 없음)와 응답을 못 받은 발행.
// 테스트 설정(tsconfig jsx: preserve)으로는 .tsx를 바로 불러올 수 없어, 실제 forms.tsx를 TypeScript로 변환해 불러온다.
// 서버 액션·화면 부품은 가짜로 바꿔 DB·브라우저 없이 확인한다.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import vm from "node:vm";
import { UnrecognizedActionError, unstable_isUnrecognizedActionError } from "next/dist/client/components/unrecognized-action-error";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";
import * as agentRules from "@/lib/agent-rules";

type State = { ok?: string; error?: string; values?: Record<string, string>; ackFor?: string };
type Action = (prev: State, form: FormData) => Promise<State>;

const publishAction = vi.fn<Action>();
const nodeRequire = createRequire(import.meta.url);
const stubs: Record<string, unknown> = {
  "next/navigation": { unstable_isUnrecognizedActionError },
  "@/components/ui/button": {},
  "@/components/ui/input": {},
  "@/components/ui/label": {},
  "@/components/ui/textarea": {},
  "@/lib/agent-rules": agentRules,
  "./actions": { publishAction, agentStatusAction: vi.fn(), anchorAction: vi.fn(), createAgentAction: vi.fn(), signalEventAction: vi.fn() },
};

type PublishFormProps = { agents: { id: string; name: string; status: string }[] };

function loadForms(extra: Record<string, unknown> = {}) {
  const source = readFileSync(path.join(process.cwd(), "src", "app", "admin", "forms.tsx"), "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  });
  const mod = { exports: {} as Record<string, unknown> };
  const load = vm.runInThisContext(`(function (exports, require, module) {${outputText}\n})`) as (e: object, r: (id: string) => unknown, m: object) => void;
  const all = { ...stubs, ...extra };
  load(mod.exports, (id) => (id in all ? all[id] : nodeRequire(id)), mod);
  return mod.exports as {
    RELOAD_NOTICE: string;
    PUBLISH_LOST_NOTICE: string;
    guardAction: (a: Action, lost?: string) => Action;
    publishWithRequestId: Action;
    PublishForm: (p: PublishFormProps) => unknown;
  };
}

/**
 * 발행 폼을 정해 둔 action 상태(서버가 돌려준 오류·입력값)로 그려 HTML로 받는다. useActionState만 바꾸고 나머지 React는 그대로 쓴다.
 * 화면 부품(Button 등)은 같은 이름의 기본 태그로 바꾼다.
 */
function renderPublishForm(state: State & { fields?: Record<string, string> }): string {
  const React = nodeRequire("react") as typeof import("react");
  const { renderToStaticMarkup } = nodeRequire("react-dom/server") as typeof import("react-dom/server");
  const tag = (name: string) =>
    function Stub(props: Record<string, unknown>) {
      return React.createElement(name, props);
    };
  const { PublishForm } = loadForms({
    react: { ...React, useActionState: () => [state, () => {}, false] },
    "@/components/ui/button": { Button: tag("button") },
    "@/components/ui/input": { Input: tag("input") },
    "@/components/ui/label": { Label: tag("label") },
    "@/components/ui/textarea": { Textarea: tag("textarea") },
  });
  return renderToStaticMarkup(React.createElement(PublishForm as React.FC<PublishFormProps>, { agents: [{ id: "a1", name: "든든", status: "VERIFYING" }] }));
}

const { PUBLISH_LOST_NOTICE, RELOAD_NOTICE, guardAction, publishWithRequestId } = loadForms();

const formOf = (entries: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
};

describe("관리자 폼 서버 액션 감싸기", () => {
  it("새 배포로 서버에 액션이 없으면 오류 화면 대신 새로고침 안내를 보이고 입력값을 남긴다(다시 보내지 않음)", async () => {
    const action = vi.fn<Action>().mockRejectedValue(new UnrecognizedActionError('Server Action "x" was not found on the server.'));
    const r = await guardAction(action)({}, formOf({ ticker: "005930", $ACTION_ID_abc: "", requestId: "r" }));
    expect(r.error).toBe(RELOAD_NOTICE);
    expect(r.error).toMatch(/새로고침/);
    expect(r.values).toEqual({ ticker: "005930", requestId: "r" });
    expect(action).toHaveBeenCalledTimes(1);
  });

  it("그 밖의 오류는 그대로 올린다(발행이 아닌 폼)", async () => {
    const boom = new Error("boom");
    await expect(guardAction(vi.fn<Action>().mockRejectedValue(boom))({}, formOf({}))).rejects.toBe(boom);
  });

  it("발행: 요청 번호를 처음에 한 번 만들고, 응답을 못 받으면 그 번호와 입력값을 남긴 채 확인 안내를 보인다", async () => {
    const publish = guardAction(publishWithRequestId, PUBLISH_LOST_NOTICE);
    publishAction.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    const lost = await publish({}, formOf({ ticker: "005930", requestId: "" }));
    expect(lost.error).toBe(PUBLISH_LOST_NOTICE);
    expect(lost.values?.requestId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(publishAction).toHaveBeenCalledTimes(1);
    // 다시 그린 폼(숨은 칸에 같은 번호)으로 다시 누르면 같은 번호로 보낸다
    publishAction.mockResolvedValueOnce({ ok: "이미 봉인됨(순번 1)" });
    expect(await publish({}, formOf({ ticker: "005930", requestId: lost.values!.requestId }))).toEqual({ ok: "이미 봉인됨(순번 1)" });
    expect(publishAction.mock.calls[1][1].get("requestId")).toBe(lost.values!.requestId);
    // 새로 연 폼은 새 번호를 받는다
    publishAction.mockResolvedValueOnce({ ok: "봉인 완료" });
    await publish({}, formOf({ ticker: "000660", requestId: "" }));
    expect(publishAction.mock.calls[2][1].get("requestId")).not.toBe(lost.values!.requestId);
  });
});

describe("발행 폼: 공급자 필명·주소 확인란(identityAck)", () => {
  const ackInput = (html: string) => /<input[^>]*name="identityAck"[^>]*>/.exec(html)?.[0];

  it("처음에는 확인란이 없다(운영자가 습관적으로 체크하지 않게)", () => {
    expect(ackInput(renderPublishForm({}))).toBeUndefined();
  });

  const token = "a".repeat(64);

  it("서버가 주소·필명과 같은 표기를 알리면 체크되지 않은 확인란이 나오고(값은 서버가 준 확인 값), 같은 요청 번호를 남긴다", () => {
    const html = renderPublishForm({
      error: "규칙 버전·근거에 공급자 프로필 주소·필명과 같은 표기가 있습니다(걸린 표기: 근거의 필명 돌파).",
      fields: { rationale: "필명과 같은 표기", identityAck: "확인 필요" },
      ackFor: token,
      values: { requestId: "11111111-1111-4111-8111-111111111111", rationale: "20일선 돌파" },
    });
    const input = ackInput(html);
    expect(input).toMatch(/type="checkbox"/);
    expect(input).toContain(`value="${token}"`);
    expect(input).not.toMatch(/checked/);
    expect(html).toContain("오류 안내의 &#x27;걸린 표기&#x27;는 모두 필명·주소와 겹치는 일반 낱말이며 공급자 신원 정보가 아님을 확인했습니다");
    expect(html).toMatch(/<input type="hidden" name="requestId" value="11111111-1111-4111-8111-111111111111"\/>/);
  });

  it("다른 오류로 돌아오거나 예전 확인 값만 남아 있으면 확인란을 그리지 않는다(확인은 서버가 방금 물은 표기에만)", () => {
    expect(ackInput(renderPublishForm({ error: "다른 오류", fields: { validUntil: "공개 기한이 이미 지남" }, values: { requestId: "r", identityAck: token } }))).toBeUndefined();
    expect(ackInput(renderPublishForm({ error: "다른 오류", values: { requestId: "r", identityAck: "on" } }))).toBeUndefined();
  });

  it("시장 선택지는 1R에 봉인하는 국내 시장(KOSPI·KOSDAQ)뿐이다", () => {
    const select = /<select name="market"[^>]*>([\s\S]*?)<\/select>/.exec(renderPublishForm({}))?.[1] ?? "";
    expect([...select.matchAll(/<option[^>]*>([^<]*)<\/option>/g)].map((m) => m[1])).toEqual(["KOSPI", "KOSDAQ"]);
  });

  it("최대 보유 거래일 칸은 세는 법(발행일이 1일째, 장 마감 뒤 발행도 그날부터)을 보인다", () => {
    expect(renderPublishForm({})).toContain("최대 보유 거래일(발행일이 1일째, 장 마감 뒤 발행도 그날부터 셈)");
  });
});
