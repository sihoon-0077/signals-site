// db/migrations/*.sql 을 이름 순서대로 한 번씩 적용한다(적용 기록: schema_migrations, 파일 내용의 sha256 포함).
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import type { Db } from "./db";

/** 파일 맨 앞의 UTF-8 BOM(U+FEFF). Windows 메모장('UTF-8 with BOM')·PowerShell 5.1(Set-Content -Encoding utf8)이 붙인다. */
const BOM = /^\uFEFF/;

/**
 * 파일 내용의 sha256. 줄바꿈(CRLF→LF)과 BOM을 맞춘 뒤 계산한다: Windows에서 받으면 같은 파일이 CRLF로 바뀌기도 하는데,
 * 그걸 '내용이 바뀌었다'로 오인해 마이그레이션을 막으면 안 된다.
 */
export function migrationChecksum(sql: string): string {
  return createHash("sha256").update(sql.replace(BOM, "").replace(/\r\n?/g, "\n"), "utf8").digest("hex");
}

export function migrationFiles(dir = path.join(process.cwd(), "db", "migrations")): { name: string; sql: string; checksum: string }[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((name) => {
      // BOM은 실행 전에 뗀다(체크섬과 같은 문자열을 실행). PostgreSQL은 BOM을 공백이 아니라 글자로 읽어, 붙은 채 실행하면
      // 첫 문장이 'syntax error at or near "…"'(42601)로 실패한다(보이지 않는 글자라 원인을 찾기 어렵다).
      const sql = readFileSync(path.join(dir, name), "utf8").replace(BOM, "");
      return { name, sql, checksum: migrationChecksum(sql) };
    });
}

/**
 * 적용 대상 표시(비밀번호 제외). 운영자가 엉뚱한 DB(로컬 파일 DB 등)에 적용하고 성공으로 착각하지 않게 먼저 보여 준다.
 * Supabase 공유 풀러 주소는 같은 리전의 모든 프로젝트가 함께 쓰므로, 프로젝트 ref가 든 사용자 이름까지 보여야 구별된다.
 */
export function describeMigrationTarget(url: string | undefined, pgliteDir: string): string {
  if (!url) return `로컬 PGlite(${path.resolve(pgliteDir)}) — 운영 DB가 아닙니다`;
  try {
    const u = new URL(url);
    return `${decodeURIComponent(u.username)}@${u.hostname}:${u.port || "5432"}${u.pathname}`;
  } catch {
    return "(DATABASE_URL 형식을 읽지 못했습니다)";
  }
}

export async function runMigrations(db: Db, dir?: string): Promise<string[]> {
  // 기록 표는 러너가 만들고 러너가 보호한다(RLS, 0002가 이 표를 몰라도 되게). checksum 열은 예전 러너가 만든 표에도 덧붙인다.
  await db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now());
ALTER TABLE schema_migrations ADD COLUMN IF NOT EXISTS checksum TEXT;
ALTER TABLE schema_migrations ENABLE ROW LEVEL SECURITY;`);
  const files = migrationFiles(dir);
  const byName = new Map(files.map((f) => [f.name, f]));
  const rows = await db.query<{ name: string; checksum: string | null }>("SELECT name, checksum FROM schema_migrations ORDER BY name");
  // 적용하기 전에 기록 전체를 먼저 대조한다. 하나라도 어긋나면 아무것도 적용하지 않는다(바뀐 파일 + 새 파일이 반만 적용되는 일 방지).
  // 이미 적용한 파일을 고치면 이름만 보는 러너는 건너뛰어, 운영 스키마와 저장소의 SQL이 조용히 달라진다.
  for (const r of rows) {
    const f = byName.get(r.name);
    if (!f) throw new Error(`DB에 적용 기록이 있는 ${r.name} 파일이 없습니다. 적용한 마이그레이션 파일은 지우거나 이름을 바꾸지 마세요.`);
    if (r.checksum !== null && r.checksum !== f.checksum) {
      throw new Error(`이미 적용한 ${r.name}의 내용이 바뀌었습니다. 파일을 되돌리고, 바꿀 내용은 새 번호 파일로 추가하세요.`);
    }
  }
  // 예전 러너가 남긴 행(checksum 없음)은 지금 파일 값으로 한 번 채운다. 이후 바뀌면 위에서 드러난다.
  for (const r of rows) {
    if (r.checksum === null) await db.query("UPDATE schema_migrations SET checksum = $1 WHERE name = $2", [byName.get(r.name)!.checksum, r.name]);
  }
  const done = new Set(rows.map((r) => r.name));
  const applied: string[] = [];
  for (const m of files) {
    if (done.has(m.name)) continue;
    await db.tx(async (t) => {
      await t.exec(m.sql);
      await t.query("INSERT INTO schema_migrations (name, checksum) VALUES ($1, $2)", [m.name, m.checksum]);
    });
    applied.push(m.name);
  }
  return applied;
}
