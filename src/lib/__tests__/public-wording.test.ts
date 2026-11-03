// 공개 문구에 금지 표현이 다시 들어오지 않게 막는다(감사 F01·F05·F06·F57·F58).
// 사이트 소스는 사람이 읽는 문자열(문자열 리터럴·템플릿·JSX 텍스트)만 본다: 주석·변수 이름은 화면에 나가지 않으므로 걸지 않는다.
// 공개 앵커 저장소 템플릿은 저장소째 공개되므로(README·step 이름·주석·--help) 파일 전체를 본다.
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

/** 공개 화면에 나가는 소스. 검증 결과 문구는 src/core/verify.ts가 만든다. 운영자 화면(Basic 인증 뒤)과 테스트는 뺀다. */
const SOURCE_ROOTS = ["src/app", "src/components", "src/lib/format.ts", "src/core/verify.ts"];
const SKIP_DIRS = new Set(["__tests__", "admin"]);
/** 공개 GitHub 저장소에 그대로 올라가는 템플릿 */
const PUBLIC_REPO = "deploy/anchors-repo";

const BANNED: { re: RegExp; why: string }[] = [
  { re: /독립|independen/i, why: "금소법 제27조④: 독립금융상품자문업자가 아니면 '독립'(외국어 포함)을 명칭·광고에 못 씀 → '별도 구현'" },
  { re: /추천/, why: "투자 사이트에서 '종목 추천'으로 읽힘 → 초대 기능은 '초대'" },
  { re: /파는|팔리는/, why: "출시 전 무료 기간: 지금 판매하는 마켓처럼 쓰지 않음" },
  { re: /손댈 수 없|변조 ?불가|조작 ?불가|영구 ?(?:보존|공개)|사라질 수 없/, why: "과장: 사실은 '지우거나 고치면 드러난다'까지" },
  { re: /검증됨|검증된|검증 기간 통과|verified|인증된|리딩/i, why: "품질·성과 보증으로 읽힘" },
  { re: /신고 부담 없이|대신 신고|개별 신고(?:는|가)? ?(?:불필요|필요 없)/, why: "법률 검토 전: 공급자 신고 필요 여부를 약속하지 않음(중립 문구로)" },
  { re: /(?<![0-9A-Za-z])1R(?![0-9A-Za-z])/, why: "공모전 내부 용어(대회 1라운드): 방문자는 뜻을 알 수 없음 → '이번'·날짜로" },
];

function walk(p: string): string[] {
  if (!statSync(p).isDirectory()) return [p];
  return readdirSync(p).flatMap((f) => (SKIP_DIRS.has(f) ? [] : walk(path.join(p, f))));
}

/** TS/TSX에서 화면에 나갈 수 있는 글자만 뽑는다(줄 번호 포함). */
function userFacingText(fileName: string, source: string): { line: number; text: string }[] {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const out: { line: number; text: string }[] = [];
  const visit = (n: ts.Node) => {
    if (ts.isStringLiteralLike(n) || ts.isJsxText(n) || ts.isTemplateHead(n) || ts.isTemplateMiddle(n) || ts.isTemplateTail(n)) {
      out.push({ line: sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1, text: n.text });
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

function hits(file: string, chunks: { line: number; text: string }[]): string[] {
  const rel = path.relative(ROOT, file).replaceAll("\\", "/");
  return chunks.flatMap(({ line, text }) =>
    BANNED.flatMap(({ re, why }) => {
      const m = re.exec(text);
      return m ? [`${rel}:${line} '${m[0]}' — ${why}`] : [];
    }),
  );
}

describe("공개 문구 금지 표현", () => {
  it("점검기가 화면 문자열은 잡고 주석·변수 이름은 넘긴다", () => {
    const src = [
      "// 추천 관계 주석은 화면에 안 나간다",
      "const 독립 = 1;",
      'export const A = <p title="공유 링크">초대 링크 {"추천 링크"}</p>;',
      "const t = `기록 ${독립}건 · 독립 검증`;",
      "export const B = <span>지금 파는 마켓</span>;",
    ].join("\n");
    const found = hits(path.join(ROOT, "x.tsx"), userFacingText("x.tsx", src));
    expect(found).toEqual([
      "x.tsx:3 '추천' — 투자 사이트에서 '종목 추천'으로 읽힘 → 초대 기능은 '초대'",
      expect.stringMatching(/^x\.tsx:4 '독립'/),
      expect.stringMatching(/^x\.tsx:5 '파는'/),
    ]);
  });

  it("공개 화면 문자열에 금지 표현이 없다", () => {
    const files = SOURCE_ROOTS.flatMap((r) => walk(path.join(ROOT, r))).filter((f) => /\.(ts|tsx)$/.test(f));
    expect(files.length).toBeGreaterThan(20); // 경로가 틀려 아무것도 읽지 않고 통과하는 것을 막는다
    const found = files.flatMap((f) => hits(f, userFacingText(f, readFileSync(f, "utf8"))));
    expect(found).toEqual([]);
  });

  it("공개 앵커 저장소 템플릿(README·워크플로·스크립트)에 금지 표현이 없다", () => {
    const files = walk(path.join(ROOT, PUBLIC_REPO));
    expect(files.some((f) => f.endsWith("README.md"))).toBe(true);
    const found = files.flatMap((f) => hits(f, readFileSync(f, "utf8").split("\n").map((text, i) => ({ line: i + 1, text }))));
    expect(found).toEqual([]);
  });
});
