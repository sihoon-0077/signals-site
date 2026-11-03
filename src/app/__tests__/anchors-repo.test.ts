// 공개 앵커 저장소 템플릿(deploy/anchors-repo)은 그대로 공개 저장소의 첫 커밋이 된다. 동작은 WSL 시뮬레이션으로 확인했고,
// 여기서는 그 동작을 정하는 줄이 다시 어긋나지 않게 글자로 지킨다(YAML 파서 의존성 없이):
// 쓰기 권한 분리(R25), CRON_SECRET을 PyPI 코드가 없는 job에만 주기(J10), 비트코인 고정 단계 예외(R05)와 커밋 뒤 증명 점검,
// 날짜를 실은 앵커 요청(R06), 사이트 GET 재시도, 증명의 한 방향 갱신, README 고지 문장(R23).
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const REPO = path.join(process.cwd(), "deploy", "anchors-repo");
const read = (p: string) => readFileSync(path.join(REPO, p), "utf8");
const wf = read(".github/workflows/anchor.yml");
/** jobs: 아래 job 하나의 본문(다음 job 이름 줄 또는 파일 끝까지) */
const job = (name: string) => {
  const m = new RegExp(`^  ${name}:\\n([\\s\\S]*?)(?=^  [\\w-]+:\\n|(?![\\s\\S]))`, "m").exec(wf);
  if (!m) throw new Error(`job ${name}이 없습니다`);
  return m[1];
};
/** 셸 스크립트에서 주석 줄을 뺀 본문(주석 속 낱말에 걸리지 않게) */
const code = (p: string) =>
  read(p)
    .split("\n")
    .filter((l) => !/^\s*#/.test(l))
    .join("\n");
// 비트코인 블록 증명 태그. 세 스크립트가 같은 값을 써야 '완성본' 기준이 맞는다
const BTC_TAG = "btc_tag=$'\\x05\\x88\\x96\\x0d\\x73\\xd7\\x19\\x01'";

describe("공개 앵커 저장소 워크플로", () => {
  it("job은 request → check → publish → proofs 순서로 돈다", () => {
    const jobs = wf.slice(wf.indexOf("\njobs:\n"));
    expect([...jobs.matchAll(/^ {2}([\w-]+):\n/gm)].map((m) => m[1])).toEqual(["request", "check", "publish", "proofs"]);
    expect(job("check")).toMatch(/^ {4}needs: request$/m);
    expect(job("publish")).toMatch(/^ {4}needs: check$/m);
    expect(job("proofs")).toMatch(/^ {4}needs: publish$/m);
  });

  it("CRON_SECRET은 PyPI 코드가 돌지 않는 request job에만 environment 비밀값으로 준다", () => {
    const request = job("request");
    expect(request).toMatch(/^ {4}environment:\n {6}name: anchor-cron\n {6}deployment: false$/m);
    expect(request).toContain("CRON_SECRET: ${{ secrets.CRON_SECRET }}");
    expect(request).toContain("run: bash scripts/request-anchor.sh");
    // request job에서 도는 것은 GitHub의 checkout 액션과 러너 기본 bash·curl·jq뿐이다
    expect([...request.matchAll(/uses: (\S+)/g)].map((m) => m[1].split("@")[0])).toEqual(["actions/checkout"]);
    expect(request).not.toMatch(/pip |python|verify_anchor|ots-stamp|setup-python|artifact/);
    // 워크플로 전체에서 비밀값을 참조하는 곳은 이 한 줄뿐이고, 다른 job은 environment도 쓰지 않는다
    expect(wf.match(/secrets\./g)).toHaveLength(1);
    for (const name of ["check", "publish", "proofs"]) expect(job(name), name).not.toMatch(/secrets\.|environment:/);
    for (const p of ["scripts/pull-anchor.sh", "scripts/accept-files.sh", "scripts/proof-age.sh"]) {
      expect(code(p), p).not.toMatch(/CRON_SECRET|\/api\/cron\/anchor/);
    }
  });

  it("쓰기 권한과 토큰은 publish job에만 있고, PyPI 코드(검증기·ots)는 check job에서만 돈다", () => {
    expect(wf).toMatch(/^permissions:\n {2}contents: read\n/m);
    const publish = job("publish");
    expect(publish).toMatch(/^ {4}permissions:\n {6}contents: write$/m);
    for (const name of ["request", "check", "proofs"]) {
      expect(job(name), name).not.toMatch(/permissions:|contents: write|GH_TOKEN|github\.token/);
    }
    for (const name of ["request", "publish", "proofs"]) {
      expect(job(name), name).not.toMatch(/pip |python|verify_anchor|ots-stamp|setup-python/);
    }
    expect(publish).toContain('bash scripts/accept-files.sh "$RUNNER_TEMP/anchor-files"');
    expect(wf.match(/GH_TOKEN: \$\{\{ github\.token \}\}/g)).toHaveLength(1);
    // checkout은 job마다 하나이고, 모두 토큰을 .git/config에 남기지 않는다
    expect(wf.match(/uses: actions\/checkout@/g)).toHaveLength(4);
    expect(wf.match(/persist-credentials: false/g)).toHaveLength(4);
  });

  it("액션은 모두 40자리 커밋 SHA로 고정한다", () => {
    const uses = [...wf.matchAll(/uses: (\S+)/g)].map((m) => m[1]);
    expect(uses).toHaveLength(7);
    for (const u of uses) expect(u, u).toMatch(/^actions\/[\w-]+@[0-9a-f]{40}$/);
  });

  it("비트코인 고정 단계는 실패·시간 초과여도 커밋을 막지 않고, ots 호출은 스크립트 안에서도 끊는다", () => {
    const step = /- name: 비트코인 고정[^\n]*\n((?: {8}[^\n]*\n)+)/.exec(job("check"))?.[1] ?? "";
    expect(step).toMatch(/timeout-minutes: 5/);
    expect(step).toMatch(/continue-on-error: true/);
    const ots = read("scripts/ots-stamp.sh");
    expect(ots).toMatch(/timeout -k 5 "\$per_call" ots stamp/);
    expect(ots).toMatch(/timeout -k 5 "\$per_call" ots upgrade/);
  });

  it("커밋 뒤 proofs job(bash만)이 문서 날짜로 이틀이 지나도 완성되지 않은 증명을 실패로 알린다", () => {
    const proofs = job("proofs");
    expect(proofs).toContain("run: bash scripts/proof-age.sh");
    expect([...proofs.matchAll(/uses: (\S+)/g)].map((m) => m[1].split("@")[0])).toEqual(["actions/checkout"]);
    const age = read("scripts/proof-age.sh");
    expect(age).toContain(BTC_TAG);
    expect(age).toContain('today="${PROOF_TODAY:-$(TZ=Asia/Seoul date +%F)}"');
    expect(age).toContain('cutoff="$(date -u -d "$today -2 days" +%F)"');
    expect(age).toContain('echo "::error::앵커는 이미 커밋됐습니다.');
    expect(age).toMatch(/\n {2}exit 1\nfi\n?$/);
  });

  it("앵커 요청(request-anchor.sh)은 오늘 날짜를 싣고, 시도마다 날짜를 다시 보며, 000·5xx만 다시 보낸다", () => {
    const req = read("scripts/request-anchor.sh");
    expect(req).toContain('"${SITE_URL}/api/cron/anchor?date=${today}"');
    // KST 18시 전에는 요청하지 않고 성공으로 끝낸다(뒤 job의 대조·미러링은 그대로 돈다)
    expect(req).toMatch(/-lt 18 \]; then\n[\s\S]*?\n {2}exit 0\nfi\n/);
    const loop = /^for attempt in 1 2 3; do\n([\s\S]*?)\ndone$/m.exec(req)?.[1] ?? "";
    const recheck = loop.indexOf('[ "$(TZ=Asia/Seoul date +%F)" = "$today" ]');
    expect(recheck).toBeGreaterThanOrEqual(0);
    expect(recheck).toBeLessThan(loop.indexOf("curl "));
    expect(loop).toContain('case "$code" in 000 | 5??) ;; *) break ;; esac');
    expect(req).toMatch(/^ {2}422\) fail 1 /m);
    expect(req).toContain('409) fail 2 "사이트가 과거 기록 불일치를 보고했습니다(HTTP 409): ');
  });

  it("사이트 GET은 파이프가 아니라 파일(-o)로 받아 재시도한다(끊긴 응답이 이어 붙어 거짓 '과거 변경'이 되지 않게)", () => {
    const retry =
      /curl -f --no-progress-meter --retry 3 --retry-all-errors --retry-delay 5 --max-time 30 -o "\$work\/(get|site)\.raw" "\$\{SITE_URL\}\$1"/;
    for (const p of ["scripts/pull-anchor.sh", "scripts/accept-files.sh"]) {
      const c = code(p);
      expect(c, p).toMatch(retry);
      // curl은 위 도우미 한 곳에서만 부르고, curl 출력을 jq로 바로 파이프하지 않는다(||는 파이프가 아님)
      expect(c.match(/\bcurl /g), p).toHaveLength(1);
      expect(c, p).not.toMatch(/curl [^\n]*(?<!\|)\|(?!\|)/);
    }
  });

  it("이미 있는 증명은 대기 중→완성본으로만 바꾼다(옛 실행의 Re-run이 완성본을 되돌리지 않게)", () => {
    const acc = read("scripts/accept-files.sh");
    expect(acc).toContain(BTC_TAG);
    expect(read("scripts/ots-stamp.sh")).toContain(BTC_TAG);
    const same = acc.indexOf('if [ -f "$rel" ] && cmp -s "$in/$rel" "$rel"; then continue; fi');
    const keepComplete = acc.indexOf('if LC_ALL=C grep -qaF -- "$btc_tag" "$rel"; then');
    const needComplete = acc.indexOf('if ! LC_ALL=C grep -qaF -- "$btc_tag" "$in/$rel"; then');
    const queue = acc.indexOf('changed_ots+=("$rel")');
    expect(same).toBeGreaterThan(0);
    expect(keepComplete).toBeGreaterThan(same);
    expect(needComplete).toBeGreaterThan(keepComplete);
    expect(queue).toBeGreaterThan(needComplete);
  });
});

