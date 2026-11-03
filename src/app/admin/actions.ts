"use server";

import { revalidatePath } from "next/cache";
import { kstHour, kstToday } from "@/core/date";
import { kstDateTime } from "@/lib/format";
import { requireAdmin } from "@/server/admin-auth";
import { isProduction } from "@/server/config";
import { getDb } from "@/server/db";
import { findContact, findProviderName } from "@/server/identity-guard";
import { createAgent, getAgent, setAgentStatus } from "@/server/repo/agents";
import { anonymizeProvider, listApprovedProviders, setProviderStatus } from "@/server/repo/providers";
import { revealOf } from "@/server/repo/signals";
import { ConflictError, InputError, NotFoundError } from "@/server/sql";
import { AnchorConsistencyError, buildDailyAnchor } from "@/server/services/anchor";
import { IdentityAckRequired, publishSignal, recordSignalEvent } from "@/server/services/publish";

export interface ActionState {
  ok?: string;
  error?: string;
  fields?: Record<string, string>;
  // React 19는 action 뒤 폼을 초기화한다. 입력값을 돌려주고 attempt를 form key로 써서 그 값으로 다시 그린다
  // (특히 에이전트 선택이 첫 항목으로 돌아가 다른 에이전트로 잘못 발행되는 것을 막는다).
  values?: Record<string, string>;
  attempt?: number;
  /** 발행: 서버가 이번 응답에서 확인을 요청한 공급자 신원 표기 묶음의 표시(확인란의 값, publish.ts IdentityAckRequired) */
  ackFor?: string;
}

// 발행 확인란(identityAck)은 되돌려 주지 않는다. 서버가 방금 확인을 요청한 응답(ackFor)에서만 새로 그리므로,
// 다른 오류로 돌아오거나 응답을 못 받으면 확인란이 풀린다(다시 누르면 서버가 다시 묻는다).
function formValues(form: FormData, only?: string[]): Record<string, string> {
  return Object.fromEntries(
    [...form.entries()].filter(([k]) => !k.startsWith("$") && k !== "identityAck" && (!only || only.includes(k))).map(([k, v]) => [k, String(v)]),
  );
}

function fail(e: unknown, form: FormData): ActionState {
  const keep = { values: formValues(form), attempt: Date.now() };
  if (e instanceof IdentityAckRequired) return { error: e.message, fields: e.fields, ackFor: e.ackToken, ...keep };
  if (e instanceof InputError) return { error: e.message, fields: e.fields, ...keep };
  if (e instanceof ConflictError || e instanceof NotFoundError || e instanceof AnchorConsistencyError) return { error: e.message, ...keep };
  throw e;
}

export async function setProviderStatusAction(form: FormData) {
  await requireAdmin();
  const status = form.get("status") === "APPROVED" ? "APPROVED" : "REJECTED";
  await setProviderStatus(await getDb(), String(form.get("providerId")), status);
  revalidatePath("/admin");
}

export async function createAgentAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  await requireAdmin();
  try {
    const providerId = String(form.get("providerId") ?? "");
    if (providerId !== "platform") {
      // 탈퇴하면 필명·에이전트 이름은 바꾸지만 주소(slug)는 기록과 묶여 바꿀 수 없다. 처음부터 필명·프로필 주소·연락처를 넣지 못하게 막아야
      // 처리방침의 '탈퇴 뒤 프로필 주소는 공개하지 않음'이 참으로 남는다(발행의 규칙 버전·근거와 같은 검사, identity-guard.ts).
      // 에이전트는 급하게 만들 일이 없어 확인으로 넘기지 않고, 프로필 주소도 낱말 단위가 아닌 부분 문자열로 엄격하게 본다. 필명은 2글자 이상만 본다.
      const p = (await listApprovedProviders(await getDb())).find((x) => x.id === providerId);
      if (!p) return fail(new InputError("승인된 공급자만 고를 수 있습니다.", { providerId: "승인 전" }), form);
      const parts = [
        ["slug", String(form.get("slug") ?? "")],
        ["agentName", String(form.get("agentName") ?? "")],
        ["description", String(form.get("description") ?? "")],
      ] as const;
      for (const [field, value] of parts) {
        const contact = findContact(value);
        if (contact) {
          return fail(
            new InputError(`에이전트 주소·이름·설명에는 메일·링크·메신저 아이디·휴대전화 번호를 넣지 마세요(걸린 표기: ${contact}). 탈퇴한 뒤에도 기록은 계속 공개됩니다.`, {
              [field]: "연락처 금지",
            }),
            form,
          );
        }
        if (findProviderName(value, p, { handleAsToken: false })) {
          return fail(new InputError("에이전트 주소·이름·설명에는 공급자 필명이나 프로필 주소를 넣지 마세요. 탈퇴한 뒤에도 기록은 계속 공개됩니다.", { [field]: "필명·주소 금지" }), form);
        }
      }
    }
    await createAgent(await getDb(), {
      providerId: providerId === "platform" ? null : providerId,
      slug: String(form.get("slug") ?? "").trim(),
      name: String(form.get("agentName") ?? ""),
      description: String(form.get("description") ?? ""),
    });
  } catch (e) {
    return fail(e, form);
  }
  revalidatePath("/admin");
  return { ok: "에이전트를 만들었습니다.", attempt: Date.now() };
}

