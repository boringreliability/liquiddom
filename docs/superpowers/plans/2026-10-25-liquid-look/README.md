# liquiddom Epic 16 (Liquid look): implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking. **Every ward also follows WDD / GS-TDD:** direction gate (all `Decision:` lines approved) → failing tests → `wdd ward status NN red` → STOP for Dennis' "godkendt" → implement → green → ward review → `wdd ward status NN gold` → STOP. AI never decides on its own that a ward is complete; after Dennis approves gold, AI may run `wdd complete` (or apply the approved manual transition when the harness blocks it).

**Goal:** renderer work on top of the finished fluid engine (Epic 15). The first ward is W88: an observed element keeps its own CSS `box-shadow`, and the shadow follows the liquid while it splashes, sloshes, drags and merges.

**Architecture:** the hybrid model of the shadows design. At rest the browser draws the author's `box-shadow`. While an element's liquid is away, a refcounted class `liquid-shadow-away` hides it, and the renderer draws the outer layers from the liquid's shape, under all liquid. Rust and the FFI are untouched.

**Tech stack:** TypeScript (strict), Canvas2D, WebGPU/WGSL, Vitest 4 (jsdom, fake canvas, fake GPU), Playwright 1.63.0 (canvas2d blocking in CI; WebGPU local on Metal), Astro 7 (site).

**Spec:** [`2026-10-24-liquiddom-shadows-design.md`](../../specs/2026-10-24-liquiddom-shadows-design.md) (approved by Dennis 2026-10-25; brainstorm saga dec_c7b5f5d4, dec_1b99e860). It is binding for this plan. The engine's binding design [`2026-10-02-liquiddom-fluid-design.md`](../../specs/2026-10-02-liquiddom-fluid-design.md) still holds. Acceptance scene and matrix: `.wdd/NORTH-STAR.md`, which is unchanged by this epic.

## Wards

| Ward | File | Content |
|---|---|---|
| W88 | [W88.md](W88.md) | **Shadows follow the liquid.** Part 1 = W88.0: the epic file, the ward file, the baseline, spike W88.0 (Q1 Canvas2D mask cost, Q2 WebGPU blur and buckets, Q3 the handoff), and the D88 gate. Part 2 = W88.1 red … gold, written after the gate. |

**Order:** W88.0 → D88 direction gate → part 2 of W88.md → Dennis reviews part 2 → W88.1 red. Later wards of the epic are planned after W88 gold.

**Human prerequisites:** the D88 gate; Dennis approves red ("godkendt") and gold; a Mac with Metal for `e2e:webgpu-hw`. No Linux baseline is expected to move (spec §7); if one does, it needs Dennis' vision approval (D65-7) and Docker.

## Global Constraints

- **Unchanged contracts:** FFI layout and strides, the 7-arg constructor, every Rust file under `src/`, every public API (no new option or method: spec §1), every acceptance step and Linux baseline.
- **Rule of Two:** rendering never touches the DOM; the runtime owns every class write. Rust stays colour-blind.
- **Stylesheet:** every new rule sits in `@layer liquiddom` and `@media screen and (forced-colors: none)`, so print and forced colours show the element's own shadow.
- **Process:** commit by path, never `git add -A`; `git add` and `git commit -F <message file>` as separate commands, message files in the session scratchpad. Trailers `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` and `Claude-Session: https://claude.ai/code/session_01JWKWkrzUtppUzFBpDS954E`. No pushes or merges without asking. Ward status only via `wdd ward status 88 …`; ward files are hand-created flat (D63-1). One changeset per ward (`minor`, pre mode alpha).
- **Live scenes:** RAF by default; `?clock=manual` only for e2e.
- **Questions to Dennis** are laid out in full in the chat, never as a pointer into a file.
