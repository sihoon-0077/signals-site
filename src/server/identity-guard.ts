// 공급자 신원 정보가 지울 수 없는 공개 문자열에 들어가지 않게 막는 검사(발행·에이전트 만들기가 같이 쓴다).
// 규칙 버전·근거는 봉인되어 UPDATE 금지 트리거 때문에 고칠 수 없고, 공개 기한이 지나면 /verify와 bundle API로 누구나 받는다.
// 에이전트 주소(slug)도 기록과 묶여 탈퇴 뒤에 바꿀 수 없다. 여기에 필명·프로필 주소·연락처가 들어가면
// 처리방침 2항(탈퇴하면 필명을 바꾸고 프로필 주소는 공개하지 않음)이 그 공급자에게는 거짓이 된다.
//   - 연락처(메일·링크·메신저 아이디·휴대전화 번호): 정상 근거에 들어갈 일이 없어 항상 거부한다(확인으로 넘길 수 없음)
//   - 프로필 주소(handle)·필명: 'rsi'·'돌파'처럼 일반 낱말과 겹칠 수 있다. 발행은 운영자 확인(identityAck)이 있어야 넘긴다
// 휴리스틱이다. 바꿔 쓴 표기(영문 번역·줄임말, '/'·'*' 같은 다른 기호를 끼운 표기), 발행에서 다른 영문 낱말에 붙여 쓴 주소(bluefoxswing),
// '@'·도메인 없는 아이디('카톡 ID: bluefox'), 유선·대표 전화번호는 못 잡으므로 붙여 넣기 전 확인은 그대로 필요하다.
import "server-only";

export interface ProviderIdentity {
  handle: string;
  pen_name: string;
}

export interface IdentityHit {
  kind: "handle" | "pen_name";
  /** 걸린 기준값(@handle 또는 필명). 운영자 화면 안내용 */
  label: string;
}

/**
 * 비교용 정규화: 보이지 않는 형식 문자 제거 + NFKC + 소문자.
 * - 형식 문자(유니코드 Cf: 폭 없는 공백·결합 제어 문자·방향 표시·BOM·소프트 하이픈)는 복사해 붙인 글에 섞여도 화면에 보이지 않는다.
 *   지우지 않으면 '@(폭 없는 공백)bluefox'·'blue(폭 없는 공백)fox'처럼 화면에는 그대로 보이는 표기가 검사를 빠져나간다.
 *   일반 공백은 지우지 않는다(낱말이 붙으면 'MA20. Co…'가 도메인으로 읽힌다).
 * - NFKC는 NFC 결합(맥에서 붙여 넣은 자모 분리 한글)에 더해 전각 문자(＠·ｔ．ｍｅ·Ｂｌｕｅ·０１０)를 반각으로 맞춘다.
 */
const norm = (s: string) => s.replace(/\p{Cf}/gu, "").normalize("NFKC").toLowerCase();

/** 공백. 필명 비교에서 지운다('파란 숲'도 '파란숲'으로 본다. 폭 없는 공백은 norm이 이미 지움). */
const GAPS = /\s+/g;

/** 프로필 주소의 글자 사이에 끼어도 같은 주소로 보는 기호: 하이픈·'_'·'.'·'·'·공백(정규식 조각) */
const SEP = "[-_.·\\s]*";

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * '@' 뒤에 와도 메신저 아이디로 보지 않는 매매 표기(낱말 전체가 같을 때만). '진입 @VWAP'·'BUY @MKT'·'매수 @open'·'@MA20' 같은 표기다.
 * 뒤에 영문·숫자·'_'나 '.영문'이 이어지면 아이디로 본다('@open.chat'·'@stop.loss'·'@marketing_kr'·'@stopper'는 걸린다).
 */
const TRADING_AT = "(?:open|close|high|low|bid|ask|mkt|market|vwap|twap|poc|target|limit|stop|[sew]?ma\\d{0,3})(?![a-z0-9_]|\\.[a-z0-9_])";

/**
 * 연락처로 보이는 표기(norm 기준).
 * - 메일 주소, http(s)://·www. 링크, 메신저·단축 주소(t.me/, open.kakao.com, bit.ly/)
 * - 메신저 아이디(@이름): 앞이 영문·숫자가 아닐 때만. '목표 @78,000'처럼 숫자로 시작하는 가격 표기, 'buy@open', 위 매매 표기는 걸리지 않는다
 * - 영문 라벨에 붙은 메신저 아이디(IG@bluefox, 카톡ID@bluefox, kakao@bluefox, TG@bluefox). 'bid@open'·'valid@close'처럼 다른 낱말 끝의
 *   'id'는 보지 않고, 라벨 뒤가 위 매매 표기면 넘긴다(종목명과 겹치는 'Kakao@open'·'TG@open', 'IG@open')
 * - 흔한 최상위 도메인으로 끝나는 주소(blog.naver.com, x.com, youtu.be 등). 'BRK.B'·'005930.KS'·'035720.KQ' 같은 종목 표기는 걸리지 않지만,
 *   최상위 도메인과 같은 거래소 접미사('AAPL.US'·'NOVO-B.CO')와 도메인으로 끝나는 회사 이름('C3.ai'·'JD.com')은 걸린다(운영자가 바꿔 쓴다)
 * - 휴대전화 번호(010-1234-5678, 010 1234 5678, 01012345678, +82 10-1234-5678). 두 묶음을 모두 띄우거나 모두 붙인 것만 본다:
 *   '011170 1000주'(종목 코드 + 수량)·'010130 2026-11-02'(종목 코드 + 날짜)는 걸리지 않는다
 */
