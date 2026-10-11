/**
 * @vitest-environment jsdom
 * W78 (D78-1): the Canvas2D drag label (away-toggle.ts), W74/W75's toggle pattern: liquid-away is
 * on while the element is dragged under Canvas2D, kept after the release until restAlpha is 1,
 * never under WebGPU or reduced motion; refcounted across instances; written only on change; an
 * element it holds gets no halo.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { clearAwayClasses, releaseAwayClass, syncAwayClasses, wantsAway } from "../src/away-toggle";
import { clearHaloClasses, syncHaloClasses } from "../src/halo-toggle";
import { addAwayClass, AWAY_CLASS, HALO_CLASS, removeAwayClass } from "../src/stylesheet";

let a: HTMLElement;
let b: HTMLElement;
beforeEach(() => {
  document.body.replaceChildren();
  a = document.body.appendChild(document.createElement("button"));
  b = document.body.appendChild(document.createElement("div"));
});

const on = (el: HTMLElement): boolean => el.classList.contains(AWAY_CLASS);

function classWrites(el: HTMLElement, run: () => void): number {
  const mo = new MutationObserver(() => {});
  mo.observe(el, { attributes: true, attributeFilter: ["class"] });
  run();
  const n = mo.takeRecords().length;
  mo.disconnect();
  return n;
}

describe("W78: syncAwayClasses (D78-1)", () => {
  it("given_canvas2d_and_a_dragged_element_when_synced_then_liquid_away_once_kept_after_release_while_restAlpha_below_1_and_removed_at_rest", () => {
    const held = new Set<HTMLElement>();
    const alpha = new Map([[0, 1], [1, 1]]);
    const entries = [{ id: 0, el: a }, { id: 1, el: b }];
    let dragged: HTMLElement | null = a;
    const sync = (): void =>
      syncAwayClasses({ entries, restAlpha: (id) => alpha.get(id) ?? 1, dragged, activeRenderer: "canvas2d", reducedMotion: false, held });
    const writes = classWrites(a, () => {
      sync(); // the drag starts while restAlpha is still 1
      alpha.set(0, 0);
      for (let f = 0; f < 4; f++) sync();
    });
    expect(writes, "one class write for five dragged frames").toBe(1);
    expect(on(a)).toBe(true);
    expect(on(b), "never dragged").toBe(false);
    dragged = null; // released: the liquid crawls home
    sync();
    expect(on(a), "kept until rest").toBe(true);
    alpha.set(0, 1);
    sync();
    expect(on(a), "at rest").toBe(false);
    expect(held.size).toBe(0);
    expect(wantsAway("canvas2d", false, false, false, 0.2), "moving but never dragged: no").toBe(false);
  });

  it("given_webgpu_reduced_motion_or_nan_when_synced_then_no_liquid_away_and_an_existing_hold_is_withdrawn", () => {
    expect(wantsAway("webgpu", false, true, false, 0)).toBe(false);
    expect(wantsAway("canvas2d", true, true, false, 0)).toBe(false);
    expect(wantsAway("canvas2d", false, false, true, Number.NaN), "NaN counts as at rest (the DOM label shows)").toBe(false);
    const held = new Set<HTMLElement>();
    const entries = [{ id: 0, el: a }];
    const sync = (activeRenderer: "canvas2d" | "webgpu", reducedMotion: boolean): void =>
      syncAwayClasses({ entries, restAlpha: () => 0, dragged: a, activeRenderer, reducedMotion, held });
    sync("canvas2d", false);
    expect(on(a)).toBe(true);
    sync("webgpu", false);
    expect(on(a), "WebGPU carries the label on the liquid").toBe(false);
    sync("canvas2d", false);
    sync("canvas2d", true);
    expect(on(a), "reduced motion").toBe(false);
    expect(held.size).toBe(0);
  });

  it("given_two_instances_holding_one_element_when_one_releases_then_liquid_away_stays_until_both_release_and_an_authors_own_class_is_kept", () => {
    const one = new Set<HTMLElement>();
    const two = new Set<HTMLElement>();
    const entries = [{ id: 0, el: a }];
    for (const held of [one, two]) {
      syncAwayClasses({ entries, restAlpha: () => 0, dragged: a, activeRenderer: "canvas2d", reducedMotion: false, held });
    }
    releaseAwayClass(one, a);
    expect(on(a), "the other instance still holds").toBe(true);
    releaseAwayClass(two, a);
    expect(on(a)).toBe(false);
    b.classList.add(AWAY_CLASS); // the author's own class
    addAwayClass(b);
    removeAwayClass(b);
    expect(on(b), "an author's own class is never removed").toBe(true);
  });

  it("given_clearAwayClasses_or_a_missed_release_when_called_then_this_instance_lets_go", () => {
    const mine = new Set<HTMLElement>();
    const sync = (entries: Array<{ id: number; el: HTMLElement }>): void =>
      syncAwayClasses({ entries, restAlpha: () => 0.5, dragged: null, activeRenderer: "canvas2d", reducedMotion: false, held: mine });
    // Both were dragged and released; their liquid still crawls home (restAlpha 0.5).
    mine.add(a);
    addAwayClass(a);
    mine.add(b);
    addAwayClass(b);
    sync([{ id: 0, el: a }, { id: 1, el: b }]);
    expect([on(a), on(b)], "held after the release while moving").toEqual([true, true]);
    sync([{ id: 0, el: a }]); // b is no longer observed by this instance (a missed release)
    expect(on(b)).toBe(false);
    clearAwayClasses(mine); // a failed frame, reduced motion, destroy
    expect(on(a)).toBe(false);
    expect(mine.size).toBe(0);
    releaseAwayClass(mine, a); // no hold left: no-op
    expect(on(a)).toBe(false);
  });

  it("given_an_element_held_by_liquid_away_when_the_halo_syncs_with_it_suppressed_then_it_gets_no_halo_and_an_unsuppressed_one_does", () => {
    const halo = new Set<HTMLElement>();
    syncHaloClasses({
      entries: [{ id: 0, el: a }, { id: 1, el: b }],
      restAlpha: () => 0.3,
      activeRenderer: "canvas2d",
      reducedMotion: false,
      held: halo,
      suppressed: new Set([a]),
    });
    expect(a.classList.contains(HALO_CLASS), "a halo around hidden glyphs is never drawn").toBe(false);
    expect(b.classList.contains(HALO_CLASS)).toBe(true);
    syncHaloClasses({
      entries: [{ id: 1, el: b }],
      restAlpha: () => 0.3,
      activeRenderer: "canvas2d",
      reducedMotion: false,
      held: halo,
      suppressed: new Set([b]),
    });
    expect(b.classList.contains(HALO_CLASS), "suppression withdraws an existing hold").toBe(false);
    clearHaloClasses(halo);
  });
});
