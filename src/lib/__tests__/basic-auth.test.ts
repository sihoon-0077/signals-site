import { describe, expect, it } from "vitest";
import { MIN_SECRET_LENGTH, adminConfigProblem, checkBasicAuth, checkBearer, cronSecretProblem } from "../basic-auth";

// 브라우저와 같은 방식(UTF-8 바이트 → base64)으로 Authorization 헤더를 만든다
const basic = (user: string, pass: string) => `Basic ${Buffer.from(`${user}:${pass}`, "utf8").toString("base64")}`;
// 운영 길이 기준(16자 이상)을 넘는 값
const STRONG = "s3cret-0123456789-abcdef";

describe("관리자 Basic 인증", () => {
  it("맞는 아이디·비밀번호만 통과한다", () => {
    expect(checkBasicAuth(basic("admin", STRONG), "admin", STRONG)).toBe(true);
    expect(checkBasicAuth(basic("admin", "wrong"), "admin", STRONG)).toBe(false);
    expect(checkBasicAuth(null, "admin", STRONG)).toBe(false);
  });

  it("한글 아이디·비밀번호도 통과한다(UTF-8 디코딩)", () => {
    const pw = "비밀번호123".repeat(3); // 21자(길이는 글자 수로 센다)
    expect(checkBasicAuth(basic("관리자", pw), "관리자", pw, true)).toBe(true);
  });

  it("환경변수가 비어 있으면 항상 거부한다(설정 실수로 열리지 않게)", () => {
    expect(checkBasicAuth(basic("", ""), undefined, undefined)).toBe(false);
    expect(checkBasicAuth(basic("admin", ""), "admin", "")).toBe(false);
    expect(adminConfigProblem(undefined, undefined)).toMatch(/환경변수를 설정해야/);
  });

  it("앞부분만 같거나 한 글자 더 긴 값, 아이디만 틀린 값은 거부한다(길이가 달라도 일찍 끝나지 않는 비교)", () => {
    expect(checkBasicAuth(basic("admin", STRONG.slice(0, -1)), "admin", STRONG)).toBe(false);
    expect(checkBasicAuth(basic("admin", `${STRONG}x`), "admin", STRONG)).toBe(false);
    expect(checkBasicAuth(basic("admim", STRONG), "admin", STRONG)).toBe(false);
    expect(checkBasicAuth(basic("admin", ""), "admin", STRONG)).toBe(false);
    // 비밀번호 안의 ':'는 첫 ':'만 구분자로 쓴다
    expect(checkBasicAuth(basic("admin", `a:${STRONG}`), "admin", `a:${STRONG}`)).toBe(true);
  });

  it("운영에서는 ADMIN_PASSWORD가 16자 미만이면 맞는 값이어도 닫는다(503 문구)", () => {
    const short = "x".repeat(MIN_SECRET_LENGTH - 1);
    const enough = "x".repeat(MIN_SECRET_LENGTH);
    expect(checkBasicAuth(basic("admin", short), "admin", short, true)).toBe(false);
    expect(adminConfigProblem("admin", short, true)).toMatch(/너무 짧아/);
    expect(checkBasicAuth(basic("admin", enough), "admin", enough, true)).toBe(true);
    expect(adminConfigProblem("admin", enough, true)).toBeNull();
    // 개발 환경(NODE_ENV≠production)에서는 길이를 강제하지 않는다
    expect(checkBasicAuth(basic("admin", "dev"), "admin", "dev", false)).toBe(true);
  });

  it("기본값은 NODE_ENV를 따른다(테스트는 production이 아님)", () => {
    expect(process.env.NODE_ENV).not.toBe("production");
    expect(adminConfigProblem("admin", "short")).toBeNull();
  });
});

describe("앵커 호출구 Bearer 비밀값", () => {
  it("정확히 같을 때만 통과한다", () => {
    expect(checkBearer(`Bearer ${STRONG}`, STRONG)).toBe(true);
    expect(checkBearer(`Bearer ${STRONG.slice(0, -1)}x`, STRONG)).toBe(false);
    expect(checkBearer(`Bearer ${STRONG}x`, STRONG)).toBe(false);
    expect(checkBearer(`Basic ${STRONG}`, STRONG)).toBe(false);
    expect(checkBearer(`Bearer ${STRONG}`, undefined)).toBe(false);
  });

  it("운영에서는 CRON_SECRET이 16자 미만이면 닫는다", () => {
    const short = "abc123";
    expect(checkBearer(`Bearer ${short}`, short, true)).toBe(false);
    expect(cronSecretProblem(short, true)).toMatch(/너무 짧아/);
    expect(cronSecretProblem(undefined, true)).toMatch(/설정되지 않았습니다/);
    expect(cronSecretProblem(STRONG, true)).toBeNull();
    expect(checkBearer(`Bearer ${short}`, short, false)).toBe(true);
  });
});
