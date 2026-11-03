// MAIL_SERVICE(운영 메일함 업체) 읽기: 처리방침 3항에 그대로 공개되므로 국가로 위탁·국외 이전을 가르고, 틀린 값은 쓰지 않는다.
// 운영 빌드 검사(mailServiceProblem)는 같은 규칙에 CONTACT_EMAIL 도메인 대조를 더하고, 문제 설명에 받은 값을 넣지 않는다.
import { describe, expect, it } from "vitest";
import { mailServiceProblem, parseMailService } from "@/lib/mail-service";

describe("parseMailService", () => {
  it("해외 업체: 법인명·국가·문의처를 나누고 국외 이전으로 본다", () => {
    expect(parseMailService("Google LLC(미국, googlekrsupport@google.com)")).toEqual({
      name: "Google LLC",
      country: "미국",
      contact: "googlekrsupport@google.com",
      domestic: false,
    });
    // 앞뒤·괄호 안 공백, https 주소 문의처
    expect(parseMailService("  Proton AG ( 스위스 ,  https://proton.me/support/contact )  ")).toEqual({
      name: "Proton AG",
      country: "스위스",
      contact: "https://proton.me/support/contact",
      domestic: false,
    });
    expect(parseMailService("예시메일(아랍 에미리트, privacy@example.com)")?.domestic).toBe(false); // 띄어 써도 목록의 국가
  });

  it("국내 업체: 법인명 안의 '(주)'를 그대로 두고 처리 위탁으로 본다(대한민국·한국·국내)", () => {
    expect(parseMailService("네이버(주)(대한민국, privacy@example.com)")).toEqual({
      name: "네이버(주)",
      country: "대한민국",
      contact: "privacy@example.com",
      domestic: true,
    });
    expect(parseMailService("주식회사 예시메일(한국, 1588-0000)")).toMatchObject({ name: "주식회사 예시메일", contact: "1588-0000", domestic: true });
    expect(parseMailService("예시메일(대한 민국, 02-000-0000)")?.domestic).toBe(true); // 띄어 써도 국내
    // 예전에는 '국내'가 해외 국가로 읽혀 '이전 국가: 국내 등'이 공개됐다
    expect(parseMailService("다음메일(국내, 1577-3321)")).toMatchObject({ country: "국내", domestic: true });
  });

  it.each([
    ["비어 있음", undefined],
    ["공백뿐", "   "],
    ["서비스 이름만", "Gmail"],
    ["문의처 없음", "Google LLC(미국)"],
    ["국가·문의처 순서가 바뀜", "Google LLC(googlekrsupport@google.com, 미국)"],
    ["국가를 영문으로", "Google LLC(United States, googlekrsupport@google.com)"],
    ["예시 자리표시를 그대로", "Google LLC(미국, <Google 개인정보 문의처>)"],
    ["대괄호 자리표시", "[업체 법인명](미국, privacy@example.com)"],
    ["문의처가 이메일·주소·전화번호가 아님", "Google LLC(미국, Google 고객센터)"],
    ["법인명 없음", "(미국, privacy@example.com)"],
    ["괄호가 하나 더 닫힘", "Google LLC(미국, privacy@example.com))"],
    ["너무 김", `Google LLC(미국, ${"a".repeat(200)}@example.com)`],
    // 국내를 뜻하는 말에 다른 말이 붙으면 위탁인지 국외 이전인지 정할 수 없다
    ["국내 + 도시", "다음메일(대한민국 서울, 1577-3321)"],
    ["국내 + 다른 국가", "주식회사 예시메일(한국 및 미국, 1588-0000)"],
    ["국내외", "예시메일(국내외, 1588-0000)"],
    // 국가 이름이 아닌 값이 '이전 국가'로 공개되지 않게
    ["도시 이름", "네이버(주)(서울, privacy@example.com)"],
    ["국가 + 지역", "Google LLC(미국 캘리포니아, googlekrsupport@google.com)"],
    ["목록에 없는 표기", "예시메일(우리나라, 1588-0000)"],
  ])("형식·국가가 틀리면 null(%s)", (_name, raw) => {
    expect(parseMailService(raw)).toBeNull();
  });
});

