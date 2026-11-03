"use client";

import { unstable_isUnrecognizedActionError } from "next/navigation";
import { cloneElement, isValidElement, useActionState, useEffect, useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ACTIVE_MIN_DAYS, ACTIVE_MIN_SIGNALS, ENTRY_MARKETS } from "@/lib/agent-rules";
import { type ActionState, agentStatusAction, anchorAction, createAgentAction, publishAction, signalEventAction } from "./actions";

const selectClass = "h-9 w-full rounded-lg border border-input bg-transparent px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

type Action = (prev: ActionState, form: FormData) => Promise<ActionState>;

export const RELOAD_NOTICE = "사이트가 새 버전으로 바뀌어 이 요청은 처리되지 않았습니다(저장·봉인 안 됨). 화면을 새로고침(F5)한 뒤 다시 하세요.";
export const PUBLISH_LOST_NOTICE =
  "봉인 결과를 확인하지 못했습니다(응답 없음). 다시 누르기 전에 새 탭에서 운영자 화면의 '청산 전 시그널' 목록에 방금 시그널이 있는지 확인하세요. 이 화면에서 그대로 다시 누르면 같은 요청 번호로 보내므로 두 번 봉인되지 않습니다.";

const valuesOf = (form: FormData) => Object.fromEntries([...form.entries()].filter(([k, v]) => !k.startsWith("$") && typeof v === "string")) as Record<string, string>;

/**
 * 서버 액션 호출을 감싼다. 새 배포 뒤 열어 둔 예전 화면에서 누르면 그 액션이 서버에 없어 실행되지 않는다(Vercel Hobby에는
 * 예전 화면을 예전 배포에 묶어 두는 Skew Protection이 없음). 오류 화면 대신 새로고침 안내를 띄우고 입력값은 남긴다.
 * 자동으로 다시 보내지 않는다(새 코드가 예전 화면의 값으로 처리하거나, 발행이 두 번 될 수 있다).
 * lostNotice가 있으면 응답을 받지 못한 경우(연결 끊김·시간 초과)도 오류 화면 대신 그 안내와 입력값을 돌려준다.
 */
export function guardAction(action: Action, lostNotice?: string): Action {
  return async (prev, form) => {
    try {
      return await action(prev, form);
    } catch (e) {
      const keep = { values: valuesOf(form), attempt: Date.now() };
      if (unstable_isUnrecognizedActionError(e)) return { error: RELOAD_NOTICE, ...keep };
      if (lostNotice) return { error: lostNotice, ...keep };
      throw e;
    }
  };
}

/** 발행: 요청 번호(= 시그널 ID)를 처음 누를 때 한 번 만들고, 실패해 다시 그린 폼에는 같은 번호를 남긴다(성공하면 새 번호). */
export const publishWithRequestId: Action = (prev, form) => {
  if (!form.get("requestId")) form.set("requestId", crypto.randomUUID());
  return publishAction(prev, form);
};

const agentStatus = guardAction(agentStatusAction);
const signalEvent = guardAction(signalEventAction);
const createAgent = guardAction(createAgentAction);
const publish = guardAction(publishWithRequestId, PUBLISH_LOST_NOTICE);
const anchor = guardAction(anchorAction);

function Result({ state }: { state: ActionState }) {
  if (state.error) return <p className="text-sm text-destructive">{state.error}{state.fields ? ` (${Object.entries(state.fields).map(([k, v]) => `${k}: ${v}`).join(", ")})` : ""}</p>;
  if (state.ok) return <p className="text-sm break-all text-primary">{state.ok}</p>;
  return null;
}

// 레이블을 입력칸에 htmlFor/id로 연결한다(화면낭독기가 칸 이름을 읽도록)
function F({ label, children }: { label: string; children: React.ReactElement<Record<string, unknown>> }) {
  const id = useId();
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      {isValidElement(children) ? cloneElement(children, { id }) : children}
    </div>
  );
}

/** 되돌릴 수 없는 처리용 버튼: 첫 클릭은 확인 단계로만 바뀌고, 두 번째 클릭에 제출한다(5초 지나면 원래대로). */
export function ConfirmSubmit({ name, value, label, confirmLabel }: { name?: string; value?: string; label: string; confirmLabel: string }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 5000);
    return () => clearTimeout(t);
  }, [armed]);
  return armed ? (
    <Button size="sm" variant="destructive" type="submit" name={name} value={value}>
      {confirmLabel}
    </Button>
  ) : (
    <Button size="sm" variant="outline" type="button" onClick={() => setArmed(true)}>
      {label}
    </Button>
  );
}

