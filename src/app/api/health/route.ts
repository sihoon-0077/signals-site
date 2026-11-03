// 운영 점검용 공개 상태. 배포 직후 점검(npm run smoke), 외부 감시, 일일 앵커 작업이 실패했을 때 원인 확인에 쓴다
// (Vercel Hobby의 함수 로그는 1시간만 남으므로 비밀 없이 상태를 볼 수단이 필요하다).
// 비밀값은 내보내지 않는다: 키는 /keys.json에 이미 공개된 ID·지문만, 오류는 메시지(호스트·사용자명이 섞일 수 있음)가 아니라 코드만.
// 아무것도 쓰지 않는다(SELECT만, TSA 호출·사슬 검사 없음).
import { parseMailService } from "@/lib/mail-service";
import { anchorRepo, siteUrl, tsaEndpoints } from "@/server/config";
import { dbTlsMode, getDb } from "@/server/db";
import { loadKey } from "@/server/keys";
import { migrationFiles } from "@/server/migrate";
import { kstToday } from "@/server/services/anchor";
import { publicError } from "@/server/sql";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function keyStatus() {
  try {
    const [sig, cp] = await Promise.all([loadKey("signal"), loadKey("checkpoint")]);
    const pick = (k: typeof sig) => ({ key_id: k.keyId, fingerprint: k.fingerprint, created_at: k.createdAt });
    return { ok: true as const, signal: pick(sig), checkpoint: pick(cp) };
  } catch (e) {
    return { ok: false as const, error: publicError(e).code };
  }
}

async function dbStatus() {
  const started = Date.now();
  try {
    const db = await getDb();
    const applied = (await db.query<{ name: string }>("SELECT name FROM schema_migrations ORDER BY name")).map((r) => r.name);
    const expected = migrationFiles().map((m) => m.name);
    const [lastAnchor] = await db.query<{ date: string; key_id: string }>(
      "SELECT to_char(checkpoint_date, 'YYYY-MM-DD') AS date, checkpoint_key_id AS key_id FROM anchor_records ORDER BY checkpoint_date DESC LIMIT 1",
    );
    const [lastSignal] = await db.query<{ key_id: string }>("SELECT key_id FROM signals ORDER BY published_at DESC LIMIT 1");
    return {
      ok: true as const,
      latency_ms: Date.now() - started,
      migrations: { applied: applied.length, pending: expected.filter((n) => !applied.includes(n)), unknown: applied.filter((n) => !expected.includes(n)) },
      last_anchor_date: lastAnchor?.date ?? null,
      last_anchor_key_id: lastAnchor?.key_id ?? null,
      last_signal_key_id: lastSignal?.key_id ?? null,
    };
  } catch (e) {
    return { ok: false as const, latency_ms: Date.now() - started, error: publicError(e).code };
  }
}

export async function GET() {
  const [db, keys] = await Promise.all([dbStatus(), keyStatus()]);
  // 키가 직전 발행·앵커와 다르면 발행·앵커가 거부된다(services/publish.ts·anchor.ts). 발행 전에 미리 드러낸다.
  const keyMismatch =
    db.ok && keys.ok
      ? {
          signal: db.last_signal_key_id !== null && db.last_signal_key_id !== keys.signal.key_id,
          checkpoint: db.last_anchor_key_id !== null && db.last_anchor_key_id !== keys.checkpoint.key_id,
        }
      : null;
  const safe = <T,>(f: () => T): T | "INVALID" => {
    try {
      return f();
    } catch {
      return "INVALID";
    }
  };
  const today = kstToday();
  const healthy = db.ok && keys.ok && db.migrations.pending.length === 0 && !keyMismatch?.signal && !keyMismatch?.checkpoint;
  return Response.json(
    {
      status: healthy ? "ok" : "degraded",
      checked_at: new Date().toISOString(),
      kst_today: today,
      deployment: {
        env: process.env.VERCEL_ENV ?? null,
        region: process.env.VERCEL_REGION ?? null,
        commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 12) ?? null,
      },
      db: { ...db, tls: dbTlsMode() },
      anchor_today: db.ok ? db.last_anchor_date === today : null,
      keys,
      key_mismatch: keyMismatch,
      tsa: safe(() => tsaEndpoints().map((t) => t.name)),
      config: {
        site_url: safe(siteUrl),
        anchor_repo: anchorRepo(),
        admin_auth: Boolean(process.env.ADMIN_USER && process.env.ADMIN_PASSWORD),
        cron_secret: Boolean(process.env.CRON_SECRET),
        privacy_contact: Boolean(process.env.PRIVACY_OFFICER && process.env.CONTACT_EMAIL),
        // 처리방침 3항의 운영 메일 업체: 값은 내보내지 않고 형식이 맞는지만(틀리면 처리방침에 '설정 필요'가 보인다)
        mail_service: parseMailService(process.env.MAIL_SERVICE) !== null,
      },
    },
    { status: healthy ? 200 : 503, headers: { "Cache-Control": "no-store" } },
  );
}
