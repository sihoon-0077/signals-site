"use client";

// 검증은 브라우저에서 한다: 서버는 공개 자료(원문·지문·공개키·토큰·앵커)만 주고, 계산은 이 컴포넌트가 한다.
// 서버가 "VALID"라고 답하는 방식이면 서버를 믿어야 하므로 검증이 아니다(03 설계 §4.6).
// 공개키·앵커는 이 사이트가 준 값을 공개 저장소(GitHub)에서 브라우저가 직접 받은 사본과 다시 대조한다.
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { type SignalFieldsV2, canonicalizeV2 } from "@/core/canonical";
import { type CheckResult, type SignalBundle, fetchMirror, isSignalKey, overallStatus, verifyAgainstMirror, verifySignalBundle } from "@/core/verify";
import { kstDateTime, shortHash } from "@/lib/format";

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

const STATUS_STYLE: Record<CheckResult["status"], string> = {
  PASS: "bg-primary text-primary-foreground",
  FAIL: "bg-destructive text-white",
  // 회색 배경에 회색 글자는 대비가 4.5:1에 못 미친다 → 테두리 + 본문 색
  SKIP: "border bg-background text-foreground",
  PENDING: "border border-dashed border-foreground/60 bg-background text-foreground",
  // 했어야 할 대조를 못 한 항목은 '해당 없음'처럼 묻히지 않게 드러낸다(불일치의 빨간 바탕과는 구분되는 빨간 테두리)
  UNCHECKED: "border border-destructive bg-background text-destructive",
};
const STATUS_LABEL: Record<CheckResult["status"], string> = { PASS: "통과", FAIL: "불일치", SKIP: "해당 없음", PENDING: "반영 대기", UNCHECKED: "확인 못 함" };
const HEADLINE = {
  PASS: "모든 항목이 맞습니다",
  FAIL: "맞지 않는 항목이 있습니다",
  PARTIAL: "확인할 수 있는 항목은 모두 맞습니다",
  UNCHECKED: "공개 저장소와 대조하지 못했습니다",
} as const;

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

  if (error)
    return (
      <p role="alert" className="rounded-xl border border-destructive/40 px-5 py-6 text-destructive">
        {error}
      </p>
    );
  if (!bundle || !results)
    return (
      <p role="status" className="text-muted-foreground">
        공개 자료를 받아 브라우저에서 계산하는 중…
      </p>
    );
  return <VerifyResultView bundle={bundle} results={results} />;
}

/** 계산이 끝난 결과 화면. 받기·계산과 분리해 두어 상태별 문구를 테스트에서 바로 그려 볼 수 있다. */
export function VerifyResultView({ bundle, results }: { bundle: SignalBundle; results: CheckResult[] }) {
  const overall = overallStatus(results);
  const s = bundle.signal;
  // 원본 JSON 링크에 넣는 값도 서버가 준 것이다(지문 링크면 ID는 대조하지 않은 값). ID·지문 형식일 때만 링크를 만든다.
  const bundleKey = isSignalKey(String(s.id)) ? String(s.id) : isSignalKey(String(s.content_hash)) ? String(s.content_hash) : null;
  // 원문 재계산(checkHash)과 같은 조건에서만 원문을 보여 준다
  const shownFields = s.revealed && s.fields ? s.fields : null;
  const canonical = shownFields ? canonicalOrNull(shownFields) : null;
  return (
    <div className="space-y-10" aria-live="polite">
      <div className="space-y-3 rounded-xl border px-6 py-6">
        <p className="text-sm text-muted-foreground">종합 결과</p>
        <p className="text-2xl font-bold">{HEADLINE[overall]}</p>
        {overall === "UNCHECKED" && (
          <p className="text-sm leading-relaxed text-foreground/80">
            계산한 항목 중 맞지 않는 것은 없지만, 아래 &apos;확인 못 함&apos; 항목이 끝나기 전에는 사이트가 키를 바꿔 다시 서명한 기록이 아닌지 확인되지 않은
            상태입니다.
          </p>
        )}
        <p className="text-sm leading-relaxed text-muted-foreground">
          순번 {String(s.sequence_no)} · 발행 {publishedText(s.published_at)} · 지문 <code>{shortHash(String(s.content_hash), 16)}</code>
        </p>
        {/* 결과 화면만 캡처돼 성과 보증처럼 쓰이지 않게, 상태와 상관없이 늘 참인 범위 문장을 큰 글씨 바로 아래에 둔다 */}
        <p className="text-sm leading-relaxed text-muted-foreground">
          이 검증은 기록이 결과 전에 이 내용으로 봉인됐는지와 그 뒤 바뀌지 않았는지만 확인합니다. 수익이나 실력을 보장하지 않으며, 과거 기록이 미래
          수익을 보장하지 않습니다. 투자 판단과 결과의 책임은 투자자 본인에게 있습니다.
        </p>
      </div>

      <ol className="space-y-4">
        {results.map((r) => (
          <li key={r.id} className="flex gap-4 rounded-xl border px-5 py-4">
            <span className={`h-fit shrink-0 rounded-md px-2 py-1 text-xs font-medium ${STATUS_STYLE[r.status]}`}>{STATUS_LABEL[r.status]}</span>
            <div className="min-w-0 space-y-1">
              <p className="font-medium">{r.label}</p>
              <p className="text-sm leading-relaxed break-words text-muted-foreground">{r.detail}</p>
            </div>
          </li>
        ))}
      </ol>

      <details className="rounded-xl border px-5 py-4">
        <summary className="cursor-pointer text-sm font-medium">계산에 쓴 공개 자료 보기</summary>
        <div className="mt-4 space-y-4 text-sm">
          {shownFields ? (
            <div className="space-y-2">
              <p className="font-medium">정규 직렬화 문자열(이 문자열의 SHA-256이 지문)</p>
              {canonical !== null ? (
                <pre className="overflow-x-auto rounded-lg bg-muted/60 p-3 text-xs whitespace-pre-wrap break-all">{canonical}</pre>
              ) : (
                <p className="text-destructive">이 원문은 정규 직렬화 규칙에 맞지 않아 문자열을 만들 수 없습니다(위 &apos;원문으로 지문 다시 계산&apos; 항목 참고).</p>
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
              <a href={`/api/signals/${encodeURIComponent(bundleKey)}/bundle`} className="text-primary underline-offset-4 hover:underline">
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
