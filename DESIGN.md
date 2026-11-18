# SIGNALS Design System — 봉인 장부(Sealed Ledger)

> 이 문서는 SIGNALS 사이트의 디자인 시스템을 설명한다. 실제 값의 원본은 `src/app/globals.css`(토큰·효과 CSS)와 `src/components/typography.ts`(글자 역할)이고, 이 문서와 코드가 다르면 **코드가 맞다**(문서를 고친다).
> 형식은 awesome-design-md의 DESIGN.md 구성을 따랐지만, 내용은 SIGNALS의 토큰·규칙이다. 다른 서비스의 이름·로고·문구는 UI에 쓰지 않는다(출처는 맨 아래 참고 절에만 적는다).
> 대상 화면: 공개 페이지(홈·검증·앵커·에이전트·공급자·사전등록·처리방침) + 운영자 화면(/admin). 테마: 다크 단일(`:root` 값이 곧 다크, `.dark` 클래스 없음).

---

## 1. Visual Theme & Atmosphere

SIGNALS는 "결과 전에 봉인하고, 누구나 다시 대조하는 기록"이다. 화면이 전해야 하는 감정은 **흥분이 아니라 확신**이다. 그래서 분위기는 밤에 펼친 장부처럼 어둡고 조용하며 정밀하다. 거의 검은 무채색 캔버스(`#08090a`) 위에 면이 네 단계로 조금씩 밝아지고, 경계는 반투명 흰 선(5/8/12%)으로 "보이기보다 느껴지게" 그린다. 강조색은 인디고 하나뿐이며 행동(주 버튼)·링크·포커스에만 쓴다. 위계는 색이 아니라 **글자 크기·굵기·여백**이 만든다.

이 사이트만의 재료는 **16진수 지문(SHA-256)** 이다. 64자의 hex 문자열을 JetBrains Mono로 보여 주고, 첫 화면의 "봉인 기록 예시" 카드에서 단 한 번 노이즈에서 고정값으로 정착시킨다. 그 옆에서 봉인 표시 세 개(지문 → RFC 3161 시각 서명 → 일일 앵커)가 차례로 닫힌다. SIGNALS가 실제로 하는 일을 1초 안에 보여 주는 장면이 이 사이트의 유일한 '연출'이고, 그 뒤 화면은 완전히 멈춘다. 데이터가 있는 화면(검증·앵커·에이전트·운영자)은 조용하고 촘촘하게, 설명하는 화면(홈)은 넉넉하게 둔다.

금융 서비스지만 시세 화면이 아니다. 오르는 차트, 시장색(빨강·파랑), ▲▼, 카운트업 숫자, 깜빡이는 'LIVE' 점, 카운트다운은 이 시스템에 존재하지 않는다(유사투자자문업 신고 전 · 수익 주장 없음).

**Key Characteristics**
- 무채색 면 90% 이상 + 인디고 1색(`#5a61d8` 채움 / `#a3a9ff` 글자·포커스).
- 면 사다리 4단(`#08090a` → `#0f1011` → `#141516` → `#191a1b`) + 반투명 선. 그림자 대신 면의 명도와 1px 선으로 깊이를 만든다.
- 글자 사다리 5단(`#f7f8f8` / `#d0d6e0` / `#b4bcd0` / `#8a8f98` / `#62666d`). 모든 본문은 WCAG AA 이상.
- Pretendard Variable(본문·제목) + JetBrains Mono(지문·시각·ID·명령어) 2벌. 한글은 mono 안에 넣지 않는다.
- 시그니처 1개: 홈 히어로의 "봉인 기록 예시" 카드(실제 SHA-256, '예시' 표시). 빛 번짐(glow)은 사이트 전체에 1개.
- 사슬(rail) 모양: 세로 1px 선 + 속 빈 인디고 노드. 홈 "어떻게 작동하나요"와 /anchors 타임라인이 같은 언어를 쓴다.
- 모션은 짧고(UI 100–240ms, 등장 ≤ 600ms, 전체 시퀀스 ≤ 1.2s) ease-out, 반복 없음. `prefers-reduced-motion: reduce`면 첫 프레임이 곧 완성 화면.

---

## 2. Color Palette & Roles

### 2.1 Surfaces (면 사다리)

| 이름 | 값 | Tailwind | 역할 |
|---|---|---|---|
| Canvas | `#08090a` | `bg-background` | 페이지 바탕, 헤더(80% + blur), 푸터 |
| Inset | `#050506` | `bg-inset` | 한 단 들어간 우물(well): 코드·원문·입력칸·동의 묶음 |
| Card (level 1) | `#0f1011` | `bg-card` | 카드·표·목록 |
| Raised (level 2) | `#141516` | `bg-raised` | 강조 카드(CTA), 표 머리줄(admin), 아이콘 타일 |
| Popover (level 3) | `#191a1b` | `bg-popover` | 메뉴·select 팝업 |
| Selected | `#1c1c1f` | `bg-selected` | 선택된 탭(admin 구분 탭), secondary 버튼 hover, 헤더 사전등록 버튼의 현재 화면 표시 |
| Hover fill | `rgb(255 255 255 / 0.05)` | `bg-muted`, `bg-accent`, `bg-secondary` | 줄 hover, 현재 메뉴, 보조 칩 |
| Accent tint | `#18182f` | `bg-primary-subtle` | 작은 인디고 칩·선택(높이 32px 이하 면에만) |

규칙: 카드 안의 우물은 `bg-inset`으로 **한 단 내려간다**. 카드 안에 테두리 있는 카드를 또 넣지 않는다(상자 속 상자 금지) — 카드 안에서는 5% 구분선(`divide-line-subtle`)이나 우물을 쓴다.

### 2.2 Lines (선)

| 이름 | 값 | Tailwind | 역할 | 캔버스 위 합성색 |
|---|---|---|---|---|
| line-subtle | `rgb(255 255 255 / 0.05)` | `border-line-subtle`, `divide-line-subtle` | 카드 안 구분선, 띠(band) 사이 | `#141516` |
| border | `rgb(255 255 255 / 0.08)` | `border` (기본) | 카드·표·목록 테두리, 헤더 아래선 | `#1c1d1e` |
| line-strong | `rgb(255 255 255 / 0.12)` | `border-line-strong` | hover 테두리, 사슬 레일, 점선 빈 상태 | `#262727` |
| input | `#686b72` | `border-input` | 입력칸 경계(WCAG 1.4.11 3:1 이상), 헤더 사전등록 버튼의 현재 화면 테두리 | — |

- 반투명 선은 어떤 면 위에서도 같은 '밝기 차이'로 보인다. 단, 배경이 반투명인 요소에 반투명 테두리를 주면 테두리가 배경 위에 한 번 더 겹쳐 밝아진다 → `gap-px` + `bg-border`로 칸 사이 선을 그리는 격자(KPI 등)에는 반드시 `bg-clip-padding`을 함께 쓴다.
- 입력칸 테두리만은 반투명으로 낮추지 않는다(인쇄·저시력 대비 기준 3:1).

