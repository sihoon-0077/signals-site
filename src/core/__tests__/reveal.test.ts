import { describe, expect, it } from "vitest";
import { entryRevealProblem, holdingDeadline, revealDeadline, revealState } from "../reveal";

const base = { action: "ENTRY" as const, publishedAt: "2026-11-02T23:20:00.000Z", validUntil: null, maxHoldingDays: 3, event: null, anchored: true, exitAnchored: false };

describe("원문 공개 규칙(선별 공개 차단)", () => {
  it("보유 거래일은 주말을 건너뛰고 발행일을 1일째로 센다", () => {
    // 2026-11-03(화) 08:20 KST 발행, 3거래일 → 11/5(목) 15:30 KST
    expect(holdingDeadline(base.publishedAt, 3)?.toISOString()).toBe("2026-11-05T06:30:00.000Z");
    // 2026-11-06(금) 발행, 2거래일 → 11/9(월)
    expect(holdingDeadline("2026-11-05T23:00:00.000Z", 2)?.toISOString()).toBe("2026-11-09T06:30:00.000Z");
  });

  it("유효기한과 보유 기한 중 이른 쪽이 공개 기한이다", () => {
    expect(revealDeadline({ ...base, validUntil: "2026-11-04T06:30:00.000Z" })?.toISOString()).toBe("2026-11-04T06:30:00.000Z");
    expect(revealDeadline({ ...base, maxHoldingDays: null, validUntil: null })).toBeNull();
  });

  it("운영자가 청산을 누르지 않아도 기한이 지나면 공개된다(손실 기록을 숨길 수 없음)", () => {
    expect(revealState(base, new Date("2026-11-05T06:29:59Z")).revealed).toBe(false);
    expect(revealState(base, new Date("2026-11-05T06:30:01Z"))).toMatchObject({ revealed: true, reason: "공개 기한 경과" });
  });

  it("청산(EXIT)은 외부에 고정된 뒤에 공개되고, 그때 짝인 진입도 공개된다", () => {
    const exit = { ...base, action: "EXIT" as const, maxHoldingDays: null };
    expect(revealState({ ...exit, anchored: false }, new Date("2026-11-03T00:00:00Z")).revealed).toBe(false);
    expect(revealState(exit, new Date("2026-11-03T00:00:00Z")).revealed).toBe(true);
    expect(revealState({ ...base, exitAnchored: true }, new Date("2026-11-03T00:00:00Z")).revealed).toBe(true);
  });

  it("운영자가 청산·만료·무효를 기록하면 바로 공개된다", () => {
    expect(revealState({ ...base, event: "CLOSED" }, new Date("2026-11-03T00:00:00Z")).revealed).toBe(true);
  });
});

// 발행 시점의 거부 판정(publish.ts가 DB 시계의 발행 시각으로 부른다). 고정 시각으로 확인한다. 2026-11-04는 수요일.
describe("봉인하자마자(또는 진입 전에) 원문이 공개되는 진입은 거부", () => {
  const P = (publishedAt: string, validUntil: string | null, maxHoldingDays: number | null) => entryRevealProblem(publishedAt, validUntil, maxHoldingDays);

  it("장 마감 뒤 발행 + 1거래일: 기한이 그날 15:30이라 이미 지났다", () => {
    expect(P("2026-11-04T07:00:00.000Z", null, 1)).toEqual({ field: "maxHoldingDays", reason: "passed", deadline: new Date("2026-11-04T06:30:00.000Z"), entryAt: null });
  });

  it("15:10 이후 발행 + 1거래일: 기한(15:30)이 다음 거래일 시가 진입보다 먼저다", () => {
    expect(P("2026-11-04T06:15:00.000Z", null, 1)).toEqual({
      field: "maxHoldingDays",
      reason: "before_entry",
      deadline: new Date("2026-11-04T06:30:00.000Z"),
      entryAt: new Date("2026-11-05T00:00:00.000Z"),
    });
    // 15:09:30: 토큰이 1분 늦게 찍히면 15:10이 넘어 다음 날 시가 진입이 되므로 늦은 쪽으로 보고 거부한다
    expect(P("2026-11-04T06:09:30.000Z", null, 1)?.reason).toBe("before_entry");
  });

  it("유효기한을 잘못 골라 이미 지났거나, 장중 진입 창(5~10분 뒤)이 끝나기 전이면 거부한다", () => {
    // 10:00 발행에 09:00 유효기한(보유 기한보다 이르므로 유효기한 칸을 가리킨다)
    expect(P("2026-11-04T01:00:00.000Z", "2026-11-04T00:00:00.000Z", 10)).toMatchObject({ field: "validUntil", reason: "passed" });
    // 10:00 발행, 10:05 유효기한: 토큰 여유 1분 → 진입 창 10:06~10:11이 끝나기 전
    expect(P("2026-11-04T01:00:00.000Z", "2026-11-04T01:05:00.000Z", null)).toEqual({
      field: "validUntil",
      reason: "before_entry",
      deadline: new Date("2026-11-04T01:05:00.000Z"),
      entryAt: new Date("2026-11-04T01:11:00.000Z"),
    });
    expect(P("2026-11-04T01:00:00.000Z", "2026-11-04T01:12:00.000Z", null)).toBeNull();
  });

  it("정상 진입은 받는다: 장중(14:45)·장 전(08:00)·토요일 발행 + 1거래일, 장 마감 뒤 + 2거래일", () => {
    expect(P("2026-11-04T05:45:00.000Z", null, 1)).toBeNull(); // 진입 14:51~14:56, 기한 15:30
    expect(P("2026-11-03T23:00:00.000Z", null, 1)).toBeNull(); // 11/4 08:00 → 그날 시가, 기한 그날 15:30
    expect(P("2026-11-07T03:00:00.000Z", null, 1)).toBeNull(); // 토요일 → 11/9(월) 시가, 기한 11/9 15:30
    expect(P("2026-11-04T07:00:00.000Z", null, 2)).toBeNull(); // 16:00 + 2거래일 → 11/5 15:30, 진입 11/5 시가
    expect(P("2026-11-04T07:00:00.000Z", null, null)).toBeNull(); // 기한이 없으면 판정하지 않는다(발행 입력 검사가 거부)
  });

  it("공개 규칙은 그대로다: 장 마감 뒤 발행도 발행일을 1일째로 센다", () => {
    expect(holdingDeadline("2026-11-04T07:00:00.000Z", 2)?.toISOString()).toBe("2026-11-05T06:30:00.000Z");
  });
});
