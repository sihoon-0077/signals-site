// 운영 메일함(CONTACT_EMAIL)을 운영하는 업체(MAIL_SERVICE)를 읽는다. 처리방침 3항에 그대로 공개되므로 형식이 맞을 때만 쓴다.
// 형식: 법인명(국가, 개인정보 문의처). 예: Google LLC(미국, googlekrsupport@google.com), 네이버(주)(대한민국, privacy@example.com)
// 국내 업체면 처리 위탁만, 해외 업체면 국외 이전 항목(개인정보 보호법 제28조의8 ②)까지 적어야 해서 국가를 따로 읽는다.
// 처리방침·/api/health는 parseMailService로, 운영 빌드 검사(next.config.ts)는 mailServiceProblem으로 같은 규칙을 쓴다.
// 빌드 검사는 여기에 CONTACT_EMAIL 도메인 대조를 더한다(빌드가 멈추면 배포되지 않으므로 처리방침은 그 대조를 따로 하지 않는다).
// next.config.ts가 빌드할 때 이 파일을 불러오므로 다른 모듈을 import하지 않는다.

export type MailService = {
  /** 법인명. '네이버(주)'처럼 괄호가 들어가도 된다(맨 끝 괄호만 국가·문의처로 읽는다) */
  name: string;
  /** 한글 국가 이름(예: 미국, 대한민국) */
  country: string;
  /** 개인정보 문의처: 이메일·http(s) 주소·전화번호 중 하나 이상을 담는다(국외 이전 때 알릴 '이전받는 자의 연락처') */
  contact: string;
  /** 대한민국 업체: 국외 이전이 아니라 처리 위탁으로만 적는다 */
  domestic: boolean;
};

/** 맨 끝 괄호 '(국가, 문의처)'와 그 앞의 법인명. 국가는 한글만 받아 순서를 바꿔 적은 값(문의처, 국가)을 거른다. */
const FORMAT = /^(.*\S)\s*\(\s*([가-힣]+(?: [가-힣]+)*)\s*,\s*([^()]*[^()\s])\s*\)$/;
/** 문의처로 볼 수 있는 값: 이메일, http(s) 주소, 전화번호(1588-0000, 02-000-0000 같은 꼴) */
const CONTACT = /[^\s@]+@[^\s@]+\.[^\s@]+|https?:\/\/\S+|\d{2,4}-\d{3,4}(?:-\d{4})?/;
/** 예시를 그대로 붙여 넣은 자리표시(<…>, […], {…})가 공개되지 않게 */
const PLACEHOLDER = /[<>[\]{}]/;
/** 국내를 뜻하는 국가 표기(띄어쓰기는 무시). 처리 위탁으로만 적는다. */
const DOMESTIC = new Set(["대한민국", "한국", "국내"]);
/** 국내를 뜻하는 말에 다른 말이 붙은 표기('대한민국 서울', '한국 및 미국', '국내외')는 위탁인지 국외 이전인지 정할 수 없어 받지 않는다 */
const MIXED_DOMESTIC = /대한민국|한국|국내/;
/**
 * 해외 업체의 국가로 받는 한글 국가 이름(띄어쓰기는 무시). 도시·지역 이름('서울', '미국 캘리포니아')이나 오타가 처리방침에
 * 국외 이전 국가로 그대로 공개되지 않게 목록에 있는 이름만 받는다. 목록에 없는 나라의 메일 업체를 쓰게 되면 여기에 더한다.
 */
const FOREIGN = new Set([
  ...["미국", "캐나다", "멕시코", "브라질", "아르헨티나", "칠레"],
  ...["영국", "아일랜드", "프랑스", "독일", "네덜란드", "벨기에", "룩셈부르크", "스위스", "오스트리아", "리히텐슈타인", "이탈리아", "스페인", "포르투갈"],
  ...["그리스", "몰타", "키프로스", "스웨덴", "노르웨이", "덴마크", "핀란드", "아이슬란드", "에스토니아", "라트비아", "리투아니아", "폴란드", "체코"],
  ...["슬로바키아", "헝가리", "루마니아", "불가리아", "크로아티아", "슬로베니아", "세르비아", "우크라이나", "러시아"],
  ...["튀르키예", "터키", "이스라엘", "아랍에미리트", "사우디아라비아", "카타르", "남아프리카공화국"],
  ...["일본", "중국", "홍콩", "대만", "싱가포르", "인도", "베트남", "태국", "말레이시아", "인도네시아", "필리핀", "호주", "뉴질랜드"],
]);

