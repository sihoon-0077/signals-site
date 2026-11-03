// /api/anchors/<날짜>: 달력에 없는 날짜는 DB를 건드리지 않고 400(예전에는 13월·32일이 RangeError로 500이었다).
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ getDb: vi.fn(), getAnchor: vi.fn() }));
vi.mock("@/server/db", () => ({ getDb: m.getDb }));
vi.mock("@/server/services/anchor", () => ({ getAnchor: m.getAnchor }));

import { GET } from "../api/anchors/[date]/route";

const call = (date: string) => GET(new Request(`https://site.example/api/anchors/${date}`), { params: Promise.resolve({ date }) });

beforeEach(() => {
  m.getDb.mockReset().mockResolvedValue({});
  m.getAnchor.mockReset().mockResolvedValue(null);
});

describe("GET /api/anchors/[date]", () => {
  it("달력에 없는 날짜·0000년·형식 오류는 400", async () => {
    for (const d of ["2026-13-01", "2026-02-32", "2026-00-10", "2026-12-00", "2026-02-30", "0000-01-01", "not-a-date"]) {
      const res = await call(d);
      expect(res.status, d).toBe(400);
    }
    expect(m.getAnchor).not.toHaveBeenCalled();
  });

  it("실제 날짜는 조회해 없으면 404, 있으면 문서를 돌려준다", async () => {
    expect((await call("2026-11-02")).status).toBe(404);
    m.getAnchor.mockResolvedValue({ date: "2026-11-03", merkle_root: "b".repeat(64) });
    const res = await call("2026-11-03");
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(m.getAnchor).toHaveBeenLastCalledWith({}, "2026-11-03");
  });
});
