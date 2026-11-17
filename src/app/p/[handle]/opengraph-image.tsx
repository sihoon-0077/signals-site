// 공유 미리보기 카드(X·카카오톡 등). 한글 글꼴은 Google Fonts에서 카드에 쓰는 글자만 받아 넣는다.
import { ImageResponse } from "next/og";
import { STRATEGY_LABEL, STYLE_LABEL } from "@/lib/format";
import { getDb } from "@/server/db";
import { listAgentsByProvider } from "@/server/repo/agents";
import { getApprovedProviderByHandle } from "@/server/repo/providers";

export const runtime = "nodejs";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "SIGNALS 공급자 프로필";

async function loadCard(handle: string) {
  const db = await getDb();
  const p = await getApprovedProviderByHandle(db, handle);
  if (!p) return null;
  const records = (await listAgentsByProvider(db, p.id)).reduce((n, a) => n + a.chain_length, 0);
  return { p, records };
}

// 카카오톡·X·페이스북은 og:image를 '이미지 주소' 기준으로 캐시해, 주소가 같으면 카드를 다시 받지 않는다.
// 그래서 기록 수를 주소에 넣는다(/p/<handle>/opengraph-image/r12): 기록이 늘면 새 주소 → 새 카드.
// 승인 전·거절·탈퇴·없는 주소는 빈 배열 → 페이지에 og:image가 아예 없고, 이미지 주소는 Next가 404로 답한다.
export async function generateImageMetadata({ params }: { params: Promise<{ handle: string }> }) {
  const { handle } = await params;
  const card = await loadCard(handle);
  return card ? [{ id: `r${card.records}`, size, alt, contentType }] : [];
}

const FONT_TIMEOUT_MS = 3000;
const FONT_CACHE_MAX = 64;
// 같은 글자 묶음의 글꼴은 다시 받지 않는다(크롤러·CDN 만료 때마다 같은 카드를 다시 그린다). 인스턴스 메모리라 개수에 상한을 둔다.
const fontCache = new Map<string, ArrayBuffer>();

/** Satori는 TrueType(00 01 00 00, 'true')·OpenType('OTTO')만 읽는다. woff2나 오류 HTML을 넘기면 카드 생성이 중간에 실패한다. */
function isSfnt(data: ArrayBuffer): boolean {
  const tag = String.fromCharCode(...new Uint8Array(data, 0, Math.min(4, data.byteLength)));
  return tag === "\x00\x01\x00\x00" || tag === "true" || tag === "OTTO";
}

/** 카드 글자만 담은 Noto Sans KR 굵게. 3초 안에 못 받거나 형식이 다르면 null(→ 한글 없는 대체 카드). */
async function koreanFont(text: string): Promise<ArrayBuffer | null> {
  // 글자 집합만 보낸다: 필명이 순서대로 외부에 나가지 않고, 같은 글자 묶음은 캐시 한 칸을 쓴다
  const chars = [...new Set(text)].sort().join("");
  const hit = fontCache.get(chars);
  if (hit) return hit;
  try {
    // 두 요청을 합쳐 3초. 없으면 Google이 느릴 때 카드 요청이 함수 제한 시간(최대 300초)까지 매달리고 크롤러는 먼저 포기한다.
    const signal = AbortSignal.timeout(FONT_TIMEOUT_MS);
    const css = await fetch(`https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@700&text=${encodeURIComponent(chars)}`, {
      headers: { "User-Agent": "Mozilla/5.0" },
      signal,
    });
    if (!css.ok) return null;
    const url = /src: url\((.+?)\) format\('(?:truetype|opentype)'\)/.exec(await css.text())?.[1];
    if (!url) return null;
    const res = await fetch(url, { signal });
    if (!res.ok) return null;
    const data = await res.arrayBuffer();
    if (!isSfnt(data)) return null;
    if (fontCache.size >= FONT_CACHE_MAX) {
      const oldest = fontCache.keys().next();
      if (!oldest.done) fontCache.delete(oldest.value);
    }
    fontCache.set(chars, data);
    return data;
  } catch {
    return null;
  }
}

const PRINTABLE_ASCII = /^[\x20-\x7e]+$/;

