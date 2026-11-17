// 글자 역할(타입 스케일). Tailwind에 새 글자 크기 이름(text-display 등)을 만들면 cn(tailwind-merge)이 색 클래스로 오인해
// 병합이 깨진다 → 표준 클래스 묶음을 상수로 둔다. 순서는 글자 크기 → 행간 → 굵기 → 자간 → 색(cn이 행간을 지우지 않게).
// 값의 근거와 쓰임은 DESIGN.md 3절. 화면 문구는 넣지 않는다(문구는 각 화면 파일에 그대로).
export const TYPE = {
  /** 홈 히어로 h1 한 곳: 34(<380) · 40 · 48(sm) · 56(lg) · 60px(xl). 색은 headline-gradient가 정한다. */
  display: "text-[2.125rem] leading-[1.2] font-[560] tracking-tight min-[380px]:text-[2.5rem] sm:text-5xl lg:text-[3.5rem] xl:text-6xl",
  /** 각 화면 h1(PageHeader 포함): 30 → 40px */
  title: "text-[1.875rem] leading-[1.25] font-semibold tracking-[-0.022em] text-foreground sm:text-[2.5rem]",
  /** 홈 섹션 h2: 26 → 36px */
  section: "text-[1.625rem] leading-[1.25] font-semibold tracking-[-0.02em] text-foreground sm:text-4xl",
  /** 화면 안 블록 h2(표·목록·카드 묶음 위): 18 → 20px */
  block: "text-lg leading-[1.4] font-semibold tracking-[-0.012em] text-foreground sm:text-xl",
  /** 카드·단계 h3: 17px */
  card: "text-[1.0625rem] leading-[1.45] font-semibold tracking-[-0.01em] text-foreground",
  /** 히어로·화면 첫 문단: 17 → 18px */
  lead: "text-[1.0625rem] leading-[1.7] text-muted-foreground sm:text-lg",
  /** 본문: 16px(휴대폰도 16px) */
  body: "text-base leading-[1.7] text-muted-foreground",
  /** 촘촘한 UI 설명: 14px */
  small: "text-sm leading-[1.6] text-muted-foreground",
  /** 짧은 라벨·메타: 13px */
  meta: "text-[0.8125rem] leading-[1.5] font-medium text-tertiary",
  /** 지문·시각·ID 값: 13px mono */
  mono: "font-mono text-[0.8125rem] leading-[1.7] tabular-nums text-lead",
} as const;