/**
 * 잘 알려진 메일 주소의 도메인과 그 메일함을 운영하는 회사(법인명에 들어 있어야 하는 말). Gmail 예시를 그대로 둔 채 다른 메일함을 쓰면
 * 처리방침에 사실과 다른 수탁자·국외 이전이 공개되므로 빌드에서 막는다. 그 밖의 도메인(자체 도메인·Workspace 등)은 대조하지 않는다.
 * 다음·한메일은 서비스 제공 주체가 카카오에서 분사 법인(현 주식회사 다음, policy.daum.net)으로 바뀌어 두 이름을 모두 받는다.
 */
const MAILBOX_COMPANY: readonly { domains: readonly string[]; name: RegExp; expected: string }[] = [
  { domains: ["gmail.com", "googlemail.com"], name: /google/i, expected: "Google" },
  { domains: ["naver.com"], name: /네이버|naver/i, expected: "네이버 또는 NAVER" },
  { domains: ["daum.net", "hanmail.net"], name: /다음|daum|카카오|kakao/i, expected: "다음·Daum 또는 카카오·Kakao" },
  { domains: ["kakao.com"], name: /카카오|kakao/i, expected: "카카오 또는 Kakao" },
];

/** 형식 오류 안내. 운영 빌드 오류 메시지에 'MAIL_SERVICE(…)'로 그대로 들어간다 */
const FORMAT_PROBLEM = "법인명(국가, 개인정보 문의처) 형식: 국가는 한글, 문의처는 이메일·https 주소·전화번호";

type Reading = { service: MailService; problem: null } | { service: null; problem: string };

/** 형식·국가를 읽는다. 문제 설명에는 받은 값을 넣지 않는다(빌드 로그에 남지 않게). */
function readMailService(raw: string | undefined): Reading {
  const v = raw?.trim() ?? "";
  if (!v) return { service: null, problem: "비어 있음" };
  const m = v.length > 200 || PLACEHOLDER.test(v) ? null : FORMAT.exec(v);
  if (!m || !CONTACT.test(m[3])) return { service: null, problem: FORMAT_PROBLEM };
  const country = m[2].replace(/\s/g, "");
  const domestic = DOMESTIC.has(country);
  if (!domestic && MIXED_DOMESTIC.test(country)) return { service: null, problem: "국가: 국내 업체는 대한민국만 적고 도시·다른 국가를 붙이지 않음" };
  if (!domestic && !FOREIGN.has(country)) return { service: null, problem: "국가: 알 수 없는 이름, 미국·대한민국처럼 한글 국가 이름 하나만" };
  return { service: { name: m[1], country: m[2], contact: m[3], domestic }, problem: null };
}

/** 형식·국가가 맞으면 나눈 값, 비었거나 틀리면 null(처리방침은 '설정 필요'를 보이고, 운영 빌드는 mailServiceProblem으로 멈춘다). */
export function parseMailService(raw: string | undefined): MailService | null {
  return readMailService(raw).service;
}

/**
 * 운영 빌드 검사용: 문제가 없으면 null, 있으면 짧은 설명(값은 넣지 않음). parseMailService와 같은 형식·국가 규칙에,
 * CONTACT_EMAIL이 잘 알려진 메일 주소이면 법인명이 그 메일함을 운영하는 회사인지를 더 본다.
 * CONTACT_EMAIL이 비었거나 이메일 꼴이 아니면 대조하지 않는다(그 값은 next.config.ts가 따로 검사한다).
 */
export function mailServiceProblem(rawMailService: string | undefined, contactEmail: string | undefined): string | null {
  const { service, problem } = readMailService(rawMailService);
  if (!service) return problem;
  const email = contactEmail?.trim() ?? "";
  const at = email.lastIndexOf("@");
  const domain = at > 0 ? email.slice(at + 1).toLowerCase() : "";
  const known = MAILBOX_COMPANY.find((c) => c.domains.includes(domain));
  if (known && !known.name.test(service.name)) return `CONTACT_EMAIL 메일함 회사와 다름: ${known.domains.join("·")} 주소면 법인명에 ${known.expected}`;
  return null;
}
