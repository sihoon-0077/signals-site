// 사이트 기본 공유 카드(카카오톡·X 등). 공급자 화면(/p/<handle>)은 자기 카드를 쓰고, 나머지 화면은 이 카드를 쓴다.
// 빌드 때 한 번 그려 정적 파일로 나간다: 요청 시점 API(headers·cookies·DB)를 쓰지 않는다. 쓰면 매 요청마다 그리게 되고,
// 아래 글꼴 경로(process.cwd())는 서버 함수 묶음에 들어가지 않아 실패한다.
// 글꼴은 저장소의 Pretendard(OFL, node_modules)를 읽는다 → Google 등 외부 요청이 없다. 카드에 없는 글자를 쓰면
// @vercel/og가 Google에 글꼴을 찾으러 가므로, 문구는 아래 상수만 쓴다(site-images 테스트가 외부 요청 0을 지킨다).
import { readFile } from "node:fs/promises";
import path from "node:path";
import { ImageResponse } from "next/og";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
// 루트 제목과 같은 문장(새 문구를 만들지 않는다)
export const alt = "SIGNALS — 결과 전에 봉인하고 누구나 대조하는 AI 시그널 기록";

// 모두 사이트에 이미 있는 문구: 홈 히어로 윗줄·h1 두 줄, 공급자 카드의 아랫줄(모의 기록·수익 보장 아님)
const EYEBROW = "출시 전 무료 기간 · 공급자 사전등록 중";
const HEADLINE = ["결과 전에 봉인하고", "누구나 다시 대조하는 AI 시그널 기록"] as const;
const TAGLINE = "매일 외부에 고정하는 모의 기록 · 수익을 보장하지 않음";

export default async function Image() {
  const bold = await readFile(path.join(process.cwd(), "node_modules/pretendard/dist/public/static/Pretendard-Bold.otf"));
  // 공급자 카드(p/[handle]/opengraph-image.tsx)와 같은 틀·색(globals.css :root): 바탕 #08090a, 제목 #f7f8f8, 보조 #b4bcd0,
  // 짧은 메타 #8a8f98, 테두리 흰색 12%, 강조색 #a3a9ff는 SIGNALS 글자 하나에만. Satori는 자식이 여럿인 div에 display:flex가 있어야 그린다.
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", padding: 72, background: "#08090a", border: "1px solid rgba(255,255,255,0.12)", color: "#f7f8f8", fontFamily: "Pretendard" }}>
        <div style={{ fontSize: 30, fontWeight: 700, color: "#a3a9ff" }}>SIGNALS</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          <div style={{ fontSize: 28, color: "#b4bcd0" }}>{EYEBROW}</div>
          <div style={{ display: "flex", flexDirection: "column", fontSize: 64, fontWeight: 700, lineHeight: 1.25 }}>
            <div>{HEADLINE[0]}</div>
            <div>{HEADLINE[1]}</div>
          </div>
        </div>
        <div style={{ color: "#8a8f98", fontSize: 24 }}>{TAGLINE}</div>
      </div>
    ),
    { ...size, fonts: [{ name: "Pretendard", data: bold, weight: 700, style: "normal" }] },
  );
}
