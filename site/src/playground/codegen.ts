/**
 * Ward 086 (D86-5): "Copy as code". Turns the playground's state into the
 * `LiquidDOM.create()` and `observe()` calls that reproduce it on a page.
 */
import { dialVector } from "../lib/dial";
import type { PlaygroundState } from "./state";

/** Three decimals at most; `-0` and `6e-17` both print as `0`. */
const num = (n: number) => String(Number(n.toFixed(3)));

/** D86-5 "Copy as code": the create() and observe() calls that reproduce the playground's settings. */
export function toCode(s: PlaygroundState): string {
  const m = s.material;
  const lines = [
    `import { LiquidDOM } from "liquiddom";`,
    ``,
    `const liquid = await LiquidDOM.create({`,
    `  particles: ${s.init.particles},`,
    `  seed: ${s.init.seed},`,
    `  renderer: "${s.init.renderer}",`,
  ];
  if (s.init.forceReducedMotion) lines.push(`  forceReducedMotion: true,`);
  lines.push(`  material: { viscosity: ${num(m.viscosity)}, cohesion: ${num(m.cohesion)}, recovery: ${num(m.recovery)} },`);
  if (s.gravity.source === "fixed") {
    const [x, y] = dialVector(s.gravity.angle);
    lines.push(`  gravity: { source: "fixed", vector: [${num(x)}, ${num(y)}], strength: ${num(s.gravity.strength)} },`);
  } else if (s.gravity.source === "orientation") {
    lines.push(`  gravity: { source: "orientation", strength: ${num(s.gravity.strength)} },`);
  }
  lines.push(`  autoObserve: false,`);
  lines.push(`});`);
  if (s.gravity.source === "orientation") lines.push(`// iOS: call liquid.requestOrientationPermission() from a user gesture first.`);
  for (const id of s.dragOff) lines.push(`liquid.observe(document.querySelector("#${id}"), { drag: false });`);
  lines.push(`for (const el of document.querySelectorAll("[data-liquid]")) liquid.observe(el);`, ``);
  return lines.join("\n");
}
