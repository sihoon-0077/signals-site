// 마이그레이션 실행기: 적용한 파일의 내용 변경을 막고(체크섬), 줄바꿈만 다른 파일은 같은 파일로 본다.
// 실제 마이그레이션 대신 작은 SQL 파일을 임시 폴더에 만들어 쓴다(다른 마이그레이션 내용과 상관없이 실행기만 확인).
import { mkdtempSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, describe, expect, it } from "vitest";
import { pgliteDb } from "../db";
import { describeMigrationTarget, migrationChecksum, runMigrations } from "../migrate";

const dirs: string[] = [];
const pgs: PGlite[] = [];
afterEach(async () => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  for (const p of pgs.splice(0)) await p.close();
});

function migrationsDir(files: Record<string, string>): string {
  const dir = mkdtempSync(path.join(tmpdir(), "signals-migrate-"));
  dirs.push(dir);
  for (const [name, sql] of Object.entries(files)) writeFileSync(path.join(dir, name), sql);
  return dir;
}

function freshDb() {
  const pg = new PGlite();
  pgs.push(pg);
  return { pg, db: pgliteDb(pg) };
}

const BASE = {
  "0001_a.sql": "CREATE TABLE mig_a (x INT);\nCREATE TABLE mig_b (y INT);\n",
  "0002_b.sql": "ALTER TABLE mig_a ADD COLUMN z TEXT;\n",
};

const tableExists = async (db: ReturnType<typeof pgliteDb>, name: string) =>
  (await db.query<{ t: string | null }>("SELECT to_regclass($1)::text AS t", [name]))[0].t !== null;

