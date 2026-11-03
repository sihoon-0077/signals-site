import { describe, expect, it } from "vitest";
import vectors from "../test-vectors/canonical_v2.json";
import { CANONICAL_TEMPLATE_V2, CanonicalError, type SignalFieldsV2, canonicalizeV2, contentHashV2 } from "../canonical";

// 정답값은 별도 Python 구현(scripts/gen_canonical_vectors.py)이 만들었다.
describe("정규 직렬화 v2 — 골든 벡터", () => {
  it("템플릿이 Python 생성기와 같다", () => {
    expect(vectors.template).toBe(CANONICAL_TEMPLATE_V2);
  });

  for (const c of vectors.cases) {
    it(c.name, async () => {
      const input = c.input as unknown as SignalFieldsV2;
      expect(canonicalizeV2(input)).toBe(c.canonical);
      expect(await contentHashV2(input)).toBe(c.sha256);
    });
  }

  for (const r of vectors.rejects) {
    it(`거부: ${r.name}`, () => {
      expect(() => canonicalizeV2(r.input as unknown as SignalFieldsV2)).toThrow(CanonicalError);
    });
  }

  it("봉인 필드 하나만 바꿔도 지문이 달라진다(방향 바꿔치기)", async () => {
    const base = vectors.cases[0].input as unknown as SignalFieldsV2;
    const flipped = { ...base, side: "SHORT" as const };
    expect(await contentHashV2(flipped)).not.toBe(vectors.cases[0].sha256);
  });

  it("파이프 이스케이프로 필드 경계를 위조할 수 없다", () => {
    const base = vectors.cases[0].input as unknown as SignalFieldsV2;
    const a = canonicalizeV2({ ...base, ruleVersion: "x|y", rationale: "z" });
    const b = canonicalizeV2({ ...base, ruleVersion: "x", rationale: "y|z" });
    expect(a).not.toBe(b);
  });
});
