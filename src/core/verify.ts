// 시그널 하나를 공개 자료만으로 검증한다(03 설계 §4.6). 브라우저 검증 페이지와 CLI가 같은 함수를 쓴다.
// 서버가 "VALID"라고 답하는 방식이 아니라, 검증하는 쪽이 원문·지문·공개키·토큰·앵커를 받아 직접 계산한다.

import { type AnchorDocument, verifyAnchorDocument } from "./anchor";
import { GENESIS_HASH, type SignalFieldsV2, canonicalizeV2, CanonicalError } from "./canonical";
import { isRealDate } from "./date";
import { fromBase64, sha256Hex } from "./encoding";
import { describeEntry, resolveEntry } from "./entry";
import { type KeysFile, findKey } from "./keys";
import { importPublicKeyPem, publicKeyFingerprint, verifyMessage } from "./signature";
import { parseTimestampToken, verifyTimestampToken } from "./tsa";

export interface PublicSignal {
  id: string;
  agent_id: string;
  sequence_no: number;
  canonical_version: number;
  published_at: string;
  content_hash: string;
  prev_hash: string;
  signature: string;
  key_id: string;
  /** 청산·만료·무효 처리 후 원문 공개 여부 */
  revealed: boolean;
  /** 공개된 경우에만 원문(nonce 포함) */
  fields: SignalFieldsV2 | null;
}

export interface ChainLink {
  sequence_no: number;
  prev_hash: string;
  content_hash: string;
  /** 공개된 기록이면 원문(지문 재계산용) */
  fields: SignalFieldsV2 | null;
}

export interface SignalBundle {
  signal: PublicSignal;
  previous: { sequence_no: number; content_hash: string } | null;
  timestamps: { tsa: string; token_b64: string; gen_time: string }[];
  /** 이 기록을 처음 담은 일일 앵커 */
  anchor: AnchorDocument | null;
  /** 이 기록 다음부터 앵커가 묶은 마지막 기록까지(앵커의 마지막 지문까지 사슬을 이어 보기 위함) */
  chain_to_head?: ChainLink[];
  keys: KeysFile;
}

/**
 * PASS 통과 · FAIL 불일치 · SKIP 지금은 확인할 수 없음(청산 전 원문 비공개 등, 정상인 상태)
 * PENDING 공개 저장소에 아직 반영 전(곧 확인 가능) · UNCHECKED 했어야 할 대조를 하지 못함(저장소 주소·받기 실패)
 * UNCHECKED는 기록이 틀렸다는 증거가 아니라 FAIL로 만들지 않는다. 그렇다고 SKIP('해당 없음')으로 두면 사이트 밖 대조가 빠진 것을 아무도 모른다.
 */
export type CheckStatus = "PASS" | "FAIL" | "SKIP" | "PENDING" | "UNCHECKED";

export interface CheckResult {
  id: "hash" | "signature" | "chain" | "timestamp" | "anchor" | "entry" | "mirror_keys" | "mirror_anchor";
  label: string;
  status: CheckStatus;
  detail: string;
}

const kst = (iso: string) =>
  new Date(Date.parse(iso) + 9 * 3600 * 1000).toISOString().replace("T", " ").slice(0, 19) + " KST";

/**
 * 검증 링크·CLI가 받는 기록 식별자: 시그널 ID(UUID) 또는 지문(64자리 16진수). 서버 조회 규칙(server/services/bundle.ts)과 같다.
 * 그 밖의 값은 요청 주소 경로에 넣지 않는다('../' 같은 값이 다른 주소를 부르게 되는 것 차단).
 */
export function isSignalKey(v: string): boolean {
  return /^[0-9a-f]{64}$/i.test(v) || /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}

async function checkHash(s: PublicSignal): Promise<CheckResult> {
  const label = "원문으로 지문 다시 계산";
  if (!s.revealed || !s.fields) {
    return { id: "hash", label, status: "SKIP", detail: "원문이 아직 공개되지 않았습니다(청산·만료·무효 처리, 청산 시그널의 일일 앵커 고정, 공개 기한 경과 중 먼저 오는 때 공개). 지금은 지문만 공개됩니다." };
  }
  const f = s.fields;
  if (typeof f.signalId !== "string" || f.signalId.toLowerCase() !== s.id.toLowerCase()) {
    return { id: "hash", label, status: "FAIL", detail: "공개된 원문에 봉인된 ID가 이 기록의 ID와 다릅니다(기록끼리 ID를 바꿔치기한 흔적)." };
  }
  if (f.agentId.toLowerCase() !== s.agent_id || f.sequenceNo !== s.sequence_no || f.prevHash !== s.prev_hash || Date.parse(f.publishedAt) !== Date.parse(s.published_at)) {
    return { id: "hash", label, status: "FAIL", detail: "공개된 원문의 에이전트·순번·직전 지문·발행 시각이 기록과 다릅니다." };
  }
  try {
    const h = await sha256Hex(canonicalizeV2(f));
    return h === s.content_hash
      ? { id: "hash", label, status: "PASS", detail: `다시 계산한 지문이 기록과 같습니다 (${h.slice(0, 12)}…).` }
      : { id: "hash", label, status: "FAIL", detail: `다시 계산한 지문 ${h.slice(0, 12)}…이 기록된 지문 ${s.content_hash.slice(0, 12)}…과 다릅니다.` };
  } catch (e) {
    const msg = e instanceof CanonicalError ? e.message : String(e);
    return { id: "hash", label, status: "FAIL", detail: `원문을 정규 직렬화할 수 없습니다: ${msg}` };
  }
}

