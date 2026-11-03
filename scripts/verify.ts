// 명령줄 검증기. 사이트의 공개 묶음(JSON)을 받아 src/core/verify.ts로 직접 계산한다(브라우저 검증 페이지와 같은 코드).
// 사용: npm run verify -- https://사이트주소 <지문 또는 시그널ID> [--mirror https://github.com/계정/signals-anchors] [--branch main]
//       npm run verify -- ./bundle.json [--mirror ...]      (내려받은 JSON 파일)
// --mirror를 주면 공개키·앵커를 사이트가 아니라 공개 저장소에서 직접 받아 대조한다(사이트를 믿지 않는 검증). 브랜치 기본값은 main.
// 종료 코드: 0 맞지 않는 항목 없음(청산 전이라 아직 확인할 수 없는 항목·저장소 반영 대기는 포함)
//            1 불일치(FAIL)·오류(파일·네트워크 오류 포함)
//            2 공개 저장소와 대조하지 못함 — 통과가 아니다. --mirror 없음·저장소 받기 실패, 또는 발행 후 이틀(KST)이 지난 기록인데
//              사이트가 그 기록을 담은 앵커를 보내지 않은 경우(앵커를 숨겼을 수 있음). 키를 바꿔 다시 서명한 기록인지 모르는 상태다.
// 요청마다 30초 시간 제한이 있다(응답을 멈춘 서버 때문에 끝나지 않는 일 방지).
import { readFileSync } from "node:fs";
import {
  DEFAULT_MIRROR_BRANCH,
  FETCH_TIMEOUT_MS,
  type SignalBundle,
  fetchMirror,
  fetchTimeoutSignal,
  isFetchTimeout,
  isSignalKey,
  overallStatus,
  verifyAgainstMirror,
  verifySignalBundle,
} from "../src/core/verify";

const USAGE = "사용법: npm run verify -- <사이트주소> <지문 또는 시그널ID> [--mirror <저장소 주소>] [--branch <브랜치>]  또는  npm run verify -- <bundle.json> [--mirror ...]";

/**
 * 사이트가 준 문자열을 터미널에 찍기 전에 제어 문자(ANSI 이스케이프·줄바꿈 등)와 글자 방향·줄을 바꾸는 문자를 '?'로 바꾼다.
 * 그대로 찍으면 사이트가 보낸 값이 앞의 '불일치' 줄을 지우거나 덮어써 통과처럼 보이게 할 수 있다(이 검증기는 사이트를 믿지 않는 쪽이 쓴다).
 */
function printable(s: string): string {
  let out = "";
  for (const ch of s) {
    const c = ch.codePointAt(0) ?? 0;
    const control = c < 0x20 || (c >= 0x7f && c <= 0x9f) || c === 0x2028 || c === 0x2029;
    const bidi = c === 0x061c || (c >= 0x200b && c <= 0x200f) || (c >= 0x202a && c <= 0x202e) || (c >= 0x2066 && c <= 0x2069) || c === 0xfeff;
    out += control || bidi ? "?" : ch;
  }
  return out;
}
const say = (line: string) => console.log(printable(line));

/**
 * 내려받은 묶음 파일을 읽는다. 다른 도구로 다시 저장하며 붙은 BOM(UTF-8, Windows PowerShell 5.1 기본의 UTF-16LE)을 처리하고,
 * UTF-8·JSON이 아니면 '불일치'가 아니라 파일 오류로 알린다(그대로 JSON.parse하면 'Unexpected token'으로 끝나 무엇이 문제인지 모른다).
 */
function readBundleFile(file: string): SignalBundle {
  const buf = readFileSync(file);
  const utf16 = buf[0] === 0xff && buf[1] === 0xfe; // PowerShell 5.1 기본 '>'·Out-File
  const bom = utf16 || (buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf);
  let text: string;
  try {
    text = new TextDecoder(utf16 ? "utf-16le" : "utf-8", { fatal: true }).decode(buf); // 앞의 BOM은 TextDecoder가 걷어 낸다
  } catch {
    throw new Error("파일을 읽지 못했습니다: UTF-8 텍스트가 아닙니다. 사이트의 '원본 JSON 받기'로 받은 파일을 그대로 쓰거나 사이트 주소로 직접 검증하세요.");
  }
  let bundle: SignalBundle;
  try {
    bundle = JSON.parse(text) as SignalBundle;
  } catch (e) {
    throw new Error(`파일을 읽지 못했습니다(JSON 형식): ${e instanceof Error ? e.message : String(e)}`);
  }
  // BOM이 있어도 판정은 그대로 둔다(불일치를 파일 오류로 바꾸지 않는다: 사이트가 보내는 바이트에 BOM을 붙일 수도 있다)
  if (bom)
    say("참고: 이 파일은 내려받은 뒤 다른 도구로 다시 저장된 흔적(BOM)이 있습니다. 아래에 '불일치'가 나오면 저장 과정에서 글자가 바뀌었을 수 있으니, 사이트 주소로 직접 검증하거나 원본 파일로 다시 확인하세요.");
  return bundle;
}

