// 공유 카드 이미지(/p/<주소>/opengraph-image)를 실제 라우트 코드로 그려 본다. DB는 흉내 내고 외부 요청(fetch)은 가로챈다.
// 지키는 것: 없는·승인 전 주소는 404(카드가 굳지 않게, F11), 기록 수가 바뀌면 이미지 주소가 바뀜, 글꼴 요청은 3초 제한과
// 글자 목록(필명을 읽는 순서로 보내지 않음)만, 글꼴을 못 받으면 한글이 네모로 깨진 카드 대신 영문 대체 카드(F43).
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import Image, { generateImageMetadata } from "@/app/p/[handle]/opengraph-image";
import { STRATEGY_LABEL, STYLE_LABEL } from "@/lib/format";

const state = vi.hoisted(() => ({ provider: null as null | Record<string, unknown>, agents: [] as { chain_length: number }[] }));
vi.mock("@/server/db", () => ({ getDb: async () => ({}) }));
vi.mock("@/server/repo/providers", () => ({
  getApprovedProviderByHandle: async (_db: unknown, handle: string) => (state.provider && state.provider.handle === handle ? state.provider : null),
}));
vi.mock("@/server/repo/agents", () => ({ listAgentsByProvider: async () => state.agents }));

// 한글이 없는 라틴 글꼴(Next에 들어 있음)을 '받은 글꼴'로 쓴다. 한글 글리프 대체 요청이 생기면 그대로 드러난다.
const LATIN_TTF = readFileSync(path.join(process.cwd(), "node_modules/next/dist/compiled/@vercel/og/noto-sans-v27-latin-regular.ttf"));
const OUR_CSS = "https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@700&text=";