async function checkSignature(s: PublicSignal, keys: KeysFile): Promise<CheckResult> {
  const label = "공개키로 서명 확인";
  const key = findKey(keys, s.key_id, "signal", s.published_at);
  if (!key) return { id: "signature", label, status: "FAIL", detail: `발행 시각에 유효한 서명 키(${s.key_id})를 공개키 목록에서 찾을 수 없습니다.` };
  // 화면에 보이는 지문은 목록에 적힌 값이 아니라 공개키에서 다시 계산한 값이어야 한다(표기만 진짜로 두고 키를 바꾸는 속임수 차단).
  const fp = await publicKeyFingerprint(key.public_key_pem);
  if (fp !== key.fingerprint) return { id: "signature", label, status: "FAIL", detail: `공개키 목록에 적힌 지문(${key.fingerprint.slice(0, 12)}…)이 실제 공개키의 지문(${fp.slice(0, 12)}…)과 다릅니다.` };
  const ok = await verifyMessage(await importPublicKeyPem(key.public_key_pem), s.content_hash, s.signature);
  return ok
    ? { id: "signature", label, status: "PASS", detail: `키 ${s.key_id}(공개키 지문 ${fp.slice(0, 12)}…)로 서명이 맞습니다.` }
    : { id: "signature", label, status: "FAIL", detail: "서명이 지문과 맞지 않습니다." };
}

function checkChain(b: SignalBundle, hashPassed: boolean): CheckResult {
  const s = b.signal;
  const label = "직전 기록과 사슬 연결";
  const fail = (detail: string): CheckResult => ({ id: "chain", label, status: "FAIL", detail });
  let what: string;
  if (s.sequence_no === 1) {
    if (s.prev_hash !== GENESIS_HASH) return fail("첫 기록인데 직전 지문이 시작값(0…0)이 아닙니다.");
    what = "이 에이전트의 첫 기록입니다";
  } else {
    if (!b.previous || b.previous.sequence_no !== s.sequence_no - 1) return fail(`직전 기록(순번 ${s.sequence_no - 1})을 찾을 수 없습니다. 중간 기록이 빠졌을 수 있습니다.`);
    if (b.previous.content_hash !== s.prev_hash) return fail("직전 기록의 지문과 이어지지 않습니다. 중간 기록이 바뀌었거나 지워졌습니다.");
    what = `순번 ${s.sequence_no - 1}의 지문과 이어집니다`;
  }
  // 직전 지문 값이 원문(지문)에 묶였는지는 원문 재계산(checkHash)이 통과해야 확정된다. 그 전에는 서버가 준 두 값을 비교했을 뿐이다
  // ('공개'라면서 원문을 주지 않았거나 재계산이 맞지 않는 묶음에 '재계산으로 확인했다'고 적지 않는다).
  if (hashPassed) return { id: "chain", label, status: "PASS", detail: `${what}. 원문 재계산으로 이 연결이 지문에 묶여 있음을 확인했습니다.` };
  const why = s.revealed && s.fields ? "원문 재계산이 맞지 않아 이 연결이 원문에 묶였는지 확인하지 못했습니다" : "원문 공개 전이라 이 연결이 원문에 묶였는지는 공개 후 확정됩니다";
  return { id: "chain", label, status: "SKIP", detail: `${what}(값 대조). ${why}.` };
}