describe("공개 앵커 저장소 README", () => {
  const readme = read("README.md").replace(/\s+/g, " ");

  it("투자 판단 책임 문장을 사이트 푸터와 같은 표현으로 쓴다", () => {
    expect(readme).toContain("과거 기록이 미래 수익을 보장하지 않으며, 투자 판단과 그 결과의 책임은 투자자 본인에게 있습니다.");
    expect(readme).not.toContain("그 결과는 투자자 본인에게");
  });

  it("'지우거나 바꾸면 드러난다'에 일일 앵커 고정 조건을 붙인다(앵커 전에 지운 기록은 저장소로 드러나지 않음)", () => {
    expect(readme).toContain("일일 앵커로 외부에 고정된 뒤 지우거나 바꾸면 드러난다");
    expect(readme).not.toContain("기록됐고, 나중에 지우거나 바꾸면 드러난다");
  });

  it("비트코인 고정 단계만 실패해도 커밋하고, 수동 복구는 KST 23:50 전에 시작해야 한다고 쓴다", () => {
    expect(readme).toContain("어느 단계든 실패하면 커밋하지 않습니다. 비트코인 고정 단계만 예외입니다.");
    expect(readme).toContain("KST 23:50 전에 시작해야 합니다");
    expect(readme).toContain("요청이 자정을 넘기면 앵커를 만들지 않고 실패로 끝나며");
  });

  it("비밀값을 쓰는 요청 job과 커밋 뒤 증명 점검을 워크플로와 같게 설명한다", () => {
    expect(readme).toContain("요청에 쓰는 비밀값은 이 job에만 줍니다(Python 패키지가 도는 job에는 이 비밀값도 쓰기 권한도 없습니다)");
    expect(readme).toContain(
      "커밋 뒤의 증명 점검(7)은 이틀이 지나도 완성되지 않은 증명이 있으면 실행을 실패로 표시합니다(그 실행의 앵커 커밋은 이미 끝난 것입니다).",
    );
    expect(readme).toContain("보통 다음 날 실행까지 완성본으로 갱신됩니다");
    expect(readme).not.toContain("다음 실행 때 완성본으로 갱신됩니다");
  });
});
