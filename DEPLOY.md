# 배포 안내 — Vercel + Supabase + 공개 앵커 저장소

계정 만들기·로그인·비밀값 입력은 운영자가 직접 합니다. 비밀번호·개인키를 AI 도구, 메신저, 메모 앱에 붙여 넣지 마세요. 순서대로 하면 1~2시간 걸립니다.

## 먼저 알아 둘 것: 되돌릴 수 없는 시점

**첫 앵커가 만들어지는 순간**부터는 다음 셋을 하면 안 됩니다.
- 서명 키를 다시 만들기
- 키 환경변수 6줄(키마다 ID·생성 시각·개인키)을 고치기
- Supabase 프로젝트를 새로 만들기

첫 앵커는 아래 중 가장 먼저 일어난 것으로 만들어집니다.
- 5단계 공개 저장소에서 워크플로를 켠 뒤 KST 18시 이후의 첫 실행(예약 실행 포함)
- `/admin`의 '오늘(KST) 앵커 만들기' 버튼(운영은 KST 18시 이후만)
- 운영 `DATABASE_URL`과 운영 키를 셸에 넣고 `npm run anchor`를 실행한 경우(KST 18시 이후만). 이 문서는 운영에 이 명령을 쓰지 않습니다(로컬 시험용).

앵커는 에이전트가 0개여도 만들어집니다. 체크포인트 키 서명과 함께 DB에 지울 수 없게 저장되고, 첫 실행이 성공하면 공개 저장소 `keys.json`에 두 공개키가 고정됩니다.

그 뒤에 위 셋 중 하나를 바꾸면 이렇게 됩니다.
- **체크포인트 키를 바꾸면:** 사이트가 앵커를 만들지 않습니다(409).
- **시그널 키나 생성 시각만 바꿔도:** 공개 저장소 작업이 공개키 대조에서 매일 실패합니다.
- **DB를 새로 만들면:** '앵커가 사이트에서 사라졌습니다'로 매일 실패합니다.

실패한 실행은 공개 저장소 Actions 탭에 누구나 볼 수 있게 남습니다(GitHub 보관 기간은 공개 저장소 최대 90일). 오래 남는 흔적은 저장소 자체입니다: 빈 날, 늦게 찍힌 `.ots`.

그래서 5단계 4번(워크플로 켜기)은 키와 DB가 최종인지 확인한 뒤에만 합니다. 그 전에는 `/admin`의 앵커 버튼도 누르지 마세요.

## 코드가 미리 막아 둔 것

- **필수 환경변수 확인:** 운영 빌드(Vercel Production)는 필수 환경변수가 빠지거나 형식이 틀리면 빌드를 실패시키고, 로그에 문제 된 변수 이름과 이유만 보여 줍니다(값은 출력하지 않음). `DATABASE_URL` 끝의 `?sslmode=` 같은 SSL 설정, 인증서로 읽을 수 없는 `DATABASE_CA_PEM`, 개인키와 짝이 아닌 키 ID, 형식·국가가 틀렸거나 메일 주소의 회사와 다른 `MAIL_SERVICE`(4단계 표)도 여기서 걸립니다. 실패한 배포는 연결되지 않으니 직전 정상 배포가 그대로 서비스됩니다. 빌드는 DB 등에 접속하지 않고 값만 봅니다: 틀린 DB 비밀번호, 닿지 않는 주소, 읽을 수는 있지만 다른 인증서는 배포 뒤 smoke·`/api/health`에서 드러납니다.
- **미리보기 차단:** 미리보기(Preview) 배포는 운영 DB와 서명 키를 쓰지 않습니다. 값이 들어 있어도 거부합니다.
- **조용한 대체 없음:** 운영에서 `DATABASE_URL`이나 서명 키가 없으면, 임시 DB나 새 키로 조용히 넘어가지 않고 그 값을 쓰는 요청이 오류로 끝납니다.
- **잠긴 화면:** 모든 테이블에 RLS가 켜져 있습니다. 관리자 화면과 앵커 호출구는 비밀값이 없거나 16자 미만이면 닫힙니다(503).
- **이른·늦은 앵커 방지:** 운영 사이트는 KST 18시 전에는 앵커를 만들지 않습니다(앵커 호출구는 앵커 없이 끝내고, 관리자 앵커 버튼은 거부). 일찍 만들면 그날 앵커가 그 시각으로 확정되어, 이후 발행분이 다음 날로 밀립니다. 공개 저장소 작업은 실행을 시작한 날짜(KST)를 요청에 실어 보내고 시도마다 날짜를 다시 확인하며, 사이트는 그 날짜가 아직 오늘일 때만 만듭니다(지난 날짜는 422). 그래서 자정을 넘긴 재시도가 다음 날 앵커를 00시에 확정하지 않고, 그날은 빈 날로 남습니다.
- **이중 봉인 방지:** 발행 화면은 요청 번호를 함께 보냅니다. 응답을 못 받아 같은 화면에서 다시 눌러도 두 번 봉인되지 않습니다.
- **암호화 연결:** DB 연결은 항상 TLS입니다. `DATABASE_CA_PEM`이 있으면 서버 인증서까지 확인합니다. 운영 주소를 점검하는 `npm run smoke`는 서버 인증서를 확인하지 않는 연결을 실패로 셉니다.
- **상태 점검:** `/api/health`가 비밀값 없이 DB 연결(오류는 코드만), 마이그레이션, 키 ID와 DB에 남은 키의 불일치, 리전을 보여 줍니다(`npm run smoke`가 사용).

## 0. 구성과 고른 이유

| 부분 | 선택 | 대안과 트레이드오프 |
|---|---|---|
| 사이트 | Vercel(서울 `icn1`, `vercel.json`) | 직접 서버(Lightsail 등)는 상시 프로세스·cron이 쉽지만, HTTPS·배포·보안 패치를 직접 해야 함 |
| DB | Supabase Postgres(서울 리전), 드라이버 `pg` + `attachDatabasePool` | Neon 등 다른 Postgres도 `DATABASE_URL`만 바꾸면 됨. 코드는 표준 SQL만 씀 |
| 매일 앵커 | 공개 GitHub 저장소의 Actions가 `/api/cron/anchor` 호출 | Vercel Cron도 같은 호출구로 가능. 다만 공개 저장소에서 돌리면 실행·실패를 누구나 볼 수 있음(오래 남는 증거는 커밋과 `.ots`) |

**비용(1R, 결제 없음 단계):** Vercel Hobby, Supabase Free, GitHub 공개 저장소, FreeTSA·DigiCert 타임스탬프, OpenTimestamps가 모두 0원입니다. 도메인은 선택입니다.

**주의:** Vercel Hobby는 개인·비상업 용도 조건입니다. 판매를 시작하기 전에 Pro 전환을 검토하세요.

## 1. 서명 키 만들기(한 번만)

```powershell
npm run keys:generate
```

**파일 위치**
- 홈 폴더 `C:\Users\<계정>\.signals-keys\prod-keys.env`에 시그널 키와 체크포인트 키가 생깁니다. 키마다 ID·생성 시각·개인키 3줄입니다. 개인키는 화면에 출력하지 않습니다.
- 프로젝트 폴더(`.data/` 포함)와 OneDrive 안에는 만들지 않습니다. 지워도 휴지통과 버전 기록에 남기 때문입니다.
- 파일이 이미 있으면 덮어쓰지 않고 멈춥니다.

**다루는 법**
- 이 6줄은 한 묶음입니다. 줄을 따로 옮기거나 다시 입력하지 말고, 파일 내용을 통째로 보관하고 통째로 입력합니다.
  - 생성 시각 하나만 달라져도 그 전 시그널의 검증이 모두 실패합니다.
  - ID와 개인키가 다른 묶음에서 오면 운영 빌드가 멈춥니다(키 ID는 공개키 지문에서 나옴. 직전 배포가 그대로 서비스됨).
- 보관본은 서로 다른 두 곳에 둡니다.
  - ① 비밀번호 관리자의 보안 메모(6줄 통째)
  - ② 암호화한 USB(BitLocker To Go 등)
- OneDrive, 메신저, 메일, 메모 앱, AI 채팅에는 두지 않습니다. Vercel의 Secret 값(예전 이름 Sensitive)은 저장 뒤 다시 볼 수 없으니 백업이 되지 않습니다.
- 개인키를 PowerShell 창에 붙여 넣지 않습니다. 입력한 명령은 기록 파일에 평문으로 남습니다. 키가 필요한 명령에는 파일 경로를 넘깁니다.

**원본 지우기:** 원본 파일은 아래를 모두 통과한 뒤에만 지웁니다.
1. `npm run keys:check`(인자가 없으면 원본을 읽음) → 문제 없음(종료 코드 0)
2. 보관본 ①②를 각각 OneDrive 밖 임시 파일로 꺼내 `npm run keys:check -- <임시 파일>` → 키 ID·생성 시각·지문이 원본과 같음
3. 4단계 배포 뒤 `npm run keys:check -- <파일> --expect https://<운영도메인>/keys.json` → '기준 keys.json(…)과 같습니다.' 줄이 나옴(`--expect`를 빠뜨리고 주소만 붙이면 비교하지 않고 종료 코드 2로 멈춤)
4. 임시 파일과 원본을 Shift+Delete로 지웁니다(탐색기 삭제는 휴지통에 남음).

**첫 시그널 전에 키나 DB를 꼭 바꿔야 했다면:** 옛 키 6줄을 Vercel에 다시 넣고 Redeploy하는 것이 가장 깨끗합니다. 옛 키가 없으면 Supabase 프로젝트와 공개 앵커 저장소를 둘 다 새로 만든 뒤 1·2·4·5단계를 다시 합니다(봉인된 시그널이 없으니 잃는 기록은 없음). 첫 시그널 뒤에는 이 방법도 쓸 수 없습니다.

## 2. Supabase

1. **새 프로젝트:** Region은 **Northeast Asia (Seoul)**를 고릅니다.
   - Database Password는 영문과 숫자만으로 32자 안팎으로 만들어 비밀번호 관리자에 저장합니다.
   - `@ # / % ?` 같은 문자가 있으면 연결 주소가 잘못 잘립니다.
2. **연결 주소:** 상단 **Connect** → **Transaction pooler**(포트 6543) URI를 복사합니다.
   - `[YOUR-PASSWORD]` 자리를 비밀번호로 바꾼 값이 `DATABASE_URL`입니다.
   - 주소 끝에 `?sslmode=…`를 붙이지 마세요. 붙이면(`ssl`로 시작하는 다른 설정·`uselibpqcompat`도) 운영 빌드가 멈춥니다. 인증서 확인은 `DATABASE_CA_PEM`으로 합니다.
   - 트랜잭션 풀러는 쿼리를 이어 보내는 방식(파이프라이닝)을 지원하지 않습니다. 코드는 연결 하나에 쿼리를 하나씩만 보내는 `pg` 드라이버로 연결합니다(`src/server/db.ts`).
3. **SSL 인증서:** Database Settings → SSL Configuration → **Download certificate**로 `prod-ca-2021.crt`를 받습니다.
   - 비밀값은 아닙니다. 접속한 서버가 진짜 Supabase인지 확인하는 데 씁니다.
   - 받은 파일이 맞는지는 아래 명령으로 확인합니다.

   ```powershell
   node -e "const c=new (require('crypto').X509Certificate)(require('fs').readFileSync(process.argv[1]));console.log(c.subject,c.fingerprint256)" "$HOME\Downloads\prod-ca-2021.crt"
   ```

   `CN=Supabase Root 2021 CA`가 보이고, 지문이 `80:70:25:AD`로 시작해 `CA:FA`로 끝나면 맞는 파일입니다.
   - 'Enforce SSL'(SSL 강제)을 켜면 DB가 잠깐 재시작됩니다. 첫 발행 전에 켜고, 운영 중에 바꿀 때는 08:00~09:00·17:30~19:30(KST)을 피합니다.