async function checkTimestamps(b: SignalBundle): Promise<{ result: CheckResult; earliest: Date | null }> {
  const s = b.signal;
  const label = "외부 타임스탬프 확인";
  if (b.timestamps.length === 0) {
    return { result: { id: "timestamp", label, status: "SKIP", detail: "타임스탬프 토큰이 없습니다(기관 장애 등). 진입 기준은 다음 일일 앵커 이후로 밀립니다." }, earliest: null };
  }
  let earliest: Date | null = null;
  const notes: string[] = [];
  for (const t of b.timestamps) {
    const v = await verifyTimestampToken(fromBase64(t.token_b64), s.content_hash);
    notes.push(`${t.tsa}: ${v.reason}`);
    if (v.ok && v.genTime && (!earliest || v.genTime < earliest)) earliest = v.genTime;
  }
  if (!earliest) return { result: { id: "timestamp", label, status: "FAIL", detail: notes.join(" / ") }, earliest: null };
  // TSA 시각은 초 단위로 잘려 기록되므로 서버 접수 시각보다 최대 1초 앞서 보일 수 있다(허용 오차는 entry.ts의 CLOCK_TOLERANCE_MS).
  const delay = Math.round((earliest.getTime() - Date.parse(s.published_at)) / 1000);
  const lagMs = earliest.getTime() - Date.parse(s.published_at);
  const when =
    lagMs >= -1000 && delay <= 0 ? "발행과 같은 초, 기관은 초 단위로 기록" : lagMs < 0 ? `서버가 적은 발행 시각보다 ${(-lagMs / 1000).toFixed(1)}초 이른 기관 시각 — 서버 시계가 빠름` : `발행 후 ${delay}초`;
  return {
    result: { id: "timestamp", label, status: "PASS", detail: `${kst(earliest.toISOString())}에 이 지문이 존재했다는 기관 서명이 있습니다(${when}). ${notes.join(" / ")}` },
    earliest,
  };
}

/** 앵커 루트에 찍힌 기관 시각 중 유효한 가장 이른 것. 서명되지 않은 created_at 대신 진입 기준의 대체 시각으로 쓴다. */
async function anchorTsaTime(a: AnchorDocument): Promise<{ earliest: Date | null; invalid: number }> {
  let earliest: Date | null = null;
  let invalid = 0;
  for (const t of a.timestamps ?? []) {
    const v = await verifyTimestampToken(fromBase64(t.token_b64), a.merkle_root);
    if (!v.ok || !v.genTime) invalid++;
    else if (!earliest || v.genTime < earliest) earliest = v.genTime;
  }
  return { earliest, invalid };
}

const kstDate = (iso: string) => new Date(Date.parse(iso) + 9 * 3600 * 1000).toISOString().slice(0, 10);

async function checkAnchor(b: SignalBundle): Promise<CheckResult> {
  const s = b.signal;
  const label = "일일 앵커(외부 고정)에 포함";
  const a = b.anchor;
  if (!a) return { id: "anchor", label, status: "SKIP", detail: "아직 이 기록을 포함한 일일 앵커가 없습니다(매일 18시 KST 무렵 생성, 늦어질 수 있음)." };
  const fail = (detail: string): CheckResult => ({ id: "anchor", label, status: "FAIL", detail });
  // 앵커 날짜는 공개 저장소 파일 주소(anchors/<날짜>.json)에도 들어간다. 사이트가 '9999/../../다른저장소/…' 같은 값을 보내면
  // 문자열 비교는 통과하고 저장소 대조가 다른 저장소 파일을 받게 되므로, 실제 날짜가 아니면 불일치로 둔다(값은 화면에 옮기지 않음).
  if (typeof a.date !== "string" || !isRealDate(a.date)) return fail("앵커 날짜가 YYYY-MM-DD 형식의 실제 날짜가 아닙니다.");
  if (a.date < kstDate(s.published_at)) return fail(`${a.date} 앵커가 이 기록의 발행일(${kstDate(s.published_at)})보다 이른 날짜로 표시돼 있습니다.`);
  const v = await verifyAnchorDocument(a, b.keys);
  if (!v.rootMatches || !v.sorted) return fail(`${a.date} 앵커의 리프로 다시 계산한 머클 루트가 문서와 다르거나 리프가 중복됩니다.`);
  if (!v.signatureValid) return fail(`${a.date} 앵커의 체크포인트 서명이 맞지 않거나 공개키 지문 표기가 다릅니다.`);
  const tsa = await anchorTsaTime(a);
  if (tsa.invalid > 0) return fail(`${a.date} 앵커 루트의 타임스탬프 토큰 ${tsa.invalid}건이 유효하지 않습니다(위조 의심).`);
  const leaf = a.leaves.find((l) => l.agent_id.toLowerCase() === s.agent_id);
  if (!leaf) return fail(`${a.date} 앵커에 이 에이전트가 없습니다.`);
  if (leaf.chain_length < s.sequence_no) return fail(`${a.date} 앵커의 체인 길이(${leaf.chain_length})가 이 기록의 순번(${s.sequence_no})보다 짧습니다.`);
  const where = `${a.date} 앵커(루트 ${a.merkle_root.slice(0, 12)}…, 서명 유효${tsa.earliest ? `, 기관 시각 ${kst(tsa.earliest.toISOString())}` : ""})`;
  const tail = " 같은 루트가 공개 저장소에 있는지는 아래 대조 항목이, 비트코인 고정은 저장소의 .ots 파일이 보여 줍니다.";
  if (leaf.chain_length === s.sequence_no) {
    return leaf.head_hash === s.content_hash
      ? { id: "anchor", label, status: "PASS", detail: `${where}의 마지막 지문이 이 기록과 같습니다.${tail}` }
      : fail(`${a.date} 앵커의 마지막 지문이 이 기록의 지문과 다릅니다.`);
  }
  // 이 기록 뒤에도 그날 기록이 더 있으면, 이 기록에서 앵커의 마지막 지문까지 사슬을 실제로 이어 봐야 포함이 증명된다.
  const seg = b.chain_to_head;
  const need = leaf.chain_length - s.sequence_no;
  if (!seg) return { id: "anchor", label, status: "SKIP", detail: `${where}은 이 기록 뒤 ${need}건까지 묶었지만, 그 사이 사슬 자료가 없어 포함을 확인하지 못했습니다.` };
  let prev = s.content_hash;
  let hidden = 0;
  for (let i = 0; i < seg.length; i++) {
    const r = seg[i];
    if (r.sequence_no !== s.sequence_no + 1 + i) return fail(`이 기록 뒤 순번이 이어지지 않습니다(${s.sequence_no + 1 + i} 자리에 ${r.sequence_no}).`);
    if (r.prev_hash !== prev) return fail(`순번 ${r.sequence_no}의 직전 지문이 사슬과 다릅니다.`);
    if (r.fields) {
      const ok = r.fields.sequenceNo === r.sequence_no && r.fields.prevHash === r.prev_hash && (await sha256Hex(canonicalizeV2(r.fields))) === r.content_hash;
      if (!ok) return fail(`순번 ${r.sequence_no}의 공개 원문으로 다시 계산한 지문이 기록과 다릅니다.`);
    } else hidden++;
    prev = r.content_hash;
  }
  if (seg.length !== need || prev !== leaf.head_hash) return fail(`이 기록에서 ${a.date} 앵커의 마지막 지문까지 사슬이 이어지지 않습니다.`);
  return hidden
    ? { id: "anchor", label, status: "SKIP", detail: `${where}은 이 기록 뒤 ${need}건까지 묶었고 사슬 값은 맞지만, 그중 ${hidden}건이 원문 공개 전이라 포함은 그 기록들이 공개되면 확정됩니다.` }
    : { id: "anchor", label, status: "PASS", detail: `${where}이 묶은 마지막 기록까지 이후 ${need}건을 원문으로 다시 계산해 사슬이 이어짐을 확인했습니다.${tail}` };
}

