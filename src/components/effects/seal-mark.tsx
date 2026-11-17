/*!
 * SIGNALS SealMark — adapted from React Bits "StatusMark" (https://reactbits.dev, https://github.com/DavidHDev/react-bits @ d01aa914)
 * Copyright (c) 2026 David Haz. Licensed under the MIT + Commons Clause License Condition v1.0; full text in THIRD_PARTY_NOTICES.md.
 * Used only as part of the SIGNALS website. Not sold, sublicensed or redistributed as a component.
 * SIGNALS changes: rewritten as a CSS-only server component: the final state is the default style and a one-time draw-in plays over it (globals.css); no motion/react, no labels, no strike-through.
 */
import type { CSSProperties } from "react";

const CHECK = "M7.5 12.25 10.5 15.25 16.75 8.75";

/**
 * A ring that closes, then a check that draws. `delayMs` lets a parent sequence several marks (e.g. 0 / 160 / 320 ms).
 * Color comes from `currentColor` (text-link in the hero: "recorded", not "passed"; text-status-pass only for real check results).
 */
export function SealMark({ delayMs = 0, className }: { delayMs?: number; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
      className={["seal-mark size-4 shrink-0", className].filter(Boolean).join(" ")}
      style={{ "--seal-delay": `${delayMs}ms` } as CSSProperties}
    >
      <circle className="seal-mark__ring" cx="12" cy="12" r="9.25" pathLength={1} transform="rotate(-90 12 12)" />
      <path className="seal-mark__check" d={CHECK} pathLength={1} />
    </svg>
  );
}
