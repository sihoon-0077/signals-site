import { describe, expect, it } from "vitest";
import { isRealDate, kstHour, kstToday } from "../date";

describe("날짜 문자열 검사", () => {
  it("달력에 없는 날짜·형식 오류는 거부한다(예외 없이 false)", () => {
    // 2026-13-01·2026-02-32·2026-00-10·2026-12-00은 예전 코드에서 RangeError(500)가 났다
    for (const d of ["2026-13-01", "2026-02-32", "2026-00-10", "2026-12-00", "2026-99-99", "2026-02-30", "2026-04-31", "2026-02-29", "0000-01-01", "not-a-date", "2026-1-01", "2026-01-01T00:00:00Z", " 2026-01-01", ""]) {
      expect(isRealDate(d), d).toBe(false);
    }
  });

  it("실제 날짜와 윤일, PostgreSQL date 범위의 양 끝은 받는다", () => {
    for (const d of ["2026-11-02", "2024-02-29", "2000-02-29", "0001-01-01", "9999-12-31"]) expect(isRealDate(d), d).toBe(true);
  });
});

describe("KST 날짜·시각", () => {
  it("UTC 15시가 KST 자정이다(그 직전까지는 전날 23시)", () => {
    const cases: [string, string, number][] = [
      ["2026-11-10T14:59:59.999Z", "2026-11-10", 23],
      ["2026-11-10T15:00:00.000Z", "2026-11-11", 0],
      ["2026-11-10T15:00:05.000Z", "2026-11-11", 0],
      ["2026-11-10T08:59:59.999Z", "2026-11-10", 17], // 18시 직전: 앵커를 만들지 않는 시각
      ["2026-11-10T09:00:00.000Z", "2026-11-10", 18],
      ["2026-12-31T15:00:00.000Z", "2027-01-01", 0], // 해가 바뀌는 자정
    ];
    for (const [utc, day, hour] of cases) {
      const now = new Date(utc);
      expect([kstToday(now), kstHour(now)], utc).toEqual([day, hour]);
    }
  });
});