async function checkEntry(b: SignalBundle, earliest: Date | null, anchorProven: boolean): Promise<CheckResult> {
  // 이 사이트는 아직 가격·수익률을 계산하지 않는다. 그래서 "가격을 확인했다"가 아니라, 나중에 성과를 계산할 때 쓸 진입 '시점'을
  // 외부 시각으로 정해 보여 주는 항목이다(라벨·문구가 가격 검증처럼 읽히면 없는 기능을 증명한다고 적는 셈이 된다).
  const label = "진입 기준 시각(타임스탬프 이후)";
  const action = b.signal.fields?.action;
  if (action === "EXIT") return { id: "entry", label, status: "SKIP", detail: "청산 시그널이라 진입 기준을 정하지 않습니다." };
  // 시그널 토큰이 없을 때의 대체 기준은 이 기록이 포함됐음이 증명된 앵커의 기관 시각이다
  // (서명되지 않은 created_at이나, 포함이 확정되지 않은 앵커의 시각은 쓰지 않는다).
  const anchorAt = anchorProven && b.anchor ? (await anchorTsaTime(b.anchor)).earliest : null;
  const r = resolveEntry(new Date(b.signal.published_at), earliest, anchorAt);
  // 서버 시계가 기관 시각보다 빠른 것은 조작 증거가 아니다(뒤로 당겨 적는 조작은 오히려 기관 시각이 늦게 나온다). 판정만 보류한다.
  if (r.kind === "CLOCK_ANOMALY")
    return { id: "entry", label, status: "SKIP", detail: "서버가 적은 발행 시각이 기관 시각보다 늦습니다(서버 시계가 빠름). 이 기록의 진입 기준은 정하지 않습니다." };
  if (r.kind === "PENDING_ANCHOR" || r.kind === "OUT_OF_CALENDAR") return { id: "entry", label, status: "SKIP", detail: describeEntry(r) };
  // 청산 전에는 원문이 없어 진입·청산을 구분할 수 없다
  const when = action ? "" : "진입 시그널이면 ";
  return {
    id: "entry",
    label,
    status: "PASS",
    detail: `${when}나중에 성과를 계산할 때 쓸 진입 기준: ${describeEntry(r)}(외부 타임스탬프 이후 가격만 사용). 수익률은 시세 데이터 이용계약 전이라 아직 표시하지 않습니다.`,
  };
}