4. **마이그레이션(테이블·불변 트리거·RLS 만들기):** AI 도구가 아니라 **직접 연 PowerShell 창**에서 프로젝트 폴더로 이동한 뒤, 아래 한 줄을 그대로 붙여 넣습니다.

   ```powershell
   $c = "$HOME\Downloads\prod-ca-2021.crt"; if (-not (Test-Path -LiteralPath $c -PathType Leaf)) { "인증서 파일이 없습니다: $c (2단계 3번에서 확인한 파일을 이 경로에 두세요)" } else { $u = (Read-Host 'Transaction pooler URI([YOUR-PASSWORD] 그대로)').Trim(); $p = Read-Host 'DB 비밀번호' -AsSecureString; if ($u.Contains('[YOUR-PASSWORD]')) { $env:DATABASE_URL = $u.Replace('[YOUR-PASSWORD]', [uri]::EscapeDataString([Net.NetworkCredential]::new('', $p).Password)); $env:DATABASE_CA_PEM = Get-Content -Raw -LiteralPath $c; npm run db:migrate; Remove-Item Env:DATABASE_URL, Env:DATABASE_CA_PEM -ErrorAction SilentlyContinue } else { 'URI에 [YOUR-PASSWORD] 자리가 없습니다. Connect 화면의 주소를 그대로 붙여 넣으세요.' }; Remove-Variable u, p }; Remove-Variable c
   ```

   - **입력:** 첫 질문에는 Connect 화면의 주소를 `[YOUR-PASSWORD]`가 든 그대로, 둘째 질문에는 DB 비밀번호 원래 값을 넣습니다. 화면에는 `*`만 보입니다.
   - **안전한 이유:** 비밀번호가 명령줄에 들어가지 않으므로 PowerShell 기록 파일에 남지 않습니다. 특수문자도 자동으로 인코딩됩니다. 인증서 파일이 그 경로에 없으면 비밀번호를 묻기 전에 멈춥니다. 끝나면 셸에 넣었던 주소·인증서 값을 지웁니다.
   - **인증서 파일이 없다고 나오면:** 2단계 3번에서 확인한 `prod-ca-2021.crt`를 `Downloads`에 두거나, 줄 맨 앞의 경로를 실제 위치로 바꿉니다.
   - **성공 기준:** `대상:` 줄에 Supabase 풀러 주소(`postgres.<프로젝트 ref>@…pooler.supabase.com`)와 `TLS verify-full`이 보이고, `0001_init.sql`부터 `0005_indexes.sql`까지 적용 목록이 나오면 성공입니다. 0004는 사전등록의 판매 경험·신고 여부 칸을 지우고 이메일 254자 제한과 등록 시각 인덱스를 추가합니다.
   - **`TLS encrypt-only`가 보이면:** 성공이 아닙니다. 인증서 값이 비어(빈 파일 등) 서버 인증서를 확인할 수 없는 상태라, 실행기가 DB 비밀번호를 보내기 전에 멈춥니다(종료 코드 1). 인증서를 다시 받아 2단계 3번 확인을 통과시킨 뒤 같은 줄을 다시 실행합니다. `ALLOW_UNVERIFIED_TLS=1`로 넘기지 마세요(인증서 없는 시험용 DB 전용).
   - **빨간 `Get-Content` 오류가 보이면:** 인증서를 읽지 못한 것입니다. 실행기가 `TLS encrypt-only`로 멈췄는지 확인하고, 위와 같이 인증서를 고친 뒤 다시 실행합니다.
   - **다시 실행하면:** 적용할 것이 없다고 나옵니다. 이미 적용된 파일이 바뀌었으면 아무것도 적용하지 않고 멈춥니다.
   - **인증서 오류가 나면:** `self-signed certificate in certificate chain`, `unable to get local issuer certificate` 같은 오류가 나면 인증서를 빼고 다시 실행하지 마세요(공용망에서는 가짜 서버가 DB 비밀번호를 받아 갈 수 있음). 받은 파일과 주소를 확인합니다. 이 명령이 `TLS verify-full`로 성공하면 같은 인증서가 Vercel에서도 통과합니다.
   - **연결이 안 되면:** 같은 줄을 다시 실행하고, 첫 질문에 Session pooler(5432) 주소를 넣습니다.
   - **옛 방식으로 이미 했다면:** 주소를 명령줄에 직접 넣었거나, TLS 표시가 없던 예전 실행기로 인증서 없이 실행했을 수 있다면 DB 비밀번호를 재설정하세요. 기록 파일에서 그 줄만 지우는 것으로는 충분하지 않습니다.
5. **Advisors → Security Advisor 확인:**
   - **정상 상태:** Errors 0건, Info의 'RLS Enabled No Policy'가 테이블마다 1건.
   - **정책·GRANT는 추가하지 않기:** 정책을 일부러 만들지 않은 것입니다. 예를 들어 'Enable read access for all users'를 붙이면 공급자 이메일이 anon 키로 읽힙니다.
   - **무시해도 되는 경고:** Warnings의 Auth(인증) 항목(Leaked Password Protection 등, 이 앱은 Supabase Auth를 쓰지 않음), Performance Advisor의 'Unindexed foreign keys'·'Unused Index'(지금 규모에서는 영향 없음).
   - **멈춰야 하는 경고:** 우리 테이블 이름이나 `raise_immutable` 함수가 붙은 경고가 있으면 발행 전에 멈추고 확인합니다.
6. **(권장) Data API 확인:** Settings → Data API에서 `public` 스키마가 노출되지 않는지 봅니다. 이 앱은 Supabase REST(anon 키)를 쓰지 않습니다. 메뉴 이름은 바뀔 수 있습니다.
7. **일시정지:** Free 플랜은 7일 동안 활동이 없으면 일시정지됩니다. 매일 앵커 작업이 DB를 쓰므로 보통은 멈추지 않습니다. 정지 메일을 받으면 대시보드에서 Resume합니다.

**주의:** `.env.local`에 운영 `DATABASE_URL`을 넣지 마세요. 로컬 개발 서버와 `npm run seed:dev`가 운영 DB를 쓰게 됩니다. `seed:dev`는 이 경우 거부하도록 막아 두었습니다.

## 2-1. 백업과 복구

Supabase Free에는 자동 백업이 없습니다(매일 백업은 Pro 이상).

- **이 DB에만 있는 것:** 시그널 원문, 서명, 시그널별 타임스탬프 토큰, 공급자 정보.
- **공개 저장소에 있는 것:** 루트와 에이전트별 마지막 지문뿐입니다.

그래서 DB를 잃으면 되살릴 수 없습니다. 트리거는 수정·삭제·비우기만 막고, DROP TABLE이나 프로젝트 삭제는 막지 못합니다. 개인정보 처리방침은 '암호화 백업, 클라우드 동기화 폴더가 아닌 저장장치에 최대 30일, 복구 때 탈퇴·파기 다시 적용(이를 위해 탈퇴 처리한 등록의 프로필 주소·처리일만 30일 따로 기록)'을 약속하므로 아래를 지킵니다.

**언제 백업하나(기본값)**
- 매일 앵커 작업이 성공한 뒤 1회
- SQL Editor에서 직접 SQL을 실행하기 전

공개 저장소의 마지막 앵커보다 오래된 백업으로 복구하면, 그 사이 기록이 사라진 것이 앵커 대조에서 공개로 드러납니다. 그래서 주 1회로는 부족합니다.

**준비(WSL Ubuntu에서 한 번, 운영자가 직접)**

```bash
sudo apt install -y postgresql-common gnupg && sudo /usr/share/postgresql-common/pgdg/apt.postgresql.org.sh
sudo apt install -y postgresql-client-17     # SQL Editor에서 'show server_version;'의 메이저 이상
mkdir -p -m 700 ~/signals-backups            # WSL 홈은 OneDrive 밖
# ~/.pgpass (chmod 600) 한 줄: <Session pooler 호스트>:5432:postgres:postgres.<프로젝트 ref>:<DB 비밀번호>
# 2단계 인증서를 ~/signals-backups/prod-ca-2021.crt로 복사
```

- **Session pooler(5432)를 쓰는 이유:** Direct 연결은 Free에서 IPv6 전용이라 WSL에서 안 되고, Transaction pooler(6543)는 pg_dump용이 아닙니다.
- **클라이언트 버전:** Ubuntu 기본 클라이언트(16)는 17 서버를 덤프하지 못해서 17을 설치합니다.

**백업 스크립트 `~/signals-backups/backup.sh`**

```bash
#!/usr/bin/env bash
set -euo pipefail
umask 077
export PGHOST='<Session pooler 호스트>' PGPORT=5432 PGDATABASE=postgres PGUSER='postgres.<프로젝트 ref>'
export PGSSLMODE=verify-full PGSSLROOTCERT="$HOME/signals-backups/prod-ca-2021.crt"
cd "$HOME/signals-backups"
f="signals-$(date -u -d '+9 hours' +%Y%m%d-%H%M).dump"
psql -Atc "select '마지막 앵커 ' || coalesce((select max(checkpoint_date)::text from anchor_records),'없음') || ', 시그널 ' || (select count(*) from signals)"
pg_dump --schema=public --format=custom --no-privileges --file="$f"
pg_restore --list "$f" | grep -q 'TABLE DATA public signals ' || { echo '덤프에 signals가 없습니다' >&2; exit 1; }
gpg --symmetric --cipher-algo AES256 --output "$f.gpg" "$f"   # 암호는 비밀번호 관리자에
shred -u "$f"
find . -maxdepth 1 -name 'signals-*.dump.gpg' -mtime +29 -delete   # 처리방침의 30일과 같게
ls -l "$f.gpg"
```

