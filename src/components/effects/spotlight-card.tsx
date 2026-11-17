"use client";
/*!
 * SIGNALS SpotlightCard — adapted from React Bits "SpotlightCard" (https://reactbits.dev, https://github.com/DavidHDev/react-bits @ d01aa914)
 * Copyright (c) 2026 David Haz. Licensed under the MIT + Commons Clause License Condition v1.0; full text in THIRD_PARTY_NOTICES.md.
 * Used only as part of the SIGNALS website. Not sold, sublicensed or redistributed as a component.
 * SIGNALS changes: token colors; circle light only (no flare/grain/ambient/beam); mouse/pen only; reduced motion = no pointer tracking (focus light stays, static); stops on a hidden tab; polymorphic `as`; draws its own 1px border; margin 0 on decorative layers; print hides the light.
 */
import React, { useEffect, useRef } from "react";

type Tag = "div" | "li" | "section" | "article";

export type SpotlightCardProps = React.HTMLAttributes<HTMLElement> & {
  as?: Tag;
  /** Light color. Default = --link (#a3a9ff), read as a soft indigo tint at low intensity. */
  spotlightColor?: string;
  /** Fill strength 0..1 (default 0.09: barely there, never a glow). */
  intensity?: number;
  spotlightSize?: number;
  softness?: number;
  /** Strength of the 1px edge highlight 0..1. */
  borderGlow?: number;
  /** px outside the card where the light still reaches (lets neighbours in a grid catch the edge). 0 = only when hovered. */
  proximity?: number;
  smoothing?: number;
  /**
   * Draw the static 1px border inside the card (default). Do NOT also give the card a CSS `border`: the root is
   * overflow-hidden, so the highlight ring can only sit on a border the component draws itself.
   * Pass false inside gap-px grids, where the 1px lines are the grid's own background showing through.
   */
  border?: boolean;
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

// Same falloff curve as the original: a smooth core plus an exponential tail (no hard ring).
const falloff = (color: string, softness: number) => {
  const soft = clamp(softness, 0, 1);
  const core = (1 - soft) ** 1.5 * 0.85;
  const stop = (alpha: number, at: number) =>
    `color-mix(in srgb, ${color} ${(alpha * 100).toFixed(2)}%, transparent) ${(at * 100).toFixed(2)}%`;
  const list = [stop(1, 0)];
  for (let i = 0; i <= 14; i++) {
    const t = core + ((1 - core) * i) / 14;
    const g = (t - core) / (1 - core);
    const smooth = 1 - g * g * (3 - 2 * g);
    const glow = Math.exp(-4.6 * g * g) * (1 - g ** 6);
    list.push(stop(smooth + (glow - smooth) * soft, t));
  }
  return list.join(", ");
};

// Class strings live in plain literals so Tailwind's scanner always sees them (a class touching `${` in a template can be missed).
const ROOT = "relative isolate overflow-hidden";
// 1px ring drawn with a mask (content-box excluded from border-box), as in the original.
const RING_SHAPE =
  "pointer-events-none absolute inset-0 z-[1] rounded-[inherit] p-px [-webkit-mask:linear-gradient(#000_0_0)_content-box,linear-gradient(#000_0_0)] [-webkit-mask-composite:xor] [mask:linear-gradient(#000_0_0)_content-box_exclude,linear-gradient(#000_0_0)]";
const BASE_RING = `${RING_SHAPE} [background:var(--border)]`;
const EDGE_RING = `${RING_SHAPE} opacity-0 print:hidden`;
// Absolute layers still take margins: a `space-y-*` on the card would push their bottom edge up and leave an unlit strip.
// Inline margin 0 beats any utility the caller puts on the card.
const NO_MARGIN = { margin: 0 } as const;

export function SpotlightCard({
  as: Component = "div",
  children,
  className = "",
  spotlightColor = "#a3a9ff",
  intensity = 0.09,
  spotlightSize = 260,
  softness = 0.8,
  borderGlow = 0.4,
  proximity = 0,
  smoothing = 0.3,
  border = true,
  ...rest
}: SpotlightCardProps) {
  const rootRef = useRef<HTMLElement>(null);
  const lightRef = useRef<HTMLSpanElement>(null);
  const edgeRef = useRef<HTMLSpanElement>(null);
  const settings = {
    fill: falloff(spotlightColor, softness),
    edge: falloff(spotlightColor, 1),
    size: Math.max(20, spotlightSize),
    intensity: clamp(intensity, 0, 1),
    borderGlow: clamp(borderGlow, 0, 1),
    proximity: Math.max(0, proximity),
    smoothing: clamp(smoothing, 0, 1),
  };
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  useEffect(() => {
    const root = rootRef.current;
    const light = lightRef.current;
    const edge = edgeRef.current;
    if (!root || !light || !edge) return undefined;

    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    const state = { x: 0, y: 0, presence: 0, visible: true };
    const pointer = { x: 0, y: 0, active: false };
    const drawn = { light: "", edge: "" };
    let focus: Element | null = null;
    let raf = 0;
    let last = 0;
    let alive = true;

    const gradient = (size: number, x: number, y: number, stops: string) =>
      `radial-gradient(circle ${size.toFixed(1)}px at ${x.toFixed(1)}px ${y.toFixed(1)}px, ${stops})`;

    const paint = () => {
      const s = settingsRef.current;
      const fill = gradient(s.size, state.x, state.y, s.fill);
      const rim = gradient(s.size * 0.6, state.x, state.y, s.edge);
      if (fill !== drawn.light) light.style.background = drawn.light = fill;
      if (rim !== drawn.edge) edge.style.background = drawn.edge = rim;
      light.style.opacity = String(Math.min(1, state.presence * s.intensity));
      edge.style.opacity = String(Math.min(1, state.presence * s.borderGlow));
    };

    const tick = (now: number) => {
      raf = 0;
      if (!alive) return;
      const s = settingsRef.current;
      const dt = Math.min(0.05, Math.max(0.001, (now - last) / 1000));
      last = now;
      const rect = root.getBoundingClientRect();
      let tx = state.x;
      let ty = state.y;
      let target = 0;
      if (focus && root.contains(focus)) {
        const box = focus.getBoundingClientRect();
        tx = box.left + box.width / 2 - rect.left;
        ty = box.top + box.height / 2 - rect.top;
        target = 1;
      } else if (pointer.active && state.visible) {
        tx = pointer.x - rect.left;
        ty = pointer.y - rect.top;
        const gap = Math.hypot(Math.max(0, -tx, tx - rect.width), Math.max(0, -ty, ty - rect.height));
        if (gap === 0) target = 1;
        else if (s.proximity > 0) target = Math.max(0, 1 - gap / s.proximity) ** 2;
      }
      if (state.presence < 0.02 && target > 0) {
        state.x = tx;
        state.y = ty;
      }
      const follow = reduce || s.smoothing === 0 ? 1 : 1 - Math.exp(-dt / (0.015 + s.smoothing * 0.22));
      state.x += (tx - state.x) * follow;
      state.y += (ty - state.y) * follow;
      const fade = reduce ? 1 : 1 - Math.exp(-dt / (target > state.presence ? 0.1 : 0.32));
      state.presence += (target - state.presence) * fade;
      if (Math.abs(target - state.presence) < 0.002) state.presence = target;
      paint();
      const moving = Math.abs(tx - state.x) > 0.1 || Math.abs(ty - state.y) > 0.1;
      if (moving || state.presence !== target) raf = requestAnimationFrame(tick);
    };

    const wake = () => {
      if (raf || !alive || document.hidden) return;
      last = performance.now();
      raf = requestAnimationFrame(tick);
    };

    const isFinePointer = (event: PointerEvent) => event.pointerType === "mouse" || event.pointerType === "pen";
    const onMove = (event: PointerEvent) => {
      if (reduce || !isFinePointer(event)) return; // reduced motion: the light never follows the pointer
      pointer.x = event.clientX;
      pointer.y = event.clientY;
      pointer.active = true;
      if (state.presence > 0 || settingsRef.current.proximity > 0 || root.contains(event.target as Node | null)) wake();
    };
    const onOut = (event: PointerEvent) => {
      if (event.relatedTarget) return;
      pointer.active = false;
      wake();
    };
    const onFocusIn = (event: FocusEvent) => {
      if (!(event.target instanceof Element) || !event.target.matches(":focus-visible")) return;
      focus = event.target;
      wake();
    };
    const onFocusOut = (event: FocusEvent) => {
      if (root.contains(event.relatedTarget as Node | null)) return;
      focus = null;
      wake();
    };
    const onScroll = () => {
      if (pointer.active || state.presence > 0) wake();
    };

    // A hidden tab drops the light at once (no frames while hidden); it comes back only with the next pointer move or focus.
    const onVisibility = () => {
      if (!document.hidden) return;
      cancelAnimationFrame(raf);
      raf = 0;
      pointer.active = false;
      focus = null;
      state.presence = 0;
      paint();
    };

    const observer = new IntersectionObserver((entries) => {
      state.visible = entries.some((entry) => entry.isIntersecting);
      if (state.visible) wake();
    });
    observer.observe(root);
    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("scroll", onScroll, { capture: true, passive: true });
    document.addEventListener("pointerout", onOut);
    root.addEventListener("focusin", onFocusIn);
    root.addEventListener("focusout", onFocusOut);
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      alive = false;
      cancelAnimationFrame(raf);
      observer.disconnect();
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("scroll", onScroll, { capture: true });
      document.removeEventListener("pointerout", onOut);
      root.removeEventListener("focusin", onFocusIn);
      root.removeEventListener("focusout", onFocusOut);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  return (
    <Component
      ref={rootRef as React.Ref<never>}
      className={className ? `${ROOT} ${className}` : ROOT}
      {...rest}
    >
      <span ref={lightRef} className="pointer-events-none absolute inset-0 -z-10 rounded-[inherit] opacity-0 print:hidden" style={NO_MARGIN} aria-hidden="true" />
      {children}
      {border && <span className={BASE_RING} style={NO_MARGIN} aria-hidden="true" />}
      <span ref={edgeRef} className={EDGE_RING} style={NO_MARGIN} aria-hidden="true" />
    </Component>
  );
}