### 2.3 Text (글자 사다리)

| 단계 | 값 | Tailwind | 쓰임 | 대비(캔버스 / 카드) |
|---|---|---|---|---|
| 1 Foreground | `#f7f8f8` | `text-foreground` | 제목, 핵심 값, 버튼 글자(보조) | 18.73 / 17.90 |
| 2 Lead | `#d0d6e0` | `text-lead` | 지문·시각 값, 코드, 알림 칩 글자 | 13.64 / 13.04 |
| 3 Body | `#b4bcd0` | `text-muted-foreground` | 본문·설명·법정 고지 | 10.48 / 10.02 |
| 4 Meta | `#8a8f98` | `text-tertiary` | 짧은 라벨·번호·플레이스홀더·메뉴 | 6.13 / 5.86 |
| 5 Disabled | `#62666d` | `text-disabled` | 비활성·장식 숫자(404)만, 내용 금지 | 3.45 / 3.30 |

- 법정 고지(푸터·검증 결과 면책·기록표 아래 고지)는 **Body(`#b4bcd0`) 아래로 흐리게 하지 않는다**.
- `--text-*`는 Tailwind의 글자 크기 이름공간이라 `@theme`에 넣지 않고 `:root`에 두며, 색 유틸리티는 `--color-lead` 등으로 노출한다.

### 2.4 Accent (인디고 1색)

| 이름 | 값 | Tailwind | 규칙 |
|---|---|---|---|
| Primary fill | `#5a61d8` | `bg-primary` | 주 버튼 채움만. 흰 글자 5.08:1. **글자색으로 쓰지 않는다**(3.93:1) |
| Primary hover / pressed | `#6168e2` / `#4f56c9` | `hover:bg-primary-hover`, `active:bg-primary-pressed` | 흰 글자 4.58 / 5.99 |
| Link · Ring | `#a3a9ff` | `text-link`, 포커스 `outline` | 링크·포커스·봉인 표시·사슬 노드. 캔버스 9.18:1 |
| Tint | `#18182f` | `bg-primary-subtle` | 작은 칩 배경 |

- 한 화면(viewport)에 채운 인디고 버튼은 **1개**. 헤더의 사전등록 버튼은 그래서 반투명 보조 버튼이다.
- 인디고 글자(`text-link`)는 링크와, 섹션당 1곳의 '기록됨' 표시(SealMark·체크 아이콘)에만. 예외 하나: 장식 아이콘 타일 1곳(사전등록 완료 화면의 메일 아이콘, `aria-hidden`).
- 인디고를 섹션·카드 배경으로 깔지 않는다.

### 2.5 Status (검증 결과 전용)

| 상태 | 값 | 알약(pill) | 아이콘 | 대비(카드 위 14% 바탕) |
|---|---|---|---|---|
| 통과 PASS | `#4cd3a0` | 14% 채움 + 40% 테두리 | CircleCheck | 7.89 |
| 불일치 FAIL | `#f26b5e` | 14% 채움 + 40% 테두리 | CircleX | 5.36 |
| 반영 대기 PENDING | `#e3b24f` | 14% 채움 + 40% 테두리 | Clock | 7.59 |
| 해당 없음 SKIP | `#8b939e` | 14% 채움 + 40% 테두리 | CircleMinus | 5.14 |
| 확인 못 함 UNCHECKED | `#f26b5e` | **속 빈** 알약(실선 50% 테두리, 채움 없음) | CircleAlert | 6.39 |

- 초록은 **실제로 통과한 검증 항목에만** 쓴다. 홈의 "증명하는 것" 체크, 봉인 기록 예시의 표시는 인디고(`text-link`)다. 지문·루트 복사 버튼의 '복사 완료' 체크는 글자색(`text-foreground`)이다(값 옆 초록 체크는 검증 통과 표시로 읽힌다).
- 상태는 색만으로 구분하지 않는다: 상태마다 다른 아이콘 + 글자 라벨 + 모양(채움/속 빔).
- 시장 상승·하락 토큰(`--mkt-up #f25f66`, `--mkt-down #4e9bff`, 한국식 빨강=상승)은 정의만 있고 **쓰지 않는다**. LONG/SHORT는 색 없는 글자다.

### 2.6 Gradient · Glow 예산 (이것 말고는 없음)

| 효과 | 위치 | 값 | 최대 |
|---|---|---|---|
| Headline gradient | 홈 h1 한 곳 | `linear-gradient(to bottom right, #f7f8f8 45%, rgb(247 248 248 / .7))` + `background-clip: text` | 끝 색 합성 `#afb0b1`(캔버스 9.17:1). 3줄째 'AI 시그널 기록'(제품 이름)이 제목에서 가장 흐린 말이 되지 않게 옅게만 |
| Hero glow | 홈 히어로, 봉인 기록 예시 카드 뒤 1개 | `radial-gradient(closest-side, rgb(90 97 216 / .14), rgb(90 97 216 / .05) 55%, transparent)` | alpha 0.14, 정지(맥동 없음) |
| Spotlight | 봉인 기록 예시 카드, 홈 CTA 카드 | 포인터 위치의 인디고 원(`#a3a9ff`) | 채움 0.10, 테두리 빛 0.45 |
| Grain | 히어로 띠·위 두 카드 | 정적 필름 그레인. 히어로 띠는 아래로 갈수록 마스크로 사라진다(띠 전체에 고르게 깔면 띠가 캔버스보다 밝은 '회색 판'이 되고 아래 경계에서 끊긴다) | opacity 0.05 |
| Ledger grid | 홈 히어로 띠 바탕 | 44px 격자선 `#18191b`, 방사형 마스크 | 선 대비 1.13:1 |

메시(mesh)·오로라·네온·무지개 그라디언트, 색이 들어간 글자 그라디언트, 두 번째 glow는 금지.

---

## 3. Typography Rules

### 3.1 Font Families

- **Pretendard Variable** (OFL, `pretendard@1.3.9` 동적 서브셋 자체 호스팅): 한글·라틴 본문과 제목 전부. 굵기 축 45–930.
- **JetBrains Mono** (`next/font/google`로 빌드 때 받아 자체 호스팅): 지문·루트·시각·순번·ID·명령어. 한글 글리프가 없으므로 **한글 라벨을 mono 안에 넣지 않는다**(공백이 고정폭이 되어 띄엄띄엄 보인다). 패턴: `<span class="text-tertiary">마지막 발행</span> <span class="font-mono">2026-10-29 22:49 KST</span>`.
- 새 글꼴 요청(외부 CDN) 금지. 처리방침의 국외 이전 항목이 바뀐다.

