import { describe, expect, it } from "vitest";
import { type EntryResult, entryPriceFixedAt, resolveEntry } from "../entry";

// signals/docs/calc/03_arch_check.py 의 entry_v2 사례 9개와 같은 입력·정답
const k = (s: string) => new Date(`${s}+09:00`);
const show = (r: EntryResult) =>
  r.kind === "OPEN" ? `OPEN ${r.date}` : r.kind === "VWAP" ? `VWAP ${r.date} ${r.window}` : r.kind;

const CASES: [string, Date, Date | null, Date | null, string][] = [
  ["A 07:45 발행, 07:45 토큰", k("2026-11-02T07:45:10"), k("2026-11-02T07:45:12"), null, "OPEN 2026-11-02"],
  ["B 08:29:40 발행, 08:30:05 토큰(컷오프 넘김)", k("2026-11-02T08:29:40"), k("2026-11-02T08:30:05"), null, "VWAP 2026-11-02 09:05~09:10"],
  ["C 장중 10:00 발행", k("2026-11-02T10:00:00"), k("2026-11-02T10:00:02"), null, "VWAP 2026-11-02 10:05~10:10"],
  ["D 15:12 발행(종가 단일가 직전)", k("2026-11-02T15:12:00"), k("2026-11-02T15:12:01"), null, "OPEN 2026-11-03"],
  ["E 장 마감 뒤 15:40 발행", k("2026-11-02T15:40:00"), k("2026-11-02T15:40:02"), null, "OPEN 2026-11-03"],
  ["F 토요일 발행", k("2026-11-07T10:00:00"), k("2026-11-07T10:00:01"), null, "OPEN 2026-11-09"],
  ["G TSA 장애 → 18:00 일일 앵커", k("2026-11-02T07:45:00"), null, k("2026-11-02T18:00:00"), "OPEN 2026-11-03"],
  ["H TSA 장애, 앵커 전", k("2026-11-02T07:45:00"), null, null, "PENDING_ANCHOR"],
  ["I 토큰 시각이 발행보다 이름", k("2026-11-02T07:51:00"), k("2026-11-02T07:50:00"), null, "CLOCK_ANOMALY"],
];

describe("진입 기준가 규칙 v2", () => {
  for (const [name, received, tsa, anchor, want] of CASES) {
    it(name, () => {
      expect(show(resolveEntry(received, tsa, anchor))).toBe(want);
    });
  }

  it("초 단위로 잘린 토큰 시각(발행보다 0.9초 이름)은 시계 이상으로 보지 않는다", () => {
    expect(show(resolveEntry(new Date("2026-11-02T07:45:10.900+09:00"), new Date("2026-11-02T07:45:10.000+09:00")))).toBe("OPEN 2026-11-02");
  });

  it("고정 휴장일(성탄절)은 다음 거래일로 넘어간다", () => {
    expect(show(resolveEntry(k("2026-12-24T16:00:00"), k("2026-12-24T16:00:01")))).toBe("OPEN 2026-12-28");
  });

  it("진입가가 정해지는 시각: 시가는 09:00, 거래량가중평균가는 창이 끝나는 시각(초까지)", () => {
    const at = (s: string) => {
      const b = k(s);
      return entryPriceFixedAt(resolveEntry(b, b), b);
    };
    expect(at("2026-11-02T07:45:00")).toBe(Date.parse("2026-11-02T09:00:00+09:00"));
    expect(at("2026-11-02T08:45:00")).toBe(Date.parse("2026-11-02T09:10:00+09:00")); // 08:30 뒤 → 09:05~09:10
    expect(at("2026-11-02T10:00:30")).toBe(Date.parse("2026-11-02T10:10:30+09:00")); // 표기는 10:05~10:10(초를 버림), 실제 창은 30초 늦게 끝난다
    expect(at("2026-11-02T15:40:00")).toBe(Date.parse("2026-11-03T09:00:00+09:00"));
    expect(entryPriceFixedAt({ kind: "PENDING_ANCHOR" }, k("2026-11-02T10:00:00"))).toBeNull();
    // resolveEntry의 창 표기와 같은 규칙인지(기준 시각이 분 단위면 표기된 창 끝과 같다)
    for (const t of ["2026-11-02T09:00:00", "2026-11-02T12:34:00", "2026-11-02T15:09:00"]) {
      const b = k(t);
      const r = resolveEntry(b, b);
      if (r.kind !== "VWAP") throw new Error(`VWAP이 아님: ${t}`);
      expect(entryPriceFixedAt(r, b)).toBe(Date.parse(`${r.date}T${r.window.slice(-5)}:00+09:00`));
    }
  });
});