export function AgentStatusForm({ agentId, status, eligible }: { agentId: string; status: string; eligible: boolean }) {
  const [state, action] = useActionState<ActionState, FormData>(agentStatus, {});
  if (status === "TERMINATED") return null;
  return (
    <form action={action} className="flex flex-wrap items-center justify-end gap-2">
      <input type="hidden" name="agentId" value={agentId} />
      {/* 1R은 '기록 기준 충족'으로 바꾸지 않는다(계획의 품질 기준은 판매 단계에서 계산). 기간·건수 충족 여부만 운영자에게 보인다. */}
      {status === "VERIFYING" && eligible && (
        <span className="text-xs text-muted-foreground">
          {ACTIVE_MIN_DAYS}일·{ACTIVE_MIN_SIGNALS}건 충족(상태 변경은 판매 단계에서)
        </span>
      )}
      <ConfirmSubmit name="status" value="TERMINATED" label="종료" confirmLabel="종료 확인(되돌릴 수 없음)" />
      <Result state={state} />
    </form>
  );
}

export function SignalEventForm({ signalId }: { signalId: string }) {
  const [state, action] = useActionState<ActionState, FormData>(signalEvent, {});
  return (
    <form action={action} className="flex flex-wrap items-center justify-end gap-2">
      <input type="hidden" name="signalId" value={signalId} />
      <Input name="note" aria-label="사유(무효·만료는 필수)" placeholder="사유(무효·만료는 필수)" className="h-8 w-48" maxLength={200} />
      <ConfirmSubmit name="event" value="CLOSED" label="청산" confirmLabel="청산 확인" />
      <ConfirmSubmit name="event" value="EXPIRED" label="만료" confirmLabel="만료 확인" />
      <ConfirmSubmit name="event" value="VOID" label="무효" confirmLabel="무효 확인(발행 10분 안만)" />
      <Result state={state} />
    </form>
  );
}

export function CreateAgentForm({ providers }: { providers: { id: string; handle: string; pen_name: string }[] }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(createAgent, {});
  const v = state.values ?? {};
  return (
    <form key={state.attempt ?? 0} action={action} className="grid gap-4 sm:grid-cols-2">
      <F label="소유">
        <select name="providerId" className={selectClass} defaultValue={v.providerId ?? "platform"}>
          <option value="platform">플랫폼 운영(자체 에이전트)</option>
          {providers.map((p) => (
            <option key={p.id} value={p.id}>
              {p.pen_name} (@{p.handle})
            </option>
          ))}
        </select>
      </F>
      <F label="주소(slug)">
        <Input name="slug" required placeholder="dundeun-momentum" defaultValue={v.slug} />
      </F>
      <F label="이름">
        <Input name="agentName" required placeholder="든든 모멘텀" defaultValue={v.agentName} />
      </F>
      <F label="설명">
        <Input name="description" placeholder="20일선 돌파 + 거래량 조건" defaultValue={v.description} />
      </F>
      <div className="space-y-2 sm:col-span-2">
        <Button type="submit" disabled={pending}>
          에이전트 만들기
        </Button>
        <Result state={state} />
      </div>
    </form>
  );
}

