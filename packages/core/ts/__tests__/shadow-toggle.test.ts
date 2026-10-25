/**
 * @vitest-environment jsdom
 * W88 (D88-1, D88-2; Review Focus 3): the `liquid-shadow-away` toggle (shadow-toggle.ts), the
 * W74/W75/W78 toggle pattern: on while the element's liquid is away and the renderer drew its
 * outer layers this frame (an inset-only element whenever its liquid is away), never under
 * reduced motion or without a renderer; refcounted across instances; written only on change.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { Interaction } from "../src/fluid-layout";
import type { Renderer } from "../src/renderers/frame";
import { parseBoxShadow, type ShadowLayer } from "../src/shadow";
import { clearShadowClasses, releaseShadowClass, syncShadowClasses, wantsShadowAway, type ShadowEntry } from "../src/shadow-toggle";
import { SHADOW_AWAY_CLASS } from "../src/stylesheet";

const DROP: readonly ShadowLayer[] = parseBoxShadow("rgba(0, 0, 0, 0.4) 0px 8px 20px 0px");
const INSET: readonly ShadowLayer[] = parseBoxShadow("rgba(0, 0, 0, 0.4) 0px 2px 6px 0px inset");
const NONE: readonly ShadowLayer[] = [];

let a: HTMLElement;
let b: HTMLElement;
beforeEach(() => {
  document.body.replaceChildren();
  a = document.body.appendChild(document.createElement("button"));
  b = document.body.appendChild(document.createElement("div"));
});

const on = (el: HTMLElement): boolean => el.classList.contains(SHADOW_AWAY_CLASS);

function classWrites(el: HTMLElement, run: () => void): number {
  const mo = new MutationObserver(() => {});
  mo.observe(el, { attributes: true, attributeFilter: ["class"] });
  run();
  const n = mo.takeRecords().length;
  mo.disconnect();
  return n;
}

/** A renderer stand-in: `drawn` holds the slots whose shadows its last render drew. */
function renderer(drawn: Set<number>): Renderer {
  return {
    init: async () => {},
    render: () => {},
    resize: () => {},
    destroy: () => {},
    shadowsDrawn: (id: number) => drawn.has(id),
  };
}

interface Opts {
  entries: ShadowEntry[];
  alpha: Map<number, number>;
  interaction?: Map<number, number>;
  r: Renderer | null;
  reducedMotion?: boolean;
  held: Set<HTMLElement>;
}

function sync(o: Opts): void {
  syncShadowClasses({
    entries: o.entries,
    restAlpha: (id) => o.alpha.get(id) ?? 1,
    interaction: (id) => o.interaction?.get(id) ?? Interaction.IDLE,
    renderer: o.r,
    reducedMotion: o.reducedMotion ?? false,
    held: o.held,
  });
}

