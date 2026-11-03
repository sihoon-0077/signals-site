// 공개 프로필(/p/<주소>)의 메타 설명: 검색 결과와 카카오톡·X 공유 미리보기(og:description)에 그대로 쓰인다.
// 승인 직후(기록 0건)와 오늘 발행해 아직 일일 앵커 전인 기록에도 맞아야 하므로, 이미 '외부에 고정한' 기록이라고 쓰지 않는다.
// DB는 흉내 내고 실제 generateMetadata를 부른다.
import { describe, expect, it, vi } from "vitest";
import { generateMetadata } from "@/app/p/[handle]/page";
import { STRATEGY_LABEL, STYLE_LABEL } from "@/lib/format";

const state = vi.hoisted(() => ({ provider: null as null | Record<string, unknown> }));
vi.mock("@/server/db", () => ({ getDb: async () => ({}) }));
vi.mock("@/server/repo/providers", () => ({
  getApprovedProviderByHandle: async (_db: unknown, handle: string) => (state.provider && state.provider.handle === handle ? state.provider : null),
}));
vi.mock("@/server/repo/agents", () => ({ listAgentsByProvider: async () => [] }));

const params = (handle: string) => ({ params: Promise.resolve({ handle }) });

describe("공개 프로필 메타 설명", () => {
  it("기록이 없는 승인 직후 프로필에도 맞게, 하는 일(봉인·매일 고정)과 모의 기록·수익 비보장을 쓴다", async () => {
    state.provider = { id: "p1", handle: "blue-forest", pen_name: "파란숲", strategy_type: "RULE", holding_style: "SWING" };
    const m = await generateMetadata(params("blue-forest"));
    expect(m.title).toBe("파란숲의 결과 전 기록");
    expect(m.description).toBe(
      `파란숲 — ${STRATEGY_LABEL.RULE} · ${STYLE_LABEL.SWING}. 결과 전에 봉인해 매일 외부에 고정하는 모의(페이퍼) 시그널 기록입니다. 수익을 보장하지 않습니다.`,
    );
    // 예전 문구: 기록 0건·앵커 전에도 '이미 외부에 고정한 기록'이라고 했다
    expect(m.description).not.toContain("외부에 고정한");
  });

  it("없는·승인 전 주소는 제목만 주고 설명을 만들지 않는다", async () => {
    state.provider = null;
    expect(await generateMetadata(params("nobody"))).toEqual({ title: "공급자를 찾을 수 없습니다" });
  });
});