export async function agentStatusAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  await requireAdmin();
  const status = String(form.get("status"));
  // 계획상 '기록 기준 충족'(ACTIVE)은 판매 단계이고, 그 기준의 절반(완결 8건, 최대낙폭 −40% 이내 등)은 시세 없이 계산할 수 없다.
  // 기간·건수만 보고 바꾸면 계획과 다른 기준의 배지가 공개되므로 1R에서는 종료만 받는다.
  if (status === "ACTIVE") return { error: "1R에서는 '기록 기준 충족'으로 바꾸지 않습니다. 계획의 기준(완결 8건, 최대낙폭 −40% 이내 등)은 시세를 쓰는 판매 단계에서 계산합니다." };
  if (status !== "TERMINATED") return { error: "알 수 없는 상태입니다." };
  const db = await getDb();
  const agent = await getAgent(db, String(form.get("agentId")));
  if (!agent) return { error: "에이전트가 없습니다." };
  await setAgentStatus(db, agent.id, status);
  revalidatePath("/admin");
  return { ok: "종료했습니다(기록은 계속 공개)." };
}

/**
 * 탈퇴 처리. 되돌릴 수 없다(repo/providers.ts anonymizeProvider).
 * 승인된 적 없고 에이전트도 없는 등록은 행을 지우고, 그 밖에는 연락처·소개·채널·초대 관계·선택 동의를 지우고 필명·에이전트 이름을 바꾸며
 * 공개 프로필을 닫는다(봉인 기록은 남는다).
 */
export async function anonymizeProviderAction(form: FormData) {
  await requireAdmin();
  await anonymizeProvider(await getDb(), String(form.get("providerId")));
  revalidatePath("/admin");
}

