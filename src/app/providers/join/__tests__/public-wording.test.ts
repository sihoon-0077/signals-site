// 사전등록 화면·동의 문구·처리방침의 공개 문구 점검(소스를 읽어 확인, form-field-names.test.ts와 같은 방식).
// 동의 문구와 처리방침은 실제 처리와 같아야 하고, 신고 전 서비스가 해서는 안 되는 표현이 들어가면 안 된다.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/** 주석을 빼고(설명 주석에 금지어를 인용해도 걸리지 않게) 공백을 하나로 모은 소스. JSX 문구는 줄바꿈으로 갈라지므로 렌더링된 글과 같은 모양이 된다. */
const read = (p: string) =>
  readFileSync(path.join(process.cwd(), p), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/\s+/g, " ");

const FILES = {
  page: "src/app/providers/join/page.tsx",
  form: "src/app/providers/join/join-form.tsx",
  done: "src/app/providers/join/done/page.tsx",
  actions: "src/app/providers/join/actions.ts",
  privacy: "src/app/privacy/page.tsx",
};

// 신고 전 무료 기록 서비스가 쓰면 안 되는 표현(과장·자문 오인·신고 관련 약속). '유사투자자문업'은 법령 용어라 허용한다.
const FORBIDDEN = [
  /독립/,
  /independent/i,
  /추천/,
  /(?<!유사)투자자문/,
  /수익 보장/,
  /확실/,
  /리딩/,
  /검증된|검증됨|verified|인증된/i,
  /변조 불가|영구|손댈 수 없/,
  /파는 마켓/,
  /신고 부담 없이|개별 신고 불필요|대신 신고/,
  /미신고/,
  /(?<![0-9A-Za-z])1R(?![0-9A-Za-z])/, // 공모전 내부 용어(대회 1라운드). 공급자는 뜻을 알 수 없다(감사 F08 공통 원칙)
];

