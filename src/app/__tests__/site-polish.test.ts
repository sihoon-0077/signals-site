// 운영 검증(11/18)에서 나온 작은 개선을 지킨다: 글꼴 교체 흔들림, 검증 화면 푸터 점프, 404 제목, 공유 미리보기, 링크 두 곳.
// 화면 모양은 브라우저 측정으로 확인했고, 여기서는 그 측정이 기대는 소스 규칙이 사라지지 않게만 본다(public-copy와 같은 방식).
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(path.join(process.cwd(), p), "utf8");

// "U+0020-007E, U+00A0" 같은 unicode-range 값 → 코드포인트 집합. 모양이 다른 토큰(와일드카드 ?, 다음 규칙까지 넘어 읽은 값 등)은
// 조용히 잘못 읽지 않고 바로 실패한다.
const codePoints = (ranges: string) => {
  const out = new Set<number>();
  for (const part of ranges.split(",")) {
    const m = /^u\+([0-9a-f]{1,6})(?:-([0-9a-f]{1,6}))?$/i.exec(part.trim());
    if (!m) throw new Error(`unicode-range 토큰을 읽지 못함: ${JSON.stringify(part.trim().slice(0, 40))}`);
    for (let cp = parseInt(m[1], 16); cp <= parseInt(m[2] ?? m[1], 16); cp++) out.add(cp);
  }
  return out;
};

// 글꼴 파일의 cmap(형식 12, 유니코드 전체)에서 글리프가 있는 코드포인트. Pretendard는 범위로 '선언'만 하고 글리프는 없는 글자가 있어
// (1.3.9 기준 1,125자, 예: 옛한글 자모 U+3165–318C), 선언 범위만 보면 그런 글자가 대체 글꼴로 영구히 남는 것을 놓친다.
// 조각 woff2들과 같은 글리프 집합인 PretendardVariable.ttf를 읽는다(woff2는 압축이라 그대로 못 읽는다).
const glyphCodePoints = (file: string) => {
  const buf = readFileSync(path.join(process.cwd(), file));
  let cmap = -1;
  for (let i = 0, n = buf.readUInt16BE(4); i < n; i++) if (buf.toString("latin1", 12 + i * 16, 16 + i * 16) === "cmap") cmap = buf.readUInt32BE(12 + i * 16 + 8);
  if (cmap < 0) throw new Error(`cmap 표가 없음: ${file}`);
  const out = new Set<number>();
  for (let i = 0, n = buf.readUInt16BE(cmap + 2); i < n; i++) {
    const sub = cmap + buf.readUInt32BE(cmap + 4 + i * 8 + 4);
    if (buf.readUInt16BE(sub) !== 12) continue;
    for (let g = 0, groups = buf.readUInt32BE(sub + 12); g < groups; g++) {
      const start = buf.readUInt32BE(sub + 16 + g * 12);
      const end = buf.readUInt32BE(sub + 20 + g * 12);
      for (let cp = start; cp <= end; cp++) out.add(cp);
    }
  }
  return out;
};

describe("글꼴 교체 흔들림 방지", () => {
  const css = read("src/app/globals.css");
  const faces = [...css.matchAll(/@font-face\s*\{([^}]*)\}/g)].map((m) => m[1]).filter((body) => body.includes('"Pretendard Fallback"'));

  it("맑은 고딕을 Pretendard 폭에 맞춘 대체 글꼴을 보통·굵게 두 면으로, local()로만 정의한다", () => {
    expect(faces).toHaveLength(2);
    for (const body of faces) {
      expect(body).toMatch(/size-adjust:\s*84\.6%/);
      expect(body).not.toContain("url("); // 네트워크 요청 없음
    }
    expect(faces.some((b) => b.includes('local("Malgun Gothic")') && /font-weight:\s*100 549/.test(b))).toBe(true);
    expect(faces.some((b) => b.includes('local("Malgun Gothic Bold")') && /font-weight:\s*550 900/.test(b))).toBe(true);
  });

  it("대체 글꼴은 Pretendard가 범위로 선언하고 글리프도 가진 글자에만 쓴다(그 밖의 글자는 예전처럼 시스템 글꼴 100%)", () => {
    // 레이아웃이 불러오는 동적 서브셋 CSS: 모든 @font-face의 unicode-range를 하나도 빠짐없이 읽었는지 개수로 확인한다
    const subsetCss = read("node_modules/pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css");
    const declaredRanges = [...subsetCss.matchAll(/unicode-range:\s*([^;]+);/g)].map((m) => m[1]);
    expect(declaredRanges.length).toBeGreaterThan(0);
    expect(declaredRanges).toHaveLength([...subsetCss.matchAll(/@font-face\s*\{/g)].length);
    const declared = new Set(declaredRanges.flatMap((r) => [...codePoints(r)]));
    const drawn = glyphCodePoints("node_modules/pretendard/dist/public/variable/PretendardVariable.ttf");

    const ranges = faces.map((body) => /unicode-range:\s*([^;]+);/.exec(body)?.[1]);
    expect(ranges[0]).toBeDefined();
    expect(ranges[1]).toBe(ranges[0]); // 보통·굵게 같은 범위
    const fallback = codePoints(ranges[0]!);
    // 여기에 걸리는 글자는 교체 뒤에도 맑은 고딕 84.6%로 남는다(선언 밖: ñ·ö·키릴 등, 선언만 있고 글리프 없음: 옛한글 자모 등)
    const hex = (cp: number) => `U+${cp.toString(16).toUpperCase().padStart(4, "0")}`;
    expect([...fallback].filter((cp) => !declared.has(cp)).map(hex)).toEqual([]);
    expect([...fallback].filter((cp) => !drawn.has(cp)).map(hex)).toEqual([]);
    // 화면 글 대부분을 이루는 글자는 들어 있어야 교체 흔들림을 막는다
    for (const cp of [0x20, 0x41, 0x7e, 0xb7, 0x2014, 0x3131, 0x3164, 0x318d, 0xac00, 0xd7a3]) expect(fallback.has(cp)).toBe(true);
  });

  it("본문·고정폭 글꼴 목록에서 Pretendard 바로 뒤에 둔다(목록 순서가 곧 우선순위)", () => {
    expect(css).toContain('--font-sans: "Pretendard Variable", Pretendard, "Pretendard Fallback", ');
    expect(css).toContain('--font-mono: var(--font-jetbrains-mono), "Pretendard Variable", "Pretendard Fallback", ');
  });
});

