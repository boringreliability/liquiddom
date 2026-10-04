/**
 * @vitest-environment jsdom
 * W66: several facade instances on one page. The real-WASM race is covered by
 * W64 multi-instance-wasm.test.ts and W65 e2e/multi-instance.spec.ts.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { LiquidDOM } from "../src/index";
import { createManualClock } from "../src/clock";
import { STYLE_ELEMENT_ID } from "../src/stylesheet";
import { addLiquid, freedOf, instanceTracker, resetDom, setupFacadeTestEnv, spyBackend, ticksOf } from "./_facade-helpers";

const tracker = instanceTracker();
beforeEach(() => {
  resetDom();
  setupFacadeTestEnv();
});
afterEach(() => tracker.destroyAll());

describe("W66: multi-instance facade", () => {
  it("given_two_instances_created_in_one_task_when_resolved_then_two_canvases_two_cores_one_stylesheet", async () => {
    const sb = spyBackend();
    const [a, b] = await Promise.all([
      LiquidDOM.create({ testBackend: sb.backend, autoObserve: false, particles: 1024, maxElements: 4 }),
      LiquidDOM.create({ testBackend: sb.backend, autoObserve: false, particles: 2048, maxElements: 8 }),
    ]);
    tracker.track(a);
    tracker.track(b);
    expect(sb.cores).toHaveLength(2);
    expect(document.querySelectorAll("canvas.liquid-canvas")).toHaveLength(2);
    expect(document.querySelectorAll(`#${STYLE_ELEMENT_ID}`)).toHaveLength(1);
    expect([a.elementCapacity, b.elementCapacity]).toEqual([4, 8]);
    expect([a.particleCapacity, b.particleCapacity]).toEqual([1024, 2048]);
  });

  it("given_two_instances_when_one_destroyed_then_other_keeps_ticking", async () => {
    const sb = spyBackend();
    const clock = createManualClock();
    const a = tracker.track(await LiquidDOM.create({ testBackend: sb.backend, clock, autoObserve: false, particles: 1024, maxElements: 4 }));
    const b = tracker.track(await LiquidDOM.create({ testBackend: sb.backend, clock, autoObserve: false, particles: 1024, maxElements: 4 }));
    const [coreA, coreB] = sb.cores;
    clock.advance(2);
    a.destroy();
    const aTicks = ticksOf(sb, coreA).length;
    const bTicks = ticksOf(sb, coreB).length;
    clock.advance(3);
    expect(ticksOf(sb, coreA)).toHaveLength(aTicks);
    expect(ticksOf(sb, coreB)).toHaveLength(bTicks + 3);
    expect(b.isPaused).toBe(false);
  });

  it("given_two_instances_when_destroyed_in_either_order_twice_then_idempotent_and_stylesheet_removed_after_last", async () => {
    for (const order of [[0, 1], [1, 0]] as const) {
      resetDom();
      const sb = spyBackend();
      const el = addLiquid("button", [0, 0, 100, 40]);
      const insts = [
        await LiquidDOM.create({ testBackend: sb.backend, particles: 1024, maxElements: 4 }),
        await LiquidDOM.create({ testBackend: sb.backend, autoObserve: false, particles: 1024, maxElements: 4 }),
      ];
      insts[order[0]]!.destroy();
      expect(document.getElementById(STYLE_ELEMENT_ID)).not.toBeNull();
      insts[order[1]]!.destroy();
      for (const i of insts) expect(() => i.destroy()).not.toThrow();
      expect(document.getElementById(STYLE_ELEMENT_ID)).toBeNull();
      expect(document.querySelector("canvas")).toBeNull();
      expect(freedOf(sb)).toHaveLength(2);
      expect(el.classList.contains("liquid-element")).toBe(false);
    }
  });
});
