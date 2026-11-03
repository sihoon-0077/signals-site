// 에이전트 공개 규칙(lib/agent-visibility.ts) 하나를 홈 목록·/a/주소 페이지·그 페이지 제목이 함께 쓰는지 실제 화면 코드로 본다.
// 숨긴 에이전트(공급자가 승인 상태가 아니고 기록 0건)는 404이며, 그 404 응답의 제목도 없는 주소와 같아야 한다(이름·주소 존재가 드러나지 않게).
// DB는 흉내 낸다. next/link는 앱 라우터 없이 그리기 위해 단순한 <a>로 바꾼다(링크 동작은 여기서 보지 않는다).
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import AgentPage, { generateMetadata } from "@/app/a/[slug]/page";
import Home from "@/app/page";
import { isAgentPublic } from "@/lib/agent-visibility";

const state = vi.hoisted(() => ({ agents: [] as Record<string, unknown>[], signals: [] as Record<string, unknown>[] }));
vi.mock("@/server/db", () => ({ getDb: async () => ({}) }));
vi.mock("@/server/repo/agents", () => ({
  listAgents: async () => state.agents,
  getAgentBySlug: async (_db: unknown, slug: string) => state.agents.find((a) => a.slug === slug) ?? null,
}));
vi.mock("@/server/repo/signals", () => ({
  listAgentSignals: async () => state.signals,
  countTimestampsByAgent: async () => new Map<string, number>(),
  revealOf: () => ({ revealed: true, reason: "청산 시그널이 외부에 고정됨", deadline: null }),
}));
vi.mock("next/link", () => ({
  default: ({ href, className, children }: { href: string; className?: string; children?: ReactNode }) => createElement("a", { href, className }, children),
}));

const agent = (over: Record<string, unknown>) => ({
  id: "a0",
  provider_id: "p1",
  slug: "agent",
  name: "이름",
  description: "",
  is_platform_owned: false,
  status: "VERIFYING",
  created_at: "2026-10-30T00:00:00.000Z",
  chain_length: 0,
  head_hash: "0".repeat(64),
  last_published_at: null,
  provider_handle: "blue-forest",
  provider_pen_name: "파란숲",
  provider_status: "APPROVED",
  ...over,
});
// 숨김: 승인 뒤 거절된 공급자의 기록 0건 에이전트, 탈퇴 처리된 공급자의 기록 0건 에이전트, 대기 상태 공급자의 에이전트
const HIDDEN = [
  agent({ id: "h1", slug: "hidden-rejected", name: "숨긴전략QZX", provider_status: "REJECTED" }),
  agent({ id: "h2", slug: "hidden-withdrawn", name: "탈퇴한 공급자의 에이전트 f5db", provider_pen_name: "탈퇴한 공급자", provider_status: "REJECTED" }),
  agent({ id: "h3", slug: "hidden-pending", name: "대기전략PDX", provider_status: "PENDING" }),
];
// 공개: 승인된 공급자(기록 0건이어도), 플랫폼 운영, 공급자가 비활성이어도 봉인 기록이 있는 에이전트
const VISIBLE = [
  agent({ id: "v1", slug: "approved-agent", name: "공개전략A" }),
  agent({ id: "v2", slug: "platform-agent", name: "플랫폼전략B", is_platform_owned: true, provider_id: null, provider_handle: null, provider_pen_name: null, provider_status: null }),
  agent({ id: "v3", slug: "rejected-records", name: "기록있는전략C", provider_status: "REJECTED", chain_length: 2, head_hash: "a".repeat(64), last_published_at: "2026-11-02T00:30:00.000Z" }),
];
state.agents = [...HIDDEN, ...VISIBLE];

const params = (slug: string) => ({ params: Promise.resolve({ slug }) });
type AgentLike = Parameters<typeof isAgentPublic>[0];

describe("에이전트 공개 규칙", () => {
  it("플랫폼 운영·승인된 공급자·봉인 기록이 있는 에이전트만 공개한다", () => {
    for (const a of VISIBLE) expect(isAgentPublic(a as AgentLike)).toBe(true);
    for (const a of HIDDEN) expect(isAgentPublic(a as AgentLike)).toBe(false);
  });

  it("숨긴 에이전트의 제목은 없는 주소와 같다(이름이 404 응답에 실리지 않음)", async () => {
    const missing = await generateMetadata(params("no-such-agent"));
    expect(missing).toEqual({ title: "에이전트를 찾을 수 없습니다" });
    for (const a of HIDDEN) {
      const meta = await generateMetadata(params(a.slug as string));
      expect(meta).toEqual(missing);
      expect(JSON.stringify(meta)).not.toContain(a.name as string);
    }
    for (const a of VISIBLE) expect(await generateMetadata(params(a.slug as string))).toEqual({ title: `${a.name} 기록` });
  });

  it("숨긴 에이전트 페이지는 404, 공개 에이전트 페이지는 그려진다", async () => {
    for (const a of HIDDEN) await expect(AgentPage(params(a.slug as string))).rejects.toMatchObject({ digest: "NEXT_HTTP_ERROR_FALLBACK;404" });
    state.signals = [];
    for (const a of VISIBLE) expect(renderToStaticMarkup(await AgentPage(params(a.slug as string)))).toContain(a.name as string);
  });

  it("홈 목록에도 같은 규칙: 숨긴 에이전트는 이름이 나오지 않는다", async () => {
    const html = renderToStaticMarkup(await Home());
    for (const a of VISIBLE) expect(html).toContain(a.name as string);
    for (const a of HIDDEN) expect(html).not.toContain(a.name as string);
  });
});

describe("공개된 시그널의 방향 표시", () => {
  it("방향은 원래 값과 '예상'으로 쓴다(손실로 끝난 LONG 청산도 '상승'으로 읽히지 않게)", async () => {
    const signal = (over: Record<string, unknown>) => ({
      id: "s1",
      sequence_no: 1,
      published_at: "2026-11-02T00:30:00.000Z",
      ticker: "005930",
      side: "LONG",
      action: "ENTRY",
      event: null,
      content_hash: "b".repeat(64),
      ...over,
    });
    state.signals = [signal({}), signal({ id: "s2", sequence_no: 2, action: "EXIT", event: "CLOSED", content_hash: "c".repeat(64) }), signal({ id: "s3", sequence_no: 3, side: "SHORT", content_hash: "d".repeat(64) })];
    const html = renderToStaticMarkup(await AgentPage(params("rejected-records")));
    expect(html).toContain("005930 · LONG(상승 예상) · 진입");
    expect(html).toContain("005930 · LONG(상승 예상) · 청산");
    expect(html).toContain("005930 · SHORT(하락 예상) · 진입");
    expect(html).not.toMatch(/· (상승|하락) ·/);
  });
});