- 실행은 `bash ~/signals-backups/backup.sh`이고, '마지막 앵커'가 오늘 날짜인지 확인합니다.
- 암호화본은 오프라인 USB에도 복사하고, USB에서도 30일 지난 것은 지웁니다.
- 덤프와 암호화본은 OneDrive, GitHub 저장소, Actions에 두지 않습니다. 공급자 이메일과 청산 전 원문이 들어 있습니다.
- **탈퇴 기록:** `/admin`에서 탈퇴 처리할 때마다 그 등록의 프로필 주소와 처리 날짜만 적고(이메일·필명은 적지 않음, 처리방침 2항), 30일(백업 보관 기간)이 지난 줄은 지웁니다. 복구한 뒤 이 목록의 공급자가 '탈퇴'가 아닌 곳에 보이면 다시 탈퇴 처리합니다.
- **탈퇴 기록·기록표(8절)를 두는 곳:** 백업과 다른 곳, 클라우드 동기화 폴더 밖의 암호화 파일입니다(예: `C:\Users\<계정>\.signals-records\`의 KeePass 데이터베이스나 gpg 파일, 사본은 오프라인 USB에만). 클라우드 비밀번호 관리자·메모 앱에 두면 처리방침 3항에 없는 업체에 맡기는 것이 됩니다. 꼭 써야 하면 그 업체를 먼저 처리방침 3항에 넣습니다(공개 뒤라면 8항대로 30일 전에 알림).

**복구 연습(첫 발행 전 1회, 첫 실제 시그널 직후 1회)**
- 빈 PostgreSQL 17(예: `docker run -d --rm -e POSTGRES_PASSWORD=drill -p 127.0.0.1:55432:5432 postgres:17`)에 복호화한 파일을 `pg_restore --no-owner --no-privileges`로 복원합니다('schema "public" already exists' 1건은 정상).
- 공개 저장소 최신 `anchors/날짜.json`의 리프마다, 그 `agent_id`·`chain_length` 위치의 시그널 `content_hash`가 `head_hash`와 같은지 대조합니다.
- 평문 파일을 지우고 컨테이너를 정리합니다.

**실제 복구(새 Supabase 프로젝트)**
1. 공개 앵커 저장소의 daily-anchor를 Disable합니다. 빈 DB에 앵커 호출이 닿으면 지울 수 없는 빈 앵커가 생깁니다.
2. 새 서울 프로젝트에 `npm run db:migrate` 없이 바로 복원합니다(마이그레이션 기록도 백업에 들어 있음). 먼저 `~/.pgpass` 줄과 `backup.sh`의 `PGHOST`·`PGUSER`를 새 프로젝트 Connect 화면의 Session pooler 값(새 ref·새 비밀번호)으로 바꿉니다(복구 뒤 백업도 새 프로젝트로 가야 함). 비밀번호를 주소나 명령줄에 넣지 않고, 인증서 확인(`verify-full`)을 빼지 않습니다(2단계 4번 '인증서 오류가 나면'과 같은 이유).

   ```bash
   cd ~/signals-backups && umask 077
   export PGHOST='<새 Session pooler 호스트>' PGPORT=5432 PGUSER='postgres.<새 프로젝트 ref>'
   export PGSSLMODE=verify-full PGSSLROOTCERT="$HOME/signals-backups/prod-ca-2021.crt"
   gpg --output restore.dump --decrypt '<백업 파일>.dump.gpg'
   pg_restore --no-owner --no-privileges -d postgres restore.dump   # 'schema "public" already exists' 1건은 정상
   shred -u restore.dump
   ```

   - `-d postgres`가 있어야 DB에 복원합니다(없으면 SQL을 화면에 출력만 함). 비밀번호는 바꾼 `~/.pgpass`에서 읽고, 맞는 줄이 없으면 pg_restore가 묻습니다.
   - 복원 뒤 `bash ~/signals-backups/backup.sh`로 새 프로젝트가 백업되는지 봅니다. 인증서 오류가 나면 새 프로젝트에서 인증서를 다시 받아 2단계 3번처럼 확인합니다.
3. SQL Editor에서 `0003_hardening.sql`의 권한 회수 블록을 다시 실행합니다. 새 프로젝트 기본 권한이 anon·authenticated에 다시 붙기 때문입니다.
4. 탈퇴 기록 목록대로 탈퇴를 다시 적용하고, 위 대조를 합니다. 1년 파기는 6번 뒤 첫 앵커 호출(KST 18시 이후 실행) 때 다시 적용됩니다.
5. Vercel `DATABASE_URL`·`DATABASE_CA_PEM`을 바꾸고 Redeploy합니다(서명 키는 그대로).
6. 워크플로를 Enable하고 Run workflow로 통과하는지 봅니다.

그 사이 발행한 기록을 잃었다면 숨기지 말고 공지합니다. 다음 앵커가 실패하는 것은 정상 동작입니다.

## 3. 비밀값 만들기

`ADMIN_PASSWORD`와 `CRON_SECRET`은 외울 필요가 없는 무작위 값입니다.

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

- 두 번 실행해 각각 씁니다(43자). 저장소에 커밋하지 말고 비밀번호 관리자에 보관합니다.
- 두 값은 16자 이상이어야 합니다. 짧으면 운영 빌드가 멈추고, 이미 배포된 경우 `/admin`과 `/api/cron/anchor`가 503으로 닫힙니다. 로컬 `next start`(운영 모드)로 시험할 때도 `.env.local`의 값이 16자 미만이면 `/admin`이 닫힙니다.

## 4. Vercel

**가져오기 전에 정할 것(첫 공개판부터 맞아야 함):** 처리방침 8항은 처리 위탁·국외 이전을 바꿀 때 30일 전부터, 그 밖의 변경은 7일 전부터 알린다고 약속합니다. 그래서 아래 둘은 첫 배포 전에 정합니다.
- **운영 메일 업체:** `CONTACT_EMAIL` 메일함을 운영하는 회사를 정해 2번 표의 `MAIL_SERVICE`에 넣습니다. 본인 확인·승인 안내·시그널 접수·문의 메일이 이 회사를 거쳐 보관되므로 처리방침 3항에 공개됩니다(대한민국 회사면 처리 위탁, 그 밖이면 국외 이전). 공개한 뒤 메일함을 옮기거나 추가하면 30일 전에 알려야 합니다.
- **시행일:** `src/app/privacy/page.tsx`의 `EFFECTIVE_DATE`는 실제 첫 공개일(Production 첫 배포일, KST)이어야 하며, 지금 값은 `2026년 11월 14일`입니다. 첫 배포가 다른 날로 밀리면 그 날짜로 고쳐 0번의 커밋에 넣습니다. 테스트는 날짜를 고정하지 않으므로(형식과 실제 있는 날짜인지만 확인) 날짜를 바꿔도 `npm run check`가 통과합니다.

0. **비공개 저장소 만들기(처음 한 번):** AI 도구가 아니라 직접 연 PowerShell 창에서 프로젝트 폴더로 이동한 뒤 한 줄씩 실행합니다(`gh auth login`으로 로그인한 상태).

   ```powershell
   git branch -M main     # 이 PC의 git 기본 브랜치는 master. 첫 push 전에 main이어야 GitHub 기본 브랜치와 Vercel 운영 브랜치가 main이 됨
   git config user.name "sihoon-0077"
   git config user.email "205524758+sihoon-0077@users.noreply.github.com"
   git add -A
   git ls-files | Select-String '(^|/)\.env|(^|/)\.data/|(^|/)anchors-out/|keys\.env$|\.(pem|crt|key|dump|gpg)$'   # .env.example 한 줄만 나와야 함
   git commit -m "SIGNALS site 1R"
   git log -1 --format="%an <%ae> | %cn <%ce>"     # 두 주소 모두 noreply인지 확인
   gh repo create sihoon-0077/signals-site --private --source . --push
   git ls-remote --heads origin                    # refs/heads/main 한 줄만
   ```

   - **올리면 안 되는 파일:** 확인 줄에 `.env.example` 말고 다른 파일(`.env.local`, `.data/` 아래 개발용 키·로컬 DB, `anchors-out/`, 키·인증서·백업 파일)이 나오면 커밋하지 말고 `git rm --cached <파일>`로 뺀 뒤 `.gitignore`에 추가하고 다시 확인합니다.
   - **커밋을 빠뜨리지 않기:** 커밋 없이 push하면 Create Next App 뼈대만 올라가고, `git commit -am`은 새 파일이 빠져 빌드가 실패합니다.
   - **작성자를 noreply로 두는 이유:** 저장소를 나중에 공유하거나 공개해도 개인 메일 주소가 커밋 기록에 남지 않습니다. 이 PC에서는 브랜치 이름(main)과 작성자가 이미 맞춰져 있을 수 있습니다(그 세 줄은 다시 실행해도 됨).
1. **프로젝트 가져오기:** Vercel에 GitHub 계정으로 로그인 → **Add New → Project → Import**에서 비공개 저장소 `signals-site`를 고릅니다. 목록에 없으면 Vercel GitHub App 설정에서 이 저장소 접근을 허용합니다.
   - Framework는 Next.js로 자동 인식됩니다.
   - Build·Install 명령과 Root Directory는 기본값(`next build`, `npm install`)을 그대로 둡니다.
   - 배포는 GitHub push → Vercel Git 연동으로만 합니다. 이 폴더에서 `vercel`·`vercel deploy` 명령으로 배포하지 마세요. 로컬 개발용 `.data/`(개발용 키·로컬 DB)가 함께 올라갈 수 있습니다.
2. **환경변수:** 같은 화면의 **Environment Variables**에 아래 값을 모두 넣고 Deploy합니다. 여러 줄 `.env` 내용을 첫 칸에 통째로 붙여 넣으면 한 번에 나뉘어 들어갑니다. 여러 줄 값인 `DATABASE_CA_PEM`은 이 일괄 붙여넣기에 넣지 말고 그 변수의 값 칸에 따로 넣습니다(인증서로 읽을 수 없게 들어가면 운영 빌드가 멈춤).
   - **적용 환경은 Production만:** Preview·Development에 넣으면 브랜치·PR마다 생기는 미리보기 배포가 운영 DB와 운영 키를 받게 됩니다. 코드도 거부하지만(따로 만든 시험용 DB·키일 때만 `ALLOW_PREVIEW_DB=1`), 첫 방어선은 여기입니다.
   - **비밀값은 Secret 유형으로:** 값을 넣을 때 Type에서 `Secret`을 고릅니다(예전 이름 Sensitive, 저장 뒤 값을 다시 볼 수 없음). 대상은 `DATABASE_URL`, `ADMIN_PASSWORD`, `CRON_SECRET`, `SIGNING_PRIVATE_KEY_PEM`, `CHECKPOINT_PRIVATE_KEY_PEM`입니다. `Config`로 저장하면 대시보드에서 값이 다시 보입니다.

   | 이름 | 값 |
   |---|---|
   | `DATABASE_URL` | 2단계 Transaction pooler URI(비밀번호를 넣은 것, `?sslmode=` 같은 SSL 설정 없이: 붙이면 운영 빌드가 멈춤). 비밀번호 특수문자는 퍼센트 인코딩 |
   | `DATABASE_CA_PEM` | 2단계 인증서 파일 내용 전체(`-----BEGIN CERTIFICATE-----`부터 끝까지, 값 칸에 따로). 운영에는 꼭 넣음(없으면 DB 서버 인증서를 확인하지 않아 `npm run smoke`가 실패). 인증서로 읽을 수 없는 값(잘림 등)이면 운영 빌드가 멈춤 |
   | `SIGNING_KEY_ID`, `SIGNING_KEY_CREATED_AT`, `SIGNING_PRIVATE_KEY_PEM`, `CHECKPOINT_KEY_ID`, `CHECKPOINT_KEY_CREATED_AT`, `CHECKPOINT_PRIVATE_KEY_PEM` | 1단계 `prod-keys.env`의 6줄 그대로(PEM의 `\n` 포함) |
   | `ADMIN_USER`, `ADMIN_PASSWORD` | 관리자 아이디, 3단계 비밀값(16자 이상) |
   | `CRON_SECRET` | 3단계 비밀값(16자 이상, 5단계 공개 저장소의 environment `anchor-cron`에도 같은 값) |
   | `ANCHOR_REPO_URL` | `https://github.com/sihoon-0077/signals-anchors` 형식 그대로(`/tree/main` 같은 뒷부분 없이) |
   | `ANCHOR_REPO_BRANCH` | (선택) 공개 앵커 저장소 기본 브랜치가 main이 아닐 때만 그 이름 |
   | `PRIVACY_OFFICER`, `CONTACT_EMAIL` | 개인정보 처리방침에 공개되는 보호책임자 이름과 문의 이메일(개인정보 보호법 제30조). 공개되므로 이 서비스 전용 메일을 권장. 그 메일함을 운영하는 회사는 `MAIL_SERVICE`에 |
   | `MAIL_SERVICE` | `CONTACT_EMAIL` 메일함을 운영하는 회사(위 '가져오기 전에 정할 것'). `법인명(국가, 개인정보 문의처)` 형식, 국가는 한글 국가 이름 하나(`미국` 등). 예: Gmail이면 `Google LLC(미국, googlekrsupport@google.com)`, 국내 메일이면 국가를 `대한민국`으로(`대한민국 서울`처럼 도시·다른 국가를 붙이면 위탁인지 국외 이전인지 정할 수 없어 운영 빌드가 멈춤). 문의처는 그 회사 개인정보 처리방침에서 직접 확인한 이메일·https 주소·전화번호. `CONTACT_EMAIL`이 gmail.com·googlemail.com이면 법인명에 `Google`, naver.com이면 `네이버`·`NAVER`, daum.net·hanmail.net이면 `다음`·`Daum`(또는 `카카오`·`Kakao`), kakao.com이면 `카카오`·`Kakao`가 없을 때도 운영 빌드가 멈춤(그 밖의 도메인은 대조하지 않으니 직접 확인). 처리방침 3항에 그대로 공개되며(대한민국이면 처리 위탁, 그 밖이면 국외 이전 항목까지), 빠지거나 형식이 틀리면 운영 빌드가 멈춤. 공개 뒤에 바꾸면 처리방침 8항대로 30일 전에 알려야 함 |
   | `SITE_URL` | (선택) 비우면 Vercel 운영 주소(`https://<프로젝트>.vercel.app`). 도메인을 연결했으면 `https://도메인`(경로 없이). `http://`·localhost 주소를 넣으면 빌드가 멈춤 |

   - **저장 뒤 확인(첫 앵커 전):** 첫 배포 뒤 Settings → Environment Variables 목록에서 위 다섯 비밀값에 `Secret` 표시가 있고 적용 환경이 Production뿐인지 봅니다. 가져오기 화면에서 유형이나 환경을 고를 수 없었거나 `Config`로 들어갔다면, 그 변수를 지우고 **같은 값**으로 Type `Secret`·Production만 골라 다시 만든 뒤 Redeploy합니다. 키 6줄은 1단계 보관 파일 그대로 넣습니다.
   - **빌드가 실패하면:** 값이 빠졌거나 형식이 틀리면 빌드가 실패하고, 로그에 변수 이름과 이유가 나옵니다. 값을 고친 뒤 **Deployments → 최신 배포 ⋮ → Redeploy**를 누릅니다.
   - **값을 바꿀 때:** 환경변수는 새 배포에만 적용됩니다. 나중에 바꿀 때도 항상 Redeploy해야 합니다.
   - **시스템 변수 노출:** Settings의 'Automatically expose System Environment Variables'는 켠 채로 둡니다. 빌드 검사, 미리보기 차단, 주소 대체가 이 값(`VERCEL_ENV` 등)을 씁니다.
3. **배포 확인(배포하거나 Redeploy할 때마다)**
   - **공개 주소:** Settings → Domains에 보이는 운영 도메인이 공개 주소입니다.
     - 이름이 이미 쓰이고 있으면 `signals-site-xxxx.vercel.app`처럼 바뀔 수 있습니다.
     - Deployments 목록에 보이는 해시나 `-git-main-`이 붙은 주소는 로그인한 사람만 열리니 어디에도 쓰지 않습니다.
   - **운영 브랜치:** Settings → Environments → Production → Branch Tracking이 `main`인지 확인합니다(가져올 때 main이 없으면 master가 운영 브랜치로 잡힘).
   - **배포된 커밋:** `https://<운영도메인>/api/health`의 `deployment.commit`이 방금 push한 커밋(`git rev-parse --short=12 HEAD`)과 같은지 봅니다. 다르면 운영 브랜치가 아닌 곳에 push했거나 빌드가 실패한 것입니다.
   - **배포 보호:** Settings → Deployment Protection이 **Standard Protection**인지 확인합니다. 이 설정이면 운영 도메인은 공개되고 나머지 주소는 보호됩니다.
   - **Node 버전:** Settings → Build and Deployment → Node.js Version이 24.x인지 확인합니다(`package.json`의 engines로 고정).
   - **자동 점검:** 프로젝트 폴더에서 `npm run smoke -- https://<운영도메인>`을 실행해 실패 0인지 봅니다. `상태 점검` 줄에 `TLS verify-full`이 보여야 합니다(아니면 'DB 서버 인증서 확인'이 실패로 나옴: `DATABASE_CA_PEM`을 넣고 Redeploy). 기록을 만들지 않는 읽기 전용 점검입니다(보안 헤더, 관리자·앵커 호출구 잠김, 공개키, 404 처리, 처리방침의 운영 메일 업체, `/api/health` 포함). 중간에 요청이 실패해도 결과 줄은 모두 나옵니다. `[실패]` 줄의 오류 코드는 9절 코드 표에서 찾습니다.
   - **손으로 볼 때:** 시크릿(InPrivate) 창을 씁니다. Vercel에 로그인한 브라우저는 보호된 주소도 그냥 통과하기 때문입니다.
4. **속도 제한(첫 배포 직후 필수):** Firewall → Rules에 규칙 1개를 만듭니다(Hobby는 프로젝트당 1개).
   - **조건:** `Request Method = POST` 그리고 `Request Path`가 `^/(admin(/.*)?|api/cron/anchor)$`에 맞지 않음. 경로를 `/providers/join`으로 좁히면 안 됩니다. 서버 액션(사전등록)은 다른 경로로 보내도 실행되기 때문입니다. `/api/ref`(초대 링크 방문 집계)도 POST라 같은 규칙에 걸립니다.
   - **동작:** Rate Limit(고정 창 600초, 20회, 키 IP) → 429. Challenge(봇 확인)는 쓰지 않습니다. 방문 집계(sendBeacon)가 풀지 못해 조용히 사라집니다.
   - **첫날은 관찰만:** 하루 Log로 두고, 정상 사용자가 걸리지 않는지 본 뒤 Rate Limit으로 바꿉니다(늦어도 공급자 사전등록을 여는 11/9 전).
   - **켜지 않을 것:** Attack Challenge Mode와 Bot Protection은 GitHub Actions의 앵커 호출까지 막습니다. 켜야 한다면 먼저 `/api/cron/anchor` Bypass 규칙을 만들고, 끈 뒤 daily-anchor를 다시 실행합니다.
   - **사이트 자체 방어:** 최근 1시간에 들어온 대기 등록이 30건이면 새 등록을 받지 않습니다(등록 화면에는 잠시 뒤 다시 시도하라는 안내가 나옴). 거절한 등록은 세지 않으므로, 스팸이면 관리자 화면 '대기'의 '이 시각 이후 대기 등록 모두 거절'로 거절하면 바로 다시 열립니다. 같은 공격이 이어지면 이 규칙이 Rate Limit(429)으로 켜져 있는지 확인하고 한도를 낮춥니다.

## 5. 공개 앵커 저장소(GitHub, 공개)

**키와 DB가 최종인지 확인한 뒤에 합니다.** 확인할 것:
- `/keys.json`의 두 `key_id`가 1단계 키와 같다.
- Vercel `DATABASE_URL`이 최종 Supabase 프로젝트다.
- 키 보관본 두 곳을 `npm run keys:check`로 확인했다.
- `npm run smoke`가 실패 0이다.

1. **저장소 만들기:** 새 **공개** 저장소 `signals-anchors`를 빈 상태로 만들고 `deploy/anchors-repo/` 내용을 올립니다.
   - 공개 저장소의 커밋 작성자 이메일은 누구나 볼 수 있으므로 GitHub noreply 주소로 커밋합니다.
   - 사이트 저장소 안에서 `git init`하면 중첩 저장소가 되므로, 밖으로 복사해서 작업합니다.
   - 이 PC의 git 기본 브랜치는 master라서, 꼭 `main`으로 만듭니다(검증 화면이 main에서 읽음).

   ```powershell
   Copy-Item -LiteralPath '<프로젝트>\deploy\anchors-repo' -Destination "$HOME\signals-anchors" -Recurse
   cd "$HOME\signals-anchors"
   git init -b main
   git config user.name "sihoon-0077"
   git config user.email "205524758+sihoon-0077@users.noreply.github.com"
   $f = "$HOME\signals-anchors\README.md"; $u = [Text.UTF8Encoding]::new($false); [IO.File]::WriteAllText($f, [IO.File]::ReadAllText($f, $u).Replace('{{SITE_URL}}', 'https://<운영도메인>'), $u)   # 끝에 / 없이
   $r = [IO.File]::ReadAllText($f, $u); $r.Contains('# SIGNALS 공개 앵커 저장소') -and -not $r.Contains('{{SITE_URL}}')   # True만 나와야 함
   git diff --no-index --stat -- '<프로젝트>\deploy\anchors-repo\README.md' README.md   # '1 file changed, 2 insertions(+), 2 deletions(-)'만(종료 코드 1은 정상)
   git add -A; git commit -m "seed: daily-anchor workflow and verifier"
   git log -1 --format="%an <%ae> | %cn <%ce>"     # 두 주소 모두 noreply인지 확인
   git ls-files requirements.txt .gitattributes      # 둘 다 커밋됐는지 확인
   gh repo create sihoon-0077/signals-anchors --public --source . --push
   gh workflow disable daily-anchor -R sihoon-0077/signals-anchors   # 4번 전까지 예약 실행을 꺼 둠
   ```

   - **README 주소 바꾸기:** 위 한 줄(UTF-8 그대로 읽고 씀)로만 바꿉니다. 이 PC의 PowerShell 5.1에서 `Get-Content`·`Set-Content`로 바꾸면 한글이 `?`로 깨진 채 커밋되고, 공개 저장소 이력은 고칠 수 없습니다. 경로는 `$HOME\…` 전체로 씁니다(`[IO.File]`은 `cd`한 폴더가 아니라 창을 연 폴더를 기준으로 상대 경로를 읽음).
   - **확인 두 줄:** 첫 줄은 한글 제목이 그대로이고 자리표시가 없으면 `True`입니다. 둘째 줄의 숫자는 템플릿에서 `{{SITE_URL}}`이 있는 줄 수(지금 2)와 같아야 합니다(함께 찍히는 'LF will be replaced by CRLF' 경고 줄은 무시). `True`가 아니거나 숫자가 다르면(한글 깨짐 등) push 전이므로 `$HOME\signals-anchors` 폴더를 지우고 `Copy-Item`부터 다시 합니다.
   - GitHub 웹의 Upload files로 올리지 않습니다. 웹 업로드는 `.gitattributes`를 무시해서, 줄바꿈이 CRLF로 바뀐 사본이 올라가면 매일 작업이 스크립트 첫 줄에서 실패합니다(로그에 pipefail, invalid option name).
2. **변수·비밀값:**
   - Settings → Secrets and variables → Actions → Variables: `SITE_URL` = 4단계 운영 도메인(`https://…`, 끝에 `/` 없이)
   - Settings → Environments → New environment(이름 `anchor-cron`) → Environment secrets: `CRON_SECRET` = 사이트와 같은 값. Repository secrets에는 넣지 않습니다(이 environment를 쓰는 앵커 요청 job만 받음). 예전 안내대로 Repository secrets에 `CRON_SECRET`을 넣었으면 지웁니다(저장소 비밀값은 job마다 나뉜다는 보장이 문서에 없음).
3. **권한 설정은 그대로:** Settings → Actions → General → Workflow permissions는 바꾸지 않습니다(기본값 읽기 전용).
   - 워크플로 파일의 기본 권한은 읽기 전용(`permissions: contents: read`)이고, 커밋하는 publish job만 `contents: write`를 받습니다. `CRON_SECRET`은 environment `anchor-cron`을 쓰는 request job에만 주어집니다(PyPI 패키지가 도는 check job에는 쓰기 토큰도 비밀값도 없음).
   - 첫 실행이 push 단계에서 403으로 실패하면, 이 설정을 넓히지 말고 워크플로 파일의 `permissions`가 그대로 올라갔는지 확인합니다.
   - (필수) Settings → Rules → Rulesets → New branch ruleset에서 기본 브랜치에 'Restrict deletions'와 'Block force pushes'만 켭니다. 쓰기 토큰이 어떻게 쓰이든 공개 이력을 지우거나 다시 쓰지 못하게 하는 마지막 방어입니다. 'Require a pull request'는 켜지 않습니다(자동 커밋이 막힘).
4. **되돌릴 수 없는 단계(KST 18시 이후에):** Actions → daily-anchor → **Enable workflow** → **Run workflow**를 누릅니다.
   - 18시 전에 실행하면 앵커를 만들지 않고 `keys.json`만 커밋하며, 로그에 'KST 18시 전이라 … 대조·미러링만 합니다'가 나옵니다.
   - 18시 이후 실행이 성공하면 `anchors/오늘.json`, `.json.ots`, `keys.json`이 커밋됩니다. 이어서 Run workflow를 한 번 더 눌러 두 번째 실행이 '바뀐 것이 없습니다.'로 성공하는지 봅니다.
   - 실행 요약에서 request·check·publish·proofs 네 job이 모두 초록색인지, Annotations에 'Node.js 20 is deprecated' 경고가 없는지, 도구 설치(버전·해시 고정) 단계가 통과하는지 확인합니다. request job은 environment `anchor-cron`을 배포 기록 없이 쓰므로(`deployment: false`) 저장소 첫 화면에 Deployments가 생기지 않아야 합니다. 네 job 구성과 environment 비밀값은 GitHub 러너에서만 돌려 볼 수 있어 이 실행이 첫 시험입니다. request job이 'CRON_SECRET이 없습니다'로 실패하면 2번의 environment 이름(`anchor-cron`)과 비밀값 이름을 확인합니다.
   - 시크릿 창에서 `https://raw.githubusercontent.com/sihoon-0077/signals-anchors/main/keys.json`을 열어 `key_id`·`fingerprint`가 사이트 `/keys.json`과 같은지 확인합니다. 404면 저장소가 비공개이거나 주소·브랜치가 틀린 것입니다.
5. **이후 매일:**
   - **실행 시각:** KST 18:17 무렵 실행되고, 20:47에 한 번 더 확인합니다. GitHub 예약 실행은 늦어지거나 빠질 수 있습니다.
   - **알림 켜기:** GitHub Settings → Notifications → System → Actions에서 Email을 고르고 'Only notify for failed workflows'를 켭니다. 예약 실행 알림은 워크플로를 만든 사람이나 cron 줄을 마지막으로 고친 사람에게 가므로 운영자 계정으로 커밋합니다.
   - **알림이 없어도 확인:** GitHub가 예약 실행을 건너뛰면 실패 알림도 오지 않습니다. 21시 무렵 `/anchors`나 공개 저장소에 오늘 날짜가 있는지 봅니다.
   - **실패하면:** 커밋하지 않고, 실패한 실행은 Actions 탭에 공개로 보입니다. 원인을 고친 뒤 **KST 23:50 전에** Run workflow를 누릅니다(Re-run이 아니라 Run workflow. Re-run failed jobs는 그 실행의 check job이 넘긴 옛 파일을 다시 씁니다). 재시도까지 하면 요청에만 6분 가까이 걸리고, 실행 중에 자정이 지나면 작업은 그날 앵커를 더 요청하지 않고 실패로 끝납니다(사이트도 지난 날짜 요청은 422로 거절).
   - **proofs job('비트코인 증명 점검(커밋 뒤)')만 실패했으면:** 그 실행의 앵커는 이미 커밋된 것이니 Run workflow는 필요 없습니다. 9절 표의 '비트코인 증명 점검' 행대로 증명만 살핍니다.
   - **Run workflow도 안 될 때(GitHub 장애 등):** KST 18시 이후·24시 전에 운영 `/admin`의 '오늘(KST) 앵커 만들기'를 누르고, 시크릿 창에서 `https://<운영도메인>/anchors`에 오늘 날짜가 보이는지 확인합니다(공개 저장소에는 다음 실행이 받아 갑니다). 운영 복구에 `npm run anchor`는 쓰지 않습니다(로컬 시험용이라 운영 기록은 바뀌지 않음).
   - **자정이 지나면:** 그날은 채우지 않고 빈 날로 남습니다(다음 날 로그에 빈 날 경고). 숨기지 않습니다.
   - **(선택) 백업 예약:** 첫 앵커가 성공한 뒤에만, `vercel.json`에 `"crons": [{ "path": "/api/cron/anchor", "schedule": "0 13 * * *" }]`를 넣어 GitHub 실행이 둘 다 빠진 날을 대비할 수 있습니다. Hobby는 ±59분이라 KST 22시대에 돕니다(같은 날짜는 한 번만 저장). 첫 앵커 전에 넣으면 배포한 날 밤에 첫 앵커가 저절로 만들어지니 넣지 않습니다.

**이 작업이 하는 일**
1. request job이 오늘 앵커를 요청합니다. `CRON_SECRET`은 이 job에만 있고(environment `anchor-cron`), 이 job에서는 GitHub의 checkout 액션과 러너 기본 bash·curl·jq만 돕니다. 요청에 오늘 날짜(KST)를 실어 보내고, KST 18시 전에는 요청하지 않으며(그래도 뒤 job의 대조·미러링은 돎), 연결 실패·5xx만 30초 간격으로 최대 3번 보냅니다(시도마다 날짜를 다시 보고 자정이 지났으면 멈춤).
2. check job(비밀값 없음)이 공개키를 대조합니다(이미 올라온 키가 바뀌거나 사라지면 실패). 사이트에서 받는 요청(GET)은 일시 오류면 5초 간격으로 3번 더 받습니다.
3. 과거 앵커 문서 전체를 대조합니다. 바뀌거나 사라지면 실패합니다.
4. 별도 구현 검증기(`verify_anchor.py`)로 확인합니다. 루트, 서명, `prev_root` 사슬을 보고, 날짜 간 대조(에이전트 소실, 기록 수 감소, 리프 중복)도 합니다.
5. 비트코인 고정(OpenTimestamps)을 요청하고 대기 중인 증명을 갱신합니다. 캘린더가 응답하지 않으면 호출마다 60초에 끊고, 이 단계가 실패하거나 5분을 넘겨도 커밋은 막지 않습니다(증명은 다음 실행 때 다시 시도). 대기 중이 아닌 갱신 실패(깨진 증명 등)는 ots가 남긴 마지막 줄을 경고로 남깁니다.
6. 별도 publish job이 커밋합니다. 쓰기 권한은 이 job에만 있고, 앞 job이 넘긴 파일은 정해진 이름만 받으며 앵커 문서·`keys.json`을 사이트에서 다시 받아 같은지 확인한 뒤 커밋합니다. 이미 있는 `.ots`는 대기 중에서 완성본으로 바뀔 때만 갱신합니다(완성본을 되돌리거나 대기 중 증명끼리 바꾸지 않음). 실행 중 다른 커밋이 올라왔으면 그 위로 다시 쌓고, 강제 push는 하지 않습니다.
7. 커밋 뒤 proofs job(bash만, 읽기 권한)이 문서 날짜로부터 이틀이 지난 앵커의 `.json.ots`가 없거나 아직 완성본이 아니면 실행을 실패로 표시합니다(커밋은 이미 끝났으므로 앵커는 그대로이고, 실패 알림이 옴).

## 6. 첫 운영 점검표

- [ ] `npm run smoke -- https://<운영도메인>` 실패 0(`상태 점검` 줄에 `TLS verify-full`)
- [ ] `/keys.json`: 운영 키(`sig-`, `cp-`로 시작하고 `-dev-` 없음), `npm run keys:check -- <파일> --expect https://<운영도메인>/keys.json`이 '기준 keys.json(…)과 같습니다.'
- [ ] 시크릿 창에서 확인
  - `/admin`은 비밀번호 창이 뜸
  - `/api/cron/anchor`는 `{"error":"unauthorized"}`. 상태 코드 401만 보지 마세요. Vercel 배포 보호도 401을 줍니다.
- [ ] Vercel → Settings → Environment Variables: 다섯 비밀값에 `Secret` 표시가 있고, 환경 필터를 Preview로 바꾸면 목록이 비어 있음
- [ ] Vercel 운영 브랜치가 `main`이고, `/api/health`의 `deployment.commit`이 push한 커밋과 같음(4단계 3번)
- [ ] `/privacy`: 보호책임자·연락처가 보이고, 3항에 운영 메일 업체(`MAIL_SERVICE`, 배포 전에 넣음)가 보이고 '설정 필요'가 없으며(`/api/health`의 `config.mail_service`가 true), 그 업체가 `CONTACT_EMAIL` 메일함을 실제로 운영하는 회사이고(대한민국 회사면 처리 위탁, 해외 회사면 이전 국가가 보임), 시행일이 실제 첫 공개일과 같음(다르면 바로 `src/app/privacy/page.tsx`의 `EFFECTIVE_DATE`를 고쳐 배포)
- [ ] 사전등록 1건 → `/admin` 대기에 보임 → 본인 확인 메일(8절) → 회신 확인 → 승인 → `/p/주소` 열림(승인 전에는 404)
- [ ] 같은 이메일로 다시 등록해도 완료 화면이 똑같음(주소창에 handle·code 없음)
- [ ] 승인된 `/p/주소`를 시크릿 창에서 확인
  - '공유 링크'가 `https://<운영도메인>/p/…?ref=…`로 시작함(localhost 아님)
  - 페이지 소스(Ctrl+U)의 `og:image`가 `https://<운영도메인>/p/<주소>/opengraph-image/r<기록 수>`로 시작함
  - 카카오 공유 디버거(Kakao Developers → 도구 → 공유 디버거)에서 카드가 한글로 보임
- [ ] 사이트 기본 카드: `/`의 페이지 소스에 `og:image`가 `https://<운영도메인>/opengraph-image?…`로 있고, 그 주소가 1200×630 PNG. `/favicon.ico`·`/apple-icon`이 200. 이 카드를 배포하기 전(11/14 공개부터 이 배포까지)에 공유한 주소(공급자 화면 `/p/…`는 원래 자기 카드가 있어 제외)는 이미지 없이 캐시됐을 수 있으니 카카오 공유 디버거에서 캐시 초기화(`?ref=` 등 주소가 조금이라도 다르면 따로)
- [ ] 탈퇴 처리 시험은 시그널 없는 시험 등록으로만: 승인했던 등록은 탈퇴 구분으로 옮겨지고 승인 버튼이 사라짐, 승인한 적 없는 등록은 목록에서 사라짐(같은 주소로 다시 등록할 수 있음). 시험으로 주고받은 메일도 지움(8절)
- [ ] 첫 실제 시그널로 확인(시그널은 지울 수 없으니 시험 발행은 하지 않음)
  - 에이전트 기록 페이지의 '직접 검증'(지문 링크)에서 서명과 타임스탬프가 통과
  - '공개 저장소와 대조'가 통과. '확인 못 함'이면 이유(HTTP 404 등)를 보고 `ANCHOR_REPO_URL`·브랜치·저장소 공개 여부를 고친 뒤 Redeploy. '반영 대기'는 그날 앵커가 아직 저장소에 없는 정상 상태
  - 원문 공개 전(청산·만료·무효 처리, 청산 시그널의 앵커 고정, 공개 기한 경과 전)에는 원문이 비공개
- [ ] 백업 1회 + 복구 연습(2-1), Vercel Firewall 규칙(하루 Log 관찰 뒤 Rate Limit, 늦어도 11/9 전)
- [ ] 앵커 저장소 첫 실행(18시 이후) 성공 → 두 번째 실행 '바뀐 것이 없습니다.' → 다음 실행에서 `.ots` 완성본으로 갱신, 공개 저장소 첫 화면의 README 제목이 'SIGNALS 공개 앵커 저장소'로 보이고(한글 깨짐 없음) `{{SITE_URL}}`이 남아 있지 않음
- [ ] Supabase Security Advisor: Errors 0건, 우리 테이블 경고 없음(2단계 5번)

## 7. 운영 중

**매일 하는 일**
1. **발행·청산:** `/admin`에서 합니다.
   - 1R에는 KOSPI·KOSDAQ 시그널만 봉인합니다(발행 화면은 두 시장만 보여 주고, 서버도 다른 시장의 진입을 받지 않음). 공개 기한·진입 기준·봉인 전 검사가 모두 KRX 시간 기준이라, 미국 시장은 미국 장 시간 모델을 넣은 뒤에 엽니다.
   - 공급자 시그널은 8절 '공급자 시그널 받기'대로 메일 내용을 그대로 옮겨 봉인합니다.
   - 코드를 다시 배포했거나 환경변수를 바꿔 Redeploy했다면, 열어 둔 `/admin` 탭을 모두 새로고침(F5)한 뒤 작업합니다. Hobby에는 Skew Protection이 없어서 예전 화면의 버튼이 실패합니다(봉인되지 않음).
   - 발행 결과가 '봉인 결과를 확인하지 못했습니다'이면 화면을 새로고침하지 말고, 새 탭에서 '청산 전 시그널' 목록부터 확인합니다. 원래 화면에서 그대로 다시 누르는 것은 안전합니다(같은 요청 번호라 이미 봉인됐으면 그 기록을 알려 주고, 두 번 봉인되지 않음).
   - 공급자 에이전트의 주소(slug)·이름·설명, 규칙 버전·근거에는 필명·프로필 주소·연락처를 넣지 않습니다. 탈퇴하면 필명·에이전트 이름은 바꾸지만 slug와 봉인 원문은 바꿀 수 없습니다.
     - **서버가 막는 연락처(확인 칸으로도 넘길 수 없음):** 메일 주소, `http(s)://`·`www.` 링크, `t.me/`·`open.kakao.com`·`bit.ly/`, 흔한 도메인으로 끝나는 주소(`blog.naver.com` 등), `@아이디`(`IG@아이디`·`카톡ID@아이디`·`kakao@아이디`·`TG@아이디`처럼 라벨에 붙인 것 포함), 휴대전화 번호(`010-1234-5678` 등)는 공급자 에이전트를 만들 때와 발행할 때 항상 거부합니다. 흔한 매매 표기(`@VWAP`·`@MKT`·`@OPEN`·`@CLOSE`·`BUY @MKT`, `@78,000` 같은 가격, `005930.KS`·`035720.KQ` 같은 국내 거래소 접미사)는 거부하지 않습니다. 단 최상위 도메인과 같은 접미사(`AAPL.US`·`NOVO-B.CO`)와 도메인으로 끝나는 회사 이름(`C3.ai`·`JD.com`)은 주소로 보고 거부합니다.
     - **연락처가 아닌데 걸리는 표기:** 도메인과 같은 접미사(`AAPL.US`·`NOVO-B.CO`)와 도메인으로 끝나는 이름(`C3.ai`·`JD.com`·`std.dev`)도 같은 규칙으로 거부합니다. 공급자 시그널이면 `AAPL`·`C3 AI`·`표준편차`·`momo-v2-dev`처럼 바꿔 다시 보내 달라고 합니다(8절 '공급자 시그널 받기' 2번, 규칙 버전 이름을 바꾸면 그 에이전트의 다음 시그널에도 같은 이름).
     - **필명·프로필 주소:** 프로필 주소는 대소문자와 글자 사이의 띄어쓰기·`-`·`_`·`.`·`·`·폭 없는 문자를 무시하고, 바로 뒤에 붙인 숫자·버전(`bluefox2`·`bluefox-v1`)도 같은 표기로 봅니다. 필명(2글자 이상)은 띄어쓰기·폭 없는 문자·대소문자를 무시하고 비교합니다. 같은 표기가 있으면 에이전트 만들기에서 거부하고, 발행에서는 두 칸(규칙 버전·근거)에서 걸린 표기를 모두 오류에 보여 주며 확인 칸을 체크해야 봉인합니다.
     - **확인 칸은** 화면에 나온 표기에만 적용됩니다. 에이전트나 걸린 칸의 문구를 바꾸거나 다른 오류가 나면 체크가 풀리고 다시 묻습니다. 'RSI'·'돌파'처럼 정말 일반 낱말이 겹친 경우에만 체크합니다. 필명이나 주소를 그대로 쓴 것이면 체크하지 말고, 공급자 시그널이면 그 표기를 뺀 메일을 다시 받아 봉인합니다.
     - **직접 확인할 것:** 번역·줄임말, `/`·`*` 같은 다른 기호를 끼운 필명·주소, 발행에서 다른 영문 낱말에 붙여 쓴 주소(`bluefoxswing`), `카톡 ID: bluefox`처럼 `@`·도메인이 없는 아이디, 유선·대표 전화번호는 걸러 내지 못합니다. 봉인 전에 규칙 버전·근거를 직접 읽습니다.
   - 1R에서는 에이전트 상태를 '기록 기준 충족'으로 바꾸지 않습니다(관리자 화면에는 30일·15건 충족 여부만 보임). 계획의 품질 기준(완결 8건, 최대낙폭 등)은 판매 단계에서 적용합니다.
2. **앵커 확인:** 20:47 실행이 끝난 뒤(21시 무렵) 공개 저장소에 오늘 날짜 파일이 있고 Actions가 초록색인지 봅니다. 빨간색이면 실패한 job 이름을 봅니다. proofs(비트코인 증명 점검)만 빨간색이면 앵커는 커밋된 것이니 9절 표대로 증명만 살핍니다. 그 밖이면 23:50 전에 Run workflow로, 그것도 안 되면 24시 전에 `/admin` 버튼으로 복구합니다(5단계 5번).
3. **백업:** 앵커를 확인한 뒤 백업합니다(2-1).

**주 1회:** Next.js 15.5.x 보안 패치를 확인합니다(`npm view next dist-tags.backport`). `next`는 정확한 버전으로 고정돼 있어서 패치가 자동으로 들어오지 않습니다.

**11/16 전:** 명령줄 검증기(`scripts/verify.ts` + `src/core`)를 공개 앵커 저장소에 올립니다. 그 뒤 공개 README와 `/verify` 화면의 '공개 전' 문구를 현재형으로 바꾸고, 외부인 재검증을 증거로 남깁니다. 공개 전까지는 문구를 '공개 전'으로 둡니다. 공개 README는 VS Code나 메모장(UTF-8로 저장)으로 고치고, 커밋 전에 `git diff --stat`에 바꾼 줄만 나오는지 봅니다(PowerShell 5.1의 `Get-Content`·`Set-Content`로 바꾸면 한글이 깨짐, 5단계 1번 참고).
- **명령:** `npm run verify -- https://<운영도메인> <지문64자리> --mirror https://github.com/sihoon-0077/signals-anchors`(저장소 기본 브랜치가 main이 아니면 `--branch <브랜치>`). 공개 README의 사용법에도 `--mirror`와 아래 종료 코드 뜻을 적습니다.
- **기대값:** 정상 기록은 exit 0(종합 '모든 항목 통과', 원문 공개 전이면 '확인 가능한 항목 모두 통과'), 사이트가 준 자료끼리 또는 공개 저장소 사본과 맞지 않는 기록은 exit 1, 발행 후 이틀(KST)이 지난 기록을 사이트가 앵커 없이 보내면 exit 2입니다.
- **exit 2는 통과가 아닙니다:** 종합 '공개 저장소와 대조하지 못함'은 `--mirror`를 빠뜨렸거나 저장소를 받지 못한 경우, 또는 발행 후 이틀(KST)이 지난 기록인데 사이트가 그 기록을 담은 앵커를 보내지 않은 경우(앵커를 숨겼을 수 있음)입니다. 앞의 경우는 주소·브랜치·저장소 공개 여부를 고친 뒤 다시 실행하고, 앵커 누락이면 저장소 `anchors/`에서 발행일 다음 날짜 파일에 그 에이전트의 chain_length가 기록 순번 이상인지 직접 확인합니다(이틀 넘게 앵커가 실패했다면 앵커부터 복구).
- **공개 전 변조 시험(증거로 남김):** 받은 bundle.json의 fields 한 글자를 바꾸면 exit 1, 사흘 이상 지난 기록의 anchor를 null로 바꾸면 exit 2, keys의 created_at을 앞당긴 묶음은 `--mirror`에서 exit 1인지 확인합니다.

**코드를 바꿀 때:** 운영 브랜치(`main`)에 push하면 곧바로 운영에 배포됩니다. push 전에 `npm run check`와 `npm run build`를 돌립니다. 마이그레이션은 새 번호 파일(`0006_…`)로만 추가하고, 2단계 4번 한 줄로 적용합니다(`TLS verify-full` 확인).

**하지 말 것**
- 첫 앵커 뒤 서명 키 재생성·교체, 키 환경변수 수정, Supabase 프로젝트·DB 재생성
- DB에서 트리거를 끄고 봉인 기록 수정·삭제(앵커 대조에서 드러나도록 설계됨)
- 운영에 적용한 마이그레이션 파일(0001~0005) 고치기·지우기·이름 바꾸기(실행기가 멈춤)
- Supabase DB 시간대(timezone)를 기본값 UTC에서 바꾸기. 앱의 KST 날짜는 SQL에서 `AT TIME ZONE 'Asia/Seoul'`로 정함
- 공개 앵커 저장소 force-push나 이력 재작성(이력 자체가 증거)
- KST 18시 전에 관리자 앵커 버튼 누르기, 운영 DB를 대상으로 `npm run anchor` 실행(운영 복구는 `/admin` 버튼으로만)
- 운영 `DATABASE_URL`을 `.env.local`에 두기, 비밀값 커밋, 미리보기 주소의 `/admin`에서 시험하기
- 백업 없이 SQL Editor에서 DDL·트리거 변경, 백업 파일을 OneDrive·저장소·Actions에 두기

**알아 둘 것:** 한 번도 승인되지 않은 사전등록의 1년 파기(등록일부터 1년, 행을 통째로 지움)는 앵커 호출구(`/api/cron/anchor`)가 불릴 때 앵커보다 먼저 돕니다(앵커가 실패한 날에도 돎). 승인된 적이 있는 공급자는 지금 거절 상태여도 자동으로 파기하지 않고 탈퇴를 요청할 때까지 둡니다. 파기는 어느 등록을 지웠는지 남기지 않으므로 메일 정리는 8절 '탈퇴 처리' 5번대로 미리 합니다. 대회 뒤 앵커 작업을 끄거나, 저장소 활동이 60일 없어 GitHub가 예약을 멈추면 파기도 멈추므로 그 전에 파기 실행 방법을 따로 정합니다. 서비스를 끝낼 때는 남은 등록(승인된 뒤 거절된 행 포함)과 탈퇴 처리로 남긴 행(이메일이 `@invalid`로 끝나는 행: 프로필 주소·시그널 방식·시장·보유 기간·등록·동의 일시)도 지웁니다(처리방침 2항 '서비스를 끝내면 지웁니다').

## 8. 운영 메일과 정보주체 요청

사이트에는 이메일 소유 확인 기능도, 시그널을 받는 기능도 없습니다. 승인 전에 등록 이메일로 본인 확인 메일을 보내고 회신을 받은 뒤 승인합니다. 운영 메일(본인 확인·승인 안내·시그널 접수·문의)은 `CONTACT_EMAIL` 메일함으로 주고받고, 그 메일함을 운영하는 회사는 `MAIL_SERVICE`로 처리방침 3항에 공개됩니다(4단계).

**본인 확인 메일**
- 제목: `[SIGNALS] 공급자 사전등록 본인 확인`
- 본문: '이 이메일 주소로 SIGNALS 공급자 사전등록(필명: ○○, 프로필 주소: ○○)이 접수됐습니다. 직접 등록하셨다면 이 메일에 "확인"이라고 회신해 주세요. 회신을 받은 뒤 승인하고 공개 프로필 주소와 공유·초대 링크를 보내 드립니다. 등록한 적이 없다면 "아님"이라고 회신해 주세요. 바로 지우겠습니다. 회신이 없으면 승인하지 않습니다.'
- '아님' 회신, 회신 없음, 만 19세 미만 확인 시에는 승인하지 않고 탈퇴 처리합니다(아래 '탈퇴 처리').

**승인 안내 메일:** 아래를 모두 적고, 첫 시그널 전에 이 모두에 대한 '동의합니다' 회신을 받아 기록표에 남깁니다. 회신 전에 온 시그널은 봉인하지 않습니다.
- 가입 화면의 조건: 손실이 나도 지우지 않고 모두 공개 / 원문은 청산·만료·공개 기한 뒤 필명과 함께 공개 / 탈퇴해도 봉인 기록은 '탈퇴한 공급자'로 계속 공개
- 기록하는 시장: '지금은 국내 주식(KOSPI·KOSDAQ) 시그널만 기록합니다. 미국 등 다른 시장의 시그널은 아직 기록하지 않습니다.' 등록 때 다른 시장을 고른 공급자에게도 그대로 적습니다.
- 보내는 방법: '시그널은 등록하신 이메일 주소에서 이 메일 주소로, 시그널 하나에 메일 하나씩 보내 주세요. 메신저·설문 폼으로는 받지 않습니다.'
- 적을 칸: '종목(코드)·방향(상승/하락)·동작(진입/청산, 청산이면 닫을 진입)·목표가·손절가·최대 보유 거래일 또는 유효기한·규칙 버전·근거(500자 이내). 규칙 버전·근거는 원문과 함께 공개되고 탈퇴해도 지울 수 없으니 필명·프로필 주소·링크·연락처를 넣지 마세요(`C3.ai`처럼 주소로 읽히는 표기도 받지 않습니다).'
- 기록 시각: '기록 시각은 보내신 시각이 아니라 운영자가 봉인한 시각이며, 진입 기준도 봉인 뒤 받은 외부 타임스탬프 시각 이후의 가격으로 정합니다. 봉인은 운영자가 직접 하므로 보내신 때보다 늦어질 수 있습니다. 그날 시가를 진입 기준으로 하려면 08:30(KST) 전에 봉인돼야 하므로 전날 밤까지 보내 주세요. 보내 주신 시그널은 개인정보 처리방침 1항의 시그널 기록으로 처리합니다.'
- 끝 문장: '위 조건과 시그널 보내는 방법에 동의하시면 이 메일에 "동의합니다"라고 회신해 주세요.'

**공급자 시그널 받기(메일 → `/admin` 봉인)**
1. 승인 조건에 '동의합니다'라고 회신한(기록표에 날짜가 있는) 공급자가 등록 이메일 주소에서 `CONTACT_EMAIL`로 보낸 메일만 받습니다. 다른 주소·메신저·설문 폼으로 왔으면 봉인하지 않고 위 방법을 다시 안내합니다(메신저·폼 업체는 처리방침 3항에 없음).
2. 칸이 빠졌거나, KOSPI·KOSDAQ 종목이 아니거나, 규칙 버전·근거에 필명·프로필 주소·링크·연락처가 있거나, 서버가 연락처로 거부하면(7절 '서버가 막는 연락처') 봉인하지 않고 고쳐서 다시 보내 달라고 회신합니다(규칙 버전 이름을 바꿔야 하면 그 에이전트의 다음 시그널에도 같은 이름을 쓰도록 안내). 운영자가 원문을 고쳐 봉인하지 않습니다(기록 시각은 다시 받은 메일을 봉인한 때).
3. `/admin` '시그널 발행(봉인)'에서 그 공급자의 에이전트를 고르고(없으면 먼저 '에이전트'에서 만듦: 주소·이름·설명에 필명·프로필 주소·연락처를 넣지 않음) 메일의 값을 그대로 옮깁니다. 시장은 종목 코드로 KOSPI·KOSDAQ를 확인해 고르고, 메일에 없는 비중은 비웁니다. 청산이면 '청산 대상 진입 시그널 ID'에 닫을 진입의 ID를 넣습니다(에이전트 기록 페이지에서 그 진입의 '직접 검증' → '계산에 쓴 공개 자료 보기' → '원본 JSON 받기'의 `signal.id`).
4. 받은 순서대로 바로 봉인합니다. '봉인하고 발행'을 누른 때가 기록 시각이고, 진입 기준도 이 봉인 뒤의 타임스탬프로 정해집니다(메일을 보낸 시각이 아님).
5. 결과 줄(순번·지문·원문 공개 기한)을 확인해 공급자에게 회신합니다. 옮겨 적기를 잘못해 공개 기한 등이 메일과 다르면 발행 10분 안에만 사유를 적어 무효 처리할 수 있고(무효 처리하면 원문이 바로 공개됨), 바른 값으로 새로 봉인합니다.

**기록표:** 프로필 주소마다 등록일, 승인 조건 동의 회신일, 소식 수신 회신일·수신 거부일·수신 동의 확인 메일을 보낸 날, 정보주체 요청의 요청일·처리일·회신일을 적습니다. 사전등록하지 않은 사람의 요청은 `문의-<받은 날>` 줄에 날짜만 적습니다. 이메일은 적지 않고, 2-1 '탈퇴 기록'과 같은 곳(클라우드 동기화 폴더 밖의 암호화 파일)에 둡니다.

**소식(광고성) 메일:** 처리방침 1항대로 첫 안내 메일에서 수신 의사를 다시 확인하고, '소식 수신' 회신이 기록표에 적힌 사람에게만 보냅니다.
- 소식에 동의한 사람에게 등록일부터 14일 안에 첫 안내 메일을 보냅니다(본인 확인 메일에 함께 적어도 됨). 전송자 명칭, 동의 사실과 날짜, 처리 결과를 적고(정보통신망법 제50조) 광고 내용은 넣지 않습니다.
- 그 메일 끝에 넣을 문장: '소식 메일을 받으시려면 이 메일에 "소식 수신"이라고 회신해 주세요. 회신이 없으면 소식 메일을 보내지 않습니다.'
- 발송 대상은 관리자 화면이 아니라 기록표에서 고릅니다: '소식 수신' 회신 있음, 수신 거부 없음, 거절·탈퇴 아님. 관리자 화면의 '동의(발송 전 기록표의 회신 확인)'는 등록 때 체크한 값이라 회신 여부를 뜻하지 않습니다.
- 수신 거부·동의 철회를 받으면 아래 '정보주체 요청'대로 처리하고 14일 안에 결과를 알립니다.
- 실제 소식 메일은 제목 앞에 '(광고)'를 붙이고, 본문에 전송자 연락처와 수신 거부 방법을 넣습니다.
- **2년마다 수신 동의 확인(정보통신망법 제50조⑧, 시행령 제62조의3):** 소식 수신에 동의한 사람마다 동의한 날(등록일, `/admin`의 '등록' 날짜)부터 2년이 되기 전에 확인 메일을 보내고, 그 뒤로도 같은 날짜를 기준으로 2년마다 보냅니다. 적을 것: 전송자 명칭, 수신에 동의한 사실과 그 날짜, 동의를 유지하거나 철회하는 방법(예: 그만 받으려면 "수신 거부"라고 회신). 광고는 넣지 않습니다. 기록표에 보낸 날을 적습니다. 회신이 없으면 동의가 유지된 것으로 보고, "수신 거부" 회신은 아래 '정보주체 요청'대로 처리합니다. 첫 기한은 2028년 11월입니다.

**정보주체 요청(열람·정정·삭제·처리정지·동의 철회)**
처리방침 4항대로 6항 연락처로 받은 요청은 지체 없이 처리하고, 요청일·처리일·회신일을 기록표에 적습니다.
- **본인 확인:** 사전등록 정보에 대한 요청은 등록 이메일 주소에서 온 것만 처리합니다. 다른 주소에서 왔으면 등록 이메일로 확인 메일을 보내 회신을 받은 뒤 처리합니다(개인정보 보호법 시행령 제46조). 사전등록하지 않은 사람의 요청(보낸 메일 삭제 등)은 그 메일 주소로 처리하고 결과를 회신합니다.
- **인터뷰 연락 동의 철회:** `/admin` 사전등록 목록의 이메일 칸에서 '인터뷰 동의 철회'를 누르고, 지체 없이 처리 결과를 회신합니다.
- **소식 수신 거부·철회:** 같은 자리의 '소식 수신 거부'를 누르고 기록표에 거부일을 적은 뒤, 14일 안에 회신합니다. 회신에는 전송자 명칭, 수신 거부 사실과 그 날짜, 처리 결과를 적고 광고는 넣지 않습니다.
- **열람·삭제·처리정지:** 열람은 그 공급자의 등록 정보를 회신하고, 삭제·처리정지는 아래 '탈퇴 처리'로 합니다. 결과는 10일 안에 회신합니다.
- **정정(필명·소개·채널·이메일):** 관리자 화면에 정정 기능이 없으므로 아래 순서로 하고, 10일 안에 결과를 회신합니다(시행령 제43조).
  1. 2-1대로 백업합니다.
  2. 바꿀 값이 등록 규칙에 맞는지 직접 확인합니다: 필명 1~30자, 소개 500자 이하, 필명·소개에 '원금 보장·수익 보장·확정 수익·월 N%' 같은 표현 금지, 채널은 http(s) 주소 최대 3개·각 200자 이하.
  3. SQL Editor에서 바꿀 칸만 넣어 실행합니다(값 안의 작은따옴표는 두 번 씀). 결과가 1행이어야 합니다(0행이면 주소가 틀렸거나 탈퇴한 등록).

     ```sql
     UPDATE providers SET pen_name = '…', description = '…', channels = '["https://…"]'::jsonb
      WHERE handle = '<프로필 주소>' AND email NOT LIKE '%@invalid' RETURNING handle;
     ```

  4. 프로필 주소(handle)는 바꾸지 않습니다. 이메일은 새 주소로 본인 확인 메일을 보내 회신을 받은 뒤에만 `email = '<새 주소(소문자)>'`로 바꿉니다.

**탈퇴 처리**
1. 본인 확인 뒤 `/admin`에서 '탈퇴 처리' → '탈퇴 처리 확인(되돌릴 수 없음)'을 누릅니다.
2. 승인한 적 없고 에이전트도 없는 등록은 행이 통째로 지워지고, 그 프로필 주소는 다시 등록할 수 있게 됩니다. 그 밖에는 이메일·소개·채널·초대 관계·선택 동의를 지우고, 필명과 에이전트 이름·설명을 '탈퇴한 공급자' 표시로 바꾸며, 공개 프로필을 닫습니다. 프로필 주소(사용 중지, 공개하지 않음)·시그널 방식·시장·매매 보유 기간·등록·동의 일시는 서비스를 운영하는 동안 남기고 서비스를 끝내면 지웁니다.
3. 2-1의 탈퇴 기록에 프로필 주소·처리 날짜만 적고(이메일은 적지 않음), 10일 안에 처리 결과를 회신합니다.
4. 회신을 보낸 뒤 그 공급자와 주고받은 메일(보낸 회신 포함)을 `CONTACT_EMAIL` 메일함과 휴지통에서 지웁니다(처리방침 2항). 승인한 적 없는 등록이면 기록표의 그 줄도 지웁니다.
5. **1년 자동 파기 전에 미리:** 자동 파기(7절 '알아 둘 것')는 어느 등록을 지웠는지 남기지 않습니다(응답에는 건수만 있고, 공개 저장소 로그에는 건수도 찍히지 않음). 그래서 매달 1일 SQL Editor에서 아래 조회로 다음 달 안에 파기될 등록(한 번도 승인되지 않았고 등록일부터 11개월이 지난 등록)을 찾습니다. 승인할 등록이 아니면 그 주소와 주고받은 메일을 4번처럼 지우고 기록표의 그 줄도 지웁니다(행은 등록일부터 1년이 지나면 자동 파기가 지움). 그 뒤 그 주소에서 메일이 왔거나 이 확인을 놓쳤다면, 운영 메일함에서 상대 주소가 `/admin` 대기·승인·거절 목록 어디에도 없는 메일(`문의` 라벨 대화 제외)을 날짜와 상관없이 찾아 휴지통까지 지우고, 기록표에서 그 프로필 주소 줄도 지웁니다.

   ```sql
   SELECT handle, email, created_at FROM providers
    WHERE approved_at IS NULL AND email NOT LIKE '%@invalid' AND created_at < now() - interval '11 months'
    ORDER BY created_at;
   ```

**사전등록하지 않은 사람의 메일(문의·정보주체 요청)**
- 받으면 그 대화에 `문의` 라벨(또는 폴더)을 붙입니다(스팸 포함). 사전등록한 사람과 주고받은 메일에는 붙이지 않습니다(탈퇴·파기 때 지움). 나중에 그 사람이 사전등록하면 라벨을 뗍니다.
- 매달 1일, 마지막 답장을 보낸 날(답장하지 않은 메일은 받은 날)부터 11개월이 지난 `문의` 대화를 보낸 답장까지 `CONTACT_EMAIL` 메일함과 휴지통에서 지웁니다. 다음 달 1일 전에 1년이 차는 메일까지 미리 지워, 처리방침 2항의 '마지막 답변 뒤 1년'을 넘기지 않습니다.

## 9. 문제가 생겼을 때

| 증상 | 원인 | 조치 |
|---|---|---|
| 빌드 실패: '운영 배포에 필요한 환경변수…' | 변수 빠짐·형식 틀림. `DATABASE_URL`의 SSL 설정, 인증서로 읽을 수 없는 `DATABASE_CA_PEM`, 읽을 수 없는 개인키·개인키와 짝이 아닌 키 ID, `MAIL_SERVICE`의 형식·국가·메일 주소 회사 불일치도 여기서 걸림 | 로그의 이름과 괄호 속 이유를 보고 Production 값을 고친 뒤 Redeploy(그동안 직전 정상 배포가 그대로 서비스됨). 키는 1단계 보관 파일의 6줄 그대로 |
| 빌드 실패: `An error occurred in next/font`, `Failed to fetch Noto Sans KR` | 빌드할 때 Google Fonts에서 글꼴을 받다가 끊김(코드 문제 아님) | 몇 분 뒤 Redeploy. 실패한 빌드는 지금 배포를 바꾸지 않음 |
| `/`, `/anchors` 500, 로그에 DB 연결 오류 | `DATABASE_URL`(비밀번호·인코딩·포트) | `/api/health`(또는 smoke)의 DB 오류 코드를 아래 코드 표에서 찾기. Connect 화면 주소를 다시 확인. 6543이 안 되면 Session pooler 5432 |
| 로그에 'DATABASE_URL 끝의 ?sslmode=…'·'DATABASE_CA_PEM을 인증서로 읽을 수 없습니다'(운영 빌드는 이때 멈추므로 대개 로컬 `next start`에서 보임) | URL 끝에 `?sslmode=` 같은 SSL 설정, 또는 잘린 인증서 | 지우거나 인증서 파일 내용 전체를 다시 넣은 뒤 Redeploy(로컬이면 다시 실행) |
| 로그에 certificate·self-signed·`unable to get local issuer certificate` | `DATABASE_CA_PEM`이 Supabase 인증서가 아닌 다른 인증서(읽을 수 없는 값은 운영 빌드가 먼저 멈춤) | 2단계 3번대로 인증서를 다시 받아 값 칸에 통째로 붙여 넣고 Redeploy. 급하면 변수를 지우고 Redeploy(암호화는 유지, 서버 확인만 빠짐). 그동안 smoke는 'DB 서버 인증서 확인' 실패로 남으므로, 고친 인증서를 다시 넣고 Redeploy한 뒤 smoke의 상태 점검 줄에서 `TLS verify-full`을 확인 |
| smoke '[실패] DB 서버 인증서 확인 — encrypt-only …' | Vercel에 `DATABASE_CA_PEM`이 없음(넣지 않았거나 위 비상 조치로 지운 뒤 다시 넣지 않음). 사이트는 동작하지만 DB 서버 인증서를 확인하지 않음 | 2단계 3번 인증서 내용 전체를 `DATABASE_CA_PEM` 값 칸에 넣고 Redeploy → smoke 상태 점검 줄에 `TLS verify-full` |
| `/keys.json`만 500 | 키 6줄 중 일부 빠짐·섞임(운영 빌드는 이때 멈추므로 대개 로컬 `next start`에서 보임) | `npm run keys:check`로 파일 확인 후 통째로 다시 넣고 Redeploy |
| `/admin` 503 | `ADMIN_*` 없음 또는 비밀번호 16자 미만 | 3단계 방식으로 만든 값 넣기 |
| `/privacy`에 '설정 필요' | `PRIVACY_OFFICER`·`CONTACT_EMAIL`·`MAIL_SERVICE`가 없거나 `MAIL_SERVICE` 형식이 틀림(운영 빌드는 이때 멈추므로 대개 로컬 `next start`에서 보임) | 4단계 표의 형식으로 넣고 Redeploy |
| smoke '…키가 DB의 마지막 시그널(앵커) 키와 다름' | 첫 시그널·앵커 뒤에 키 환경변수가 바뀜(발행·앵커가 거부됨) | 1단계 보관 파일의 6줄을 그대로 다시 넣고 Redeploy. 그 파일이 없으면 멈추고 원인부터 조사 |
| 로그에 `[db] 유휴 연결 오류` | 쉬던 DB 연결을 풀러·네트워크가 끊음 | 조치 없음(그 연결은 버리고 다음 요청이 새로 연결). 계속 반복되면 Supabase 상태 확인 |
| 발행 화면에 '요청 번호가 없습니다'·'사이트가 새 버전으로 바뀌었습니다' | 배포 전에 열어 둔 `/admin` 탭 | 새로고침(F5) 뒤 다시 입력(봉인되지 않았음) |
| 발행 화면에 '이 요청 번호로 이미 다른 내용이 봉인돼 있습니다(순번 N)' | 응답을 못 받은 첫 시도가 실제로 봉인됐고, 그 뒤 입력을 바꿔 다시 누름 | 순번 N 기록을 확인하고, 새 시그널이면 새로고침 뒤 새로 입력 |
| 앵커 작업 401 '사이트 응답'(…environment anchor-cron의 CRON_SECRET이 사이트(Vercel) 환경변수 CRON_SECRET과 다릅니다) | Vercel과 environment `anchor-cron`의 `CRON_SECRET` 불일치 | 10절 순서대로 같은 값 넣기 |
| 앵커 작업 'CRON_SECRET이 없습니다. 저장소 Settings → Environments → anchor-cron → …'·'SITE_URL이 없습니다…' | environment 이름이 `anchor-cron`이 아니거나 비밀값을 아직 넣지 않음(또는 Variables에 `SITE_URL` 없음) | 5단계 2번대로 넣은 뒤 23:50 전에 Run workflow. Repository secrets에 `CRON_SECRET`이 있으면 지움 |
| 앵커 작업 '사이트 코드에 닿기 전에 막혔습니다(HTTP 401…)'·'다른 주소로 넘겨졌습니다(HTTP …)'(3xx) | 저장소 `SITE_URL`이 배포별 주소·http 주소이거나, Deployment Protection이 All Deployments | `SITE_URL`을 Domains의 https 운영 도메인으로, 보호는 Standard Protection으로 |
| 앵커 작업 '앵커 생성 응답(HTTP 200)이 … 앵커 문서가 아닙니다' | `SITE_URL`이 다른 사이트 | 운영 도메인으로 고치고, 다른 사람 주소로 보냈다면 `CRON_SECRET` 교체(10절) |
| 앵커 작업 500 '(코드 …)' | 아래 코드 표 | 코드에 맞게 고친 뒤 23:50 전에 Run workflow |
| 앵커 작업 'KST 자정이 지나 … 요청하지 않았습니다'·HTTP 422 | 실행·재시도 중에 KST 자정이 지남(사이트는 지난 날짜 요청으로 앵커를 만들지 않음) | 다시 보내도 같음. 그날은 빈 날로 남음(숨기지 않음). 다음부터는 23:50 전에 Run workflow |
| 앵커 작업 '…사이트는 18시 전이라며 앵커를 만들지 않았습니다' | GitHub 실행기와 사이트의 시계가 다름(드묾) | 몇 분 뒤 Run workflow |
| 앵커 작업 '사이트가 과거 기록 불일치를 보고했습니다…'(HTTP 409, 종료 코드 2) | 뒤 문장이 '체크포인트 키(…)가 직전 앵커의 키(…)와 다릅니다'·'공개키 목록에 없는 서명 키'이면 첫 앵커 뒤 키 환경변수가 바뀜. '이후 날짜(…) 앵커가 이미 있어'면 DB에 미래 날짜 앵커가 있음. 그 밖(순번·직전 지문·다시 계산한 지문·서명·체인 길이·에이전트 사라짐)은 DB의 봉인 기록이 바뀜(SQL로 직접 고침 등) | 키 문제면 1단계 보관 파일의 6줄을 그대로 다시 넣고 Redeploy한 뒤 23:50 전에 Run workflow. 그 밖은 멈추고 원인부터 조사. 숨기지 않음 |
| 앵커 작업 '공개키 …가 사이트에서 사라졌거나 바뀌었습니다'·'공개키 …의 폐기 시각(retired_at)이 … 바뀌었습니다'(종료 코드 2) | 첫 앵커 뒤 키 환경변수(ID·생성 시각·개인키)가 바뀌었거나, 코드 변경으로 `/keys.json` 출력이 달라짐, 또는 키 바꿔치기 | 사이트 `/keys.json`과 저장소 `keys.json`(`git log -p keys.json`)을 비교. 환경변수면 1단계 보관 파일의 6줄로 되돌려 Redeploy, 코드면 되돌린 뒤 Run workflow. 저장소 `keys.json`을 고치거나 지워 통과시키지 않음(경보를 숨기는 것) |
| 앵커 작업 '… 앵커가 사이트에서 사라졌습니다'·'… 앵커 루트가 저장소에 고정된 값과 다릅니다(과거 변경)'·'… 앵커 문서가 저장소에 고정된 내용과 다릅니다(과거 변경)'(종료 코드 2) | DB를 새로 만들었거나 마지막 앵커보다 오래된 백업으로 복구함(2-1), 또는 DB의 앵커·봉인 기록을 직접 바꿈 | 멈추고 원인부터 조사. `anchors/`의 파일을 지우거나 고쳐 통과시키지 않음. 기록을 잃었으면 2-1대로 공지(숨기지 않음) |
| 앵커 작업 '사이트에서 …을(를) 받지 못했습니다'·'…응답이 JSON 문서가 아닙니다' | 공개키·앵커 목록을 받는 중에 사이트·네트워크가 일시 오류(재시도까지 실패) | 커밋되지 않음. `/api/health`를 확인한 뒤 23:50 전에 Run workflow(Re-run failed jobs가 아님) |
| 로그에 pipefail, invalid option name | 스크립트가 CRLF로 올라감(웹 업로드 등) | LF 사본을 git으로 다시 push |
| 커밋 단계 '같은 파일을 고친 커밋이 올라와…' | 실행 중에 `anchors/`나 `keys.json`을 직접 push | 직접 올린 내용을 확인한 뒤 Run workflow |
| '넘겨받은 파일 확인' 단계 '사이트에서 keys.json을 다시 받지 못했습니다'·'사이트에서 … 앵커를 다시 받지 못했습니다' | job 사이에 사이트·네트워크가 일시 오류 | 커밋되지 않음. `/api/health`를 확인한 뒤 23:50 전에 Run workflow(Re-run failed jobs가 아님) |
| '넘겨받은 파일 확인' 단계 '…사이트의 /keys.json과 다릅니다'·'…사이트의 문서와 다릅니다'·'… 앵커가 이 저장소에 고정된 내용과 다릅니다(넘겨받은 파일이 바뀜)'·'예상하지 못한 이름' | job 사이에 사이트의 `keys.json`·앵커가 바뀌었거나(키 교체 직후 등) check job에서 파일이 바뀜 | 커밋되지 않음. Run workflow로 다시 실행. 다시 해도 같으면 check job 로그와 사이트 `/keys.json`·`/api/anchors/<날짜>`를 비교하고, 원인을 찾기 전에는 저장소 파일을 고치지 않음(변조 의심) |
| 비트코인 고정 단계 경고 '증명 갱신이 60초 안에 끝나지 않아 끊었습니다'·'시간 상한…건너뛴 파일' | OpenTimestamps 캘린더가 응답하지 않음 | 조치 없음. 앵커는 커밋되고 다음 실행이 증명을 다시 갱신. 이틀 넘게 이어지면 커밋 뒤 증명 점검(proofs job)이 실행을 실패로 표시 |
| 비트코인 고정 단계 경고 '증명 갱신 실패(대기 중이 아님): <파일>: …' | 그 `.ots`가 깨졌거나(예: 'Invalid timestamp file') 캘린더 응답이 비정상 | 다음 실행에도 낫지 않을 수 있음. 이틀이 지나면 아래 '비트코인 증명 점검' 행대로 처리 |
| proofs job '비트코인 증명 점검(커밋 뒤)' 단계 '앵커는 이미 커밋됐습니다. 문서 날짜가 … 이전인 앵커 중 비트코인 증명이 완성되지 않은 것 N건: anchors/<날짜>.json.ots(미완성)·(없음)' | 캘린더 장애가 이틀 넘게 이어짐, 깨진 `.ots`, 스탬프가 계속 실패(없음), 또는 늦게 받아 온 날짜(받은 뒤 증명이 완성될 때까지 한두 번) | 앵커는 커밋됨(Run workflow 필요 없음). 같은 실행의 비트코인 고정 단계 경고를 보고, 저장소 사본에서 `ots -v upgrade anchors/<날짜>.json.ots`로 원인 확인. 'Invalid timestamp file'처럼 깨진 증명이면 그 `.ots`를 지우는 일반 커밋을 올림(force-push 금지): 다음 실행이 다시 스탬프하고, 새 증명이 완성될 때까지 한두 번 더 실패로 보이며, 그 증명은 늦은 시각으로 남음(숨기지 않음). 늦게 받아 온 날짜면 증명이 완성되면 저절로 초록색 |
| '넘겨받은 파일 확인' 단계 경고 '이미 완성된 증명은 바꾸지 않습니다(저장소 사본 유지. 옛 실행을 Re-run했거나 check job에서 파일이 바뀜)' | 옛 실행을 Re-run failed jobs로 다시 돌림(그 실행의 check job이 넘긴 옛 증명), 또는 check job에서 `.ots`가 바뀜 | 조치 없음(저장소의 완성본 유지). 다시 돌릴 때는 Run workflow를 씀. Re-run이 아닌데 반복되면 check job 로그를 확인 |
| 앵커 작업 '사이트 목록에 오늘(KST …)보다 늦은 날짜의 앵커(…)가 있습니다'(종료 코드 2) | DB에 미래 날짜 앵커가 있음(앱 코드로는 생기지 않음) | 멈추고 원인부터 조사(직접 넣은 행인지). 숨기지 않음 |
| 도구 설치 단계 HASHES 오류 | `requirements.txt`를 한 줄만 고쳤거나 파일이 잘림 | 템플릿 파일로 되돌림(버전을 바꿀 때는 파일 전체를 다시 생성) |
| 공유 카드가 옛 기록 수·'찾을 수 없음'으로 보임 | 메신저·SNS가 이미지 주소 기준으로 카드를 캐시 | 카카오: 공유 디버거에서 캐시 초기화. X: 약 7일 뒤 다시 읽음 |
| 공유 카드가 영문(프로필 주소 · N records)으로 나옴 | 카드를 만들 때 한글 글꼴을 3초 안에 받지 못함(대체 카드는 1분 캐시) | 대개 저절로 회복. 계속되면 Logs에서 `/p/*/opengraph-image/*` 확인 |
| 갑자기 모든 페이지 오류 + Supabase 'paused' 메일 | Free 일시정지 | 대시보드에서 Resume |

**오류 코드(앵커 작업 500·`/api/health`·`npm run smoke` 공통):**
- `CONFIG_MISSING`·`CONFIG_INVALID` = Vercel 환경변수 누락·형식 오류(키 ID와 개인키 짝, `DATABASE_URL` 끝의 `?sslmode=`, 잘린 `DATABASE_CA_PEM` 포함). 운영 빌드가 이 값들을 먼저 거르므로 대개 빌드 검사를 거치지 않은 실행(로컬 `next start` 등)에서 보임. 운영에서 보이면 Logs의 문장대로 값을 고치고 Redeploy
- `PREVIEW_BLOCKED` = 미리보기 주소로 호출됨(저장소 `SITE_URL` 확인)
- `28P01` = DB 비밀번호, `42P01` = 마이그레이션 안 됨(2단계 4번)
- `XX000` = Supabase 풀러(Supavisor)가 연결을 거절함. 원인은 Vercel Logs 오류 원문 앞의 괄호 표시로 갈림(`/api/health`는 로그를 남기지 않으므로, Logs를 Live로 켠 채 시크릿 창에서 `/`를 열거나 Run workflow로 다시 부른 뒤 확인)
  - `(ENOTFOUND) tenant/user … not found`·`(ENOIDENTIFIER)`·`(EINVALIDUSERINFO)`: 사용자·호스트 불일치(첫 배포나 `DATABASE_URL`을 바꾼 직후면 거의 이것). Connect → Transaction pooler 주소를 다시 복사해 `[YOUR-PASSWORD]`만 바꾸고 Redeploy. 사용자는 `postgres.<프로젝트 ref>`이고, 호스트 `aws-N-…`의 N은 지역으로 알 수 없으니 화면 값을 그대로 씀
  - `(ECIRCUITBREAKER)`: 비밀번호 실패가 짧은 시간에 반복돼 잠시(약 2분) 막힘. `28P01`처럼 비밀번호부터 고치고 2분 뒤 확인
  - `(EMAXCONN)`·`(ECHECKOUTTIMEOUT)` 등: 풀러 쪽 일시 문제(잘 되던 중이면 대개 이것). Supabase 상태를 확인한 뒤 23:50 전에 Run workflow
- `ECONNREFUSED`·`ETIMEDOUT`·`ENOTFOUND` = DB 연결 실패(주소·포트). 코드가 `ENOTFOUND`이면 호스트 이름을 찾지 못한 것으로, 위 `XX000` 로그의 `(ENOTFOUND)` 표시와 다름
- `DB_CONNECT_TIMEOUT` = 10초 안에 DB(풀러)에 연결되지 않음, `DB_POOL_TIMEOUT` = 함수의 DB 연결이 모두 10초 넘게 쓰이는 중(요청 몰림), `DB_CONNECTION_LOST` = 연결이 도중에 끊김. Supabase 상태·일시정지(Resume)를 확인한 뒤 23:50 전에 Run workflow
- 인증서 관련 코드 = `DATABASE_CA_PEM`
- `UNKNOWN` = 분류되지 않은 오류. 아래 '로그'로 원인을 확인

- **로그:** Vercel → 프로젝트 → Logs(Production, Error 필터)에서 봅니다. Hobby는 로그를 1시간만 보관합니다. 시간이 지났으면 Logs를 Live로 켠 채 Actions에서 Run workflow로 다시 실행해 바로 확인합니다. 화면에 '일시적인 오류가 났습니다'가 뜨면 함께 나오는 오류 번호로 Logs에서 같은 오류를 찾습니다.
- **상태:** `https://<운영도메인>/api/health`에서 DB 오류 코드, 적용 안 된 마이그레이션, 키 오류, DB에 남은 마지막 시그널·앵커의 키와 지금 키의 불일치(`key_mismatch`)를 바로 볼 수 있습니다. `npm run smoke`도 이 코드와 불일치를 그대로 보여 줍니다.
- **롤백:** Deployments → 직전 정상 배포 ⋮ → Instant Rollback. Hobby는 바로 이전 배포로만 돌아갈 수 있습니다. 고친 뒤 새 배포를 하거나 Undo Rollback합니다.

## 10. 비밀값 교체(노출이 의심될 때)

**공통**
- **변경 → Redeploy → 확인을 한 번에:** 환경변수 변경은 새 배포에만 적용됩니다.
- **교체 전 배포는 지우기:** 교체한 뒤에는 교체 전 배포로 롤백하지 않습니다. 롤백하면 옛 값이 그대로 다시 쓰입니다. 교체가 끝나면 교체 전 Production 배포를 Deployments에서 삭제합니다.
- **배포 보호 확인:** Deployment Protection이 Standard인지 확인합니다. 꺼져 있으면 옛 배포 주소가 옛 비밀값을 계속 받습니다.

**`ADMIN_PASSWORD`(즉시)**
1. 새 값을 만듭니다(3단계 명령).
2. Vercel Edit(Production) → Redeploy.
3. 시크릿 창에서 옛 비밀번호는 401, 새 비밀번호는 열리는지 확인합니다.
4. 노출 시각 이후 무단 발행·승인이 없었는지 DB에서 확인합니다. 봉인 기록은 지울 수 없으니, 무단 발행이 있으면 무효 처리와 사유를 남기고 공지합니다.

**`CRON_SECRET`(그날 앵커가 성공한 뒤)**
1. 그날 daily-anchor가 성공했는지 확인합니다.
2. Vercel `CRON_SECRET` Edit → Redeploy → Ready 확인.
3. 곧바로 `signals-anchors`의 Settings → Environments → `anchor-cron` → Environment secrets에서 `CRON_SECRET`을 같은 값으로 Update합니다.
4. Run workflow를 눌러 성공하고 로그에 '이미 있음'이 나오는지 확인합니다. 붙여넣기 실수가 있으면 여기서 401로 드러납니다.

## 11. 기존 NestJS 코드베이스로 옮길 때

- **그대로 복사:** `src/core/`(정규화, 서명, 머클, 타임스탬프, 진입 규칙, 검증)는 프레임워크 의존이 없습니다.
- **그대로 사용:** `db/migrations/*.sql`과 `src/server/repo/*`의 SQL은 `$1` 자리표시자를 쓰는 표준 SQL입니다.
- **옮겨 맞추기:**
  - `src/server/services/*`는 NestJS provider로, `src/app/api/*`와 서버 액션은 controller로 옮깁니다.
  - 맞춰야 하는 것은 `Db` 인터페이스(`query`/`tx`/`exec`) 하나뿐입니다. 운영 구현은 `pg` Pool입니다.