type Call = { url: string; signal: boolean };
let calls: Call[] = [];
function stubFetch(handler: (url: string, init?: RequestInit) => Promise<Response>) {
  calls = [];
  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    calls.push({ url, signal: init?.signal instanceof AbortSignal });
    return handler(url, init);
  });
}
const unexpected = (url: string) => Promise.reject(new Error(`unexpected fetch: ${url}`));
const params = (handle: string) => ({ params: Promise.resolve({ handle }) });
const provider = (over: Record<string, unknown> = {}) => ({ id: "p1", handle: "blue-forest", pen_name: "파란숲", strategy_type: "RULE", holding_style: "SWING", ...over });
const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
async function expectPng(res: Response) {
  const b = Buffer.from(await res.arrayBuffer());
  expect(b.subarray(0, 8).equals(PNG_SIG)).toBe(true);
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("공유 카드 이미지", () => {
  it("없는·승인 전 주소: og:image 항목 없음, 이미지 404 + no-store, 외부 요청 없음", async () => {
    state.provider = null;
    stubFetch(unexpected);
    expect(await generateImageMetadata(params("no-such-handle"))).toEqual([]);
    const res = await Image(params("no-such-handle"));
    expect(res.status).toBe(404);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(calls).toEqual([]);
  });

  it("이미지 주소에 기록 수가 들어가 기록이 늘면 주소가 바뀐다(메신저 캐시 회피)", async () => {
    state.provider = provider();
    state.agents = [{ chain_length: 3 }, { chain_length: 9 }];
    expect(await generateImageMetadata(params("blue-forest"))).toEqual([
      { id: "r12", size: { width: 1200, height: 630 }, alt: "SIGNALS 공급자 프로필", contentType: "image/png" },
    ]);
    state.agents = [{ chain_length: 3 }, { chain_length: 10 }];
    expect((await generateImageMetadata(params("blue-forest")))[0].id).toBe("r13");
  });

  it("글꼴을 받으면 짧은 캐시의 PNG, 글자 목록만 3초 제한과 함께 보내고 같은 글자는 다시 받지 않는다", async () => {
    state.provider = provider();
    state.agents = [{ chain_length: 12 }];
    vi.spyOn(console, "error").mockImplementation(() => {}); // 라틴 시험 글꼴에 한글이 없어 @vercel/og가 남기는 로그
    stubFetch(async (url) => {
      if (url.startsWith(OUR_CSS)) return new Response("@font-face { src: url(https://fonts.gstatic.com/s/test.ttf) format('truetype'); }");
      if (url === "https://fonts.gstatic.com/s/test.ttf") return new Response(LATIN_TTF);
      return new Response("nope", { status: 404 }); // @vercel/og 자체의 한글 글리프 대체 요청
    });
    const res = await Image(params("blue-forest"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("cache-control")).toBe("public, max-age=0, s-maxage=600");
    await expectPng(res);
    const ours = calls.filter((c) => c.url.startsWith(OUR_CSS) || c.url.endsWith("/test.ttf"));
    expect(ours.map((c) => c.signal)).toEqual([true, true]);
    const sent = decodeURIComponent(ours[0].url.slice(OUR_CSS.length));
    const cardText = `파란숲${STRATEGY_LABEL.RULE} · ${STYLE_LABEL.SWING}결과 전에 봉인한 기록 12건`;
    expect([...sent]).toEqual([...new Set(sent)].sort()); // 정렬·중복 없음
    for (const ch of cardText) expect(sent).toContain(ch);
    expect(sent).not.toContain("파란숲"); // 필명이 읽는 순서 그대로 나가지 않는다
    expect(sent).toContain("보"); // '수익을 보장하지 않음' 문구 글자도 함께 받는다

    const before = calls.filter((c) => c.url.startsWith(OUR_CSS)).length;
    await expectPng(await Image(params("blue-forest")));
    expect(calls.filter((c) => c.url.startsWith(OUR_CSS)).length).toBe(before);
  });

  const failures: [string, (url: string) => Promise<Response>, number][] = [
    ["woff2만 주는 응답", (url) => (url.startsWith(OUR_CSS) ? Promise.resolve(new Response("@font-face { src: url(https://fonts.gstatic.com/s/x.woff2) format('woff2'); }")) : unexpected(url)), 1],
    ["CSS 429", (url) => (url.startsWith(OUR_CSS) ? Promise.resolve(new Response("Too Many Requests", { status: 429 })) : unexpected(url)), 1],
    [
      "글꼴 본문이 HTML(200)",
      (url) =>
        url.startsWith(OUR_CSS)
          ? Promise.resolve(new Response("@font-face { src: url(https://fonts.gstatic.com/s/x.ttf) format('truetype'); }"))
          : url === "https://fonts.gstatic.com/s/x.ttf"
            ? Promise.resolve(new Response("<!DOCTYPE html><html>blocked</html>"))
            : unexpected(url),
      2,
    ],
    ["네트워크 오류", (url) => (url.startsWith(OUR_CSS) ? Promise.reject(new TypeError("fetch failed")) : unexpected(url)), 1],
  ];
  it.each(failures)("글꼴을 못 받으면(%s) 영문 대체 카드, CDN 60초, 추가 글꼴 요청 없음", async (name, handler, expectedCalls) => {
    state.provider = provider({ pen_name: `가람${name.length}` }); // 경우마다 다른 글자(글꼴 캐시를 피함)
    state.agents = [{ chain_length: 7 }];
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    stubFetch(handler);
    const res = await Image(params("blue-forest"));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("public, max-age=0, s-maxage=60");
    await expectPng(res);
    // 카드에 한글이 남아 있으면 @vercel/og가 글리프를 더 받으려 하고(요청 증가) 오류 로그를 남긴다. 둘 다 없어야 한다.
    expect(calls.length).toBe(expectedCalls);
    expect(err).not.toHaveBeenCalled();
  });

  it("Google이 응답하지 않으면 약 3초에 끊고 대체 카드를 준다", async () => {
    state.provider = provider({ pen_name: "Blue Forest Lab" });
    state.agents = [{ chain_length: 1 }];
    stubFetch(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(init.signal!.reason));
        }),
    );
    const t0 = Date.now();
    const res = await Image(params("blue-forest"));
    const ms = Date.now() - t0;
    expect(ms).toBeGreaterThanOrEqual(2900);
    expect(ms).toBeLessThan(6000);
    expect(res.headers.get("cache-control")).toBe("public, max-age=0, s-maxage=60");
    await expectPng(res);
    expect(calls.length).toBe(1);
  });
});
