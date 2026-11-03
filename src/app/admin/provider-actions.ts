"use server";

// 사전등록 관리용 서버 액션. 서버 액션은 어느 페이지에서든 호출될 수 있는 공개 엔드포인트라, 미들웨어와 별개로 액션마다 관리자 인증을 다시 확인한다.
// 이 파일에서 내보내는 함수는 모두 서버 액션이 되므로, 인증이 없는 보조 함수는 내보내지 않는다.
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/server/admin-auth";
import { getDb } from "@/server/db";
import { clearOptionalConsent, rejectPendingSince } from "@/server/repo/providers";

/** datetime-local 입력값(KST, 'YYYY-MM-DDTHH:mm' 또는 초까지) → ISO 시각. 형식이 틀리거나 없는 날짜(2월 30일 등)면 null. */
function parseKstLocal(raw: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(raw);
  if (!m) return null;
  const local = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6] ?? "00"}`;
  const t = new Date(`${local}+09:00`);
  // 넘친 날짜는 다른 날로 바뀌므로 KST로 되돌려 입력과 같은지 비교한다
  if (Number.isNaN(t.getTime()) || new Date(t.getTime() + 9 * 3600 * 1000).toISOString().slice(0, 19) !== local) return null;
  return t.toISOString();
}

/**
 * 스팸 일괄 거절: 입력한 시각(KST) 이후에 들어온 대기 등록을 모두 거절한다(승인·탈퇴 처리한 행은 그대로).
 * 확인 버튼의 두 번째 클릭이 보내는 confirm=yes가 있을 때만 실행한다. 확인 전에는 제출 버튼이 없어, 입력칸에서 Enter를 누르면 확인 단계 없이 폼이 제출되기 때문이다.
 */
export async function rejectPendingSinceAction(form: FormData) {
  await requireAdmin();
  if (form.get("confirm") !== "yes") return;
  const since = parseKstLocal(String(form.get("since") ?? ""));
  if (!since) return;
  await rejectPendingSince(await getDb(), since);
  revalidatePath("/admin");
}

/**
 * 선택 동의만 철회(처리방침 4항): 공급자가 '인터뷰 연락은 그만'·'소식 메일 수신 거부'를 알려 오면 그 동의만 지운다(등록·공개 프로필은 그대로).
 * 관리자 화면의 해당 칸이 '-'로 바뀌어 다시 연락하지 않게 된다. 본인 확인·회신 기한은 DEPLOY.md 절차를 따른다.
 * 확인 버튼의 두 번째 클릭이 보내는 kind가 정해진 값일 때만 실행한다.
 */
export async function clearOptionalConsentAction(form: FormData) {
  await requireAdmin();
  const kind = form.get("kind");
  const id = String(form.get("providerId") ?? "");
  // 형식이 틀린 ID를 그대로 넘기면 DB가 uuid 형식 오류를 내 오류 화면이 뜬다. 화면의 숨은 칸 값만 오므로 조용히 끝낸다.
  if ((kind !== "interview" && kind !== "marketing") || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return;
  await clearOptionalConsent(await getDb(), id, kind);
  revalidatePath("/admin");
}
