// /privacy를 실제로 그려 3항(처리 위탁·국외 이전)의 운영 메일 업체 항목을 본다(MAIL_SERVICE).
// 해외 업체면 국외 이전 법정 항목(항목·국가·시기·방법·연락처·보유 기간)까지, 국내 업체면 처리 위탁으로만 적고,
// 값이 없거나 형식이 틀리면 '설정 필요'를 보여 배포 점검(smoke)이 잡게 한다.
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import PrivacyPage from "@/app/privacy/page";

const render = (mailService: string) => {
  vi.stubEnv("MAIL_SERVICE", mailService);
  return renderToStaticMarkup(PrivacyPage());
};
/** 1항·2항·3항(제목부터 다음 항 전까지) */
const section1 = (html: string) => html.slice(html.indexOf("1. 처리하는 항목과 목적"), html.indexOf("2. 보유 기간과 파기"));
const section2 = (html: string) => html.slice(html.indexOf("2. 보유 기간과 파기"), html.indexOf("3. 제3자 제공"));
const section3 = (html: string) => html.slice(html.indexOf("3. 제3자 제공"), html.indexOf("4. 정보주체의 권리"));
/** 렌더링 결과를 사람이 읽는 글로(태그를 빼고 공백을 하나로) */
const text = (html: string) => html.replace(/<[^>]+>/g, "").replace(/\s+/g, " ");
const FOREIGN = "Google LLC(미국, googlekrsupport@google.com)";
const DOMESTIC = "네이버(주)(대한민국, privacy@example.com)";
/** 3항에서 운영 메일 업체 항목(<li>) */
const mailItem = (html: string) => section3(html).match(/<li>(?:(?!<li>)[\s\S])*운영 메일(?:(?!<li>)[\s\S])*<\/li>/)?.[0] ?? "";

beforeEach(() => {
  vi.stubEnv("PRIVACY_OFFICER", "홍길동");
  vi.stubEnv("CONTACT_EMAIL", "privacy@example.com");
});
afterEach(() => vi.unstubAllEnvs());

describe("처리방침 3항의 운영 메일 업체", () => {
  it("해외 업체: 국외 이전 항목을 모두 적고, 이전 근거 국가는 그대로(미국)", () => {
    const html = render("Google LLC(미국, googlekrsupport@google.com)");
    const item = mailItem(html);
    expect(item).toContain("<strong>Google LLC</strong>(미국, googlekrsupport@google.com)");
    for (const s of ["운영 메일(본인 확인·승인 안내·시그널 접수·문의 답변)을 주고받고 보관", "이전 항목: 이메일 주소", "이전 국가: 미국 등", "시기·방법:", "보유·이용 기간: 2항의 보유 기간과 같음"]) {
      expect(item).toContain(s);
    }
    expect(section3(html)).toContain("이전 근거: 미국·싱가포르 이전은");
    expect(html).not.toContain("설정 필요");
  });

  it("미국·싱가포르가 아닌 해외 업체는 이전 근거의 국가 목록에 더한다", () => {
    const html = render("Proton AG(스위스, https://proton.me/support/contact)");
    expect(mailItem(html)).toContain("이전 국가: 스위스 등");
    expect(section3(html)).toContain("이전 근거: 미국·싱가포르·스위스 이전은");
  });

  it("국내 업체: 처리 위탁으로만 적고 국외 이전 항목은 쓰지 않는다", () => {
    const html = render("네이버(주)(대한민국, privacy@example.com)");
    const item = mailItem(html);
    expect(item).toContain("<strong>네이버(주)</strong>(대한민국, privacy@example.com)");
    expect(item).toContain("처리 위탁 항목: 이메일 주소");
    expect(item).not.toMatch(/이전 항목|이전 국가|시기·방법/);
    expect(section3(html)).toContain("이전 근거: 미국·싱가포르 이전은");
    expect(html).not.toContain("설정 필요");
  });

  it.each([
    ["비어 있음", ""],
    ["형식 틀림", "Gmail"],
    ["예시 자리표시", "Google LLC(미국, <Google 개인정보 문의처>)"],
    // 국가 칸이 국가 이름이 아니면 '이전 국가: 국내 등'·'이전 국가: 서울 등'처럼 사실과 다른 국외 이전이 공개됐다
    ["국내를 뜻하는 말 + 도시", "Gmail서비스(대한민국 서울, 1577-3321)"],
    ["도시 이름", "Gmail서비스(서울, 1577-3321)"],
  ])("값이 %s이면 '설정 필요'를 보이고 자리표시나 받은 값을 공개하지 않는다", (_name, value) => {
    const html = render(value);
    expect(mailItem(html)).toContain("(배포 전 MAIL_SERVICE 설정 필요)");
    expect(html).not.toMatch(/Gmail|&lt;Google/);
  });

  it("국가를 '국내'로 적은 국내 업체도 처리 위탁으로만 적는다", () => {
    const html = render("다음메일(국내, 1577-3321)");
    expect(mailItem(html)).toContain("처리 위탁 항목: 이메일 주소");
    expect(section3(html)).not.toMatch(/이전 국가: 국내|·국내 이전은/);
    expect(section3(html)).toContain("이전 근거: 미국·싱가포르 이전은");
  });

  it("3항 첫 문장은 국내·해외 업체 모두에 맞고, 2항은 탈퇴·파기 때 운영 메일함의 메일도 지운다고 적는다", () => {
    const html = render("Google LLC(미국, googlekrsupport@google.com)");
    expect(section3(html)).toContain("서비스 운영을 위해 아래 업체에 처리를 맡기며, 해외 업체에 맡기는 처리에서는 개인정보가 국외로 이전");
    expect(html).not.toContain("아래 해외 법인에 처리를 맡기며");
    expect(section2(html)).toContain("탈퇴·파기 때에는 운영 메일함(3항의 운영 메일 업체)에서 그 등록자와 주고받은 메일도 지웁니다.");
  });
});

