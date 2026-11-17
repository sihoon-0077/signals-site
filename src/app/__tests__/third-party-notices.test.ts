// React Bits 라이선스(MIT + Commons Clause)는 사본에 저작권 표시와 라이선스 문구를 함께 두라고 한다. 빌드된 JS는 압축 때
// 파일 머리의 /*! … */ 주석이 지워지므로, 같은 고지를 사이트 주소 /third-party-notices.txt(public 폴더)로도 제공한다.
// 저장소의 THIRD_PARTY_NOTICES.md만 고치고 사이트 사본을 잊으면 두 고지가 어긋나므로 글자 그대로 같은지 본다.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(path.join(process.cwd(), p), "utf8");

describe("제3자 코드 고지", () => {
  it("사이트로 제공하는 사본(public/third-party-notices.txt)은 THIRD_PARTY_NOTICES.md와 글자 그대로 같다", () => {
    expect(read("public/third-party-notices.txt")).toBe(read("THIRD_PARTY_NOTICES.md"));
  });

  it("모든 화면의 푸터가 사이트 사본을 연결한다(주소만 있고 아무 데서도 이어지지 않으면 방문자가 찾을 수 없다)", () => {
    expect(read("src/components/site-footer.tsx")).toContain('href="/third-party-notices.txt"');
  });

  it("사본에 React Bits 저작권 표시와 라이선스 이름이 있다", () => {
    const notices = read("public/third-party-notices.txt");
    expect(notices).toContain("Copyright (c) 2026 David Haz");
    expect(notices).toContain("MIT + Commons Clause License Condition v1.0");
  });
});
