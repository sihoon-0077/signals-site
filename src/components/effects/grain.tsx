"use client";
/*!
 * SIGNALS Grain — adapted from React Bits "Noise" (https://reactbits.dev, https://github.com/DavidHDev/react-bits @ d01aa914)
 * Copyright (c) 2026 David Haz. Licensed under the MIT + Commons Clause License Condition v1.0; full text in THIRD_PARTY_NOTICES.md.
 * Used only as part of the SIGNALS website. Not sold, sublicensed or redistributed as a component.
 * SIGNALS changes: static only (the original's fps=0 path): one seeded 256x256 tile painted once, no animation loop, no dust/scratches/scanlines/flicker.
 */
import { useEffect, useRef } from "react";
import { createTileCache } from "./tile-cache";

const TILE = 256;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

// Plain string literal so Tailwind's scanner always sees every class (a class touching `${` in a template can be missed).
const LAYER = "pointer-events-none absolute inset-0 bg-repeat [image-rendering:pixelated] print:hidden";

// Seeded generator from the original: the same grain on every visit (no shimmer between page loads).
const generator = (seed: number) => {
  let state = seed >>> 0 || 1;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const paintTile = (contrast: number) => {
  const canvas = document.createElement("canvas");
  canvas.width = TILE;
  canvas.height = TILE;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  const image = ctx.createImageData(TILE, TILE);
  const data = image.data;
  const random = generator(1013904223);
  const range = 0.5 + contrast * 1.1;
  for (let i = 0; i < data.length; i += 4) {
    const value = clamp(0.5 + (random() + random() - 1) * range, 0, 1) * 255;
    data[i] = data[i + 1] = data[i + 2] = value;
    data[i + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);
  return canvas;
};

// One tile per contrast for the whole page. The home page has three grain layers; each used to paint and PNG-encode the
// same 256×256 noise and keep its own copy (256 KiB of decoded RGBA plus a PNG blob per layer). Layers now share one object URL
// through tile-cache.ts, which counts users, drops the entry as soon as the last layer leaves (so React StrictMode's dev re-mount
// gets a fresh tile, never a revoked URL) and revokes the URL once its encode has finished.
// The promise always settles: null when the canvas, the PNG encode or painting fails (the layer then just stays empty).
const paintTileUrl = (contrast: number) =>
  new Promise<string | null>((resolve) => {
    try {
      const canvas = paintTile(contrast);
      if (!canvas) return resolve(null);
      canvas.toBlob((blob) => resolve(blob ? URL.createObjectURL(blob) : null));
    } catch {
      resolve(null); // decoration only: a failure leaves the layer empty instead of an unhandled rejection
    }
  });

const tiles = createTileCache(paintTileUrl, (url) => URL.revokeObjectURL(url));

/**
 * Static film grain over its positioned parent (parent needs `relative isolate overflow-hidden`).
 * opacity 0.04–0.06 on #0B0D10 surfaces; size 0.5 → 128 CSS px tile = 1 device px per grain on 2× screens.
 */
export function Grain({
  opacity = 0.05,
  size = 0.5,
  contrast = 0.5,
  blendMode = "soft-light",
  className = "",
}: {
  opacity?: number;
  size?: number;
  contrast?: number;
  blendMode?: "overlay" | "soft-light" | "normal";
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    let alive = true;
    const key = clamp(contrast, 0, 1);
    const tile = tiles.acquire(key);
    void tile.url.then((url) => {
      if (alive && url) el.style.backgroundImage = `url("${url}")`;
    });
    return () => {
      alive = false;
      tiles.release(key, tile);
    };
  }, [contrast]);

  return (
    <div
      ref={ref}
      aria-hidden="true"
      className={className ? `${LAYER} ${className}` : LAYER}
      // margin 0: an absolute layer inside a `space-y-*` parent would otherwise get a margin and stop short of the edge
      style={{ margin: 0, opacity: clamp(opacity, 0, 1), mixBlendMode: blendMode, backgroundSize: `${TILE * size}px ${TILE * size}px` }}
    />
  );
}
