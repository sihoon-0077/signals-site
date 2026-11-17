"use client";

// 검증은 브라우저에서 한다: 서버는 공개 자료(원문·지문·공개키·토큰·앵커)만 주고, 계산은 이 컴포넌트가 한다.
// 서버가 "VALID"라고 답하는 방식이면 서버를 믿어야 하므로 검증이 아니다(03 설계 §4.6).
// 공개키·앵커는 이 사이트가 준 값을 공개 저장소(GitHub)에서 브라우저가 직접 받은 사본과 다시 대조한다.
import { ChevronRight, CircleAlert, CircleCheck, CircleMinus, CircleX, LoaderCircle, type LucideIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { HashText } from "@/components/hash-text";
import { ListPanel, ListRow, Panel } from "@/components/panel";
import { type PillKind, StatusPill } from "@/components/status-pill";
import { TerminalBlock } from "@/components/terminal-block";
import { Badge } from "@/components/ui/badge";
import { type SignalFieldsV2, canonicalizeV2 } from "@/core/canonical";
import {
  type CheckResult,
  type CheckStatus,
  type OverallStatus,
  type SignalBundle,
  fetchMirror,
  isSignalKey,
  overallStatus,
  verifyAgainstMirror,
  verifySignalBundle,
} from "@/core/verify";
import { kstDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";

// 결과 화면은 검증이 끝난(불일치일 수도 있는) 묶음을 그린다. 그리다 예외가 나면 앱 오류 화면('일시적인 오류')이 떠서
// 위조·손상된 기록이 잠깐의 장애처럼 보이고, 같은 묶음에 '불일치'(exit 1)를 내는 명령줄 검증기와 결과가 갈린다.
// 그래서 사이트가 준 값은 화면에 넣기 전에 예외 없이 문자열로 바꾼다.

/** 공개된 원문의 정규 직렬화 문자열. 규칙에 맞지 않는 원문이면 null(CanonicalError뿐 아니라 문자열이 아닌 필드의 TypeError도). */
function canonicalOrNull(f: SignalFieldsV2): string | null {
  try {
    return canonicalizeV2(f);
  } catch {
    return null;
  }
}

/** 발행 시각 표시. 날짜로 읽히지 않는 값이면 '-'(kstDateTime은 그런 값에 RangeError를 낸다). */
function publishedText(v: unknown): string {
  try {
    return typeof v === "string" ? kstDateTime(v) : "-";
  } catch {
    return "-";
  }
}

// 항목 상태는 StatusPill(상태마다 모양이 다른 아이콘 + 아래 글자 라벨)로 그린다: 색만으로 통과·불일치를 가르지 않는다.
// 했어야 할 대조를 못 한 항목(UNCHECKED)은 '해당 없음'처럼 묻히지 않게 경고색의 속 빈 알약(실선 테두리, 채움 없음)으로 드러낸다(배경을 채운 '불일치'와는 구분).
const STATUS_KIND: Record<CheckStatus, PillKind> = {
  PASS: "pass",
  FAIL: "fail",
  SKIP: "skip",
  PENDING: "pending",
  UNCHECKED: "unchecked",
};
const STATUS_LABEL: Record<CheckResult["status"], string> = { PASS: "통과", FAIL: "불일치", SKIP: "해당 없음", PENDING: "반영 대기", UNCHECKED: "확인 못 함" };
const HEADLINE = {
  PASS: "모든 항목이 맞습니다",
  FAIL: "맞지 않는 항목이 있습니다",
  PARTIAL: "확인할 수 있는 항목은 모두 맞습니다",
  UNCHECKED: "공개 저장소와 대조하지 못했습니다",
} as const;
// 종합 결과 타일: 항목 알약과 같은 색·아이콘·모양 규칙(통과·부분·불일치 = 12% 채움, 확인 못 함 = 같은 경고색의 속 빈 타일).
// Tailwind는 소스에 그대로 적힌 클래스만 CSS로 만든다 → 상태 이름을 붙여 조립하지 않고 전부 적어 둔다.
const OVERALL_STYLE: Record<OverallStatus, { tile: string; Icon: LucideIcon }> = {
  PASS: { tile: "bg-status-pass/12 text-status-pass", Icon: CircleCheck },
  PARTIAL: { tile: "bg-status-skip/12 text-status-skip", Icon: CircleMinus },
  FAIL: { tile: "bg-status-fail/12 text-status-fail", Icon: CircleX },
  UNCHECKED: { tile: "border border-status-fail/50 text-status-fail", Icon: CircleAlert },
};

export function VerifyRunner({ id, mirrorRepo, mirrorBranch }: { id: string; mirrorRepo: string | null; mirrorBranch?: string | null }) {
  const [bundle, setBundle] = useState<SignalBundle | null>(null);
  const [results, setResults] = useState<CheckResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        // 링크 값은 요청 주소 경로에 들어간다. ID·지문 형식이 아니면 요청하지 않는다('../' 같은 값이 다른 주소를 부르지 않게).
        if (!isSignalKey(id)) throw new Error("검증 링크 형식이 올바르지 않습니다(시그널 ID 또는 64자리 지문이어야 합니다).");
        const res = await fetch(`/api/signals/${encodeURIComponent(id)}/bundle`, { cache: "no-store" });
        if (!res.ok) throw new Error(res.status === 404 ? "해당 시그널을 찾을 수 없습니다." : `공개 자료를 받지 못했습니다(HTTP ${res.status}).`);
        const b = (await res.json()) as SignalBundle;
        // 링크의 지문·ID와 서버가 준 기록이 같아야 한다(다른 기록을 보여 주는 바꿔치기 차단). 지문 링크가 더 강하다:
        // ID만 맞추는 바꿔치기는 원문이 공개된 뒤에야 지문 재계산(봉인된 ID)으로 드러난다.
        if (/^[0-9a-f]{64}$/i.test(id)) {
          if (b.signal.content_hash !== id.toLowerCase()) throw new Error("서버가 이 링크의 지문과 다른 기록을 보냈습니다(바꿔치기 의심).");
        } else if (String(b.signal.id).toLowerCase() !== id.toLowerCase()) {
          throw new Error("서버가 이 링크의 ID와 다른 기록을 보냈습니다(바꿔치기 의심).");
        }
        const mirror = mirrorRepo ? await fetchMirror(mirrorRepo, b.anchor?.date ?? null, { branch: mirrorBranch ?? undefined }) : null;
        const r = [...(await verifySignalBundle(b)), ...verifyAgainstMirror(b, mirror)];
        if (alive) {
          setBundle(b);
          setResults(r);
        }
      } catch (e) {
        if (alive) setError((e as Error).message);
      }
    })();
    return () => {
      alive = false;
    };
  }, [id, mirrorRepo, mirrorBranch]);

  // 오류 글은 서버·브라우저가 만든 문장이라 길이를 모른다: 글 칸을 minmax(0,1fr)로 두어 긴 글도 카드 안에서 줄을 바꾼다
  if (error)
    return (
      <Panel role="alert" className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-3 border-status-fail/40 bg-status-fail/10 text-status-fail">
        <CircleX aria-hidden="true" className="mt-0.5 size-5" />
        {error}
      </Panel>
    );
  // 계산 중: 결과 요약 카드와 같은 모양(16px 모서리·같은 여백)에 정적인 자리 표시 막대를 둔다. 얇은 한 줄짜리 카드면 계산이 끝날 때까지
  // 푸터가 화면 가운데로 올라와 있다가 결과가 뜨는 순간 아래로 밀려난다. 막대는 장식(aria-hidden)이고 깜빡이지 않는다(pulse 금지).
  if (!bundle || !results)
    return (
      <Panel role="status" pad="none" className="space-y-6 rounded-2xl p-6 text-sm text-muted-foreground sm:p-8">
        <div className="flex items-center gap-3">
          <LoaderCircle aria-hidden="true" className="size-4 shrink-0 motion-safe:animate-spin" />
          공개 자료를 받아 브라우저에서 계산하는 중…
        </div>
        <div aria-hidden="true" className="space-y-3">
          <div className="h-7 w-3/5 rounded-md bg-white/5" />
          <div className="h-4 w-full rounded bg-white/[0.035]" />
          <div className="h-4 w-4/5 rounded bg-white/[0.035]" />
        </div>
      </Panel>
    );
  return <VerifyResultView bundle={bundle} results={results} />;
}

