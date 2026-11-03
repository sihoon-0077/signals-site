// 배포용 서명 키 2개(시그널·체크포인트)를 만든다. 개인키는 파일에만 쓰고 화면에 출력하지 않는다.
// 사용: npm run keys:generate [-- --out <폴더>]  → 기본 파일은 홈의 .signals-keys/prod-keys.env(클라우드 동기화 폴더 밖).
//       이 프로젝트는 OneDrive 아래에 있어서, 프로젝트 안에 쓰면 개인키가 생성 즉시 클라우드에 올라가고 지워도 휴지통·버전 기록에 남는다.
//       파일 내용을 Vercel 환경변수에 넣고, 서로 다른 두 곳의 보관본을 npm run keys:check로 확인한 뒤에만 원본을 지운다(DEPLOY.md 1단계).
// ⚠️ 첫 앵커가 만들어진 뒤에는 키를 바꾸지 않는다(DEPLOY.md 1단계). 체크포인트 키가 바뀌면 사이트가 앵커를 만들지 않고(409),
//    어느 키든 바뀌면 공개 저장소에 고정된 keys.json과 달라져 그 작업이 매일 실패한다. 그래서 이미 키 파일이 있으면 덮어쓰지 않는다
//    (덮어쓰면 고정된 키의 유일한 로컬 사본이 사라질 수 있고, Vercel의 Secret 값은 다시 읽을 수 없다).
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { type KeyPurpose, expectedKeyId } from "../src/core/keys";
import { exportPrivateKeyPem, exportPublicKeyPem, generateSigningKeyPair, publicKeyFingerprint } from "../src/core/signature";

async function make(purpose: KeyPurpose) {
  const prefix = purpose === "signal" ? "SIGNING" : "CHECKPOINT";
  const kp = await generateSigningKeyPair();
  const pub = await exportPublicKeyPem(kp.publicKey);
  const fp = await publicKeyFingerprint(pub);
  const keyId = expectedKeyId(purpose, fp);
  const createdAt = new Date().toISOString();
  const priv = (await exportPrivateKeyPem(kp.privateKey)).replace(/\n/g, "\\n");
  return { keyId, fp, createdAt, lines: [`${prefix}_KEY_ID=${keyId}`, `${prefix}_KEY_CREATED_AT=${createdAt}`, `${prefix}_PRIVATE_KEY_PEM="${priv}"`] };
}

async function main() {
  const oi = process.argv.indexOf("--out");
  const dir = path.resolve(oi >= 0 ? process.argv[oi + 1] : path.join(os.homedir(), ".signals-keys"));
  const synced = [process.env.OneDrive, process.env.OneDriveConsumer, process.env.OneDriveCommercial].filter((d): d is string => !!d).map((d) => path.resolve(d).toLowerCase());
  if (synced.some((d) => dir.toLowerCase().startsWith(d))) throw new Error(`클라우드 동기화 폴더(OneDrive) 안에는 개인키를 만들지 않습니다: ${dir}`);
  // OneDrive 환경변수가 없는 셸(WSL 등)에서도 프로젝트 폴더 안(.data/ 포함)에는 만들지 않는다. .gitignore에 있어도 OneDrive는 동기화한다.
  const rel = path.relative(process.cwd(), dir);
  if (!rel.startsWith("..") && !path.isAbsolute(rel)) throw new Error(`프로젝트 폴더 안에는 개인키를 만들지 않습니다: ${dir}`);
  const file = path.join(dir, "prod-keys.env");
  const exists = `이미 키 파일이 있어 덮어쓰지 않습니다: ${file}
앵커가 한 번이라도 만들어졌다면 이 키를 계속 써야 합니다(DEPLOY.md 1단계). 정말 새로 만들어야 하면 기존 파일을 확인·보관한 뒤 옮기거나 --out으로 다른 폴더를 지정하세요.`;
  if (existsSync(file)) throw new Error(exists);

  const sig = await make("signal");
  const cp = await make("checkpoint");
  mkdirSync(dir, { recursive: true });
  try {
    // wx: 그사이 같은 이름의 파일이 생겼어도 덮어쓰지 않는다
    writeFileSync(file, [...sig.lines, ...cp.lines].join("\n") + "\n", { mode: 0o600, flag: "wx" });
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "EEXIST") throw new Error(exists);
    throw e;
  }
  console.log(`키를 만들었습니다: ${file}`);
  console.log(`  시그널 키 ${sig.keyId} · 생성 ${sig.createdAt} · 공개키 지문 ${sig.fp}`);
  console.log(`  체크포인트 키 ${cp.keyId} · 생성 ${cp.createdAt} · 공개키 지문 ${cp.fp}`);
  console.log("다음 순서로 진행하세요(DEPLOY.md 1단계).");
  console.log("  1) 이 파일의 6줄을 고치지 말고 그대로 Vercel 환경변수(Production)에 넣습니다.");
  console.log("  2) 보관본을 서로 다른 두 곳에 둡니다(예: 비밀번호 관리자, 암호화한 USB). OneDrive·메신저·메일에는 두지 않습니다.");
  console.log("  3) 보관본마다 npm run keys:check -- <보관본 파일> 로 위 키 ID·생성 시각·지문이 같게 나오는지 확인합니다. 이 파일은 4단계 배포 뒤 npm run keys:check -- <파일> --expect https://<운영도메인>/keys.json 이 '같습니다'로 끝난 뒤에만 지웁니다(DEPLOY.md 1단계).");
}

main().catch((e) => {
  console.error((e as Error).message ?? e);
  process.exit(1);
});