### 3.2 Hierarchy (글자 역할 = `TYPE` 상수)

Tailwind에 새 글자 크기 이름을 만들면 `cn`(tailwind-merge)이 색 클래스로 오인해 병합이 깨진다. 그래서 역할을 **클래스 묶음 상수** `TYPE`(`src/components/typography.ts`)로 둔다.

| 역할 | `TYPE` 키 | 휴대폰 → 데스크톱 | 굵기 | 행간 | 자간 | 색 | 쓰임 |
|---|---|---|---|---|---|---|---|
| Display | `display` | 34px(<380) · 40 · 48(sm) · 56(lg) · 60(xl) | 560 | 1.2 | −0.025em | headline gradient | 홈 h1 한 곳 |
| Title | `title` | 30 → 40px | 600 | 1.25 | −0.022em | foreground | 각 화면 h1 |
| Section | `section` | 26 → 36px | 600 | 1.25 | −0.02em | foreground | 홈 섹션 h2 |
| Block | `block` | 18 → 20px | 600 | 1.4 | −0.012em | foreground | 화면 안 블록 h2 |
| Card | `card` | 17px | 600 | 1.45 | −0.01em | foreground | 카드·단계 h3 |
| Lead | `lead` | 17 → 18px | 400 | 1.7 | 0 | body | 히어로·화면 첫 문단 |
| Body | `body` | 16px | 400 | 1.7 | 0 | body | 본문(휴대폰도 16px) |
| Small | `small` | 14px | 400 | 1.6 | 0 | body | 목록 설명·표 옆 설명 |
| Meta | `meta` | 13px | 500 | 1.5 | 0 | meta | 라벨·눈썹·번호 옆 글 |
| Mono value | `mono` | 13px | 400 | 1.7 | 0 | lead | 지문·시각·ID |
| Legal | (푸터) | 13px | 400 | 1.75 | 0 | body | 법정 고지(최대 46rem 폭) |

- 굵기는 400 / 500 / 600 + 히어로만 560. 700 이상은 쓰지 않는다 — 예외 하나: 동의 문구·처리방침의 법정 강조 `<strong>`은 브라우저 기본 굵기(700)를 그대로 둔다(법이 요구하는 '눈에 띄는 표시'). (참고로 삼은 시스템의 510·590은 쓰지 않는다: Pretendard가 늦게 오는 동안 쓰는 Windows 대체 글꼴 Malgun Gothic은 보통·굵게뿐이라 그 중간 굵기를 낼 수 없다. 대체 면(globals.css "Pretendard Fallback") 범위 안 글자는 549까지 보통, 550부터 굵게, 범위 밖 글자는 시스템 글꼴 규칙대로 501부터 **굵게** 그려진다.)
- `leading-relaxed`는 전역에서 1.7로 맞춘다(한글 본문 행간).
- Tailwind 기본 `text-*`는 행간을 함께 바꾸므로, 행간을 지정할 때는 `cn()` 안에서 **글자 크기 → 행간** 순서로 쓴다.

### 3.3 한글 규칙 (Pretendard 실측 근거)

- 한글 잉크 높이 0.895em(라틴 대문자 0.707em) → 큰 제목 행간 1.2 이상(1.0이면 줄 사이 0.1em만 남는다).
- 자간: 48px 이상 −0.025em(최대 −0.03em), 32–40px −0.02em, 17–28px −0.01~−0.015em, 16px 이하 0. 한글에 양수 자간 금지.
- `:lang(ko){ word-break: keep-all; overflow-wrap: break-word }`, 제목 `text-wrap: balance`, 문단 `text-wrap: pretty`. 해시·URL만 `break-all`.
- 붙어 있어야 하는 묶음은 `whitespace-nowrap`(예: 히어로의 "AI 시그널 기록").
- 줄 길이: 본문 35–45음절(16px ≈ 36–40rem), 법정 고지 50–60음절(13px ≈ 46rem).
- 굵은 제목은 왼쪽 여백이 커 보이므로 큰 제목에만 필요하면 `ml-[-0.04em]`로 광학 정렬한다(선택).

### 3.4 숫자와 mono

- `table, time, code, kbd, samp, pre`는 전역 `tabular-nums`. 숫자 칸·순번·시각은 자릿수가 맞아야 한다.
- 숫자를 강조색으로 칠하지 않는다. 큰 통계 숫자(stat callout)·카운트업 금지.

---

## 4. Component Stylings

### 4.1 Buttons (`ui/button.tsx`)

| variant | 모양 | 쓰임 |
|---|---|---|
| default (Primary) | `bg-primary` + 흰 글자 + `elev-button`(위쪽 1px 흰 하이라이트 16% + 바깥 1px 그림자). hover `#6168e2`, pressed `#4f56c9` + 1px 내려감 | 화면당 1개의 주 행동 |
| outline (Secondary) | 흰 4% 채움 + 8% 테두리, hover 흰 8% + 12% 테두리, 글자 foreground | 보조 행동, 헤더 사전등록, 404 '처음으로' |
| secondary / ghost / destructive / link | 기존 유지(링크는 `text-link` + 밑줄 오프셋 4px) | 운영자·표 안 동작 |

| size | 높이 | 좌우 | 글자 | 쓰임 |
|---|---|---|---|---|
| lg | **44px(휴대폰) → 40px(sm 이상)** | 20 → 16px | 15px / 500 | 히어로·CTA·폼 제출(터치 44px) |
| default | 32px | 10px | 14px | 운영자 폼 |
| sm | 28px(헤더에서는 32px로 덮어씀) | 10–12px | 13px | 표 안 동작, 앵커 JSON |
| xs / icon* | 기존 유지 | | | |

- 반경 8px(`rounded-lg`). 알약형(pill) CTA 금지.
- 전환 `transition-colors duration-150`. `button`은 전역에서 `cursor: pointer`(Tailwind v4 preflight가 기본 화살표로 둔다).
- 포커스: 전역 `:focus-visible { outline: 2px solid #a3a9ff; outline-offset: 2px }`. 버튼에 `outline-none`·`ring`을 쓰지 않는다.
- 제출 버튼은 `type="submit"` 명시(Base UI 기본값은 `button`).

### 4.2 Header · Navigation (`site-header.tsx`)

