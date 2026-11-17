"use client";
/*!
 * SIGNALS LedgerGrid — adapted from React Bits "ShapeGrid" (https://reactbits.dev, https://github.com/DavidHDev/react-bits @ d01aa914)
 * Copyright (c) 2026 David Haz. Licensed under the MIT + Commons Clause License Condition v1.0; full text in THIRD_PARTY_NOTICES.md.
 * Used only as part of the SIGNALS website. Not sold, sublicensed or redistributed as a component.
 * SIGNALS changes: settings only — a still square grid in SIGNALS colors (no drift, intro, click cascade, rainbow, glow or twinkle) inside an aria-hidden, masked wrapper.
 */
import ShapeGrid from "./shape-grid";

// Decorative hero background: a quiet 44px ledger grid. Cells light softly under a mouse and fade; touch and reduced motion
// leave it a still image. The radial mask keeps the grid behind the receipt card (lower centre on phones, right side on lg+)
// and fades it out under the headline. Classes stay in one plain literal: Tailwind's scanner can miss an arbitrary class that
// touches `${` in a template string.
const WRAP =
  "pointer-events-none absolute inset-0 -z-10 print:hidden [mask-image:radial-gradient(ellipse_110%_55%_at_50%_85%,#000_0%,rgba(0,0,0,0.5)_45%,transparent_80%)] lg:[mask-image:radial-gradient(ellipse_70%_80%_at_78%_45%,#000_0%,rgba(0,0,0,0.55)_45%,transparent_80%)]";

export function LedgerGrid({ className = "" }: { className?: string }) {
  return (
    <div aria-hidden="true" className={className ? `${WRAP} ${className}` : WRAP}>
      <ShapeGrid
        shape="square"
        cellSize={44}
        lineWidth={1}
        direction="none"
        speed={0}
        lineColor="#18191b" /* 1.13:1 on the #08090a canvas: texture, never a pattern. Owner-tunable range #161719–#1d1e21 */
        hoverColor="#2f3136"
        hoverFillColor="#1e1f3d" /* indigo-tinted cell fill (between --primary-subtle #18182f and the accent) */
        fillOpacity={0.5}
        rainbow={false}
        radius={1.1}
        trail={0.45}
        glow={0}
        twinkle={0}
        fade={0.35}
        clickCascade={false}
        intro={false}
      />
    </div>
  );
}
