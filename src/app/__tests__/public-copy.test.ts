// 공개 화면 문구가 1R 사이트가 실제로 하는 일과 맞는지 지킨다(감사 F05·F07·F08·F10·F11·F14·F43·F56·F57·F59).
// 출시 전 무료 기록 서비스다: 판매·결제·수익률 계산·명령줄 검증기 공개처럼 아직 없는 것을 있는 것처럼 쓰면 공개 주장이 거짓이 된다.
// 이 테스트 설정은 tsconfig의 jsx: preserve를 따라 .tsx를 불러올 수 없어서, 화면 소스의 글자를 읽어 본다(JSX 줄바꿈은 공백 하나로 맞춘다).
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { AGENT_STATUS_LABEL } from "@/lib/format";

const read = (p: string) => readFileSync(path.join(process.cwd(), p), "utf8").replace(/\s+/g, " ");

describe("홈·메타데이터: 출시 전 무료 기록 서비스", () => {
  const layout = read("src/app/layout.tsx");
  const home = read("src/app/page.tsx");

  it("제목·설명이 지금 하는 일(봉인·대조)과 무료·결제 없음을 말한다", () => {
    expect(layout).toMatch(/default: "SIGNALS — 결과 전에 봉인하고 누구나 대조하는/);
    expect(layout).toMatch(/description: "[^"]*출시 전 무료 기간[^"]*결제를 받지 않/);
    // og:image·공유 링크 주소는 siteUrl() 하나로 정한다(여기서 localhost로 따로 대체하면 Vercel 운영 주소 대체가 막힘)
    expect(layout).toContain("metadataBase: new URL(siteUrl())");
    expect(layout).not.toContain("process.env.SITE_URL");
  });

  it("홈은 판매·결제가 없다고 말하고, 공급자 신고 문제는 법률 검토 전이라 중립으로 쓴다", () => {
    expect(home).toContain("지금은 시그널을 팔거나 결제를 받지 않습니다");
    expect(home).toContain("판매를 시작할 때 공급자의 신고 필요 여부를 포함한 구조는 법률 검토로 확정해 안내합니다.");
  });

  it("없는 기능(실패·수익률 계산)을 '증명하는 것'으로 쓰지 않는다", () => {
    expect(home).not.toMatch(/실패까지 같은 규칙|성과 계산의 진입가는/);
    expect(home).toContain("수익률(시세 데이터 이용계약 전이라 아직 표시하지 않음)");
  });

  it("홈 CTA는 공개 프로필·링크가 본인 확인·승인 뒤라고 쓴다(가입·완료·404 화면과 같게)", () => {
    expect(home).not.toContain("지금 등록하면 공개 프로필");
    expect(home).toContain("사전등록 후 이메일 본인 확인과 승인을 거치면 공개 프로필과 공유·초대 링크를 받고");
  });
});

describe("검증·앵커 화면", () => {
  it("진입 기준은 가격 확인이 아니라 시각으로 정하는 기준이고, 명령줄 검증기는 공개 전이라고 쓴다", () => {
    const verify = read("src/app/verify/page.tsx");
    expect(verify).not.toMatch(/진입가가 외부 타임스탬프 이후 가격인지 확인/);
    expect(verify).toContain("수익률은 시세 데이터 이용계약 전이라 아직 표시하지 않습니다");
    expect(verify).toContain("명령줄로 검증하기(검증기 공개 후 사용 가능)");
    expect(read("src/app/verify/[id]/page.tsx")).toContain("이 사전등록 기록을 직접 검증합니다");
  });

  it("일일 앵커 일정을 단정하지 않는다(늦어질 수 있음, 빠진 날은 채우지 않음)", () => {
    const anchors = read("src/app/anchors/page.tsx");
    expect(anchors).not.toContain("18:00 KST에");
    expect(anchors).toContain("매일 18시(KST) 무렵");
    expect(anchors).toContain("늦어질 수 있습니다");
    expect(anchors).toContain("나중에 채우지 않고 빈 날로 남깁니다");
  });

  it("원문 공개 규칙에 운영자 처리 경로와 '이른 때'를 함께 쓴다(reveal.ts와 같게)", () => {
    const agent = read("src/app/a/[slug]/page.tsx");
    expect(agent).toContain("운영자가 청산·만료·무효로 처리한 기록은 바로 공개되고");
    expect(agent).toContain("중 이른 때");
  });

  it("시그널 방향은 예상으로 쓴다(맨 '상승/하락'은 주가가 오르내린 결과로 읽힌다)", () => {
    const agent = read("src/app/a/[slug]/page.tsx");
    expect(agent).toContain('s.side === "LONG" ? "LONG(상승 예상)" : "SHORT(하락 예상)"');
    expect(agent).not.toMatch(/\? "상승" : "하락"/);
  });
});

describe("상태 배지·프로필", () => {
  it("에이전트 상태 배지는 합격·영구처럼 읽히지 않고, 계획서 기준(30일·15건·완결 8건)을 그대로 쓴다", () => {
    for (const label of Object.values(AGENT_STATUS_LABEL)) expect(label).not.toMatch(/통과|영구|검증\s?됨/);
    expect(AGENT_STATUS_LABEL.ACTIVE).toContain("30일·15건·완결 8건");
  });

  it("프로필은 '승인' 대신 '프로필 공개', 가입 경로는 '초대'로 쓰고 접속 수는 참고용이라고 밝힌다", () => {
    const profile = read("src/app/p/[handle]/page.tsx");
    expect(profile).toContain("프로필 공개 {kstDateTime(p.approved_at)}");
    expect(profile).toMatch(/공유·초대 링크 접속 \{p\.referral_visits\}회\([^)]*참고용\)/);
  });

  it("'지우거나 바꾸면 드러난다'는 일일 앵커로 고정된 뒤에만 맞으므로 조건을 붙인다(홈의 '외부 고정 이후 구간'과 같게)", () => {
    const profile = read("src/app/p/[handle]/page.tsx");
    expect(profile).toContain("각 기록은 결과 전에 봉인됐고, 일일 앵커로 외부에 고정된 뒤에는 지우거나 바꾸면 드러납니다.");
    expect(profile).not.toContain("봉인됐고, 지우거나 바꾸면 드러납니다");
  });
});

describe("공유 카드(OG 이미지)", () => {
  const og = read("src/app/p/[handle]/opengraph-image.tsx");

  it("카드 안에 모의 기록·수익 비보장을 적고, 조건 없는 '지우거나 바꾸면 드러나는'은 쓰지 않는다", () => {
    expect(og).toContain('tagline: "매일 외부에 고정하는 모의 기록 · 수익을 보장하지 않음"');
    expect(og).not.toContain("지우거나 바꾸면 드러나는");
  });

  it("카드가 굳지 않게: 기록 수로 주소가 바뀌고, 캐시는 짧고, 없는 주소는 일반 404", () => {
    expect(og).toMatch(/generateImageMetadata[\s\S]*id: `r\$\{card\.records\}`/);
    expect(og).toMatch(/"Cache-Control": `public, max-age=0, s-maxage=\$\{font \? 600 : 60\}`/);
    expect(og).toMatch(/new Response\("Not Found", \{ status: 404/);
  });

  it("글꼴 요청은 3초 안에 끝내고, truetype·opentype만 받는다", () => {
    expect(og).toContain("AbortSignal.timeout(FONT_TIMEOUT_MS)");
    expect(og).toMatch(/const FONT_TIMEOUT_MS = 3000;/);
    expect(og).toContain("format\\('(?:truetype|opentype)'\\)");
  });
});
