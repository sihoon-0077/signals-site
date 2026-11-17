# Third-party notices

This file lists third-party source code that is copied or adapted into the SIGNALS website.
Packages installed from npm keep their own license files in `node_modules` and are not repeated here.

## React Bits

- Project: React Bits — https://reactbits.dev — https://github.com/DavidHDev/react-bits
- Version used: `main` at commit `d01aa914dcbe76da8b2923ebf872b5c8b1066e4c` (2026-11-16), TypeScript + Tailwind variants
- Use: only as part of the SIGNALS website. The components are not sold, sublicensed or redistributed on their own,
  and they are not included in the public anchor repository template (`deploy/anchors-repo`).
- Adapted files:
  - `src/components/effects/spotlight-card.tsx` — from `SpotlightCard` (Components), adapted
  - `src/components/effects/hash-settle.tsx` — idea from `DecryptedText` (TextAnimations), rewritten
  - `src/components/effects/shape-grid.tsx` — `ShapeGrid` (Backgrounds), original with SIGNALS patches
  - `src/components/effects/ledger-grid.tsx` — SIGNALS settings for `ShapeGrid`
  - `src/components/effects/grain.tsx` — static subset of `Noise` (Animations)
  - `src/components/effects/seal-mark.tsx` — idea from `StatusMark` (Micro), rewritten as CSS
  - `src/app/globals.css` (section "effects") — SealMark and Reveal keyframes; Reveal idea from `FadeContent` (Animations)

### License (verbatim)

MIT + Commons Clause License Condition v1.0

Copyright (c) 2026 David Haz

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, and distribute the Software **as part of an application, website, or product**, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

## Commons Clause Restriction

You may use this Software, including for any commercial purpose, **so long as you do not sell, sublicense, or redistribute the components themselves-whether alone, in a bundle, or as a ported version.**

The same restriction covers the React Bits tools (Background Studio, Texture Lab, Shape Magic, Center Stage, Sound Lab and any tools added later) and the sounds in the sound library. **You may not sell, sublicense, or redistribute the tools or the sounds themselves, or offer the tools or a substantially similar copy of them as a hosted service-whether alone, in a bundle, or as a ported version.**

What you make with the tools is yours to use. You can use exported code, images, videos, and audio files in any personal or commercial application, website, or product, including paid ones. **You may not sell or redistribute the exports on their own, either individually or as the product itself, such as a sound, texture, background, or template pack.**

## No Warranty

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