/** 계산이 끝난 결과 화면. 받기·계산과 분리해 두어 상태별 문구를 테스트에서 바로 그려 볼 수 있다. */
export function VerifyResultView({ bundle, results }: { bundle: SignalBundle; results: CheckResult[] }) {
  const overall = overallStatus(results);
  const { tile, Icon } = OVERALL_STYLE[overall];
  // 지문 정착 연출은 '원문으로 지문 다시 계산'이 실제로 통과했을 때만(맞지 않는 지문이 '맞춰지는' 모습은 사실과 반대 신호)
  const hashPassed = results.some((r) => r.id === "hash" && r.status === "PASS");
  const s = bundle.signal;
  // 원본 JSON 링크에 넣는 값도 서버가 준 것이다(지문 링크면 ID는 대조하지 않은 값). ID·지문 형식일 때만 링크를 만든다.
  const bundleKey = isSignalKey(String(s.id)) ? String(s.id) : isSignalKey(String(s.content_hash)) ? String(s.content_hash) : null;
  // 원문 재계산(checkHash)과 같은 조건에서만 원문을 보여 준다
  const shownFields = s.revealed && s.fields ? s.fields : null;
  const canonical = shownFields ? canonicalOrNull(shownFields) : null;
  return (
    <div className="space-y-6" aria-live="polite">
      {/* 들어 올린 16px 카드 + 40px 상태 타일(장식이라 화면낭독기에서 숨김: 뜻은 옆 제목 글자가 전한다). 색 띠·색 테두리는 두지 않는다 */}
      <Panel pad="none" className="space-y-5 rounded-2xl p-6 elev-lift sm:p-8">
        <div className="flex items-start gap-4">
          <span aria-hidden="true" className={cn("grid size-10 shrink-0 place-items-center rounded-xl", tile)}>
            <Icon className="size-5" />
          </span>
          <div className="min-w-0 space-y-1">
            <p className="text-[0.8125rem] font-medium text-tertiary">종합 결과</p>
            <h2 className="text-xl leading-[1.35] font-semibold tracking-tight text-foreground sm:text-2xl">{HEADLINE[overall]}</h2>
          </div>
        </div>
        {overall === "UNCHECKED" && (
          <p className="text-sm leading-relaxed text-foreground">
            계산한 항목 중 맞지 않는 것은 없지만, 아래 &apos;확인 못 함&apos; 항목이 끝나기 전에는 사이트가 키를 바꿔 다시 서명한 기록이 아닌지 확인되지 않은
            상태입니다.
          </p>
        )}
        <p className="border-t border-line-subtle pt-4 text-sm leading-relaxed text-muted-foreground tabular-nums">
          순번 {String(s.sequence_no)} · 발행 {publishedText(s.published_at)} · 지문 <HashText value={String(s.content_hash)} head={16} copyLabel="지문" settle={hashPassed} />
        </p>
        {/* 결과 화면만 캡처돼 성과 보증처럼 쓰이지 않게, 상태와 상관없이 늘 참인 범위 문장을 큰 글씨 바로 아래에 둔다 */}
        <p className="text-sm leading-relaxed text-muted-foreground">
          이 검증은 기록이 결과 전에 이 내용으로 봉인됐는지와 그 뒤 바뀌지 않았는지만 확인합니다. 수익이나 실력을 보장하지 않으며, 과거 기록이 미래
          수익을 보장하지 않습니다. 투자 판단과 결과의 책임은 투자자 본인에게 있습니다.
        </p>
      </Panel>

      {/* 휴대폰에서는 알약을 설명 위에 두고(grid-cols-1 = minmax(0,1fr) 한 칸), 넓은 화면에서만 알약 칸(7rem) | 설명 칸으로 나눈다.
          설명 칸은 minmax(0,1fr) + min-w-0: 그냥 1fr·auto 칸은 글의 최소 폭보다 줄어들지 않아, 긴 값이 있으면 카드 밖으로 밀려 나간다. */}
      <ListPanel>
        {results.map((r) => (
          <ListRow key={r.id} className="grid grid-cols-1 gap-2.5 sm:grid-cols-[7rem_minmax(0,1fr)] sm:gap-5">
            <StatusPill kind={STATUS_KIND[r.status]} className="justify-self-start">{STATUS_LABEL[r.status]}</StatusPill>
            <div className="min-w-0 space-y-1">
              <p className="font-medium text-foreground">{r.label}</p>
              <p className="text-sm leading-relaxed break-words text-muted-foreground">{r.detail}</p>
            </div>
          </ListRow>
        ))}
      </ListPanel>

      {/* 브라우저 기본 펼침 삼각형을 지우고 같은 자리에 화살표 아이콘을 둔다: 펼치면 90도 돌아 아래를 가리킨다. Safari는 ::-webkit-details-marker로 따로 지운다.
          details가 overflow-hidden(hover 채움을 둥근 모서리로 자름)이라 바깥으로 그리는 포커스 테두리가 잘린다 → 목록 줄 링크처럼 안쪽(-2px)으로 그린다 */}
      <details className="group overflow-hidden rounded-xl border bg-card">
        <summary className="flex cursor-pointer list-none items-center gap-2 rounded-xl px-5 py-4 text-sm font-medium transition-colors group-open:rounded-b-none hover:bg-muted focus-visible:-outline-offset-2 [&::-webkit-details-marker]:hidden">
          <ChevronRight aria-hidden="true" className="size-4 shrink-0 text-tertiary motion-safe:transition-transform group-open:rotate-90" />
          계산에 쓴 공개 자료 보기
        </summary>
        <div className="space-y-4 border-t border-line-subtle px-5 py-4 text-sm">
          {shownFields ? (
            <div className="space-y-2">
              <p className="font-medium">정규 직렬화 문자열(이 문자열의 SHA-256이 지문)</p>
              {canonical !== null ? (
                <TerminalBlock wrap>{canonical}</TerminalBlock>
              ) : (
                <p className="text-status-fail">이 원문은 정규 직렬화 규칙에 맞지 않아 문자열을 만들 수 없습니다(위 &apos;원문으로 지문 다시 계산&apos; 항목 참고).</p>
              )}
            </div>
          ) : (
            <p className="text-muted-foreground">아직 원문 공개 전입니다. 지문·서명·시각·앵커만 공개됩니다.</p>
          )}
          <div className="flex flex-wrap gap-2">
            <Badge variant="outline">서명 키 {String(s.key_id)}</Badge>
            <Badge variant="outline">타임스탬프 {Array.isArray(bundle.timestamps) ? bundle.timestamps.length : 0}건</Badge>
            <Badge variant="outline">앵커 {bundle.anchor ? String(bundle.anchor.date) : "없음"}</Badge>
          </div>
          <div className="space-y-1">
            {bundleKey && (
              <a href={`/api/signals/${encodeURIComponent(bundleKey)}/bundle`} className="inline-block text-link underline underline-offset-4 transition-colors hover:text-foreground">
                원본 JSON 받기
              </a>
            )}
            <p className="text-muted-foreground">명령줄 검증기는 아직 공개 전입니다. 받아 둔 JSON은 검증기가 공개되면 그것으로 다시 검증할 수 있습니다.</p>
          </div>
        </div>
      </details>
    </div>
  );
}
