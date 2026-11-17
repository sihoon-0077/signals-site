"use client";
/*!
 * SIGNALS HashSettle — adapted from React Bits "DecryptedText" (https://reactbits.dev, https://github.com/DavidHDev/react-bits @ d01aa914)
 * Copyright (c) 2026 David Haz. Licensed under the MIT + Commons Clause License Condition v1.0; full text in THIRD_PARTY_NOTICES.md.
 * Used only as part of the SIGNALS website. Not sold, sublicensed or redistributed as a component.
 * SIGNALS changes: rewritten — no motion/react, no per-letter spans, hex-only glyphs, plays at most once, the server renders the final value, optional hold-until-start with a 1.2 s CSS fallback, finishes at once on a hidden tab, scrambled frames hidden from assistive tech.
 */
import { useCallback, useEffect, useRef, type ComponentPropsWithoutRef, type Ref, type RefObject } from "react";

const HEX_LOWER = "0123456789abcdef";
const HEX_UPPER = "0123456789ABCDEF";

const isHex = (ch: string) => (ch >= "0" && ch <= "9") || (ch >= "a" && ch <= "f") || (ch >= "A" && ch <= "F");

/**
 * One frame: the first `settled` characters are final, the rest are random hex glyphs.
 * Hex stays hex in the value's own case (an all-uppercase ID gets uppercase digits-and-letters); anything else
 * ('…', ' ', ':', '-') is never touched, so the length and the separators never move (no layout shift in a monospace font).
 * Pure function (rand is injected) so it can be unit-tested.
 */
export function settleFrame(finalText: string, settled: number, rand: () => number): string {
  const pool = /[A-F]/.test(finalText) && !/[a-f]/.test(finalText) ? HEX_UPPER : HEX_LOWER;
  let out = "";
  for (let i = 0; i < finalText.length; i++) {
    const ch = finalText[i];
    out += i >= settled && isHex(ch) ? pool[Math.min(pool.length - 1, Math.floor(rand() * pool.length))] : ch;
  }
  return out;
}

/**
 * If the value first becomes visible later than this (counted from `since`), skip the effect and just show the value.
 * Kept below the 1.2 s CSS fallback of data-settle="hold" (globals.css) so JS and CSS never fight over the same frame.
 */
export const SKIP_IF_LATE_MS = 1000;

type Props = Omit<ComponentPropsWithoutRef<"code">, "children"> & {
  value: string;
  /** Whole settle duration. Keep it short: this is a confirmation, not a show. */
  durationMs?: number;
  delayMs?: number;
  /** Turn the effect off without changing markup (e.g. verify page when the hash check is not PASS). */
  disabled?: boolean;
  /**
   * Render data-settle="hold": CSS keeps the value invisible until the settle starts (no final → scrambled flash),
   * reveals it by itself after 1.2 s if JS never starts, and never hides it under prefers-reduced-motion.
   */
  holdUntilStart?: boolean;
  /**
   * Clock for the "late" check. "navigation": server-rendered, above the fold (counted from page load; a slow hydration skips
   * the effect). "mount": content that appears after client work, e.g. a verify result (counted from when this element mounted).
   */
  since?: "navigation" | "mount";
  /** Forwarded to the <code> element (HashText selects its text when automatic copy is blocked). */
  ref?: Ref<HTMLElement>;
};

/**
 * Renders <code>{value}</code> like a plain code element (SSR, tests and no-JS see the real value).
 * After hydration, once the element is at least 60% visible, the glyphs settle left → right into the same value, once.
 * The animation writes the existing text node's nodeValue (no React state per frame, no extra DOM nodes) and always ends on `value`.
 */