// 첫 공개판에 들어 있어야 하는 항목들(공개한 뒤에 넣으면 8항의 사전 고지가 필요하다).
// 시그널은 승인된 공급자가 운영 메일로 보내고 운영자가 봉인한다(DEPLOY.md 8절). 사전등록하지 않은 사람도 6항 연락처로 메일을 보낸다.
describe("처리방침 1항·2항: 시그널 기록·문의 메일과 동의 없이 처리하는 항목의 근거", () => {
  it.each([
    ["해외 메일 업체", FOREIGN],
    ["국내 메일 업체", DOMESTIC],
    ["메일 업체 설정 전", ""],
  ])("1항에 시그널 기록·문의 메일 항목과, 목록과 따로 동의 없이 처리하는 항목의 법적 근거를 적는다(%s)", (_name, value) => {
    const s1 = section1(render(value));
    for (const s of [
      "시그널 기록(승인된 공급자가 운영 메일로 보낸 시그널): 종목·방향·동작(진입·청산)·목표가·손절가·최대 보유 거래일 또는 유효기한·규칙 버전·근거 등 시그널 내용과 봉인 시각 — 결과 전 기록 봉인, 공개 규칙에 따른 원문 공개(필명과 함께)",
      "문의 메일(6항 연락처로 메일을 보낸 경우, 사전등록하지 않은 분 포함): 이메일 주소, 메일에 표시된 보낸 사람 이름, 보낸 내용 — 문의 답변과 4항의 요청 처리",
      "동의 없이 처리하는 항목과 근거: 위의 자동 수집·자동 생성 항목은",
      "문의 메일은 답변을 위해 개인정보 보호법 제15조제1항제6호(운영자의 정당한 이익)에 따라 동의 없이 처리합니다",
      "시그널 기록은 승인된 공급자가 요청한 기록(결과 전 봉인과 공개 규칙에 따른 공개)을 하는 데 필요한 처리로 같은 항 제4호(계약의 이행)에 따라 처리합니다",
      "4항의 요청을 처리하는 데 필요한 정보(요청한 분의 이메일 주소·프로필 주소, 요청 내용과 요청·처리·회신 날짜)와 2항의 탈퇴 기록은 같은 항 제2호(법령상 의무)에 따라",
      "필수·선택 항목은 사전등록 화면에서 받은 동의에 따라 처리합니다.",
    ]) {
      expect(text(s1)).toContain(s);
    }
    // 동의받는 항목과 구분해(개인정보 보호법 제22조③): 항목 목록 안의 한 줄이 아니라 목록 뒤 따로 쓴 문단이다
    expect(s1.indexOf("동의 없이 처리하는 항목과 근거")).toBeGreaterThan(s1.lastIndexOf("</ul>"));
    // 시그널 기록은 동의 회신에 기대지 않는다(승인 안내 메일의 '동의합니다'는 공개 조건 확인이지 개인정보 동의가 아니다)
    expect(text(s1)).not.toMatch(/시그널 기록[^.]*동의(?:에 따라|를 받아)/);
  });

  it("2항: 1년 파기는 한 번도 승인되지 않은 등록만, 사전등록하지 않은 분의 메일은 마지막 답변 뒤 1년, 복구용 탈퇴 기록은 30일", () => {
    const s2 = text(section2(render(FOREIGN)));
    expect(s2).toContain("사전등록 정보는 탈퇴를 요청할 때까지 보유합니다. 한 번도 승인되지 않은 사전등록은 등록일부터 1년이 지나면 탈퇴와 같은 방식으로 처리합니다.");
    // '승인되지 않은'만 쓰면 '지금 승인 상태가 아님'(승인 뒤 거절)으로도 읽힌다. 코드는 승인된 적 없는 등록만 1년 뒤 지운다(repo/providers.ts)
    expect(s2).not.toMatch(/(?<!한 번도 )승인되지 않은 사전등록은/);
    expect(s2).toContain(
      "사전등록하지 않은 분과 주고받은 메일(문의·요청과 그 답변)은 마지막 답변을 보낸 날(답변하지 않은 메일은 받은 날)부터 1년이 지나면 운영 메일함에서 지웁니다.",
    );
    expect(s2).toContain("백업으로 복구하는 경우에는 그 사이의 탈퇴·파기 처리를 다시 적용합니다. 이를 위해 탈퇴 처리한 등록의 프로필 주소와 처리일만 백업과 따로 적어 두었다가(탈퇴 기록) 30일이 지나면 지웁니다.");
  });
});

