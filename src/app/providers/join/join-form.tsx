"use client";

import { cloneElement, isValidElement, useActionState, useEffect, useRef } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { type JoinState, joinAction } from "./actions";

const selectClass =
  "h-9 w-full rounded-lg border border-input bg-transparent px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

// 힌트·오류 문구를 입력칸에 aria-describedby로 연결하고 오류 칸은 aria-invalid로 표시한다(화면낭독기가 어느 칸이 틀렸는지 읽도록).
function Field({ id, label, hint, error, children }: { id: string; label: string; hint?: string; error?: string; children: React.ReactElement<Record<string, unknown>> }) {
  const descId = `${id}-desc`;
  const control = isValidElement(children)
    ? cloneElement(children, { "aria-describedby": error || hint ? descId : undefined, "aria-invalid": error ? true : undefined })
    : children;
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      {control}
      {error ? (
        <p id={descId} className="text-sm text-destructive">
          {error}
        </p>
      ) : hint ? (
        <p id={descId} className="text-sm text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export function JoinForm({ referralCode, profileHost }: { referralCode?: string; profileHost: string }) {
  const [state, action, pending] = useActionState<JoinState, FormData>(joinAction, {});
  const f = state.fields ?? {};
  const v = state.values ?? {};
  const formRef = useRef<HTMLFormElement>(null);
  // 오류로 폼을 다시 그린 뒤 첫 오류 칸으로 포커스를 옮긴다(새로 마운트하면 포커스가 사라지므로).
  useEffect(() => {
    if (state.attempt) formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [state.attempt]);
  return (
    // React 19가 제출 뒤 폼을 초기화하므로, 오류 때 돌려받은 값으로 다시 그리도록 key로 새로 마운트한다.
    <form ref={formRef} key={state.attempt ?? 0} action={action} className="space-y-8">
      {state.message && (
        <Alert variant="destructive">
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      )}

      <div className="grid gap-6 sm:grid-cols-2">
        <Field id="penName" label="필명" hint="공개 프로필에 보이는 이름입니다. 실명이 아니어도 됩니다." error={f.penName}>
          <Input id="penName" name="penName" required maxLength={30} defaultValue={v.penName} />
        </Field>
        <Field id="handle" label="프로필 주소" hint={`${profileHost}/p/주소 — 영문 소문자·숫자·하이픈 3~30자(첫 글자는 영문·숫자)`} error={f.handle}>
          <Input id="handle" name="handle" required pattern="[a-z0-9][a-z0-9\-]{2,29}" defaultValue={v.handle} placeholder="blue-forest" />
        </Field>
      </div>

      <Field id="email" label="연락용 이메일(비공개)" hint="본인 확인·승인 안내와 운영 연락에 씁니다(인터뷰·소식은 아래에서 따로 동의). 공개 화면에 보이지 않습니다." error={f.email}>
        <Input id="email" name="email" type="email" required maxLength={254} defaultValue={v.email} />
      </Field>

      <div className="space-y-3">
        <div className="grid gap-6 sm:grid-cols-3">
          <Field id="strategyType" label="시그널을 만드는 방식" error={f.strategyType}>
            <select id="strategyType" name="strategyType" required className={selectClass} defaultValue={v.strategyType ?? "RULE"}>
              <option value="RULE">규칙 기반(퀀트)</option>
              <option value="ML">머신러닝</option>
              <option value="LLM">LLM 에이전트</option>
              <option value="DISCRETIONARY">재량</option>
            </select>
          </Field>
          <Field id="market" label="시장" error={f.market}>
            <select id="market" name="market" className={selectClass} defaultValue={v.market ?? "KR_STOCK"}>
              <option value="KR_STOCK">국내 주식</option>
              <option value="US_STOCK">미국 주식</option>
              <option value="OTHER">기타</option>
            </select>
          </Field>
          <Field id="holdingStyle" label="매매 보유 기간" error={f.holdingStyle}>
            <select id="holdingStyle" name="holdingStyle" required className={selectClass} defaultValue={v.holdingStyle ?? "SWING"}>
              <option value="SWING">스윙(며칠~몇 주)</option>
              <option value="POSITION">포지션(몇 주 이상)</option>
              <option value="DAY">단타(당일)</option>
            </select>
          </Field>
        </div>
        {/* 선택지를 지우면 재량 매매자가 '규칙 기반'을 골라 공개 프로필에 사실과 다른 방식이 실릴 수 있어, 선택지는 두고 받는 범위를 알린다 */}
        <p className="text-sm text-muted-foreground">
          이번 사전등록은 규칙·AI로 만드는 국내 주식 스윙 시그널을 중심으로 받습니다. 다른 시장·보유 기간·방식도 등록할 수 있으며, 기록 시작 여부는 승인
          안내 때 알려 드립니다.
        </p>
      </div>

      <Field id="description" label="전략 소개(공개)" hint="500자 이내. 수익률 자랑 대신 어떤 규칙으로 시그널을 내는지 적어 주세요." error={f.description}>
        <Textarea id="description" name="description" maxLength={500} rows={4} defaultValue={v.description} />
      </Field>

      <Field id="channels" label="지금 시그널을 공개하는 곳(공개, 선택)" hint="블로그·텔레그램·유튜브 등 URL을 띄어쓰기로 구분해 최대 3개" error={f.channels}>
        <Input id="channels" name="channels" defaultValue={v.channels} placeholder="https://blog.example.com https://t.me/example" />
      </Field>

      {/* 판매 경험·신고 여부는 묻지 않는다: 이메일과 같은 행에 '유료 판매 + 미신고'로 읽힐 기록을 남기지 않게(이메일을 받지 않는 익명 설문에서만 묻는다) */}
      <fieldset className="space-y-4">
        <legend className="sr-only">등록 조건 확인과 동의</legend>
        <label className="flex items-start gap-3 text-sm leading-relaxed">
          <input
            type="checkbox"
            name="ageConfirmed"
            required
            className="mt-1 size-4 accent-primary"
            defaultChecked={v.ageConfirmed === "on"}
            aria-invalid={f.ageConfirmed ? true : undefined}
            aria-describedby={f.ageConfirmed ? "ageConfirmed-desc" : undefined}
          />
          <strong>(필수) 만 19세 이상입니다</strong>
        </label>
        {f.ageConfirmed && (
          <p id="ageConfirmed-desc" className="text-sm text-destructive">
            {f.ageConfirmed}
          </p>
        )}
        <label className="flex items-start gap-3 text-sm leading-relaxed">
          <input
            type="checkbox"
            name="consentPrivacy"
            required
            className="mt-1 size-4 accent-primary"
            defaultChecked={v.consentPrivacy === "on"}
            aria-invalid={f.consentPrivacy ? true : undefined}
            aria-describedby={f.consentPrivacy ? "consentPrivacy-desc" : undefined}
          />
          {/* 동의 때 알릴 네 가지(항목·목적·보유 기간·거부권과 불이익)를 항목마다 목적을 붙여 적고, 보유·이용 기간은 굵게 표시한다(개인정보 보호법 제15조②·제22조②) */}
          <span className="space-y-1">
            <strong className="block">(필수) 개인정보 수집·이용 동의</strong>
            <span className="block">· 이메일(비공개): 본인 확인, 승인 결과 안내, 운영 연락</span>
            <span className="block">· 필명·프로필 주소·시그널 방식·시장·매매 보유 기간·전략 소개·채널 주소(승인 후 공개): 승인 검토, 공개 프로필 게시</span>
            <span className="block">· 초대한 공급자(비공개, 초대 링크로 들어온 경우): 그 공급자의 공개 프로필에 등록 수로만 집계</span>
            <strong className="block">보유·이용 기간: 탈퇴를 요청할 때까지(한 번도 승인되지 않은 등록은 등록일부터 1년)</strong>
            {/* 처리방침 2항과 같은 내용. 탈퇴 뒤에도 남기는 항목의 보유 기간도 눈에 띄게 굵게 알린다(개인정보 보호법 시행령 제17조③) */}
            <span className="block">
              한 번도 승인되지 않은 등록은 탈퇴하면 모든 항목을 바로 지우고, 탈퇴하지 않아도 등록일부터 1년이 지나면 모두 지웁니다. 승인된 적이 있으면 탈퇴할 때
              이메일·전략 소개·채널·초대 관계·선택 동의를 바로 지우고, 필명을 「탈퇴한 공급자」로 바꾸며 공개 프로필을 닫습니다. 이미 봉인된 시그널 기록은 지우지
              않고 그 표시로 계속 공개합니다. 탈퇴하면 운영 메일함에서 주고받은 메일도 지우며, 장애에 대비한 암호화 백업과, 복구할 때 탈퇴를 다시 적용하려고
              따로 적어 두는 기록(프로필 주소·처리일)에는 최대 30일 남았다가 지워집니다.
            </span>
            <strong className="block">
              승인된 적이 있는 등록의 탈퇴 뒤에도 남기는 항목과 기간: 프로필 주소(다른 사람의 사칭을 막는 용도, 공개하지 않음)·시그널 방식·시장·매매 보유
              기간·등록·동의 일시 — 서비스를 운영하는 동안 보관하고 서비스를 끝내면 지웁니다
            </strong>
            <span className="block">동의를 거부할 수 있으며, 거부하면 사전등록을 할 수 없습니다.</span>
          </span>
        </label>
        {f.consentPrivacy && (
          <p id="consentPrivacy-desc" className="text-sm text-destructive">
            {f.consentPrivacy}
          </p>
        )}
        <label className="flex items-start gap-3 text-sm leading-relaxed">
          <input type="checkbox" name="consentInterview" className="mt-1 size-4 accent-primary" defaultChecked={v.consentInterview === "on"} />
          <span>
            (선택) 인터뷰 요청 메일 수신 — 항목: 이메일 / 목적: 서비스 설계를 위한 인터뷰 일정 연락 /{" "}
            <strong>보유·이용 기간: 동의를 철회하거나 탈퇴할 때까지</strong> / 동의하지 않아도 사전등록에는 영향이 없습니다.
          </span>
        </label>
        <label className="flex items-start gap-3 text-sm leading-relaxed">
          <input type="checkbox" name="consentMarketing" className="mt-1 size-4 accent-primary" defaultChecked={v.consentMarketing === "on"} />
          <span>
            <strong>(선택) 판매 개시·서비스 소식 메일(광고성 정보) 수신</strong> — 항목: 이메일 / 목적: SIGNALS 판매 개시와 서비스 소식 안내 /{" "}
            <strong>보유·이용 기간: 수신을 거부하거나 탈퇴할 때까지</strong> / 동의하지 않아도 사전등록에는 영향이 없으며, 메일마다 적힌 방법으로 언제든 수신을
            거부할 수 있습니다.
          </span>
        </label>
      </fieldset>

      {/* 스팸 방지: 사람에게는 보이지 않는 칸 */}
      <div aria-hidden className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
        <label>
          웹사이트 <input type="text" name="website" tabIndex={-1} autoComplete="off" />
        </label>
      </div>
      <input type="hidden" name="referralCode" value={referralCode ?? ""} />

      <div className="space-y-3">
        <Button type="submit" size="lg" disabled={pending} className="w-full sm:w-auto">
          {pending ? "등록하는 중…" : "무료로 사전등록하기"}
        </Button>
        <p className="text-sm text-muted-foreground">결제는 없습니다. 등록 후 이메일로 본인 확인을 거쳐 승인되면 공개 프로필이 열리고, 기록 시작 방법을 안내합니다.</p>
      </div>
    </form>
  );
}
