// 공개 주소(공유·초대 링크, og:image, 검증 안내)가 배포에서 조용히 localhost가 되지 않는지 본다.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { siteUrl } from "../config";

beforeEach(() => {
  for (const n of ["SITE_URL", "VERCEL", "VERCEL_PROJECT_PRODUCTION_URL"]) vi.stubEnv(n, "");
});
afterEach(() => vi.unstubAllEnvs());

describe("siteUrl()", () => {
  it("SITE_URL을 쓰고 끝 슬래시·공백은 정리한다", () => {
    vi.stubEnv("SITE_URL", " https://signals.example/ ");
    expect(siteUrl()).toBe("https://signals.example");
  });

  it("SITE_URL이 없으면 Vercel 운영 주소, 그것도 없으면(로컬) localhost", () => {
    expect(siteUrl()).toBe("http://localhost:3000");
    vi.stubEnv("VERCEL", "1");
    vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "signals-x.vercel.app");
    expect(siteUrl()).toBe("https://signals-x.vercel.app");
  });

  it("주소 형식이 아니면(scheme 없음·경로·다른 scheme) 명확한 오류로 멈춘다", () => {
    for (const v of ["signals.example", "https://signals.example/app", "ftp://signals.example", "https://user:pw@signals.example", "https://"]) {
      vi.stubEnv("SITE_URL", v);
      expect(() => siteUrl(), v).toThrow(/SITE_URL은 http\(s\):\/\//);
    }
  });

  it("Vercel 배포에 localhost·http 주소를 넣으면 멈춘다(.env.example 예시값을 그대로 넣은 경우)", () => {
    vi.stubEnv("VERCEL", "1");
    for (const v of ["http://localhost:3000", "https://127.0.0.1", "http://signals.example"]) {
      vi.stubEnv("SITE_URL", v);
      expect(() => siteUrl(), v).toThrow(/공개 https 주소가 아닙니다/);
    }
  });

  it("로컬 시험(next start, VERCEL 없음)에서는 localhost를 그대로 쓴다", () => {
    vi.stubEnv("SITE_URL", "http://localhost:3000");
    expect(siteUrl()).toBe("http://localhost:3000");
  });
});