export async function verifySignalBundle(b: SignalBundle): Promise<CheckResult[]> {
  const ts = await checkTimestamps(b);
  const anchor = await checkAnchor(b);
  const hash = await checkHash(b.signal);
  return [hash, await checkSignature(b.signal, b.keys), checkChain(b, hash.status === "PASS"), ts.result, anchor, await checkEntry(b, ts.earliest, anchor.status === "PASS")];
}

/**
 * 공개 앵커 저장소(GitHub)에서 검증하는 쪽이 직접 받은 사본.
 * 공개키와 앵커를 검증 대상인 사이트가 주는 묶음에서만 가져오면, 사이트가 자기 키로 다시 서명한 가짜 묶음도 통과한다.
 * 그래서 서명에 쓴 공개키와 앵커 루트가 사이트 밖에 먼저 고정된 값과 같은지 따로 대조한다.
 */
export interface MirrorSnapshot {
  /** 사람이 볼 저장소 주소 */
  source: string;
  keys: KeysFile | null;
  /** 이 시그널을 담은 앵커 날짜의 저장소 사본(아직 올라가지 않았으면 null) */
  anchor: AnchorDocument | null;
  /** keys를 받지 못한 이유(주소·브랜치 형식, HTTP 상태, 네트워크). 화면에 그대로 보여 준다 */
  keysError?: string;
  /** anchor를 받다 실패한 이유. 저장소에 아직 파일이 없을 때(HTTP 404)는 비워 두어 '반영 대기'와 구분한다 */
  anchorError?: string;
}

/** 공개 앵커 저장소의 기본 브랜치. 다른 이름으로 만들었으면 ANCHOR_REPO_BRANCH(사이트)·--branch(CLI)로 지정한다. */
export const DEFAULT_MIRROR_BRANCH = "main";

/** 검증에 쓰는 요청 하나의 시간 제한(ms). 제한이 없으면 응답을 멈추거나 조금씩만 보내는 서버 때문에 명령줄 검증기가 끝나지 않는다. */
export const FETCH_TIMEOUT_MS = 30_000;

/**
 * 요청에 붙일 시간 제한 신호. 이 타이머는 Node 이벤트 루프를 붙잡지 않아 정상 종료를 늦추지 않는다.
 * AbortSignal.timeout이 없는 오래된 브라우저에서는 제한 없이 요청한다(없는 함수를 불러 요청 자체가 '네트워크 오류'가 되지 않게).
 */
export function fetchTimeoutSignal(ms: number = FETCH_TIMEOUT_MS): AbortSignal | undefined {
  return typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function" ? AbortSignal.timeout(ms) : undefined;
}

/** fetchTimeoutSignal의 제한에 걸려 끊긴 요청·본문 읽기인지 */
export const isFetchTimeout = (e: unknown) => (e as { name?: unknown } | null)?.name === "TimeoutError";

/** GitHub 저장소 주소 → raw 파일 주소. 주소나 브랜치 이름 형식이 다르면 null. */
export function mirrorRawBase(repoUrl: string, branch: string = DEFAULT_MIRROR_BRANCH): string | null {
  const m = /^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/.exec(repoUrl.trim());
  const b = branch.trim();
  // 브랜치 이름은 raw 주소 경로에 그대로 들어가므로 안전한 글자만 받는다('..'·숨김 경로·빈 칸 거부)
  const okBranch = /^[\w.-]+(?:\/[\w.-]+)*$/.test(b) && !b.split("/").some((p) => p.startsWith("."));
  // 계정·저장소 이름이 '.'·'..'이면 fetch가 경로에서 접어, 결과 문장에 적힌 주소와 다른 저장소의 파일을 받는다
  // ('…/공식계정/.. --branch 다른계정/저장소/main'). '.github'처럼 점으로 시작하는 정상 이름은 받는다. .git을 뗀 값으로 본다('...git' → '..').
  const okRepo = m !== null && !/^\.+$/.test(m[1]) && !/^\.+$/.test(m[2]);
  return m && okRepo && okBranch ? `https://raw.githubusercontent.com/${m[1]}/${m[2]}/${b}` : null;
}

/**
 * 저장소의 keys.json과 앵커 사본을 받는다. 받지 못하면 이유를 함께 남겨, 검증 화면이 조용히 '해당 없음'으로 넘기지 않고
 * '확인 못 함'으로 드러내게 한다(저장소가 비공개이거나 주소·브랜치가 틀려도 겉보기에는 정상처럼 보이던 문제).
 */