// 걸린 표기를 안내할 때 주소 뒤 경로까지 보여 준다(괄호·쉼표 앞에서 끊음)
const CONTACT_RES: RegExp[] = [
  /[^\s@]+@[^\s@]+\.[a-z]{2,}/,
  /https?:\/\/[^\s)\]>,]*|www\.[^\s)\]>,]*/,
  /(?:t\.me|bit\.ly)\/[^\s)\]>,]*|open\.kakao\.com[^\s)\]>,]*/,
  new RegExp(`(?<![a-z0-9._%+-])@(?!${TRADING_AT})[a-z_][a-z0-9_.]{2,}`),
  new RegExp(`(?<![a-z0-9])(?:ig|insta(?:gram)?|telegram|tg|kakao(?:talk)?|katalk|dm|id)\\s*@\\s*(?!${TRADING_AT})[a-z_][a-z0-9_.]{2,}`),
  /\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|net|org|kr|io|me|co|so|ly|ai|be|gg|ee|us|tv|app|dev|xyz|link|blog|page|site)\b(?:\/[^\s)\]>,]*)?/,
  /(?<![\d.,])(?:\+82[-.\s]?0?|0)1[016789](?:[-.\s]\d{3,4}[-.\s]|\d{3,4})\d{4}(?!\d)/,
];

/** 메일·링크·메신저 아이디·휴대전화 번호처럼 보이는 부분(정규화한 글자, 최대 60자). 없으면 null. */
export function findContact(text: string): string | null {
  const t = norm(text);
  for (const re of CONTACT_RES) {
    const m = re.exec(t);
    if (m) return m[0].trim().slice(0, 60);
  }
  return null;
}

/**
 * 공급자 프로필 주소(handle)·필명(공백을 뺀 2글자 이상)과 같은 표기를 모두 찾는다(주소 먼저, 0~2개).
 * 발행의 운영자 확인은 걸린 표기를 모두 보여 주고 그 묶음에만 적용해야 하므로 첫 번째에서 멈추지 않는다(publish.ts).
 * - 주소는 대소문자를 무시하고, 하이픈을 뺀 글자 사이에 하이픈·'_'·'.'·'·'·공백·폭 없는 문자가 끼어도 같은 것으로 본다
 *   (bluefox = Blue Fox = blue_fox = blue-fox = Blue·Fox, blue-forest = BlueForest = blue forest)
 * - handleAsToken: 주소를 낱말 단위로만 본다(앞이 영문·숫자가 아니고 뒤가 영문이 아님). 발행에서 'mom'이 'momentum'에 걸리지 않게 쓴다.
 *   뒤에 바로 붙은 숫자·'v숫자'는 버전 번호로 보고 잡는다(bluefox2, BlueFoxV2, bluefox-v1). 다른 영문 낱말에 붙여 쓴 주소(bluefoxswing)는 못 잡는다.
 *   에이전트 주소·이름은 시간이 급하지 않으니 더 엄격하게 부분 문자열로 본다(낱말 경계를 넘는 우연한 일치도 걸린다: 주소 'top' ⊂ 'at open').
 * - 필명은 공백·폭 없는 문자·대소문자를 무시한 부분 문자열로 본다(한국어는 조사가 붙으므로 낱말 경계로 보지 않는다).
 */
export function findProviderNames(text: string, p: ProviderIdentity, opts: { handleAsToken: boolean }): IdentityHit[] {
  const t = norm(text);
  const hits: IdentityHit[] = [];
  const body = [...norm(p.handle).trim().replace(/-/g, "")].map(escapeRe).join(SEP);
  if (body) {
    const re = opts.handleAsToken ? new RegExp(`(?<![a-z0-9])${body}(?:v\\d)?(?![a-z])`) : new RegExp(body);
    if (re.test(t)) hits.push({ kind: "handle", label: `@${p.handle}` });
  }
  const pen = norm(p.pen_name).replace(GAPS, "");
  if ([...pen].length >= 2 && t.replace(GAPS, "").includes(pen)) hits.push({ kind: "pen_name", label: p.pen_name.trim() });
  return hits;
}

/** 첫 번째 표기만. 없으면 null(에이전트 만들기는 하나라도 걸리면 거부한다). */
export function findProviderName(text: string, p: ProviderIdentity, opts: { handleAsToken: boolean }): IdentityHit | null {
  return findProviderNames(text, p, opts)[0] ?? null;
}