describe("mailServiceProblem(운영 빌드 검사)", () => {
  const OTHER = "privacy@example.com"; // 대조하지 않는 도메인

  it("parseMailService가 읽는 값만 통과시킨다(빌드는 통과했는데 처리방침에 '설정 필요'가 뜨지 않게)", () => {
    for (const v of [
      "Google LLC(미국, googlekrsupport@google.com)",
      "네이버(주)(대한민국, privacy@example.com)",
      "다음메일(국내, 1577-3321)",
      "Gmail",
      "다음메일(대한민국 서울, 1577-3321)",
      "네이버(주)(서울, privacy@example.com)",
      "",
    ]) {
      expect({ v, ok: mailServiceProblem(v, OTHER) === null }).toEqual({ v, ok: parseMailService(v) !== null });
    }
  });

  it("문제마다 짧은 설명을 주고, 받은 값은 넣지 않는다", () => {
    expect(mailServiceProblem(undefined, OTHER)).toBe("비어 있음");
    expect(mailServiceProblem("  ", OTHER)).toBe("비어 있음");
    expect(mailServiceProblem("Gmail", OTHER)).toBe("법인명(국가, 개인정보 문의처) 형식: 국가는 한글, 문의처는 이메일·https 주소·전화번호");
    expect(mailServiceProblem("다음메일(대한민국 서울, 1577-3321)", OTHER)).toBe("국가: 국내 업체는 대한민국만 적고 도시·다른 국가를 붙이지 않음");
    expect(mailServiceProblem("예시메일(국내외, 1588-0000)", OTHER)).toContain("국내 업체는 대한민국만");
    expect(mailServiceProblem("네이버(주)(서울, privacy@example.com)", OTHER)).toBe("국가: 알 수 없는 이름, 미국·대한민국처럼 한글 국가 이름 하나만");
    const leaks = [
      mailServiceProblem("SecretCorp(서울, secret-contact@example.org)", OTHER),
      mailServiceProblem("SecretCorp(미국, secret-contact@example.org)", "secret-local@naver.com"),
    ];
    for (const p of leaks) {
      expect(p).not.toBeNull();
      expect(p).not.toMatch(/SecretCorp|secret-contact|secret-local|서울/);
    }
  });

  it.each([
    ["Gmail 주소 + Google", "signals.ops@gmail.com", "Google LLC(미국, googlekrsupport@google.com)"],
    ["googlemail.com, 대소문자 무시", " Signals.Ops@GoogleMail.com ", "Google LLC(미국, googlekrsupport@google.com)"],
    ["네이버 메일 + 네이버(주)", "signals.ops@naver.com", "네이버(주)(대한민국, privacy@example.com)"],
    ["네이버 메일 + 영문 법인명", "signals.ops@naver.com", "NAVER Corp.(대한민국, privacy@example.com)"],
    ["한메일 + 주식회사 다음(현재 제공 주체)", "signals.ops@hanmail.net", "주식회사 다음(대한민국, 1577-3321)"],
    ["다음 메일 + 카카오", "signals.ops@daum.net", "주식회사 카카오(대한민국, 1577-3321)"],
    ["카카오 메일 + 카카오", "signals.ops@kakao.com", "주식회사 카카오(대한민국, 1577-3321)"],
    ["자체 도메인은 대조하지 않음", "privacy@signals.example", "Proton AG(스위스, https://proton.me/support/contact)"],
    ["CONTACT_EMAIL 없음", undefined, "Google LLC(미국, googlekrsupport@google.com)"],
    ["CONTACT_EMAIL이 이메일 꼴이 아님", "not-an-email", "네이버(주)(대한민국, privacy@example.com)"],
  ])("메일 주소와 업체가 맞으면 통과(%s)", (_name, contact, service) => {
    expect(mailServiceProblem(service, contact)).toBeNull();
  });

  it.each([
    ["Gmail 예시를 두고 네이버 메일함을 씀", "signals.ops@naver.com", "Google LLC(미국, googlekrsupport@google.com)", "naver.com 주소면 법인명에 네이버 또는 NAVER"],
    ["Gmail 주소인데 네이버", "signals.ops@gmail.com", "네이버(주)(대한민국, privacy@example.com)", "gmail.com·googlemail.com 주소면 법인명에 Google"],
    ["Gmail 주소인데 한국 지사", "signals.ops@gmail.com", "구글코리아 유한회사(대한민국, privacy@example.com)", "법인명에 Google"],
    ["한메일 주소인데 Google", "signals.ops@hanmail.net", "Google LLC(미국, googlekrsupport@google.com)", "daum.net·hanmail.net 주소면"],
    ["카카오 메일 주소인데 주식회사 다음", "signals.ops@kakao.com", "주식회사 다음(대한민국, 1577-3321)", "kakao.com 주소면 법인명에 카카오 또는 Kakao"],
  ])("메일 주소와 다른 업체면 빌드를 멈춘다(%s)", (_name, contact, service, hint) => {
    const p = mailServiceProblem(service, contact);
    expect(p).toMatch(/^CONTACT_EMAIL 메일함 회사와 다름: /);
    expect(p).toContain(hint);
    expect(p).not.toContain("signals.ops");
    // 처리방침은 도메인 대조를 하지 않는다(그 값으로는 운영 빌드가 멈춰 배포되지 않는다)
    expect(parseMailService(service)).not.toBeNull();
  });
});
