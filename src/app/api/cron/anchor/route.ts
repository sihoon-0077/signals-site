// 일일 앵커 생성 호출구. 공개 앵커 저장소의 GitHub Actions(deploy/anchors-repo)가 매일 18시(KST) 무렵 부른다(예약 실행이라 늦어질 수 있음).
// Vercel Cron도 같은 형식(Authorization: Bearer $CRON_SECRET, GET)으로 부를 수 있다. 같은 날짜는 한 번만 저장되므로 함께 켜도 안전하다.
// 같은 날짜는 한 번만 만들어지고(다시 부르면 저장된 앵커를 돌려줌), 응답의 document는 공개 API와 같은 공개 자료다.
// 날짜 규칙(시각은 인증 직후 한 번만 잡는다):
//  - ?date=YYYY-MM-DD를 보내면 그 날짜가 아직 오늘(KST)일 때만 만든다. 자정 직전에 시작한 요청·재시도가 자정 뒤에 닿아
//    다음 날 앵커를 00시에 확정하면, 복구하려던 날은 빈 날로 남고 다음 날 발행분이 하루씩 밀린다.
//  - 운영에서는 18시(KST) 전 요청에 앵커를 만들지 않는다(관리자 버튼과 같은 규칙). 일찍 만들면 그날 앵커가 그 시각으로 확정된다.
// 응답 본문은 공개 저장소의 Actions 기록에 찍힐 수 있으므로 비밀값·연결 문자열·DB 오류 메시지를 넣지 않는다.
import { kstHour, kstToday } from "@/core/date";
import { checkBearer, cronSecretProblem } from "@/lib/basic-auth";
import { isProduction } from "@/server/config";
import { getDb } from "@/server/db";
import { purgeStaleRegistrations } from "@/server/repo/providers";
import { AnchorConsistencyError, buildDailyAnchor } from "@/server/services/anchor";
import { InputError, publicError } from "@/server/sql";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60; // 루트 타임스탬프(TSA) 요청이 기관당 최대 10초

async function run(req: Request) {
  const secret = process.env.CRON_SECRET;
  const problem = cronSecretProblem(secret);
  if (problem) return Response.json({ error: problem }, { status: 503 });
  if (!checkBearer(req.headers.get("authorization"), secret)) return Response.json({ error: "unauthorized" }, { status: 401 });
  // 날짜·시각은 여기서 한 번만 정한다. DB 연결·파기를 마친 뒤 다시 읽으면, 자정 직전에 도착한 요청도 다음 날 날짜가 된다.
  const now = new Date();
  const today = kstToday(now);
  const asked = new URL(req.url).searchParams.get("date");
  let purged: number | undefined;
  try {
    const db = await getDb();
    // 개인정보 보유 기간이 지난 미승인 등록 파기는 앵커보다 먼저 한다: 앵커가 409·500으로 멈춘 날에도 처리방침의 '등록일부터 1년' 약속이 지켜지게.
    // 앵커 리프는 agents·signals만 읽으므로 순서를 바꿔도 앵커 결과는 같다. 파기가 실패해도(-1) 앵커는 그대로 만든다.
    purged = await purgeStaleRegistrations(db).catch((e) => {
      console.error("[cron/anchor] 미승인 등록 파기 실패", e);
      return -1;
    });
    // 요청한 날짜가 이미 지났으면(자정을 넘겨 도착한 요청) 만들지 않는다. 다시 보내도 같으므로 5xx가 아니라 422로 끝낸다(재시도 안 함).
    // 18시 확인보다 먼저 본다: 자정 직후(0시)에 닿은 요청은 둘 다 해당하는데, 이쪽이 실제 원인이다.
    if (asked !== null && asked !== today) {
      return Response.json({ error: "date_passed", message: "요청한 날짜가 오늘(KST)이 아니라 만들지 않습니다", purged_registrations: purged }, { status: 422 });
    }
    // 공개 저장소 작업은 18시 전에는 부르지 않으므로, 이 응답은 손으로 부른 요청이거나 작업 쪽 시계가 어긋난 경우다.
    if (isProduction() && kstHour(now) < 18) {
      return Response.json({ created: false, skipped: "before-18-kst", document: null, purged_registrations: purged });
    }
    try {
      const r = await buildDailyAnchor(db, today);
      return Response.json({ created: r.created, tsa_errors: r.tsaErrors, purged_registrations: purged, document: r.document });
    } catch (e) {
      // 과거 기록이 바뀐 것이 발견되면 앵커를 만들지 않고 409로 알린다 → 워크플로가 실패해 공개 경보가 된다.
      if (e instanceof AnchorConsistencyError) return Response.json({ error: "consistency", message: e.message, purged_registrations: purged }, { status: 409 });
      // 날짜 확인 실패(DB 연결·파기 도중 자정이 지남): 다시 보내도 같으므로 422. 500이면 공개 저장소 작업이 다시 시도한다.
      // 이 메시지는 앱이 만든 문장(날짜만 들어 있음)이라 그대로 내보낸다.
      if (e instanceof InputError) return Response.json({ error: "invalid_input", message: e.message, purged_registrations: purged }, { status: 422 });
      throw e;
    }
  } catch (e) {
    // 그대로 던지면 Next가 본문 없는 500을 보내, 공개 작업 기록에 원인이 남지 않는다(Hobby 런타임 로그는 1시간뿐).
    // 자세한 내용은 서버 로그에만 남기고, 응답에는 코드와 정해 둔 문장만 넣는다(DB 호스트·사용자명 노출 방지).
    console.error("[cron/anchor] 앵커 생성 실패", e);
    const { code, message } = publicError(e);
    return Response.json({ error: "internal", code, message, ...(purged === undefined ? {} : { purged_registrations: purged }) }, { status: 500 });
  }
}

export const GET = run;
export const POST = run;