export async function fetchMirror(
  repoUrl: string,
  anchorDate: string | null,
  opts: { branch?: string; fetchFn?: typeof fetch } = {},
): Promise<MirrorSnapshot> {
  const base = mirrorRawBase(repoUrl, opts.branch?.trim() || DEFAULT_MIRROR_BRANCH);
  if (!base) {
    const why = "저장소 주소가 https://github.com/계정/저장소 형식이 아니거나 브랜치 이름이 올바르지 않음";
    return { source: repoUrl, keys: null, anchor: null, keysError: why, anchorError: why };
  }
  const fetchFn = opts.fetchFn ?? fetch;
  const timedOut = { data: null, notFound: false, error: "네트워크 오류(시간 초과)" };
  const get = async <T>(p: string, valid: (v: unknown) => boolean): Promise<{ data: T | null; notFound: boolean; error?: string }> => {
    let res: Response;
    try {
      res = await fetchFn(`${base}/${p}`, { signal: fetchTimeoutSignal() });
    } catch (e) {
      return isFetchTimeout(e) ? timedOut : { data: null, notFound: false, error: "네트워크 오류" };
    }
    if (!res.ok) {
      // 읽지 않은 본문은 연결을 붙잡아, 명령줄 검증기가 결과를 찍은 뒤에도 서버가 연결을 닫을 때까지 끝나지 않는다
      await res.body?.cancel().catch(() => {});
      return { data: null, notFound: res.status === 404, error: `HTTP ${res.status}` };
    }
    let v: unknown;
    try {
      v = await res.json();
    } catch (e) {
      // 본문을 받다 시간 제한에 걸린 것은 파일 형식 문제가 아니다
      if (isFetchTimeout(e)) return timedOut;
    }
    return valid(v) ? { data: v as T, notFound: false } : { data: null, notFound: false, error: "파일 형식이 다름" };
  };
  // 형식이 다른 파일을 그대로 넘기면 대조 중에 예외가 나 화면 전체가 오류로 끝난다 → 받기 실패로 다룬다
  const isKeysFile = (v: unknown) => {
    const ks = (v as Partial<KeysFile> | null)?.keys;
    return Array.isArray(ks) && ks.every((k) => typeof k?.key_id === "string" && typeof k.public_key_pem === "string" && typeof k.fingerprint === "string");
  };
  const keys = await get<KeysFile>("keys.json", isKeysFile);
  // 날짜는 검증 대상인 사이트가 준 값이다. 실제 날짜(YYYY-MM-DD)일 때만 주소에 넣는다: '..'·'%2e%2e'는 fetch가 경로에서 접어
  // 다른 저장소의 파일을 받게 되므로 일부 글자만 막는 방식으로는 부족하다. 받지 않은 이유는 '확인 못 함'으로 남긴다.
  const anchor = !anchorDate
    ? null
    : isRealDate(anchorDate)
      ? await get<AnchorDocument>(`anchors/${anchorDate}.json`, (v) => typeof (v as Partial<AnchorDocument> | null)?.merkle_root === "string")
      : { data: null, notFound: false, error: "앵커 날짜 형식이 다름" };
  return {
    source: repoUrl,
    keys: keys.data,
    anchor: anchor?.data ?? null,
    ...(keys.data ? {} : { keysError: keys.error }),
    // 저장소에 아직 없는 앵커(404)는 오류가 아니라 '반영 대기'로 판정한다(verifyAgainstMirror)
    ...(anchor && !anchor.data && !anchor.notFound ? { anchorError: anchor.error } : {}),
  };
}

/** 앵커가 저장소에 올라가길 기다리는 기간(일). 보통 그날 18시(KST) 무렵 올라가고, 자동 작업이 하루 실패해도 다음 실행이 빠진 날짜를 채운다. */
const MIRROR_GRACE_DAYS = 1;
const daysSince = (date: string, now: Date) => (Date.parse(`${kstDate(now.toISOString())}T00:00:00Z`) - Date.parse(`${date}T00:00:00Z`)) / 86_400_000;

/**
 * 사이트가 이 기록을 담은 앵커를 주지 않아도 정상일 수 있는 기간(일). 18시 앵커 뒤에 발행한 기록은 다음 날 앵커에 담기고,
 * 그날 앵커가 실패해도 그다음 날 앵커가 담는다. 이 기간이 지나도 앵커가 없으면 '해당 없음'이 아니라 '확인 못 함'이다:
 * 앵커를 빼고 보내는 것은 검증 대상인 사이트가 고를 수 있는 길이라, 해당 없음으로 두면 앵커 대조를 통째로 건너뛸 수 있다(S09).
 */
const SITE_ANCHOR_GRACE_DAYS = 2;