export function PublishForm({ agents }: { agents: { id: string; name: string; status: string }[] }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(publish, {});
  const v = state.values ?? {};
  return (
    <form key={state.attempt ?? 0} action={action} className="grid gap-4 sm:grid-cols-3">
      {/* 실패해 다시 그린 폼은 같은 요청 번호를 가진다. 새로고침하면 사라지므로, 결과를 모를 때는 이 화면에서 다시 누른다. */}
      <input type="hidden" name="requestId" value={v.requestId ?? ""} />
      <F label="에이전트">
        <select name="agentId" required className={selectClass} defaultValue={v.agentId}>
          {agents.filter((a) => a.status !== "TERMINATED").map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      </F>
      {/* 1R은 국내 시장만 봉인한다(공개 기한·진입 기준이 KRX 시간 기준, lib/agent-rules.ts ENTRY_MARKETS) */}
      <F label="시장">
        <select name="market" className={selectClass} defaultValue={v.market ?? "KOSPI"}>
          {ENTRY_MARKETS.map((m) => (
            <option key={m}>{m}</option>
          ))}
        </select>
      </F>
      <F label="종목 코드">
        <Input name="ticker" required placeholder="005930" defaultValue={v.ticker} />
      </F>
      <F label="방향">
        <select name="side" className={selectClass} defaultValue={v.side ?? "LONG"}>
          <option value="LONG">LONG(상승)</option>
          <option value="SHORT">SHORT(하락)</option>
        </select>
      </F>
      <F label="동작">
        <select name="signalAction" className={selectClass} defaultValue={v.signalAction ?? "ENTRY"}>
          <option value="ENTRY">ENTRY(진입)</option>
          <option value="EXIT">EXIT(청산)</option>
        </select>
      </F>
      <F label="청산 대상 진입 시그널 ID(EXIT일 때)">
        <Input name="entrySignalId" placeholder="uuid" defaultValue={v.entrySignalId} />
      </F>
      <F label="목표가">
        <Input name="targetPrice" inputMode="decimal" placeholder="78000" defaultValue={v.targetPrice} />
      </F>
      <F label="손절가">
        <Input name="stopLossPrice" inputMode="decimal" placeholder="71500" defaultValue={v.stopLossPrice} />
      </F>
      <F label="비중(0~1)">
        <Input name="suggestedWeight" inputMode="decimal" placeholder="0.1" defaultValue={v.suggestedWeight} />
      </F>
      {/* 공개 기한 = 발행일을 1일째로 센 마지막 거래일 15:30(core/reveal.ts). 장 마감 뒤 발행해도 그날이 1일째라 1일이면 이미 지난 기한이 된다(서버가 거부) */}
      <F label="최대 보유 거래일(발행일이 1일째, 장 마감 뒤 발행도 그날부터 셈)">
        <Input name="maxHoldingDays" inputMode="numeric" placeholder="10" defaultValue={v.maxHoldingDays} />
      </F>
      <F label="유효기한(KST)">
        <Input name="validUntil" type="datetime-local" defaultValue={v.validUntil} />
      </F>
      <F label="규칙 버전">
        <Input name="ruleVersion" required placeholder="momo-v1.0" defaultValue={v.ruleVersion} />
      </F>
      <div className="sm:col-span-3">
        <F label="근거(청산 후 공개)">
          <Textarea name="rationale" rows={2} maxLength={500} defaultValue={v.rationale} />
        </F>
      </div>
      {/* 서버가 이번 응답에서 규칙 버전·근거의 공급자 프로필 주소·필명과 같은 표기를 알렸을 때만, 체크하지 않은 채로 보인다(identityAck).
          값(ackFor)은 그때 보여 준 에이전트·문구·걸린 표기에 묶여, 체크한 뒤 에이전트나 걸린 칸의 문구를 바꾸면 서버가 다시 묻는다.
          다른 오류로 돌아오면 사라진다. 연락처(메일·링크·메신저 아이디·휴대전화 번호)는 확인해도 거부된다 */}
      {state.ackFor && (
        <label className="flex items-start gap-3 text-sm leading-relaxed sm:col-span-3">
          <input type="checkbox" name="identityAck" value={state.ackFor} className="mt-1 size-4 accent-primary" />
          <span>오류 안내의 &apos;걸린 표기&apos;는 모두 필명·주소와 겹치는 일반 낱말이며 공급자 신원 정보가 아님을 확인했습니다</span>
        </label>
      )}
      <div className="space-y-2 sm:col-span-3">
        <Button type="submit" disabled={pending}>
          {pending ? "봉인하는 중…" : "봉인하고 발행"}
        </Button>
        <p className="text-xs text-muted-foreground">발행하면 고칠 수도 지울 수도 없습니다. 모의(페이퍼) 기록으로 저장됩니다.</p>
        <p className="text-xs text-muted-foreground">
          규칙 버전·근거는 원문과 함께 공개됩니다. 필명·프로필 주소·연락처를 넣지 마세요. 공급자 에이전트는 메일·링크·메신저 아이디·휴대전화 번호를
          거부하고, 필명·프로필 주소와 같은 표기는 확인을 받습니다.
        </p>
        <Result state={state} />
      </div>
    </form>
  );
}

export function AnchorButton() {
  const [state, action, pending] = useActionState<ActionState, FormData>(anchor, {});
  return (
    <form action={action} className="space-y-2">
      <Button type="submit" variant="outline" disabled={pending}>
        {pending ? "만드는 중…" : "오늘(KST) 앵커 만들기"}
      </Button>
      <Result state={state} />
    </form>
  );
}
