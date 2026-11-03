// /api/health의 설정 점검: 처리방침 3항의 운영 메일 업체(MAIL_SERVICE)가 쓸 수 있는 형식인지 true/false로만 알리고 값은 내보내지 않는다.
// DB·키는 흉내 낸다(이 테스트가 개발용 키를 만들거나 DB를 열지 않게).
import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/health/route";

vi.mock("@/server/db", () => ({
  getDb: async () => {
    throw new Error("테스트에서는 DB를 열지 않음");
  },
  dbTlsMode: () => "pglite",
}));
vi.mock("@/server/keys", () => ({
  loadKey: async () => {
    throw new Error("테스트에서는 키를 읽지 않음");
  },
}));
vi.mock("@/server/migrate", () => ({ migrationFiles: () => [] }));
vi.mock("@/server/services/anchor", () => ({ kstToday: () => "2026-10-30" }));

afterEach(() => vi.unstubAllEnvs());

const config = async () => {
  const res = await GET();
  const body = (await res.json()) as { config: Record<string, unknown> };
  return { body, config: body.config };
};

describe("상태 점검의 운영 메일 업체 설정", () => {
  it("형식이 맞으면 true, 비었거나 틀리면 false이고 값은 응답에 없다", async () => {
    vi.stubEnv("MAIL_SERVICE", "Google LLC(미국, googlekrsupport@google.com)");
    const ok = await config();
    expect(ok.config.mail_service).toBe(true);
    expect(JSON.stringify(ok.body)).not.toMatch(/googlekrsupport|Google LLC/);

    vi.stubEnv("MAIL_SERVICE", "Gmail");
    const bad = await config();
    expect(bad.config.mail_service).toBe(false);
    expect(JSON.stringify(bad.body)).not.toContain("Gmail");

    vi.stubEnv("MAIL_SERVICE", "");
    expect((await config()).config.mail_service).toBe(false);
  });
});
