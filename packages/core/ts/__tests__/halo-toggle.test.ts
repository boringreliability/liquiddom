/**
 * @vitest-environment jsdom
 * W75 (D75-3): the Canvas2D halo is held per instance and frame (W74's text-toggle pattern): on
 * while the element moves (restAlpha < 1) under Canvas2D without reduced motion, off otherwise.
 * Writes only on change; a held element that is no longer observed is released.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { clearHaloClasses, releaseHaloClass, syncHaloClasses, wantsHalo } from "../src/halo-toggle";
import { addHaloClass, HALO_CLASS } from "../src/stylesheet";

let a: HTMLElement;
let b: HTMLElement;
beforeEach(() => {
  document.body.replaceChildren();
  a = document.body.appendChild(document.createElement("button"));
  b = document.body.appendChild(document.createElement("div"));
});

function classWrites(el: HTMLElement, run: () => void): number {
  const mo = new MutationObserver(() => {});
  mo.observe(el, { attributes: true, attributeFilter: ["class"] });
  run();
  const n = mo.takeRecords().length;
  mo.disconnect();
  return n;
}

describe("W75: syncHaloClasses (D75-3)", () => {
  it("given_canvas2d_and_restAlpha_below_1_when_synced_then_liquid_halo_once_and_removed_at_rest", () => {
    const held = new Set<HTMLElement>();
    const alpha = new Map([[0, 0.4], [1, 1]]);
    const entries = [{ id: 0, el: a }, { id: 1, el: b }];
    const sync = (): void =>
      syncHaloClasses({ entries, restAlpha: (id) => alpha.get(id) ?? 1, activeRenderer: "canvas2d", reducedMotion: false, held });
    const writes = classWrites(a, () => {
      for (let f = 0; f < 5; f++) sync();
    });
    expect(writes, "one class write for five moving frames").toBe(1);
    expect(a.classList.contains(HALO_CLASS)).toBe(true);
    expect(b.classList.contains(HALO_CLASS)).toBe(false);
    expect([...held]).toEqual([a]);
    alpha.set(0, 1);
    sync();
    expect(a.classList.contains(HALO_CLASS)).toBe(false);
    expect(held.size).toBe(0);
    expect(wantsHalo("canvas2d", false, 0.99)).toBe(true);
    expect(wantsHalo("canvas2d", false, 1)).toBe(false);
  });

  it("given_webgpu_or_reduced_motion_or_nan_when_synced_then_no_halo_and_an_existing_vote_is_withdrawn", () => {
    expect(wantsHalo("webgpu", false, 0.2)).toBe(false);
    expect(wantsHalo("canvas2d", true, 0.2)).toBe(false);
    expect(wantsHalo("canvas2d", false, Number.NaN)).toBe(false);
    const held = new Set<HTMLElement>();
    const entries = [{ id: 0, el: a }];
    syncHaloClasses({ entries, restAlpha: () => 0.3, activeRenderer: "canvas2d", reducedMotion: false, held });
    expect(a.classList.contains(HALO_CLASS)).toBe(true);
    syncHaloClasses({ entries, restAlpha: () => 0.3, activeRenderer: "webgpu", reducedMotion: false, held });
    expect(a.classList.contains(HALO_CLASS)).toBe(false);
    syncHaloClasses({ entries, restAlpha: () => 0.3, activeRenderer: "canvas2d", reducedMotion: true, held });
    expect(a.classList.contains(HALO_CLASS)).toBe(false);
    expect(held.size).toBe(0);
  });

  it("given_clearHaloClasses_releaseHaloClass_or_a_missed_release_when_called_then_this_instance_lets_go_and_others_keep_their_hold", () => {
    const mine = new Set<HTMLElement>();
    const sync = (entries: Array<{ id: number; el: HTMLElement }>): void =>
      syncHaloClasses({ entries, restAlpha: () => 0.5, activeRenderer: "canvas2d", reducedMotion: false, held: mine });
    sync([{ id: 0, el: a }, { id: 1, el: b }]);
    addHaloClass(b); // another instance's hold on the shared element b
    clearHaloClasses(mine);
    expect(mine.size).toBe(0);
    expect(a.classList.contains(HALO_CLASS)).toBe(false);
    expect(b.classList.contains(HALO_CLASS), "the other instance still holds").toBe(true);
    sync([{ id: 0, el: a }]);
    releaseHaloClass(mine, a); // unobserve
    releaseHaloClass(mine, a); // no hold left: no-op
    expect(a.classList.contains(HALO_CLASS)).toBe(false);
    sync([{ id: 0, el: a }]);
    sync([]); // a is no longer observed by this instance (a missed release): W74's sweep rule
    expect(a.classList.contains(HALO_CLASS)).toBe(false);
    expect(mine.size).toBe(0);
  });
});
