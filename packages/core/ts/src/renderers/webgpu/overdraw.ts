/**
 * W72 (D72-4): splat overdraw estimate, logged and never gated. The splat pass draws one
 * quad of side 2·R per particle of every element with restAlpha < 1 (D71-6: resting
 * elements are the SDF overlay), at the T0 render scale. Fragments ≈ Σ particles ×
 * (2·R·dpr·t0Scale)². An upper bound: quads clipped at the canvas edge still count.
 * Not a GPU counter: SwiftShader has no timestamp queries, and pipeline statistics are
 * not in WebGPU core.
 */
import { St, STATE_STRIDE } from "../../fluid-layout";
import type { RenderFrame } from "../frame";
import { kernelRadiusPx } from "../kernel-params";

export function estimateSplatFragments(frame: RenderFrame, t0Scale: number): number {
  if (!(frame.activeParticles > 0) || !(Number.isFinite(t0Scale) && t0Scale > 0)) return 0;
  const dpr = Number.isFinite(frame.viewport.dpr) && frame.viewport.dpr > 0 ? frame.viewport.dpr : 1;
  const scale = dpr * t0Scale;
  let total = 0;
  const paints = frame.paints;
  for (let id = 0; id < paints.length; id++) {
    const p = paints[id];
    if (p === undefined || !(p.particleCount > 0)) continue;
    const restAlpha = frame.stateView[id * STATE_STRIDE + St.REST_ALPHA];
    if (!(restAlpha < 1)) continue; // at rest (or unknown): drawn by the SDF overlay, not splatted
    const side = 2 * kernelRadiusPx(p.spacingPx) * scale;
    total += p.particleCount * side * side;
  }
  return Math.round(total);
}
