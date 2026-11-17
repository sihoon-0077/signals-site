// 홈 '봉인 기록 예시'는 예시라고 밝히고, 지문은 보이는 예시 원문의 실제 SHA-256이어야 한다(가짜 값 금지). 종목 칸은 실제 종목이 아니다.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const src = readFileSync(path.join(process.cwd(), "src/app/page.tsx"), "utf8");
const canonical = /const SAMPLE_CANONICAL =\s*"([^"]+)";/.exec(src)?.[1] ?? "";
const hash = /const SAMPLE_HASH = "([0-9a-f]{64})";/.exec(src)?.[1] ?? "";

describe("홈 봉인 기록 예시", () => {
  it("지문은 보이는 예시 원문의 실제 SHA-256이다", () => {
    expect(canonical.startsWith("v2|")).toBe(true);
    expect(createHash("sha256").update(canonical, "utf8").digest("hex")).toBe(hash);
  });
  it("예시라고 표시하고, 종목 칸은 실제 종목이 아니다", () => {
    expect(src).toContain("봉인 기록 예시");
    expect(canonical.split("|")[5]).toBe("EXAMPLE");
  });
});