describe("검증 결과 화면", () => {
  const page = read("src/app/verify/[id]/page.tsx");

  it("결과 칸이 화면 높이만큼 자리를 잡아, 계산 중에는 푸터가 첫 화면 아래에 있다(인쇄에서는 끈다)", () => {
    expect(page).toMatch(/<div className="min-h-\[calc\(100vh-20rem\)\] print:min-h-0">\s*<VerifyRunner /);
  });

  it("형식이 아닌 값은 제목을 정할 때도 404로 끝낸다(탭 제목이 '기록 검증'으로 돌아가지 않게)", () => {
    expect(page).toMatch(/export async function generateMetadata[\s\S]*?if \(!isSignalKey\(id\)\) notFound\(\);[\s\S]*?return \{ title: "기록 검증" \};/);
    expect(page).not.toContain("export const metadata");
  });
});

describe("404 제목·공유 미리보기", () => {
  it("404 화면은 홈 제목이 아니라 자기 제목을 준다", () => {
    expect(read("src/app/not-found.tsx")).toContain('export const metadata: Metadata = { title: "페이지를 찾을 수 없습니다" };');
  });

  it("루트 메타데이터는 og·twitter 묶음만 두고, 제목·설명은 Next가 화면마다 채운다(canonical 없음)", () => {
    const layout = read("src/app/layout.tsx");
    expect(layout).toContain('openGraph: { type: "website", siteName: "SIGNALS", locale: "ko_KR" },');
    expect(layout).toContain('twitter: { card: "summary_large_image" },');
    expect(layout).not.toMatch(/canonical:/);
  });
});

describe("링크", () => {
  it("푸터의 공개키는 JSON 파일이라 a로 잇는다(Link면 화면에 보일 때마다 미리 불러와 서버 함수가 돈다)", () => {
    const footer = read("src/components/site-footer.tsx");
    expect(footer).toContain('<a href="/keys.json"');
    expect(footer).not.toContain('<Link href="/keys.json"');
  });

  it("헤더의 사전등록 버튼은 NavLink라 사전등록 화면에서 현재 페이지로 표시된다(주소별 동작은 site-header 테스트)", () => {
    const header = read("src/components/site-header.tsx");
    expect(header).toMatch(/<NavLink\s+href="\/providers\/join"/);
    // 바탕만으로는 평소·hover와 구분되지 않아 테두리를 입력칸 경계색(3:1 이상)으로 밝힌다
    expect(header).toContain("aria-[current=page]:border-input aria-[current=page]:bg-selected");
  });
});

describe("명령줄 블록 이름", () => {
  it("검증 방법 화면의 명령줄 블록은 같은 화면에 한 번만 있는 카드 제목 id를 이름으로 가리킨다", () => {
    const page = read("src/app/verify/page.tsx");
    const id = /<TerminalBlock\b[^>]*\blabelledBy="([^"]+)"/.exec(page)?.[1];
    expect(id).toBeDefined();
    expect(page.match(new RegExp(`\\bid="${id}"`, "g"))).toHaveLength(1);
  });
});