describe("사전등록 공개 문구", () => {
  it("금지 표현이 없다", () => {
    for (const f of [FILES.page, FILES.form, FILES.done, FILES.privacy]) {
      const text = read(f);
      for (const re of FORBIDDEN) expect({ file: f, hit: re.exec(text)?.[0] ?? null }).toEqual({ file: f, hit: null });
    }
  });

  it("가입 화면이 등록 조건과 기록 공개 조건, 판매·신고에 대한 중립 안내를 보인다", () => {
    const page = read(FILES.page);
    for (const s of [
      "국내 주식 시그널(스윙 중심",
      "규칙·코드·AI로 반복해서 만드는 시그널",
      "만 19세 이상",
      "손실이 나도 지우거나 고치지 않고, 모든 기록을 공개합니다",
      "필명과 함께 공개됩니다",
      "「탈퇴한 공급자」 표시로 계속 공개합니다",
      "시그널 판매와 결제가 없습니다",
      "판매를 시작할 때 공급자의 신고 필요 여부를 포함한 구조는 법률 검토로 확정해 안내합니다.",
    ]) {
      expect(page).toContain(s);
    }
  });

  it("봉인 시각을 사실대로 쓴다: 사이트에는 시그널을 받는 기능이 없고 운영자가 봉인한 시각이 기록·진입 기준이 된다", () => {
    const page = read(FILES.page);
    expect(page).not.toMatch(/받는 즉시|보내신 때부터 봉인/);
    for (const s of [
      "보내 주신 시그널은 운영자가 받아 봉인한 때부터 결과 전 기록이 됩니다",
      "기록 시각은 보내신 시각이 아니라 봉인 시각이며, 봉인은 운영자가 직접 하므로 보내신 때보다 늦어질 수 있습니다",
      "나중에 성과를 계산할 때 쓰는 진입 기준도 봉인 뒤 받은 외부 타임스탬프 시각 이후의 가격으로 정합니다(수익률은 아직 표시하지 않습니다)",
      "보내 주신 첫 시그널을 운영자가 봉인한 때부터 기록합니다(기록 시각은 봉인 시각입니다)",
      // 받는 곳: 처리방침 3항에 적힌 운영 메일뿐이다(메신저·설문 폼은 처리방침에 없는 수탁자라 쓰지 않는다)
      "등록한 이메일에서 운영 메일(개인정보 처리방침 6항 연락처)로 보내 주신 첫 시그널을",
      "시그널은 메일로만 받으며 메신저·설문 폼으로는 받지 않습니다.",
    ]) {
      expect(page).toContain(s);
    }
  });

  it("폼은 만 19세 확인을 필수로 받고 판매 경험·신고 여부는 묻지 않으며, 보유·이용 기간을 굵게 알린다", () => {
    const form = read(FILES.form);
    expect(form).toMatch(/name="ageConfirmed" required/);
    expect(form).toContain("(필수) 만 19세 이상입니다");
    expect(form).not.toMatch(/hasSoldBefore|hasFiledAdvisory|판매 경험|신고 여부/);
    // 1년 파기는 승인된 적 없는 등록만이다(repo/providers.ts). '승인되지 않은'만 쓰면 승인 뒤 거절된 등록도 1년 뒤 지우는 것으로 읽힌다
    expect(form).toContain('<strong className="block">보유·이용 기간: 탈퇴를 요청할 때까지(한 번도 승인되지 않은 등록은 등록일부터 1년)</strong>');
    expect(form).toContain("<strong>(선택) 판매 개시·서비스 소식 메일(광고성 정보) 수신</strong>");
    expect(form.match(/<strong>보유·이용 기간: /g)?.length).toBe(2); // 선택 동의 두 개
    expect(form).toMatch(/name="email" type="email" required maxLength=\{254\}/);
    expect(read(FILES.actions)).toContain('ageConfirmed: form.get("ageConfirmed") === "on"');
  });

  it("동의 상자는 처리방침 2항과 같게, 승인된 적 없는 등록은 모두 지우고 탈퇴 뒤에도 남기는 항목과 그 기간을 굵게 알린다", () => {
    const form = read(FILES.form);
    expect(form).toContain("한 번도 승인되지 않은 등록은 탈퇴하면 모든 항목을 바로 지우고, 탈퇴하지 않아도 등록일부터 1년이 지나면 모두 지웁니다");
    expect(form).toContain("탈퇴하면 운영 메일함에서 주고받은 메일도 지우며");
    // 복구 때 탈퇴를 다시 적용하려고 따로 적는 기록(DEPLOY.md 2-1)도 '모든 항목을 바로 지운다'의 예외로 알린다(처리방침 2항과 같게)
    expect(form).toContain("장애에 대비한 암호화 백업과, 복구할 때 탈퇴를 다시 적용하려고 따로 적어 두는 기록(프로필 주소·처리일)에는 최대 30일 남았다가 지워집니다");
    expect(form).not.toMatch(/(?<!한 번도 )승인되지 않은 등록은 등록일부터/);
    expect(form).toMatch(
      /<strong className="block"> ?승인된 적이 있는 등록의 탈퇴 뒤에도 남기는 항목과 기간: 프로필 주소\(다른 사람의 사칭을 막는 용도, 공개하지 않음\)·시그널 방식·시장·매매 보유 기간·등록·동의 일시 — 서비스를 운영하는 동안 보관하고 서비스를 끝내면 지웁니다 ?<\/strong>/,
    );
    // 예전 문구: 승인 여부와 상관없이 주소를 남긴다고만 쓰고 기간이 없었다
    expect(form).not.toContain("공개하지 않은 채 남깁니다");
  });

  it("완료 화면은 새 등록과 중복 이메일이 같은 화면이다(주소의 값·등록마다 다른 링크 없음)", () => {
    const done = read(FILES.done);
    expect(done).not.toMatch(/searchParams|CopyField|\?handle=|\?ref=/);
    expect(read(FILES.actions)).not.toMatch(/redirect\(`/);
  });

  it("처리방침이 실제 수탁자·국외 이전 항목·보유와 파기·나이·변경 고지를 적는다", () => {
    const privacy = read(FILES.privacy);
    for (const s of [
      "시행일: {EFFECTIVE_DATE}",
      "이 처리방침은 {EFFECTIVE_DATE}부터 적용됩니다",
      "Supabase Pte. Ltd.",
      "privacy@supabase.com",
      "Vercel Inc.",
      "privacy@vercel.com",
      "제28조의8 제1항 제3호 가목",
      "만 14세 미만 아동의 개인정보는 받지 않으며",
      "만 19세 미만의 등록으로 확인되면 승인하지 않고 모든 항목을 바로 지웁니다(승인된 뒤에 확인되면 2항의 탈퇴와 같이 처리)",
      "최대 30일 보관한 뒤",
      "백업으로 복구하는 경우에는 그 사이의 탈퇴·파기 처리를 다시 적용합니다",
      // 복구에 대비한 탈퇴 기록(DEPLOY.md 2-1): 무엇을 얼마나 남기는지 적는다
      "이를 위해 탈퇴 처리한 등록의 프로필 주소와 처리일만 백업과 따로 적어 두었다가(탈퇴 기록) 30일이 지나면 지웁니다",
      // 탈퇴·1년 파기(repo/providers.ts): 승인된 적 없는 등록만 1년 뒤 지우고, 공개된 적 있는 등록만 주소 등을 기간을 정해 남긴다
      "한 번도 승인되지 않은 사전등록은 등록일부터 1년이 지나면 탈퇴와 같은 방식으로 처리합니다",
      "공개 프로필이 열린 적 없는 등록(한 번도 승인되지 않은 등록)은 탈퇴하거나 1년이 지나 파기할 때 모든 항목을 바로 지웁니다",
      "사용 중지 상태로 남기며 공개하지 않습니다",
      "이 항목들은 서비스를 운영하는 동안 보관하고 서비스를 끝내면 지웁니다",
      // 운영 메일 업체(MAIL_SERVICE): 3항에 적고(시그널 접수 포함), 탈퇴·파기 때 메일함의 메일도 지운다
      "parseMailService(process.env.MAIL_SERVICE)",
      "운영 메일(본인 확인·승인 안내·시그널 접수·문의 답변)을 주고받고 보관",
      "탈퇴·파기 때에는 운영 메일함(3항의 운영 메일 업체)에서 그 등록자와 주고받은 메일도 지웁니다",
      // 시그널 기록: 1항 항목, 수탁자(Supabase·Vercel) 이전 항목
      "시그널 기록(승인된 공급자가 운영 메일로 보낸 시그널)",
      "결과 전 기록 봉인, 공개 규칙에 따른 원문 공개(필명과 함께)",
      "1항의 사전등록 정보와 시그널 기록 전체",
      "관리자 화면에서 입력·표시하는 사전등록 정보와 시그널 기록",
      // 사전등록하지 않은 분의 문의·요청 메일: 1항 항목과 2항 보유 기간
      "문의 메일(6항 연락처로 메일을 보낸 경우, 사전등록하지 않은 분 포함)",
      "사전등록하지 않은 분과 주고받은 메일(문의·요청과 그 답변)은 마지막 답변을 보낸 날(답변하지 않은 메일은 받은 날)부터 1년이 지나면 운영 메일함에서 지웁니다",
      // 동의 없이 처리하는 항목과 그 법적 근거(개인정보 보호법 제22조③)
      "동의 없이 처리하는 항목과 근거:",
      "제15조제1항제6호(운영자의 정당한 이익)",
      "같은 항 제4호(계약의 이행)",
      "같은 항 제2호(법령상 의무)",
      "시행 7일 전부터",
      "30일 전부터",
    ]) {
      expect(privacy).toContain(s);
    }
    // 예전 문구(사실과 다름): 수탁 법인, 받지 않게 된 항목, 공개 프로필처럼 남는다는 설명, 해외 법인만 있다는 첫 문장, 미성년 등록을 익명화로 처리한다는 설명
    expect(privacy).not.toMatch(/Supabase Inc\.\(미국\)|판매 경험|신고 여부|익명화된 행|\[업체|아래 해외 법인에 처리를 맡기며|탈퇴와 같은 방식으로 바로 지웁니다/);
    // 1년 파기 대상을 '지금 승인 상태가 아닌 등록'으로 넓게 읽히게 쓰지 않는다
    expect(privacy).not.toMatch(/(?<!한 번도 )승인되지 않은 사전등록은 등록일부터/);
  });

  it("시행일은 실행할 때 계산하지 않는 실제 날짜 문자열이다(DEPLOY대로 첫 공개일로 바꿔도 통과)", () => {
    const privacy = read(FILES.privacy);
    const m = /const EFFECTIVE_DATE = "(\d{4})년 (\d{1,2})월 (\d{1,2})일";/.exec(privacy);
    expect(m).not.toBeNull();
    const [y, mo, d] = m!.slice(1).map(Number);
    const date = new Date(Date.UTC(y, mo - 1, d));
    expect([date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate()]).toEqual([y, mo, d]); // 2월 30일 같은 없는 날짜가 아님
    expect(date.getTime()).toBeGreaterThanOrEqual(Date.UTC(2026, 9, 30)); // 첫 공개 준비를 시작한 날보다 앞설 수 없다(연도 오타 방지)
    expect(privacy.match(/const EFFECTIVE_DATE =/g)).toHaveLength(1);
  });
});
