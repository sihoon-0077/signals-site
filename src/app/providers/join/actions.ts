"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getDb } from "@/server/db";
import { ConflictError, InputError } from "@/server/sql";
import { DuplicateEmailError, registerProvider } from "@/server/services/registration";

export interface JoinState {
  message?: string;
  fields?: Record<string, string>;
  values?: Record<string, string>;
  attempt?: number;
}

export async function joinAction(_prev: JoinState, form: FormData): Promise<JoinState> {
  const values = Object.fromEntries([...form.entries()].filter(([k]) => !k.startsWith("$")).map(([k, v]) => [k, String(v)]));
  const attempt = Date.now();
  // 띄어쓰기·쉼표 모두 구분자로 받고, 끝에 붙은 문장부호는 떼어 낸다(쉼표로 이어 쓴 주소가 깨진 링크 하나로 저장되지 않게).
  const channels = String(form.get("channels") ?? "")
    .split(/[\s,]+/)
    .map((s) => s.trim().replace(/[.,;]+$/, ""))
    .filter(Boolean);
  const referral = String(form.get("referralCode") ?? "") || (await cookies()).get("ref")?.value;
  try {
    await registerProvider(await getDb(), {
      handle: form.get("handle"),
      penName: form.get("penName"),
      email: form.get("email"),
      strategyType: form.get("strategyType"),
      market: form.get("market") || "KR_STOCK",
      holdingStyle: form.get("holdingStyle"),
      description: form.get("description") ?? "",
      channels,
      ageConfirmed: form.get("ageConfirmed") === "on",
      consentPrivacy: form.get("consentPrivacy") === "on",
      consentMarketing: form.get("consentMarketing") === "on",
      consentInterview: form.get("consentInterview") === "on",
      referralCode: referral || undefined,
      website: form.get("website") ?? "",
    });
  } catch (e) {
    // 이미 등록된 이메일은 새 등록과 똑같이 끝낸다(아래의 같은 redirect). 기존 등록은 그대로 두고 이번 내용은 버린다.
    // DuplicateEmailError는 ConflictError의 하위 클래스라 이 검사가 ConflictError보다 먼저여야 한다.
    if (!(e instanceof DuplicateEmailError)) {
      if (e instanceof InputError) return { message: e.message, fields: e.fields, values, attempt };
      if (e instanceof ConflictError) return { message: e.message, values, attempt };
      console.error("[joinAction]", e);
      return { message: "일시적인 오류로 등록하지 못했습니다. 잠시 뒤 다시 시도해 주세요.", values, attempt };
    }
  }
  // 주소에 handle·초대 코드를 붙이지 않는다: 붙이면 새 등록만 다른 주소·다른 화면이 되어 '이 이메일이 이미 등록됐는가'가 드러난다.
  // (한계: 같은 handle로 다시 제출하면 handle 중복 안내로 추론할 수 있다. registration.ts의 DuplicateEmailError 참고)
  // redirect는 예외를 던지므로 try 밖에서 부른다.
  redirect("/providers/join/done");
}