export function HashSettle({
  value,
  durationMs = 600,
  delayMs = 0,
  disabled = false,
  holdUntilStart = false,
  since = "navigation",
  ref,
  ...rest
}: Props) {
  const own = useRef<HTMLElement | null>(null);
  // At most once per mount: a later value change (HashText expanding the full value) must not scramble again.
  const played = useRef(false);
  const setRef = useCallback(
    (el: HTMLElement | null) => {
      own.current = el;
      if (typeof ref === "function") ref(el);
      else if (ref) (ref as RefObject<HTMLElement | null>).current = el;
    },
    [ref],
  );

  useEffect(() => {
    const el = own.current;
    if (!el) return;
    const release = () => el.removeAttribute("data-settle");
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    if (disabled || played.current || reduce || document.hidden || typeof IntersectionObserver === "undefined") {
      if (!disabled) played.current = true;
      release();
      return;
    }

    const origin = since === "mount" ? performance.now() : 0;
    let raf = 0;
    let timer = 0;
    let start = 0;
    let lastKey = "";
    let lastWritten: string | null = null;
    // Scrambled frames are noise to assistive tech, and inside an aria-live region (the verify result) every text-node write
    // could be announced. Hide the element while they are on screen; expose it again only with the final value, so it is read once.
    // Only an aria-hidden this effect added is removed (never one passed in by the caller).
    let hidByUs = false;
    const hide = () => {
      if (el.hasAttribute("aria-hidden")) return;
      el.setAttribute("aria-hidden", "true");
      hidByUs = true;
    };
    const unhide = () => {
      if (!hidByUs) return;
      el.removeAttribute("aria-hidden");
      hidByUs = false;
    };
    const write = (text: string) => {
      // Re-read firstChild every time: React replaces the text node when `value` changes.
      const node = el.firstChild;
      if (node && node.nodeType === Node.TEXT_NODE && node.nodeValue !== text) node.nodeValue = text;
      lastWritten = text;
    };
    const finish = () => {
      window.clearTimeout(timer);
      cancelAnimationFrame(raf);
      raf = 0;
      write(value);
      unhide();
      release();
    };
    const frame = (now: number) => {
      if (!start) start = now;
      const t = Math.min(1, (now - start) / durationMs);
      if (t >= 1) {
        write(value);
        unhide();
        raf = 0;
        return;
      }
      const eased = 1 - (1 - t) ** 3; // ease-out: most characters settle early, the tail resolves calmly
      const settled = Math.floor(eased * value.length);
      const tick = Math.floor((now - start) / 50); // re-roll the unsettled glyphs ~20×/s, not every frame (calmer, cheaper)
      const key = `${settled}:${tick}`;
      if (key !== lastKey) {
        lastKey = key;
        write(settleFrame(value, settled, Math.random));
      }
      raf = requestAnimationFrame(frame);
    };
    const begin = () => {
      played.current = true;
      timer = window.setTimeout(() => {
        hide(); // before the first scrambled write, so no random frame ever reaches the accessibility tree
        write(settleFrame(value, 0, Math.random)); // first scrambled frame is in place before the value becomes visible
        release();
        raf = requestAnimationFrame(frame);
      }, delayMs);
    };
    const onVisibility = () => {
      if (document.hidden) finish();
    };

    const io = new IntersectionObserver(
      (entries) => {
        // The first callback always arrives, with isIntersecting=true for any overlap at all (the threshold only decides when
        // later callbacks fire), so check the ratio too: start only once at least 60% is on screen, as documented above.
        if (!entries.some((e) => e.isIntersecting && e.intersectionRatio >= 0.6)) return;
        io.disconnect();
        if (performance.now() - origin > SKIP_IF_LATE_MS) {
          played.current = true;
          release();
        } else begin();
      },
      { threshold: 0.6 },
    );
    io.observe(el);
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      io.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      window.clearTimeout(timer);
      cancelAnimationFrame(raf);
      // Put back only a scrambled frame we wrote ourselves. When `value` changed, React has already written the new text
      // before this cleanup runs; writing the old `value` here would show stale content.
      const node = el.firstChild;
      if (lastWritten !== null && lastWritten !== value && node && node.nodeValue === lastWritten) node.nodeValue = value;
      unhide();
      // Keep the hold if the settle never started: the next run can still play it, and the CSS fallback reveals the value at 1.2 s.
      // (Releasing here showed final → scrambled → final when the effect re-ran before playing, e.g. React StrictMode in dev.)
      if (played.current) release();
    };
  }, [value, durationMs, delayMs, disabled, since]);

  return (
    <code ref={setRef} data-settle={holdUntilStart && !disabled ? "hold" : undefined} {...rest}>
      {value}
    </code>
  );
}
