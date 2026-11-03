import "server-only";
import { GENESIS_HASH } from "@/core/canonical";
import type { Db } from "../db";
import { ConflictError, InputError, isUniqueViolation, iso } from "../sql";

export interface AgentRow {
  id: string;
  provider_id: string | null;
  slug: string;
  name: string;
  description: string;
  is_platform_owned: boolean;
  status: "VERIFYING" | "ACTIVE" | "TERMINATED";
  created_at: string;
  chain_length: number;
  head_hash: string;
  last_published_at: string | null;
  provider_handle: string | null;
  provider_pen_name: string | null;
  provider_status: string | null;
}

const AGENT_SELECT = `
  SELECT a.id, a.provider_id, a.slug, a.name, a.description, a.is_platform_owned, a.status, ${iso("a.created_at")} AS created_at,
         COALESCE(h.sequence_no, 0) AS chain_length, COALESCE(h.content_hash, '${GENESIS_HASH}') AS head_hash,
         ${iso("h.published_at")} AS last_published_at,
         p.handle AS provider_handle, p.pen_name AS provider_pen_name, p.status AS provider_status
    FROM agents a
    LEFT JOIN providers p ON p.id = a.provider_id
    LEFT JOIN LATERAL (
      SELECT sequence_no, content_hash, published_at FROM signals s WHERE s.agent_id = a.id ORDER BY sequence_no DESC LIMIT 1
    ) h ON true`;

export async function listAgents(db: Db): Promise<AgentRow[]> {
  return db.query<AgentRow>(`${AGENT_SELECT} ORDER BY a.is_platform_owned DESC, a.created_at`);
}

export async function listAgentsByProvider(db: Db, providerId: string): Promise<AgentRow[]> {
  return db.query<AgentRow>(`${AGENT_SELECT} WHERE a.provider_id = $1 ORDER BY a.created_at`, [providerId]);
}

export async function getAgentBySlug(db: Db, slug: string): Promise<AgentRow | null> {
  const rows = await db.query<AgentRow>(`${AGENT_SELECT} WHERE a.slug = $1`, [slug]);
  return rows[0] ?? null;
}

export async function getAgent(db: Db, id: string): Promise<AgentRow | null> {
  const rows = await db.query<AgentRow>(`${AGENT_SELECT} WHERE a.id = $1`, [id]);
  return rows[0] ?? null;
}

export async function createAgent(db: Db, a: { providerId: string | null; slug: string; name: string; description?: string }): Promise<string> {
  if (!/^[a-z0-9][a-z0-9-]{2,39}$/.test(a.slug)) throw new InputError("slug는 영문 소문자·숫자·하이픈 3~40자입니다.", { slug: "형식 오류" });
  if (!a.name.trim()) throw new InputError("이름을 입력하세요.", { name: "필수" });
  try {
    const rows = await db.query<{ id: string }>(
      "INSERT INTO agents (provider_id, slug, name, description, is_platform_owned) VALUES ($1, $2, $3, $4, $5) RETURNING id",
      [a.providerId, a.slug, a.name.trim(), a.description ?? "", a.providerId === null],
    );
    return rows[0].id;
  } catch (e) {
    if (isUniqueViolation(e)) throw new ConflictError("이미 있는 slug입니다.");
    throw e;
  }
}

export async function setAgentStatus(db: Db, id: string, status: AgentRow["status"]): Promise<void> {
  await db.query("UPDATE agents SET status = $2 WHERE id = $1", [id, status]);
}