export async function publishAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  await requireAdmin();
  // 폼이 만든 요청 번호(= 시그널 ID). 같은 화면에서 다시 누르면 같은 번호로 와서 두 번 봉인되지 않는다.
  if (!form.get("requestId")) return { error: "요청 번호가 없습니다. 화면을 새로고침한 뒤 다시 입력하세요.", values: formValues(form), attempt: Date.now() };
  try {
    const r = await publishSignal(await getDb(), {
      requestId: form.get("requestId"),
      agentId: form.get("agentId"),
      market: form.get("market"),
      ticker: form.get("ticker"),
      side: form.get("side"),
      action: form.get("signalAction"),
      targetPrice: form.get("targetPrice"),
      stopLossPrice: form.get("stopLossPrice"),
      suggestedWeight: form.get("suggestedWeight"),
      maxHoldingDays: form.get("maxHoldingDays"),
      validUntil: form.get("validUntil") ? new Date(String(form.get("validUntil")) + "+09:00").toISOString() : "",
      isPaper: true,
      entrySignalId: form.get("entrySignalId"),
      ruleVersion: form.get("ruleVersion"),
      rationale: form.get("rationale") ?? "",
      // 규칙 버전·근거가 공급자 프로필 주소·필명과 겹칠 때 운영자가 '일반 낱말'이라고 확인한 경우(폼의 확인란, 걸렸을 때만 보임).
      // 값은 서버가 보여 준 묶음의 표시(ackFor)라 그 에이전트·문구·표기에만 적용된다. 체크하지 않으면 빈 값이다.
      identityAck: String(form.get("identityAck") ?? ""),
    });
    revalidatePath("/admin");
    const ts = r.timestamps.map((t) => `${t.tsa} ${t.genTime}`).join(", ") || "없음";
    const err = r.tsaErrors.length ? ` / 타임스탬프 실패: ${r.tsaErrors.join("; ")}` : "";
    const head = r.alreadySealed ? `이미 봉인됨(순번 ${r.signal.sequence_no}) — 같은 요청이라 새로 봉인하지 않았습니다` : `봉인 완료 — 순번 ${r.signal.sequence_no}`;
    // 진입의 원문 공개 기한을 보여 준다(무효 처리 기한 10분 안에 기한이 의도와 같은지 확인할 수 있게)
    const deadline = r.signal.action === "ENTRY" ? revealOf(r.signal).deadline : null;
    const reveal = deadline ? `, 원문 공개 기한 ${kstDateTime(deadline.toISOString())}` : "";
    return {
      ok: `${head}, 지문 ${r.signal.content_hash.slice(0, 16)}…${reveal}, 타임스탬프: ${ts}${err}`,
      values: formValues(form, ["agentId", "market"]),
      attempt: Date.now(),
    };
  } catch (e) {
    if (e instanceof InputError || e instanceof ConflictError || e instanceof NotFoundError) return fail(e, form);
    // 연결 끊김 등: 커밋됐는지 알 수 없다. 오류 화면으로 넘기면 입력값과 요청 번호가 사라져, 다시 입력해 누르면 두 번 봉인될 수 있다.
    console.error("[admin] 발행 결과 확인 실패", e);
    return {
      error: `봉인 결과를 확인하지 못했습니다(${(e as Error)?.message?.slice(0, 200) ?? "알 수 없는 오류"}). 다시 누르기 전에 새 탭에서 운영자 화면의 '청산 전 시그널' 목록에 방금 시그널이 있는지 확인하세요. 이 화면에서 그대로 다시 누르면 같은 요청 번호로 보내므로 두 번 봉인되지 않습니다.`,
      values: formValues(form),
      attempt: Date.now(),
    };
  }
}

export async function signalEventAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  await requireAdmin();
  const event = String(form.get("event"));
  const note = String(form.get("note") ?? "").trim();
  if (event !== "CLOSED" && event !== "EXPIRED" && event !== "VOID") return { error: "알 수 없는 처리입니다." };
  // 무효·만료는 기록이 왜 끝났는지 공개 기록에 남아야 한다(사유 없는 무효는 결과를 보고 지운 것과 구별되지 않는다)
  if (event !== "CLOSED" && !note) return { error: "무효·만료는 사유를 적어야 합니다." };
  try {
    await recordSignalEvent(await getDb(), String(form.get("signalId")), event, note);
  } catch (e) {
    return fail(e, form);
  }
  revalidatePath("/admin");
  return { ok: "기록했습니다. 원문이 공개됩니다." };
}

export async function anchorAction(): Promise<ActionState> {
  await requireAdmin();
  // 시각은 한 번만 잡아 18시 검사와 앵커 날짜에 같이 쓴다(앵커 호출구와 같은 규칙). 날짜를 DB 연결 뒤에 다시 계산하면, 23:59에 누르고
  // 기다리는 사이 자정이 지났을 때 다음 날 앵커가 00시에 확정되어 그날 발행분이 하루씩 밀린다. 날짜를 넘기면 그 사이 자정이 지난 경우
  // buildDailyAnchor가 '오늘만' 규칙으로 거부한다(그날은 빈 날로 남음).
  const now = new Date();
  // 18시(KST) 전에 만들면 그날 앵커가 그 시각으로 확정되어 이후 발행분이 다음 날로 밀린다. 공개 저장소 작업도 18시 전에는 만들지 않는다.
  if (isProduction() && kstHour(now) < 18) {
    return { error: "18시(KST) 전에는 만들지 않습니다. 이 버튼은 그날 자동 실행이 실패했을 때 18시 이후·24시 전에 쓰세요." };
  }
  try {
    const r = await buildDailyAnchor(await getDb(), kstToday(now));
    revalidatePath("/admin");
    revalidatePath("/anchors");
    const err = r.tsaErrors.length ? ` / 타임스탬프 실패: ${r.tsaErrors.join("; ")}` : "";
    return { ok: `${r.created ? "만들었습니다" : "이미 있습니다"} — ${r.document.date}, 루트 ${r.document.merkle_root.slice(0, 16)}…, 타임스탬프 ${r.document.timestamps.length}건${err}` };
  } catch (e) {
    return fail(e, new FormData());
  }
}
