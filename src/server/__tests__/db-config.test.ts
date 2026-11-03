// 배포 DB 연결 설정: TLS 규칙(sslOptions)과 미리보기 배포 가드(getDb). 네트워크에는 연결하지 않는다
// (pg 풀은 첫 쿼리 때 연결하므로 연결 객체만 만들고 닫는다).
import tls from "node:tls";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getDb, sslOptions } from "../db";

const REMOTE = "postgresql://postgres.abcdefghijklmnop:s3cret@aws-0-ap-northeast-2.pooler.supabase.com:6543/postgres";
// 실제 인증서 PEM(Node에 들어 있는 공개 루트 인증서 하나). 개인키는 필요 없다.
const PEM = tls.rootCertificates[0];

describe("DB 연결 TLS 설정(sslOptions)", () => {
  it("로컬 주소(테스트용 소켓 서버·로컬 DB)는 TLS를 쓰지 않는다", () => {
    for (const u of ["postgres://u:p@localhost:5432/db", "postgres://u:p@127.0.0.1:6543/postgres", "postgres://u:p@[::1]:5432/db"]) {
      expect(sslOptions(u, PEM)).toBe(false);
    }
    // pg는 주소의 host 매개변수를 먼저 쓴다: 실제 접속할 곳으로 판단해야 원격 연결이 평문이 되지 않는다
    expect(sslOptions("postgres://u:p@localhost/db?host=db.example.com", undefined)).toEqual({ rejectUnauthorized: false });
    expect(sslOptions("postgres://u:p@db.example.com/db?host=localhost", undefined)).toBe(false);
  });

  it("원격 주소: 인증서가 없으면 암호화만, 있으면 서버 인증서까지 확인한다(여러 줄·CRLF·\\n 한 줄 모두)", () => {
    expect(sslOptions(REMOTE, undefined)).toEqual({ rejectUnauthorized: false });
    expect(sslOptions(REMOTE, "  ")).toEqual({ rejectUnauthorized: false });
    const lf = PEM.trim();
    expect(sslOptions(REMOTE, PEM)).toEqual({ ca: lf, rejectUnauthorized: true });
    expect(sslOptions(REMOTE, lf.replace(/\n/g, "\\n"))).toEqual({ ca: lf, rejectUnauthorized: true }); // Vercel에 한 줄로 붙여 넣은 값
    const crlf = lf.replace(/\n/g, "\r\n"); // PowerShell Get-Content -Raw로 읽은 Windows 파일
    expect(sslOptions(REMOTE, crlf)).toEqual({ ca: crlf, rejectUnauthorized: true });
  });

  it("잘리거나 다른 내용의 DATABASE_CA_PEM은 시작할 때 알아보기 쉬운 오류로 멈춘다", () => {
    expect(() => sslOptions(REMOTE, PEM.slice(0, Math.floor(PEM.length / 2)))).toThrow(/DATABASE_CA_PEM을 인증서로 읽을 수 없습니다/);
    expect(() => sslOptions(REMOTE, "not a certificate")).toThrow(expect.objectContaining({ code: "CONFIG_INVALID" }));
  });

  it("주소에 SSL 매개변수가 있으면 멈춘다(pg가 이 설정을 덮어써 인증서 확인이 꺼지거나 Supabase 인증서를 거부함)", () => {
    for (const q of ["?sslmode=require", "?sslmode=verify-full&sslrootcert=/tmp/ca.crt", "?ssl=true", "?SSLMODE=disable", "?application_name=x&sslcert=a", "?sslkey=k", "?sslnegotiation=direct", "?uselibpqcompat=true"]) {
      expect(() => sslOptions(REMOTE + q, PEM)).toThrow(/sslmode/);
    }
    expect(() => sslOptions("postgres://u:p@localhost/db?sslmode=disable", undefined)).toThrow(/sslmode/);
  });
});

describe("미리보기 배포 가드(getDb)", () => {
  const g = globalThis as unknown as { __signalsDb?: Promise<{ end?(): Promise<void> }> };
  afterEach(async () => {
    const p = g.__signalsDb;
    g.__signalsDb = undefined;
    vi.unstubAllEnvs();
    await p?.then(
      (db) => db.end?.(),
      () => undefined,
    );
  });
  const env = (vars: Record<string, string>) => {
    g.__signalsDb = undefined;
    vi.stubEnv("DATABASE_URL", REMOTE);
    for (const [k, v] of Object.entries(vars)) vi.stubEnv(k, v);
  };

  it("Vercel 미리보기·개발 배포에서는 DATABASE_URL이 있어도 운영 DB에 연결하지 않는다", async () => {
    env({ VERCEL: "1", VERCEL_ENV: "preview" });
    await expect(getDb()).rejects.toThrow(/미리보기 배포\(VERCEL_ENV=preview\)/);
    // 앵커 호출구는 공개 기록에 메시지 대신 코드만 내보낸다(sql.ts publicError)
    await expect(getDb()).rejects.toMatchObject({ code: "PREVIEW_BLOCKED" });
    env({ VERCEL: "1", VERCEL_ENV: "development" });
    await expect(getDb()).rejects.toThrow(/Production에만/);
  });

  it("운영 배포, Vercel 밖(로컬 next start·스크립트·테스트), 명시적 허용(ALLOW_PREVIEW_DB=1)은 연결 객체를 만든다", async () => {
    const cases: Record<string, string>[] = [{ VERCEL: "1", VERCEL_ENV: "production" }, { VERCEL_ENV: "preview" }, { VERCEL: "1", VERCEL_ENV: "preview", ALLOW_PREVIEW_DB: "1" }];
    for (const vars of cases) {
      env(vars);
      const db = await getDb();
      expect(typeof db.query).toBe("function");
      await db.end?.();
      g.__signalsDb = undefined;
      vi.unstubAllEnvs();
    }
  });
});
