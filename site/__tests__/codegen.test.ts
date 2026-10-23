import { describe, it, expect } from "vitest";
import { toCode } from "../src/playground/codegen";
import type { PlaygroundState } from "../src/playground/state";

const base: PlaygroundState = {
  schema: 3,
  material: { viscosity: 0.9, cohesion: 0.7, recovery: 0.8 },
  init: { particles: 8000, seed: 7, renderer: "auto", forceReducedMotion: false },
  gravity: { source: "fixed", angle: 90, strength: 980 },
  dragOff: ["pill-b"],
};

describe("W86: Copy as code (D86-5)", () => {
  it("given_a_state_when_generated_then_the_exact_create_and_observe_code", () => {
    expect(toCode(base)).toBe(
      [
        `import { LiquidDOM } from "liquiddom";`,
        ``,
        `const liquid = await LiquidDOM.create({`,
        `  particles: 8000,`,
        `  seed: 7,`,
        `  renderer: "auto",`,
        `  material: { viscosity: 0.9, cohesion: 0.7, recovery: 0.8 },`,
        `  gravity: { source: "fixed", vector: [1, 0], strength: 980 },`,
        `});`,
        `liquid.observe(document.querySelector("#pill-b"), { drag: false });`,
        `for (const el of document.querySelectorAll("[data-liquid]")) liquid.observe(el);`,
        ``,
      ].join("\n"),
    );
  });

  it("given_states_across_every_gravity_source_when_generated_then_the_code_parses", () => {
    const variants: PlaygroundState[] = [
      { ...base, gravity: { source: "none", angle: 0, strength: 980 }, dragOff: [] },
      { ...base, gravity: { source: "fixed", angle: 33.3333, strength: 120 } },
      { ...base, gravity: { source: "orientation", angle: 0, strength: 980 }, init: { ...base.init, forceReducedMotion: true, renderer: "canvas2d" } },
    ];
    for (const s of variants) {
      const body = toCode(s).replace(/^import .*\n/, "");
      expect(() => new Function("LiquidDOM", "document", `return (async () => {\n${body}\n})`)).not.toThrow();
    }
    expect(toCode(variants[0])).not.toContain("gravity");
    expect(toCode(variants[1])).toContain("vector: [0.55, 0.835]");
    expect(toCode(variants[2])).toContain(`gravity: { source: "orientation", strength: 980 },`);
    expect(toCode(variants[2])).toContain(`  forceReducedMotion: true,`);
  });
});