export default async function Image({ params }: { params: Promise<{ handle: string }> }) {
  const { handle } = await params;
  const card = await loadCard(handle);
  // generateImageMetadata 확인 직후 승인이 취소된 경우. ImageResponse({ status: 404 })는 1년 immutable 헤더를 물려받으므로 일반 Response로 답한다.
  if (!card) return new Response("Not Found", { status: 404, headers: { "Cache-Control": "no-store" } });
  const { p, records } = card;
  const ko = {
    title: p.pen_name,
    sub: `${STRATEGY_LABEL[p.strategy_type]} · ${STYLE_LABEL[p.holding_style]}`,
    line: `결과 전에 봉인한 기록 ${records}건`,
    // 카드가 홍보에 쓰여도 성과 보증처럼 읽히지 않게: 모의 기록이고 수익을 보장하지 않는다는 것을 카드 안에 둔다.
    // '지우거나 바꾸면 드러난다'는 일일 앵커 뒤에만 맞는데, 조건까지 넣으면 기록 수가 네 자리일 때 줄이 깨져 하는 일(매일 외부 고정)만 쓴다.
    tagline: "매일 외부에 고정하는 모의 기록 · 수익을 보장하지 않음",
  };
  const font = await koreanFont(`${ko.title}${ko.sub}${ko.line}${ko.tagline}SIGNALS`);
  // 글꼴이 없을 때 한글을 그리면 □로 나오고, @vercel/og가 시간 제한 없이 Google에 글꼴을 다시 요청한다 → 영문·숫자만 쓰는 대체 카드.
  const text = font
    ? ko
    : {
        // 프로필 주소는 영문 소문자·숫자·하이픈뿐이다(등록 규칙). 필명이 영문이면 필명을 쓴다.
        title: PRINTABLE_ASCII.test(p.pen_name) ? p.pen_name : PRINTABLE_ASCII.test(p.handle) ? p.handle : "SIGNALS",
        sub: "Signal records sealed before results",
        line: `${records} ${records === 1 ? "record" : "records"}`,
        tagline: "Paper records. Not a profit guarantee.",
      };
  // 사이트와 같은 다크 팔레트(globals.css :root): 바탕 #0B0D10, 제목·기록 수 줄 #E6E8EB, 보조 #AEB5BE, 짧은 메타 #8C949F.
  // 강조색 #A3A9FF는 SIGNALS 글자 하나에만 쓴다: 사이트 전체 규칙처럼 숫자(기록 수)를 강조색으로 칠하지 않고, 굵기로만 눈에 띄게 한다.
  // 1px 테두리는 다크 모드 메신저에서 카드 가장자리가 배경에 묻히지 않게 한다. Satori는 자식이 여럿인 div에 display:flex가 있어야 그린다.
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", padding: 72, background: "#0B0D10", border: "1px solid #2A3038", color: "#E6E8EB", fontFamily: "NotoSansKR" }}>
        <div style={{ fontSize: 30, fontWeight: 700, color: "#A3A9FF" }}>SIGNALS</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <div style={{ fontSize: 76, fontWeight: 700 }}>{text.title}</div>
          <div style={{ fontSize: 34, color: "#AEB5BE" }}>{text.sub}</div>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", fontSize: 30 }}>
          <div style={{ color: "#E6E8EB", fontWeight: 700 }}>{text.line}</div>
          <div style={{ color: "#8C949F", fontSize: 24 }}>{text.tagline}</div>
        </div>
      </div>
    ),
    {
      ...size,
      fonts: font ? [{ name: "NotoSansKR", data: font, weight: 700, style: "normal" }] : undefined,
      // Next 15 기본값(1년 immutable)을 덮어쓴다: 브라우저·크롤러는 매번 다시 확인하고, Vercel CDN만 잠깐 보관한다(s-maxage는 Vercel이 쓰고 브라우저에는 보내지 않음).
      // 대체 카드는 1분만 보관해 글꼴을 다시 받을 수 있게 되면 곧 한글 카드로 바뀌게 한다.
      headers: { "Cache-Control": `public, max-age=0, s-maxage=${font ? 600 : 60}` },
    },
  );
}