describe("마이그레이션 실행기", () => {
  it("처음에는 전부 적용하고 파일별 sha256을 남기며, 다시 돌리면 아무것도 하지 않는다", async () => {
    const dir = migrationsDir(BASE);
    const { db } = freshDb();
    expect(await runMigrations(db, dir)).toEqual(["0001_a.sql", "0002_b.sql"]);
    const rows = await db.query<{ name: string; checksum: string }>("SELECT name, checksum FROM schema_migrations ORDER BY name");
    expect(rows).toEqual([
      { name: "0001_a.sql", checksum: migrationChecksum(BASE["0001_a.sql"]) },
      { name: "0002_b.sql", checksum: migrationChecksum(BASE["0002_b.sql"]) },
    ]);
    expect(await runMigrations(db, dir)).toEqual([]);
    // 기록 표는 실행기가 만들고 RLS로 보호한다(0002_rls.sql이 이 표를 몰라도 되게)
    expect((await db.query<{ rls: boolean }>("SELECT relrowsecurity AS rls FROM pg_class WHERE relname = 'schema_migrations'"))[0].rls).toBe(true);
  });

  it("줄바꿈(CRLF)·BOM만 다른 파일은 같은 파일로 본다(Windows에서 받은 저장소)", async () => {
    const dir = migrationsDir(BASE);
    const { db } = freshDb();
    await runMigrations(db, dir);
    writeFileSync(path.join(dir, "0001_a.sql"), "\uFEFF" + BASE["0001_a.sql"].replace(/\n/g, "\r\n"));
    expect(await runMigrations(db, dir)).toEqual([]);
  });

  it("BOM이 붙은 새 파일도 적용하고(실행 전에 BOM을 뗌), BOM 없는 내용과 같은 체크섬을 남긴다", async () => {
    // Windows 메모장('UTF-8 with BOM')·PowerShell 5.1 Set-Content로 만든 0006 같은 경우. 예전에는 보이지 않는 BOM 글자(U+FEFF) 근처의 syntax error(42601)로 멈췄다.
    const body = "-- BOM\r\nCREATE TABLE mig_c (x INT);\r\n";
    const dir = migrationsDir({ ...BASE, "0003_c.sql": "\uFEFF" + body, "0004_d.sql": "\uFEFFCREATE TABLE mig_d (x INT);\n" });
    const { db } = freshDb();
    expect(await runMigrations(db, dir)).toEqual(["0001_a.sql", "0002_b.sql", "0003_c.sql", "0004_d.sql"]);
    expect([await tableExists(db, "mig_c"), await tableExists(db, "mig_d")]).toEqual([true, true]);
    const [row] = await db.query<{ checksum: string }>("SELECT checksum FROM schema_migrations WHERE name = '0003_c.sql'");
    expect(row.checksum).toBe(migrationChecksum(body));
    // 실행·체크섬 모두 BOM을 뗀 같은 문자열을 쓴다(나중에 BOM을 빼고 다시 저장해도 '내용이 바뀌었다'로 막지 않는다)
    writeFileSync(path.join(dir, "0003_c.sql"), body);
    expect(await runMigrations(db, dir)).toEqual([]);
  });

  it("이미 적용한 파일을 고치면 멈추고, 함께 추가한 새 파일도 적용하지 않는다", async () => {
    const dir = migrationsDir(BASE);
    const { db } = freshDb();
    await runMigrations(db, dir);
    writeFileSync(path.join(dir, "0002_b.sql"), BASE["0002_b.sql"] + "CREATE TABLE mig_sneaky (x INT);\n");
    writeFileSync(path.join(dir, "0003_c.sql"), "CREATE TABLE mig_c (x INT);\n");
    await expect(runMigrations(db, dir)).rejects.toThrow(/이미 적용한 0002_b\.sql의 내용이 바뀌었습니다/);
    expect(await tableExists(db, "mig_sneaky")).toBe(false);
    expect(await tableExists(db, "mig_c")).toBe(false);
  });

  it("적용 기록이 있는 파일이 사라지면 멈춘다", async () => {
    const dir = migrationsDir(BASE);
    const { db } = freshDb();
    await runMigrations(db, dir);
    unlinkSync(path.join(dir, "0002_b.sql"));
    await expect(runMigrations(db, dir)).rejects.toThrow(/0002_b\.sql 파일이 없습니다/);
  });

  it("예전 실행기가 만든 기록(체크섬 없음)은 지금 파일 값으로 한 번 채우고, 그 뒤 변경은 드러낸다", async () => {
    const dir = migrationsDir(BASE);
    const { pg, db } = freshDb();
    // 예전 실행기 상태: 체크섬 열 없이 이름만 기록(개발 PC의 .data/pglite가 이렇다)
    await pg.exec(`CREATE TABLE schema_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now());
                   ${BASE["0001_a.sql"]} ${BASE["0002_b.sql"]}
                   INSERT INTO schema_migrations (name) VALUES ('0001_a.sql'), ('0002_b.sql');`);
    expect(await runMigrations(db, dir)).toEqual([]);
    expect((await db.query<{ n: number }>("SELECT count(*)::int AS n FROM schema_migrations WHERE checksum IS NULL"))[0].n).toBe(0);
    writeFileSync(path.join(dir, "0001_a.sql"), BASE["0001_a.sql"] + "-- 고침\n");
    await expect(runMigrations(db, dir)).rejects.toThrow(/0001_a\.sql/);
  });

  it("적용 대상 표시: 비밀번호는 빼고 프로젝트 ref가 든 사용자·호스트·포트·DB를 보이고, 주소가 없으면 로컬 PGlite라고 알린다", () => {
    const url = "postgresql://postgres.abcdefghijklmnop:s3cr%40t%23pw@aws-1-ap-northeast-2.pooler.supabase.com:6543/postgres";
    const shown = describeMigrationTarget(url, ".data/pglite");
    expect(shown).toBe("postgres.abcdefghijklmnop@aws-1-ap-northeast-2.pooler.supabase.com:6543/postgres");
    expect(shown).not.toMatch(/s3cr/);
    expect(describeMigrationTarget(undefined, ".data/pglite")).toMatch(/^로컬 PGlite\(.+pglite\) — 운영 DB가 아닙니다$/);
    expect(describeMigrationTarget("not a url", ".data/pglite")).toBe("(DATABASE_URL 형식을 읽지 못했습니다)");
  });
});
