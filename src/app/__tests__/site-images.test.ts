// 사이트 기본 공유 카드(/opengraph-image)와 홈 화면 아이콘(/apple-icon)을 실제 라우트 코드로 그려 보고, public/favicon.ico를 읽어 본다.
// 둘 다 빌드 때 정적으로 만들어지고 외부 요청이 없어야 한다: 카드에 글꼴에 없는 글자를 쓰면 @vercel/og가 Google에 글꼴을 찾으러 간다
// → fetch를 막아 두고 0번인지 본다.
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import AppleIcon, { size as appleSize } from "@/app/apple-icon";
import OgImage, { alt, size as ogSize } from "@/app/opengraph-image";

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const pngSize = (b: Buffer) => ({ width: b.readUInt32BE(16), height: b.readUInt32BE(20) });

let calls: string[] = [];
function blockFetch() {
  calls = [];
  vi.stubGlobal("fetch", (input: RequestInfo | URL) => {
    calls.push(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    return Promise.reject(new Error("unexpected fetch"));
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("사이트 기본 공유 카드·아이콘", () => {
  it("공유 카드는 1200×630 PNG이고, 그리는 동안 외부 요청이 없다", async () => {
    blockFetch();
    const b = Buffer.from(await (await OgImage()).arrayBuffer());
    expect(b.subarray(0, 8).equals(PNG_SIG)).toBe(true);
    expect(pngSize(b)).toEqual(ogSize);
    expect(calls).toEqual([]);
  });

  it("공유 카드의 대체 문장은 새 문구가 아니라 루트 제목과 같다", () => {
    expect(readFileSync(path.join(process.cwd(), "src/app/layout.tsx"), "utf8")).toContain(`default: "${alt}"`);
  });

  it("홈 화면 아이콘은 180×180 PNG이고, 외부 요청이 없다", async () => {
    blockFetch();
    const b = Buffer.from(await AppleIcon().arrayBuffer());
    expect(b.subarray(0, 8).equals(PNG_SIG)).toBe(true);
    expect(pngSize(b)).toEqual(appleSize);
    expect(calls).toEqual([]);
  });

  it("public/favicon.ico는 16·32·48 크기를 담은 ICO다(브라우저의 자동 /favicon.ico 요청이 404가 되지 않게)", () => {
    const b = readFileSync(path.join(process.cwd(), "public/favicon.ico"));
    expect([...b.subarray(0, 4)]).toEqual([0, 0, 1, 0]); // ICONDIR: 예약 0, 종류 1(아이콘)
    const count = b.readUInt16LE(4);
    const sizes = Array.from({ length: count }, (_, i) => b[6 + i * 16] || 256).sort((x, y) => x - y);
    expect(sizes).toEqual([16, 32, 48]);
  });
});