async function load(args: string[]): Promise<SignalBundle> {
  if (args.length === 1) return readBundleFile(args[0]);
  if (args.length === 2) {
    const want = args[1].trim().toLowerCase();
    // 요청 주소 경로에 들어가는 값이다. 사이트 조회 규칙과 같은 형식만 받는다.
    if (!isSignalKey(want)) throw new Error(`두 번째 값은 지문(64자리 16진수)이나 시그널 ID(UUID)여야 합니다. ${USAGE}`);
    const res = await fetch(`${args[0].replace(/\/$/, "")}/api/signals/${encodeURIComponent(want)}/bundle`, { signal: fetchTimeoutSignal() });
    if (!res.ok) {
      // 읽지 않은 본문(프록시·CDN 오류 화면 등)은 연결을 붙잡아, 오류를 찍은 뒤에도 프로세스가 몇 초~몇 분 끝나지 않는다
      await res.body?.cancel().catch(() => {});
      throw new Error(`HTTP ${res.status}`);
    }
    const b = (await res.json()) as SignalBundle;
    // 브라우저 검증 화면(verify-runner.tsx)처럼, 요청한 지문·ID와 다른 기록이 오면 바꿔치기로 보고 멈춘다.
    // 이 확인이 없으면 다른(진짜로 서명된) 기록을 보내는 가짜 사이트에도 '통과'가 나온다.
    const byHash = /^[0-9a-f]{64}$/.test(want);
    if ((byHash ? b.signal.content_hash : String(b.signal.id).toLowerCase()) !== want) {
      throw new Error(`[불일치] 사이트가 요청한 ${byHash ? "지문과" : "ID와"} 다른 기록을 보냈습니다(바꿔치기 의심).`);
    }
    return b;
  }
  throw new Error(USAGE);
}

/** --이름 값 형태의 옵션을 꺼내고 args에서 지운다 */
function takeOption(args: string[], name: string): string | null {
  const i = args.indexOf(name);
  if (i < 0) return null;
  const v = args[i + 1];
  if (!v || v.startsWith("--")) throw new Error(`${name} 뒤에 값이 필요합니다. ${USAGE}`);
  args.splice(i, 2);
  return v;
}

async function main() {
  const args = process.argv.slice(2);
  const mirrorRepo = takeOption(args, "--mirror");
  const branch = takeOption(args, "--branch") ?? DEFAULT_MIRROR_BRANCH;
  const bundle = await load(args);
  const mirror = mirrorRepo ? await fetchMirror(mirrorRepo, bundle.anchor?.date ?? null, { branch }) : null;
  const results = [...(await verifySignalBundle(bundle)), ...verifyAgainstMirror(bundle, mirror)];
  const mark = { PASS: "통과", FAIL: "불일치", SKIP: "해당 없음", PENDING: "반영 대기", UNCHECKED: "확인 못 함" } as const;
  say(`시그널 ${bundle.signal.id} (순번 ${bundle.signal.sequence_no}, 지문 ${bundle.signal.content_hash})`);
  for (const r of results) say(`  [${mark[r.status]}] ${r.label} — ${r.detail}`);
  const overall = overallStatus(results);
  const summary = {
    PASS: "모든 항목 통과",
    FAIL: "불일치 있음",
    PARTIAL: "확인 가능한 항목 모두 통과",
    UNCHECKED: "공개 저장소와 대조하지 못함(맞지 않는 항목은 없음)",
  } as const;
  console.log(`종합: ${summary[overall]}`);
  if (!mirrorRepo) console.log("공개 저장소와 대조하려면 --mirror https://github.com/계정/signals-anchors 를 붙여 다시 실행하세요.");
  console.log("이 검증은 결과 전에 이 내용으로 봉인됐는지와 그 뒤 바뀌지 않았는지만 확인하며, 수익을 보장하지 않습니다.");
  // process.exit()가 아니라 exitCode로 끝낸다. Windows의 Node 24는 fetch를 3번 이상 한 뒤 process.exit()을 부르면
  // libuv 단언 실패(0xC0000409)로 죽어 0/1/2 종료 코드가 사라진다(--mirror 검증이 정확히 3번 받음).
  process.exitCode = overall === "FAIL" ? 1 : overall === "UNCHECKED" ? 2 : 0;
}

main().catch((e) => {
  // 오류 문장에도 사이트가 준 값이 섞일 수 있다(형식이 틀린 묶음 등)
  const msg = isFetchTimeout(e) ? `네트워크 오류(시간 초과): 사이트가 ${FETCH_TIMEOUT_MS / 1000}초 안에 응답을 끝내지 않았습니다.` : e instanceof Error ? e.message : String(e);
  console.error(printable(msg));
  process.exitCode = 1;
});