describe("W88: syncShadowClasses (D88-1, D88-2)", () => {
  it("given_a_moving_element_whose_outer_shadow_the_renderer_drew_when_synced_then_the_class_once_and_off_in_the_frame_restAlpha_reaches_1", () => {
    const held = new Set<HTMLElement>();
    const alpha = new Map([[0, 0.4], [1, 0.4]]);
    const drawn = new Set([0]);
    const o: Opts = { entries: [{ id: 0, el: a, shadows: DROP }, { id: 1, el: b, shadows: NONE }], alpha, r: renderer(drawn), held };
    const writes = classWrites(a, () => {
      for (let f = 0; f < 5; f++) sync(o);
    });
    expect(writes, "one class write for five moving frames").toBe(1);
    expect(on(a)).toBe(true);
    expect(classWrites(b, () => sync(o)), "an element without a box-shadow costs nothing").toBe(0);
    expect(on(b)).toBe(false);
    alpha.set(0, 1); // D88-7: the instant handoff, in the frame restAlpha reaches 1
    drawn.clear();
    sync(o);
    expect(on(a)).toBe(false);
    expect(held.size).toBe(0);
  });

  it("given_outer_layers_the_renderer_did_not_draw_or_no_renderer_when_synced_then_no_class_and_an_existing_hold_is_withdrawn", () => {
    const held = new Set<HTMLElement>();
    const drawn = new Set([0]);
    const o: Opts = { entries: [{ id: 0, el: a, shadows: DROP }], alpha: new Map([[0, 0.2]]), r: renderer(drawn), held };
    sync(o);
    expect(on(a)).toBe(true);
    drawn.clear(); // e.g. a WebGPU frame that drew nothing (a lost device) or an element past the source cap
    sync(o);
    expect(on(a), "the browser's shadow never hides without the renderer's").toBe(false);
    drawn.add(0);
    sync({ ...o, r: null }); // a device-lost rebuild in flight
    expect(on(a)).toBe(false);
    expect(wantsShadowAway(true, true, DROP, false)).toBe(false);
    expect(wantsShadowAway(true, true, DROP, true)).toBe(true);
    expect(wantsShadowAway(false, true, DROP, true)).toBe(false);
    expect(wantsShadowAway(true, false, DROP, true), "at rest").toBe(false);
  });

  it("given_an_inset_only_element_whose_liquid_is_away_when_synced_then_the_class_hides_the_inset_D88_2", () => {
    const held = new Set<HTMLElement>();
    const alpha = new Map([[0, 0.5]]);
    const o: Opts = { entries: [{ id: 0, el: a, shadows: INSET }], alpha, r: renderer(new Set()), held };
    sync(o);
    expect(on(a), "inset shows at rest and hides in motion").toBe(true);
    alpha.set(0, 1);
    sync(o);
    expect(on(a)).toBe(false);
    expect(wantsShadowAway(true, true, INSET, false)).toBe(true);
    expect(wantsShadowAway(true, true, NONE, true)).toBe(false);
  });

  it("given_a_dragged_element_at_restAlpha_1_when_synced_then_the_class_D88_1", () => {
    const held = new Set<HTMLElement>();
    sync({ entries: [{ id: 0, el: a, shadows: DROP }], alpha: new Map([[0, 1]]), interaction: new Map([[0, Interaction.DRAGGED]]), r: renderer(new Set([0])), held });
    expect(on(a)).toBe(true);
    clearShadowClasses(held);
  });

  it("given_reduced_motion_or_a_nan_restAlpha_when_synced_then_no_class_and_an_existing_hold_is_withdrawn", () => {
    const held = new Set<HTMLElement>();
    const alpha = new Map([[0, 0.3]]);
    const o: Opts = { entries: [{ id: 0, el: a, shadows: DROP }], alpha, r: renderer(new Set([0])), held };
    sync(o);
    expect(on(a)).toBe(true);
    sync({ ...o, reducedMotion: true });
    expect(on(a), "reduced motion: the browser's shadow throughout").toBe(false);
    alpha.set(0, Number.NaN);
    sync(o);
    expect(on(a), "NaN counts as rest").toBe(false);
    expect(held.size).toBe(0);
  });

  it("given_two_instances_holding_one_element_when_one_releases_then_the_class_stays_until_both_release_review_focus_3", () => {
    const one = new Set<HTMLElement>();
    const two = new Set<HTMLElement>();
    const entries: ShadowEntry[] = [{ id: 0, el: a, shadows: DROP }];
    for (const held of [one, two]) sync({ entries, alpha: new Map([[0, 0.5]]), r: renderer(new Set([0])), held });
    releaseShadowClass(one, a);
    expect(on(a), "the other instance's liquid is still away").toBe(true);
    releaseShadowClass(two, a);
    expect(on(a)).toBe(false);
    releaseShadowClass(two, a); // no hold left: a no-op
    // One instance at rest, the other away: one hold, the class stays for the moving one.
    sync({ entries, alpha: new Map([[0, 1]]), r: renderer(new Set()), held: one });
    sync({ entries, alpha: new Map([[0, 0.5]]), r: renderer(new Set([0])), held: two });
    expect([one.size, two.size, on(a)]).toEqual([0, 1, true]);
    clearShadowClasses(two);
  });

  it("given_clearShadowClasses_or_a_missed_release_when_called_then_this_instance_lets_go", () => {
    const mine = new Set<HTMLElement>();
    const r = renderer(new Set([0, 1]));
    sync({ entries: [{ id: 0, el: a, shadows: DROP }, { id: 1, el: b, shadows: DROP }], alpha: new Map([[0, 0.5], [1, 0.5]]), r, held: mine });
    expect([on(a), on(b)]).toEqual([true, true]);
    sync({ entries: [{ id: 0, el: a, shadows: DROP }], alpha: new Map([[0, 0.5]]), r, held: mine }); // b no longer observed
    expect(on(b)).toBe(false);
    clearShadowClasses(mine); // a stop, reduced motion, a lost device, destroy
    expect(on(a)).toBe(false);
    expect(mine.size).toBe(0);
  });
});