describe("처리방침 3항: 시그널 접수와 문의 메일을 수탁자·국외 이전 항목에 넣는다", () => {
  it.each([
    ["해외 메일 업체", FOREIGN],
    ["국내 메일 업체", DOMESTIC],
  ])("운영 메일 업체 항목에 시그널 접수와, 사전등록하지 않은 분의 메일 보유 기간을 적는다(%s)", (_name, value) => {
    const item = text(mailItem(render(value)));
    expect(item).toContain("운영 메일(본인 확인·승인 안내·시그널 접수·문의 답변)을 주고받고 보관");
    expect(item).toContain("이메일 주소·보낸 사람 이름, 메일에 적힌 필명·프로필 주소와 주고받은 내용");
    expect(item).toContain(
      "보유·이용 기간: 2항의 보유 기간과 같음(탈퇴·파기 때 그 등록자와 주고받은 메일도 지우고, 사전등록하지 않은 분과 주고받은 메일은 마지막 답변 뒤 1년이 지나면 지움)",
    );
  });

  it("설정 전 자리표시에도 같은 목적을 적고, Vercel·Supabase 항목은 시그널 기록까지 담는다", () => {
    const s3 = text(section3(render("")));
    expect(s3).toContain("(배포 전 MAIL_SERVICE 설정 필요) — 운영 메일(본인 확인·승인 안내·시그널 접수·문의 답변)을 주고받는 업체");
    expect(s3).toContain("사전등록 양식 입력값, 관리자 화면에서 입력·표시하는 사전등록 정보와 시그널 기록 / 이전 국가: 미국 등");
    expect(s3).toContain("이전 항목: 1항의 사전등록 정보와 시그널 기록 전체 /");
    expect(s3).toContain("시기·방법: 사전등록하거나 시그널을 봉인할 때 암호화된 연결(TLS)로 저장");
  });

  it("해외 메일 업체일 때만 문의 메일의 국외 이전 거부 방법과 효과를 적는다(제28조의8 ②5)", () => {
    const refusal = "6항 연락처로 보내는 문의·요청 메일도 운영 메일 업체를 거쳐 국외에 보관되므로, 원하지 않으면 메일을 보내지 않을 수 있으며 이 경우 메일로 답변을 받을 수 없습니다.";
    expect(text(section3(render(FOREIGN)))).toContain(`사이트를 이용하지 않는 것 외에는 거부할 수 없습니다. ${refusal}`);
    expect(text(section3(render(DOMESTIC)))).not.toContain(refusal);
    expect(text(section3(render("")))).not.toContain(refusal);
  });
});

// 날짜 자체는 고정하지 않는다: 첫 배포가 다른 날로 밀리면 DEPLOY.md 4절 '시행일'대로 EFFECTIVE_DATE만 고쳐도 통과해야 한다
// (형식과 실제 있는 날짜인지는 providers/join/__tests__/public-wording.test.ts가 본다).
describe("처리방침 시행일", () => {
  it("시행일(EFFECTIVE_DATE)을 8항과 맨 끝에 같은 날짜로 적는다", () => {
    const t = text(render(FOREIGN));
    const applied = /이 처리방침은 (\d{4}년 \d{1,2}월 \d{1,2}일)부터 적용됩니다\./.exec(t)?.[1];
    expect(applied).toBeDefined();
    expect(t).toContain(`시행일: ${applied}`);
  });
});
