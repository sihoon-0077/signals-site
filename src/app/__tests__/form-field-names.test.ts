// 폼 필드 이름이 HTMLFormElement의 기본 속성과 겹치면 form.id·form.action 등이 그 input으로 가려진다(DOM clobbering).
// 실제 사고: <input name="id">가 있으면 React가 제출 버튼 값을 담을 때 쓰는 form.id가 input 요소가 되어,
// name="event" 버튼 값이 FormData에서 빠지고 청산·만료·무효 버튼이 아무 일도 하지 않았다.
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const RESERVED = ["id", "action", "method", "target", "name", "elements", "length", "submit", "reset", "encoding", "enctype", "acceptCharset", "autocomplete", "noValidate", "rel", "relList"];

function tsxFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = path.join(dir, f);
    return statSync(p).isDirectory() ? tsxFiles(p) : p.endsWith(".tsx") ? [p] : [];
  });
}

describe("폼 필드 이름", () => {
  it("HTMLFormElement 기본 속성 이름을 쓰지 않는다", () => {
    const pattern = new RegExp(`\\bname=["'{]\\s*["']?(${RESERVED.join("|")})["']`, "g");
    const hits = tsxFiles(path.join(process.cwd(), "src")).flatMap((file) =>
      [...readFileSync(file, "utf8").matchAll(pattern)].map((m) => `${path.relative(process.cwd(), file)}: name="${m[1]}"`),
    );
    expect(hits).toEqual([]);
  });
});