- `sticky top-0`, 높이 56px(휴대폰) / 64px(sm 이상). 바탕은 **캔버스와 같은 색** 80% + `backdrop-blur 20px`, 아래 8% 선(늘 보임, 스크롤 스크립트 없음). 페이지보다 밝은 띠로 만들지 않는다.
- 왼쪽: LogoMark(20px, 360px 미만 숨김) + 워드마크 "SIGNALS"(15px / 600 / 자간 +0.06em, 360px 미만 +0.02em).
- 메뉴: 14px / 500 / `text-tertiary` → hover `text-foreground`(100ms). 현재 페이지는 `aria-current="page"` + 5% 채움(색만으로 구분하지 않음). 높이 32px · 반경 8px(`inline-flex h-8 rounded-lg`)로 옆 사전등록 버튼과 같은 모양: 채운 현재 메뉴가 버튼보다 크면 그쪽이 더 무거운 버튼처럼 보인다. sm에서 다시 보이는 메뉴도 `sm:inline-flex`(inline이면 높이가 무시된다).
- 오른쪽: 사전등록 버튼은 **outline 32px**(히어로의 주 버튼과 경쟁하지 않게). 320px 폭에서 한 줄에 들어가야 한다. 사전등록 화면(완료 화면 포함)에서는 이 버튼도 `aria-current="page"`를 달고 `bg-selected` + `border-input`(#686b72, 캔버스 대비 3.73:1)으로 현재 위치를 보인다. 바탕만으로는 안 보인다: outline의 평소 바탕이 이미 4% 흰색이라 메뉴의 5% 채움은 차이가 없고, `bg-selected` + `border-line-strong`은 평소와 1.11:1이며 hover 모양과 같다.
- 검색창 없음. 스크롤에 반응하는 스크립트 없음.

### 4.3 Cards · Panels (`panel.tsx`)

| tone | 면 | 테두리 | 그림자 | 쓰임 |
|---|---|---|---|---|
| panel | `bg-card` | 8% | 없음 | 기본 카드 |
| inset | `bg-inset` | 8% | 없음 | 단독 우물 |
| raised | `bg-raised` | 8% | `elev-lift` | 강조 카드 |

- 반경 12px(`rounded-xl`), 강조·영수증 카드 16px(`rounded-2xl`). 패딩 20px(휴대폰) / 24px(데스크톱), 큰 카드 24/32px.
- 링크 카드·줄: hover `bg-muted`(5%), 포커스 테두리는 안쪽(`-outline-offset-2`, 카드가 `overflow-hidden`이라 바깥 테두리가 잘린다).
- 상자 속 상자 금지. 묶음이 필요하면 한 카드 안을 `divide-y divide-line-subtle`로 나눈다.
- 계산 중 자리 표시(검증 결과): 결과 요약 카드와 같은 모양(16px 모서리, 24/32px 여백) + 스피너 줄 + 정적 막대 3개(흰 5% / 3.5%, `aria-hidden`). 깜빡이지 않는다(pulse 금지). 얇은 한 줄 카드면 계산이 끝날 때까지 푸터가 화면 가운데로 올라와 있다가 결과가 뜨면 밀려난다.

### 4.4 Lists · Rows

- `ListPanel` = 카드 + 줄 사이 5% 선. 줄 패딩 16px × 16–24px.
- 줄 제목 16px / 500 foreground, 메타 13px tertiary(라벨은 sans, 값만 mono).
- 상태 배지는 색 없는 outline(합격·보증처럼 읽히지 않게, 초록 금지).
- 줄 전체가 링크면 줄 오른쪽 끝에 `ChevronRight` 16px(tertiary, `aria-hidden`)를 둔다: hover 5% 채움만으로는 정적 화면·터치에서 누를 수 있다는 단서가 없다. 줄은 내용 칸 | 화살표 칸의 2칸 격자(`grid-cols-[minmax(0,1fr)_auto]`)라 휴대폰에서 배지가 아래 줄로 내려가도 화살표는 오른쪽 끝 가운데에 남는다. 마우스를 올리면 2px 오른쪽으로(150ms, `group-hover`; 터치·reduce에서는 움직이지 않음).

### 4.5 Tables (`ui/table.tsx`)

- 카드 안(`overflow-hidden rounded-xl border bg-card`)에 둔다. 머리줄 40px, 12px / 500 / tertiary, 바탕 흰 2%. 칸 패딩 12px × 10px.
- 숫자·시각·지문은 mono 12–13px, `tabular-nums`. 행 hover 2.5%.
- 휴대폰에서는 칸을 숨기고(검증 화면에 있는 정보) 시각을 내용 아래 한 줄로 옮긴다. 표가 가로로 넘치지 않아야 한다.

### 4.6 Status Pill · Badge · Tag

- StatusPill: 높이 24px, 반경 6px, 12px / 500, 아이콘 14px + 글자 라벨(2.5 표). 속 빈 알약 = 확인 못 함.
- Badge: 높이 24px, 완전 둥근 모양, 12px / 500. outline = 8% 테두리 + body 글자(에이전트 상태), secondary = 흰 5% 채움(전략·플랫폼 운영 표시).
- 알림 칩(히어로 맨 위): 높이 28px, 완전 둥근 모양, 흰 4% + 8% 테두리, 13px / 500 / lead, 앞에 6px 인디고 사각 점(봉인 블록 모양, 깜빡이지 않음).

### 4.7 Hash (`hash-text.tsx`)

- 앞 N자리…끝 4자리(mono, 주변 글자의 0.92em), 전체 값은 `title`. `copyLabel`이 있으면 24px 복사 아이콘 버튼(`aria-label="${copyLabel} 복사"`).
- 자동 복사가 막히면 전체 값을 펼쳐 선택해 둔다(잘린 지문을 복사해 가지 않게).
- 복사 완료 체크 아이콘은 글자색(`text-foreground`). 초록이 아니다(2.5절).
- `settle` 옵션: 검증 결과에서 "원문으로 지문 다시 계산"이 통과일 때만 지문이 한 번 정착한다(아래 7절). 뒤섞인 글자가 보이는 동안은 요소를 화면낭독기에서 숨기고(`aria-hidden`), 최종값을 쓴 뒤에 다시 드러낸다: 검증 결과는 `aria-live` 영역 안이라 글자를 바꿀 때마다 읽힐 수 있다.

### 4.8 Code · Proof Well (`terminal-block.tsx`)

- `<pre>` 하나: `bg-inset` + 5% 테두리 + 반경 8px, 패딩 16 × 14px, JetBrains Mono 13px / 1.7 / lead.
- 긴 값(정규 직렬화 문자열)은 `wrap`(아무 곳에서나 줄바꿈), 아니면 가로 스크롤(+ `tabIndex=0`). /verify의 명령줄 블록은 휴대폰(sm 미만)에서만 줄바꿈한다(`max-sm:whitespace-pre-wrap max-sm:break-words`: 인자 사이 빈칸에서 먼저, 한 줄보다 긴 주소만 중간에서): 가로 스크롤 상자는 스크롤 표시가 없어 명령이 잘린 것처럼 보인다.
- 명령줄 블록에는 복사 버튼을 두지 않는다. '코드 창'이 필요하면 카드 머리줄(13–14px 제목 + 아래 5% 선) + 몸통 안 우물로 만든다(창 모양 색 점 금지).

### 4.9 Inputs · Forms

- 입력칸: 높이 44px(휴대폰) / 40px(sm 이상), `bg-inset`, 테두리 `#686b72`(우물 3.82 / 캔버스 3.73 / 카드 3.57 :1), 반경 8px, 글자 16px(휴대폰, iOS 확대 방지) / 14px(md 이상), 플레이스홀더 tertiary.
- 모든 입력칸에 **보이는 라벨**. 플레이스홀더만으로 라벨을 대신하지 않는다.
- 오류: 칸에 `aria-invalid` + 아래 문장(`text-status-fail`). 아이콘은 폼 위 오류 알림(`Alert` + CircleAlert)과 /verify 형식 오류 문장에만 붙고, 사전등록 칸별 오류는 글자만(빨간 문장 + `aria-invalid` + 칸 테두리). 첫 오류 칸으로 포커스.
- 동의 항목: 한 우물(`bg-inset` + 5% 테두리) 안을 5% 선으로 나눈 줄. 칸마다 상자를 따로 그리지 않는다. 체크박스는 `shrink-0`(flex 줄에서 긴 동의 문구 옆에 놓이면 가로만 줄어 찌그러진다).
- 여러 줄 입력칸(`Textarea`)은 `field-sizing-content`라 `rows`가 무시된다 → 긴 글 칸은 `min-h-32`(128px)부터 시작하고 글이 늘면 커진다.
- 사전등록 폼 카드는 sm 이상에서만 카드다. 휴대폰에서는 테두리·면·여백을 지워 캔버스에 바로 둔다(페이지·카드·우물 여백이 겹쳐 동의 문구 폭이 250px 아래로 줄지 않게).
- 네이티브 `form`/`select`/`checkbox`를 쓴다(한글 IME 조합 중 Enter 문제가 없다). 직접 Enter 처리를 만들면 `isComposing`/`keyCode 229`를 거른다.

### 4.10 Empty State (`empty-state.tsx`)

- 점선(12%) 테두리 카드, 가운데 정렬, 40px 아이콘 타일(`bg-raised` + `elev-lift`) + 14px body 문장. 점선은 '아직 비어 있음'을 실제 카드와 구분하는 유일한 점선이다.

### 4.11 Signature: 봉인 기록 예시 카드 (홈 히어로)

- 카드: `bg-card`, 반경 16px, `elev-float`, 패딩 20 / 28px, 정적 그레인 5%, 포인터 스포트라이트(마우스·펜만), 뒤에 사이트 유일의 glow.
- 머리: 13px meta "봉인 기록 예시" + 오른쪽 '예시' 칩(화면낭독기에는 숨김, 앞 라벨과 중복).
- 원문 우물: 12px meta "원문" + 정규 직렬화 v2 형식의 **예시** 원문 한 줄(mono 12px, 말줄임, 전체는 `title`). 종목 칸은 `EXAMPLE`이라 실제 종목·방향이 첫 화면에 보이지 않는다.
- 세 줄(5% 선으로 구분, 순서 있는 목록). 세 줄 라벨은 같은 봉인 단계라 모두 body 색(`text-muted-foreground`)이고, 카드에서 가장 밝은 값은 지문(lead mono)이다:
  1. SealMark + "SHA-256 지문" → 아래에 위 원문의 **실제 SHA-256**(mono 13px, 380px 미만 12px, `max-w-[32ch]`로 32자 × 2줄, 한 번 정착). 380px 이상에서는 `ml-6`(표시 16px + 간격 8px)으로 들여 라벨 글자 시작선에 맞춘다(380px 미만은 카드 안쪽이 240px라 들이지 않는다).
  2. SealMark + "RFC 3161 시각 서명 · FreeTSA, DigiCert"
  3. SealMark + "일일 앵커 · 공개 저장소, 비트코인(OpenTimestamps)"
- 금지: 날짜·루트·앵커 값 같은 가짜 기록 값, '통과·맞습니다' 같은 검증 판정 문구, 초록색, /verify로 가는 링크(예시는 검증할 수 없다).

### 4.12 Chain Rail (사슬 레일)

- 세로 1px `line-strong` 선 + 각 항목 맨 위 9px 속 빈 원(인디고 1px 테두리, 캔버스 채움). 마지막 항목 아래로는 선이 이어지지 않는다.
- 번호는 mono 12px tertiary("01"). 강조색으로 숫자를 칠하지 않는다.
- 선은 `li` 테두리가 아니라 `::before`로 '이 노드 → 다음 노드'만 긋는다(테두리로 그리면 첫 노드 위로 꼬리가 남고 마지막 노드 앞에서 끊긴다).
- 쓰는 곳: 홈 "어떻게 작동하나요"(4단계), /verify 7가지 검사, /anchors 날짜별 앵커 목록. 움직이지 않는다(정적). /anchors의 '문서(JSON)' 버튼은 모든 폭에서 날짜·요약 아래에 둔다(오른쪽 끝 칸에 두면 글에서 멀리 떨어져 어느 기록의 버튼인지 이어 보기 어렵다).

### 4.13 Footer

- 캔버스 바탕(더 어두운 띠로 만들지 않음), 위 8% 선, 위 48–56px / 아래 40px 여백.
- 법정 고지 2문단: 13px / 1.75 / body, 최대 46rem. 문장 안에 태그를 끼우지 않는다(고지 테스트가 한 덩어리로 읽는다).
- 링크 줄: 5% 선 아래, 개인정보 처리방침은 굵게 + foreground(법정 안내라 가장 눈에 띄게), 나머지는 tertiary → hover foreground. 마지막은 '오픈소스 고지'(`/third-party-notices.txt`, 정적 파일이라 `<a>`). 휴대폰은 2열 격자(그냥 줄바꿈하면 390px에서 링크 하나만 다음 줄로 떨어져 흩어져 보인다), sm 이상은 한 줄.

---

## 5. Layout Principles

### 5.1 Spacing Scale

4px 기반: `4 · 8 · 12 · 16 · 20 · 24 · 32 · 40 · 48 · 64 · 96 · 112`. 카드 안 간격 12–16, 카드 패딩 20–32, 섹션 사이 64(휴대폰) / 96(데스크톱).

### 5.2 Containers · Grid

| 영역 | 폭 | 좌우 여백 |
|---|---|---|
| 기본 컨테이너(헤더·푸터·홈 섹션) | `max-w-6xl`(1152px) | 20px(휴대폰) / 32px(sm 이상) |
| 홈 | 루트에 `data-layout="bleed"` → `<main>`의 폭·여백을 풀고, 섹션마다 위 컨테이너를 직접 둔다(히어로 띠는 화면 끝까지) |
| 글 중심 화면(검증·앵커·사전등록·완료·처리방침) | 틀 768px(`max-w-3xl`) — 헤더 메뉴로 오갈 때 제목 왼쪽 끝이 같다. 그 안에서 글 문단은 672px(`max-w-2xl`), 처리방침 본문은 680px(`[&>*]:max-w-[42.5rem]`)로 줄 길이를 지키고 왼쪽에 붙인다 | 기본 |
| 운영자 | `data-layout="wide"` → 1440px(`max-w-[90rem]`) | 기본 |

- 홈 히어로 격자: `lg:grid-cols-[minmax(0,1fr)_27rem]`, 간격 64px, 세로 가운데 정렬.
- "어떻게 작동하나요": `lg:grid-cols-[2fr_3fr]` — 왼쪽 제목(sticky), 오른쪽 세로 사슬.
- 넓은 `1fr` 칸에는 `minmax(0,1fr)` + `min-w-0`(긴 지문이 칸을 밀어내지 않게).

### 5.3 Section Rhythm (홈)

1. 히어로 띠(화면 폭 전체, 격자·그레인·glow) — 위 56/80/96px, 아래 64/96/112px.
2. 증명 범위 띠: "증명하는 것 / 증명하지 않는 것" 2열, 바깥 상자 없이 가운데 세로 5% 선.
3. 작동 방식: 제목 + 세로 사슬 4단계.
4. 공개된 에이전트: 목록 카드.
5. 마무리 CTA: raised 카드(제목 32px + 버튼, 그 아래 설명 15px).

### 5.4 Whitespace Philosophy

어두운 화면에서는 캔버스 자체가 여백이다. 섹션은 상자를 늘어놓아 나누지 않고, **여백 + 띠 사이 5% 선 + 면 한 단 올리기**로 나눈다. 정보 화면은 촘촘하게(행 44–48px, 운영자 36px), 설명 화면은 넉넉하게.

### 5.5 Border Radius Scale (`--radius: 0.5rem`)

| 토큰 | 값 | 쓰임 |
|---|---|---|
| `rounded-sm` | 4px | 인라인 코드 칩 |
| `rounded-md` | 6px | 상태 알약, 작은 칩 |
| `rounded-lg` | 8px | 버튼·입력칸·우물 |
| `rounded-xl` | 12px | 카드·표·목록 |
| `rounded-2xl` | 16px | 영수증 카드·CTA·검증 종합 결과 |
| `rounded-full` / `rounded-4xl` | 끝까지 | 배지·알림 칩·아바타 |

---

## 6. Depth & Elevation

| 단계 | 처리 | 쓰임 |
|---|---|---|
| 0 Flat | 그림자 없음, 캔버스 위 글자 | 히어로 글, 섹션 제목, 푸터 |
| 1 Card | `bg-card` + 8% 테두리 | 기본 카드·표·목록 |
| 2 Lift | 면 + 8% 테두리 + `elev-lift` | `bg-raised`: CTA 카드, 아이콘 타일 · `bg-card`(16px 모서리): 검증 종합 결과 |
| 3 Float | `bg-card` + `elev-float` | 봉인 기록 예시 카드(사이트에 1개) |
| Menu | `bg-popover` + `shadow-md` | select 팝업 |
| Well | `bg-inset` + 5% 테두리 | 코드·원문·입력칸·동의 묶음 |

- `elev-lift` = `inset 0 0 0 1px rgb(255 255 255/.03), inset 0 1px 0 rgb(255 255 255/.04), 0 0 0 1px rgb(0 0 0/.6), 0 4px 4px rgb(0 0 0/.1)` — 위쪽 가장자리에 아주 옅은 빛, 바깥에 검은 1px 테두리. 깎아 만든 듯한 가장자리를 만든다.
- `elev-float` = `elev-lift` + `0 16px 48px -12px rgb(0 0 0/.6)`.
- `elev-button` = `inset 0 1px 0 rgb(255 255 255/.16), 0 0 0 1px rgb(0 0 0/.4), 0 1px 2px rgb(0 0 0/.4)`(주 버튼).
- 기본 카드에는 그림자를 주지 않는다. 깊이는 면의 명도와 선이 만든다.

---

## 7. Motion

### 7.1 Tokens

| 용도 | 시간 | 이징 |
|---|---|---|
| 글자색·불투명도 hover(링크·메뉴) | 100ms | ease-out |
| 배경·테두리 hover(버튼·줄) | 150ms | ease-out |
| 링크 줄 화살표 hover(2px 오른쪽) | 150ms | ease-out |
| 메뉴·팝업 | 100–180ms | tw-animate 기본 |
| 등장(히어로 시퀀스, CTA) | 560ms | `--ease-out-expo` `cubic-bezier(.19,1,.22,1)` |
| 봉인 표시 그리기 | 원 400ms + 체크 240ms | `--ease-out-quart` `cubic-bezier(.165,.84,.44,1)` |
| 지문 정착 | 600ms(약 20번 다시 뽑기) | ease-out cubic |

- 쓰는 속성은 `opacity`·`transform`·`stroke-dashoffset`·텍스트 노드 값뿐(레이아웃이 흔들리지 않게).
- 반복(loop)·맥동·카운트업·자동 스크롤·커서 효과 없음. 데이터 화면에는 스스로 움직이는 것이 없다(로딩 스피너 제외, `motion-safe`). 포인터를 올렸을 때의 짧은 반응(색·배경 100–150ms, 링크 줄 화살표 2px 150ms)만 있다.

### 7.2 Effects Inventory (어디에 무엇이)

| 효과 | 파일 | 위치 | 움직임 |
|---|---|---|---|
| LedgerGrid | `effects/ledger-grid.tsx` + `effects/shape-grid.tsx` | 홈 히어로 띠 바탕 | 정지. 마우스가 지나가면 몇 칸이 옅게 켜졌다 꺼짐(마우스가 0.9초 멈추면 꺼짐) |
| Grain | `effects/grain.tsx` | 히어로 띠·영수증·CTA | 정지 이미지 |
| SpotlightCard | `effects/spotlight-card.tsx` | 영수증·CTA 카드 | 포인터·키보드 포커스에만 반응 |
| HashSettle | `effects/hash-settle.tsx` | 영수증 지문, 검증 결과 지문(통과일 때만) | 1회 600ms |
| SealMark | `effects/seal-mark.tsx` | 영수증 3줄 | 1회(400 / 520 / 640ms 시작) |
| Reveal | `globals.css` `.reveal-mount` `.reveal-scroll` | 히어로 시퀀스, 홈 CTA | 1회 / 스크롤 진입 |

**예산 규칙**: 효과는 홈 히어로와 홈 CTA에만, 그 밖에는 "검증 결과 지문 정착" 한 곳만. /anchors, /a, /p, /providers, /privacy, 404·오류, /admin에는 효과 없음.

### 7.3 히어로 시퀀스 (첫 페인트 기준)

알림 칩 0ms → 문단 100ms → 버튼 160ms → 영수증 카드 220ms (각 560ms, 12px 위로 떠오름) → 봉인 표시 400 / 520 / 640ms → 지문 정착(하이드레이션 뒤, 60% 이상 보일 때 시작, 1.2초 안에 끝나지 않으면 건너뛰고 값만 보임). 전체 CSS 시퀀스는 1.2초 안에 끝난다.

h1은 등장 연출 없이 첫 프레임부터 그대로 있다. 등장 연출을 걸었을 때 휴대폰 모션 샷에서 h1만 통째로 빈 칸으로 찍힌 적이 있고(원인 미확정, `background-clip: text` 글자에 opacity·transform 애니메이션을 합성할 때의 문제로 의심), h1은 휴대폰 첫 화면의 가장 큰 글(LCP 후보)이다. 그라디언트 글자에는 등장 애니메이션을 걸지 않는다.

### 7.4 Reduced Motion · 정지 화면

- 효과 CSS는 전부 `@media (prefers-reduced-motion: no-preference)` 안에만 있다. 최종 상태가 기본 스타일이고, 모션은 그 상태로 '들어오기'만 한다 → reduce면 첫 프레임이 완성 화면(전체 페이지 스크린샷이 이 모드로 찍힌다).
- 전역 안전망: reduce면 모든 `animation`/`transition` 시간을 0으로.
- JS 효과: reduce면 포인터를 따라가지 않고(스포트라이트·격자), 지문은 처음부터 최종값.
- JS가 없거나 늦어도 내용은 보인다(지문 대기는 CSS가 1.2초에 스스로 풀어 준다).

### 7.5 Performance

- 신규 npm 의존성 0. 효과 합계 약 11 KB(min+gzip).
- `IntersectionObserver`로 화면 밖이면 멈춤, `visibilitychange`로 숨은 탭이면 멈춤(지문 정착은 즉시 최종값). 지문 정착은 `intersectionRatio ≥ 0.6`까지 확인한다(첫 콜백은 조금만 겹쳐도 `isIntersecting=true`로 온다).
- 지문 정착의 대기(hold)는 정착이 실제로 시작될 때만 푼다: 시작 전에 effect가 다시 돌면(개발 모드 StrictMode 등) 대기를 유지해 '최종값 → 뒤섞임 → 최종값' 깜빡임이 없다. JS가 끝내 시작하지 않으면 CSS가 1.2초에 스스로 보여 준다.
- canvas는 DPR 최대 2 + 800만 픽셀 상한. 터치 포인터는 무시(스크롤 중 칸이 켜지지 않게).
- 멈춰 있을 때 `requestAnimationFrame` 0회/초가 기준이다.

---

## 8. Do's and Don'ts

### Do
- 지문·시각·순번은 mono + `tabular-nums`, 라벨은 Pretendard.
- 한 화면에 채운 인디고 버튼 1개. 나머지는 outline·링크.
- 상태 = 아이콘 + 글자 + 모양. 초록은 실제 통과에만.
- 카드 안은 5% 선과 우물로 나누기.
- 문구는 원래 파일에 그대로(테스트가 소스 파일을 읽는다). 새 문구는 승인 목록에 있는 것만.
- 장식 레이어는 `aria-hidden` + `pointer-events-none` + `print:hidden`, 부모 `relative isolate`, 레이어 `-z-10`.
- Tailwind 클래스는 소스에 글자 그대로(조립 금지: `bg-status-${k}` ✗). `${`에 붙는 임의값 클래스는 문자열 상수로 뺀다.
- 법정 고지는 body 색(`#b4bcd0`) 이상으로 읽히게.

### Don't
- 수익률·성과 숫자, 오르는 선·차트, 시장색(빨강·파랑), ▲▼, 'LIVE' 점, 카운트다운·긴박감·희소성 문구.
- 후기(testimonial)·로고 벽·"N명이 신뢰" 같은 사용자 수 주장. 외부 기관 로고(제휴·보증 오인).
- 상자 속 상자, 모든 섹션을 같은 테두리 상자로 감싸기.
- 글자 단위로 문장 쪼개기(SplitText·BlurText 류), 글리치·네온·스캔라인·3D·커서 효과, 무한 루프 배경.
- 한글을 mono 안에, 한글에 양수 자간, 700 이상 굵기.
- 두 번째 glow, 색이 있는 그라디언트 글자, 메시·오로라 배경.
- 금지어(클래스 이름·aria-label 포함): 품질·성과 보증처럼 읽히는 말, '독립', '추천', '영구' 등 — 목록은 `src/lib/__tests__/public-wording.test.ts`가 원본.
- `.dark` 클래스, 헤더 검색창, 스크롤 감지 스크립트, 명령줄 블록 복사 버튼.

---

## 9. Responsive Behavior

### 9.1 Breakpoints

| 이름 | 폭 | 주요 변화 |
|---|---|---|
| base | 320–639px | 1열, 여백 20px, 주 버튼·입력칸 44px, CTA 버튼 세로로 꽉 차게(440px 미만) |
| `min-[380px]` | 380px+ | 히어로 h1 34 → 40px |
| sm | 640px+ | 여백 32px, 헤더 64px, 버튼 40px, "외부 고정 기록" 메뉴 표시 |
| md | 768px+ | 증명 범위 2열, 표에 발행 칸 |
| lg | 1024px+ | 히어로 2열(글 + 영수증), 작동 방식 2열, 표에 지문·외부 시각 칸 |
| xl | 1280px+ | 히어로 h1 60px, 운영자 왼쪽 메뉴 |

### 9.2 Touch Targets

- 주 버튼·입력칸·복사 버튼 행동 영역: 휴대폰 44px.
- 헤더 사전등록 버튼·메뉴 32px, 표 안 버튼 28px, 지문 복사 아이콘 24px: WCAG 2.5.8 최소(24px) 충족, 촘촘한 영역의 예외.

### 9.3 Collapsing Strategy

- 히어로: 글 → 영수증 순으로 쌓인다. 영수증은 휴대폰에서도 같은 내용(지문 32자 × 2줄, 320px 폭에서는 12px).
- 격자(grid) 컨테이너는 휴대폰에서도 `grid-cols-1`(= `minmax(0,1fr)`)을 명시한다. 열을 비워 두면 `auto` 열이 말줄임(nowrap) 줄의 최소 폭만큼 늘어나고, 부모의 `overflow-hidden`이 그 넘침을 가려 `scrollWidth` 검사로도 안 잡힌다(v2 검수에서 실제로 재현).
- 증명 범위: 2열 → 위아래(사이 5% 가로선).
- 작동 방식: 제목 위, 사슬 아래(같은 세로 레일 그대로).
- 표: 칸 숨김 + 시각을 내용 아래 한 줄로. 가로 넘침 0.
- 320px: 헤더(워드마크 + "기록 검증" + 사전등록)가 한 줄에 들어가야 하고, 히어로 h1이 "결과 전에 봉인하고 / 누구나 다시 대조하는 / AI 시그널 기록" 3줄로 끊긴다(`max-w-[8.6em]` + "AI 시그널 기록" `nowrap`).

---

## 10. Agent Prompt Guide

### 10.1 Quick Reference

```
Canvas #08090a · Inset #050506 · Card #0f1011 · Raised #141516 · Popover #191a1b
Lines white 5% (line-subtle) / 8% (border) / 12% (line-strong) · Input #686b72
Text #f7f8f8 (foreground) · #d0d6e0 (lead) · #b4bcd0 (muted-foreground) · #8a8f98 (tertiary) · #62666d (disabled)
Accent #5a61d8 fill (white 5.08:1) · #a3a9ff link/ring · #18182f tint
Status pass #4cd3a0 · fail #f26b5e · pending #e3b24f · skip #8b939e (pill 14% + 40% border; unchecked = hollow)
Type Pretendard (400/500/600, display 560) + JetBrains Mono · TYPE.display/title/section/block/card/lead/body/small/meta/mono
Radius 8 buttons/inputs · 12 cards · 16 hero/CTA · full pills
Elevation elev-lift / elev-float / elev-button · one hero-glow · headline-gradient on home h1 only
Motion 100/150ms hover · 560ms entrances · ≤1.2s sequence · nothing loops · reduce = final frame
```

### 10.2 Example Prompts

- **새 데이터 화면**: "SIGNALS DESIGN.md 기준으로 /x 화면을 만들어. `PageHeader`(TYPE.title) + 카드 안 `ListPanel`. 값(시각·지문)은 mono, 라벨은 sans. 상태는 `StatusPill`(아이콘 + 글자). 효과·glow·그라디언트 없음. 새 문구는 쓰지 말고 주어진 문자열만."
- **카드 하나**: "`Panel`(tone panel, pad md)로 카드를 만들고 안쪽은 `divide-y divide-line-subtle`로 나눠. 카드 안에 테두리 카드를 또 넣지 마. 제목은 TYPE.card, 설명은 TYPE.small."
- **폼**: "입력칸마다 보이는 라벨, 휴대폰 44px, 오류는 `aria-invalid` + 아래 `text-status-fail` 문장. 제출 버튼은 `size="lg"` + `type="submit"`. 동의 항목은 한 우물 안 줄로."
- **히어로 손보기**: "h1은 TYPE.display + `headline-gradient`, 3줄 유지(`max-w-[8.6em]`, 'AI 시그널 기록' nowrap), 등장 연출 없음(첫 프레임부터 고정). 등장은 칩·문단·버튼·영수증의 `.reveal-mount` + `--reveal-delay`만. 두 번째 glow·새 효과 금지."
- **상태 표시 추가**: "`StatusPill` kind를 새로 만들지 말고 기존 6종(pass/fail/pending/skip/unchecked/neutral) 중에서 골라. 초록은 실제 통과에만."

### 10.3 Review Checklist (만든 뒤 스스로 확인)

1. 320 / 390 / 768 / 1280 / 1440px에서 가로 넘침 0(`scrollWidth === innerWidth`).
2. `prefers-reduced-motion: reduce` 전체 페이지 스크린샷이 '완성된' 화면인가(빈 칸·투명한 글자 없음).
3. 한 화면에 채운 인디고 버튼 1개, glow 1개, 그라디언트 글자 1곳.
4. 모든 글자 대비 AA(본문 4.5:1, 입력칸 경계·포커스 3:1). 새 색을 만들었다면 대비를 다시 잰다.
5. 한글이 mono 안에 없는가, 상태가 색만으로 구분되지 않는가, 초록이 통과에만 쓰였는가.
6. `npx tsc --noEmit`, `npx eslint src --max-warnings=0`, `npx vitest run` 통과(문구·금지어 테스트 포함).
7. 멈춘 화면에서 rAF 0회/초, 콘솔 오류 0, 외부 요청 0.

---

## 참고 · 출처 (Credits)

- **VoltAgent/awesome-design-md** — 구성 형식과 참고 시스템 분석. 주 참고: `design-md/linear.app/DESIGN.md`(면 사다리, 반투명 선, 인디고 1색, 제품이 곧 히어로, 절제된 모션; 2026-11-17 실제 사이트 CSS로 값 재확인). 보조 참고: `resend` DESIGN.md(반투명 선, 코드 창, 섹션당 glow 1개, 제목 그라디언트), `coinbase` DESIGN.md(금융 신뢰 톤, 굵기 절제, 숫자는 mono). 반면교사: `binance` DESIGN.md(고전압 노랑, 사용자 수 주장, 시장색). 값은 SIGNALS에 맞게 각색했고(한글 행간 1.2·자간 −0.025em·굵기 500/600 등), 해당 서비스의 이름·로고·문구는 UI에 쓰지 않는다.
- **UI UX Pro Max skill** (nextlevelbuilder/ui-ux-pro-max-skill, MIT, commit e59ff376a41f) — 제품군 규칙(Minimalism & Swiss + Accessible & Ethical), anti-pattern 목록, 웹 납품 체크리스트(cursor-pointer, 터치 44px, 모바일 본문 16px, 보이는 라벨, reduced motion), 'live'·숫자 표기 규칙.
- **React Bits** (DavidHDev/react-bits, commit d01aa914, © 2026 David Haz, **MIT + Commons Clause License Condition v1.0**) — 효과 이식: SpotlightCard(각색), ShapeGrid(원본 + 패치 → LedgerGrid), Noise(정적 부분 → Grain), DecryptedText(아이디어 → HashSettle 재작성), StatusMark(아이디어 → SealMark CSS 재작성), FadeContent(아이디어 → Reveal CSS). 웹사이트의 일부로만 사용하며 컴포넌트 자체를 판매·재배포하지 않는다. 라이선스 전문: `THIRD_PARTY_NOTICES.md`(빌드된 JS는 압축 때 파일 머리 주석이 지워지므로 같은 내용을 `public/third-party-notices.txt` → 사이트 `/third-party-notices.txt`로도 제공하고, 모든 화면의 푸터 '오픈소스 고지'가 이 주소를 연결한다. 두 파일이 글자 그대로 같은지와 푸터 연결은 테스트가 본다). 공개 앵커 저장소(`deploy/anchors-repo`)에는 React Bits 코드를 넣지 않는다.
- **Pretendard** (OFL-1.1), **JetBrains Mono** (OFL-1.1) — 자체 호스팅 글꼴. 한글 수치(잉크 높이 0.895em, 옆 여백 0.084em @SemiBold)는 Pretendard 1.3.9 글꼴 파일에서 실측.