/** 이 기록이 있었다고 주장되는 가장 이른 날(KST). 원문 공개 전에는 발행 시각이 지문에 묶이지 않으므로 토큰 시각도 본다. */
function earliestClaimedDate(b: SignalBundle): string | null {
  let t = Date.parse(b.signal.published_at);
  for (const ts of Array.isArray(b.timestamps) ? b.timestamps : []) {
    try {
      const g = parseTimestampToken(fromBase64(ts.token_b64)).genTime.getTime();
      // t가 NaN(발행 시각을 읽지 못함)이어도 토큰 시각으로 바뀐다
      if (Number.isFinite(g) && !(t <= g)) t = g;
    } catch {
      // 해석할 수 없는 토큰은 외부 타임스탬프 항목이 불일치로 드러낸다
    }
  }
  // 표현 범위 끝의 날짜(+275760년 등)는 KST로 옮기다 범위를 넘으므로 날짜 불명으로 둔다(toISOString의 RangeError 차단)
  const inKst = new Date(t + 9 * 3600 * 1000);
  return Number.isNaN(inKst.getTime()) ? null : inKst.toISOString().slice(0, 10);
}

export function verifyAgainstMirror(b: SignalBundle, m: MirrorSnapshot | null, now: Date = new Date()): CheckResult[] {
  const keysLabel = "공개키를 공개 저장소와 대조";
  const anchorLabel = "앵커를 공개 저장소와 대조";
  const keysOpen = "이 대조가 끝나기 전에는 사이트가 키를 바꿔 다시 서명한 기록이 아닌지 확인되지 않은 상태입니다.";
  const anchorOpen = "이 대조가 끝나기 전에는 앵커가 사이트 밖 사본과 같은지 확인되지 않은 상태입니다.";
  const why = (e: string | undefined) => (e ? `(${e})` : "");
  const noAnchor: CheckResult = { id: "mirror_anchor", label: anchorLabel, status: "SKIP", detail: "이 기록을 담은 앵커가 아직 없습니다." };
  if (!m) {
    const missing = "공개 저장소 주소가 없어 사이트 밖 사본과 대조하지 못했습니다.";
    return [
      { id: "mirror_keys", label: keysLabel, status: "UNCHECKED", detail: `${missing} ${keysOpen}` },
      b.anchor ? { id: "mirror_anchor", label: anchorLabel, status: "UNCHECKED", detail: `${missing} ${anchorOpen}` } : noAnchor,
    ];
  }
  const out: CheckResult[] = [];
  if (!m.keys) {
    out.push({
      id: "mirror_keys",
      label: keysLabel,
      status: "UNCHECKED",
      detail: `${m.source}에서 공개키 목록을 받지 못했습니다${why(m.keysError)}. 저장소가 공개인지, 주소·브랜치가 맞는지 확인이 필요합니다. ${keysOpen}`,
    });
  } else {
    const need = [{ id: b.signal.key_id, purpose: "signal" as const }, ...(b.anchor ? [{ id: b.anchor.checkpoint_key_id, purpose: "checkpoint" as const }] : [])];
    const pick = (k: KeysFile, n: (typeof need)[number]) => k.keys.find((e) => e.key_id === n.id && e.purpose === n.purpose);
    const differs = need.filter((n) => {
      const site = pick(b.keys, n);
      const repo = pick(m.keys!, n);
      return (
        !site ||
        !repo ||
        site.fingerprint !== repo.fingerprint ||
        site.public_key_pem.trim() !== repo.public_key_pem.trim() ||
        // 유효기간도 저장소에 고정된 값을 따라야 한다(pull-anchor.sh와 같은 규칙: 생성 시각은 그대로, 이미 적힌 폐기 시각은 지우거나 바꿀 수 없고,
        // 새로 적은 폐기 시각은 아직 저장소에 반영되기 전일 수 있어 허용). 서명·앵커 확인(findKey)은 사이트가 준 유효기간을 쓰므로,
        // 여기서 대조하지 않으면 폐기한 키를 되살리거나 생성 시각을 앞당겨 소급한 묶음도 통과한다.
        site.created_at !== repo.created_at ||
        (!!repo.retired_at && site.retired_at !== repo.retired_at)
      );
    });
    out.push(
      differs.length
        ? { id: "mirror_keys", label: keysLabel, status: "FAIL", detail: `${differs.map((n) => n.id).join(", ")} 공개키 또는 그 유효기간(생성·폐기 시각)이 ${m.source}에 고정된 값과 다르거나 그곳에 없습니다.` }
        : { id: "mirror_keys", label: keysLabel, status: "PASS", detail: `서명에 쓴 공개키(${need.map((n) => n.id).join(", ")})가 ${m.source}에 고정된 키와 같습니다.` },
    );
  }
  const a = b.anchor;
  if (!a) {
    const d = earliestClaimedDate(b);
    const age = d === null ? Number.NaN : daysSince(d, now);
    // 발행 당일부터 이틀 뒤(KST)까지만 '아직 없음'이다(이 기기 시계가 하루 늦은 경우 포함). 오래됐거나 날짜가 이상하면 확인 못 함.
    out.push(
      age >= -1 && age <= SITE_ANCHOR_GRACE_DAYS
        ? noAnchor
        : {
            id: "mirror_anchor",
            label: anchorLabel,
            status: "UNCHECKED",
            detail: `사이트가 이 기록(${d ?? "날짜 불명"}, KST)을 담은 일일 앵커를 보내지 않았습니다. 앵커는 보통 발행 당일이나 다음 날 만들어지므로, 그 뒤 앵커가 모두 실패한 경우가 아니면 사이트가 앵커를 빼고 보낸 것일 수 있습니다. ${m.source}의 anchors/에서 그 날짜 이후 파일에 이 에이전트의 chain_length가 이 기록의 순번 이상인지 직접 확인하세요. ${anchorOpen}`,
          },
    );
  } else if (typeof a.date !== "string" || !isRealDate(a.date)) {
    // 저장소 파일 주소를 만들 수 없는 날짜다(fetchMirror도 요청하지 않음). 값은 화면·터미널에 옮기지 않는다.
    out.push({ id: "mirror_anchor", label: anchorLabel, status: "FAIL", detail: `사이트가 준 앵커 날짜가 YYYY-MM-DD 형식의 실제 날짜가 아니라 ${m.source}의 사본과 대조할 수 없습니다.` });
  } else if (m.anchor) {
    const r = m.anchor;
    // 어느 항목이 다른지 적는다(서명만 다를 때 같은 루트 앞자리 두 개만 보여 주면 무엇이 다른지 알 수 없다)
    const diff = (["date", "merkle_root", "prev_root", "leaf_count", "root_signature"] as const).filter((k) => r[k] !== a[k]);
    out.push(
      diff.length
        ? { id: "mirror_anchor", label: anchorLabel, status: "FAIL", detail: `${a.date} 앵커가 ${m.source}에 고정된 사본과 다릅니다(다른 항목: ${diff.join(", ")}).` }
        : { id: "mirror_anchor", label: anchorLabel, status: "PASS", detail: `${a.date} 앵커 루트(${a.merkle_root.slice(0, 12)}…)가 ${m.source}의 사본과 같습니다.` },
    );
  } else if (daysSince(a.date, now) < 0) {
    // 앵커는 만든 날(KST) 날짜로만 만들어진다. 저장소에 없는 미래 날짜를 '반영 대기'로 두면 대조를 영영 미루는 통로가 된다.
    out.push({
      id: "mirror_anchor",
      label: anchorLabel,
      status: "FAIL",
      detail: `${a.date} 앵커는 오늘(이 기기 시계로 KST ${kstDate(now.toISOString())})보다 늦은 날짜입니다. 앵커는 만든 날 날짜로만 만들어지므로 정상적인 앵커가 아닙니다.`,
    });
  } else if (!m.keys || m.anchorError) {
    // 저장소 자체를 받지 못했으면 404도 '아직 안 올라감'인지 '주소·브랜치가 틀림'인지 가릴 수 없다
    out.push({ id: "mirror_anchor", label: anchorLabel, status: "UNCHECKED", detail: `${m.source}에서 ${a.date} 앵커 사본을 받지 못했습니다${why(m.anchorError ?? m.keysError)}. ${anchorOpen}` });
  } else if (daysSince(a.date, now) <= MIRROR_GRACE_DAYS) {
    out.push({
      id: "mirror_anchor",
      label: anchorLabel,
      status: "PENDING",
      detail: `${a.date} 앵커가 아직 ${m.source}에 올라가지 않았습니다. 저장소 자동 작업이 보통 그날 18시(KST) 무렵 올리며 늦어질 수 있고, 공개 주소의 캐시 때문에 몇 분 더 걸리기도 합니다. 나중에 다시 확인하세요.`,
    });
  } else {
    out.push({
      id: "mirror_anchor",
      label: anchorLabel,
      status: "UNCHECKED",
      detail: `${a.date} 앵커가 ${m.source}에 없습니다. 하루가 지나도 올라가지 않았다면 저장소 자동 작업이 실패했을 수 있습니다(저장소의 Actions 기록에서 확인). ${anchorOpen}`,
    });
  }
  return out;
}

export type OverallStatus = "PASS" | "PARTIAL" | "UNCHECKED" | "FAIL";

/** 하나라도 불일치면 FAIL, 했어야 할 대조를 못 했으면 UNCHECKED, 모두 통과면 PASS, 나머지(지금은 확인할 수 없음·반영 대기)는 PARTIAL. */
export function overallStatus(results: CheckResult[]): OverallStatus {
  if (results.some((r) => r.status === "FAIL")) return "FAIL";
  if (results.some((r) => r.status === "UNCHECKED")) return "UNCHECKED";
  return results.every((r) => r.status === "PASS") ? "PASS" : "PARTIAL";
}
