/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { ElementRegistry } from "../src/element-registry";
import { FluidBridge } from "../src/fluid-bridge";
import { ELEMENT_STRIDE, El, Interaction } from "../src/fluid-layout";
import { createTestBackend } from "./_fluid-test-backend";

function stubRect(el: Element, x: number, y: number, w: number, h: number): void {
  el.getBoundingClientRect = () =>
    ({ x, y, left: x, top: y, width: w, height: h, right: x + w, bottom: y + h, toJSON: () => ({}) }) as DOMRect;
}

function setup() {
  const rm = { on: false };
  const backend = createTestBackend();
  // W64 ctor: particles, maxElements, worldW, worldH, areaHint (0 → 8 px cell), maxElementH (0 → 200 px margin), seed.
  const core = new backend.FluidCore(256, 4, 1280, 800, 0, 0, 1);
  const bridge = new FluidBridge(backend, core);
  const registry = new ElementRegistry(bridge, {
    coordOffset: () => ({ x: 0, y: 0 }),
    scheduleRedistribute: () => {},
    reducedMotion: () => rm.on,
  });
  const interaction = (id: number): number => bridge.elementView()[id * ELEMENT_STRIDE + El.INTERACTION];
  return { registry, interaction, rm };
}

function button(label = "Split"): HTMLButtonElement {
  const b = document.createElement("button");
  b.textContent = label;
  stubRect(b, 100, 50, 140, 48);
  document.body.appendChild(b);
  return b;
}

// D68-2 amended (saga dec_58e41ded): hover comes from pointerenter/pointerleave with a non-touch pointerType.
const enter = (el: Element, pointerType = "mouse") => el.dispatchEvent(new PointerEvent("pointerenter", { pointerType }));
const leave = (el: Element, pointerType = "mouse") => el.dispatchEvent(new PointerEvent("pointerleave", { pointerType }));

/** Stubs window.matchMedia so `(hover: hover)` matches iff `canHover`; other queries never match. */
function stubHoverMedia(canHover: boolean): void {
  const mql = (q: string, matches: boolean) => ({
    matches,
    media: q,
    onchange: null,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    dispatchEvent: () => true,
  });
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: vi.fn((q: string) => mql(q, q.replace(/\s+/g, "") === "(hover:hover)" ? canHover : false)),
  });
}
const originalMatchMedia = Object.getOwnPropertyDescriptor(window, "matchMedia");

describe("hover and focus → interaction slot (W68, D68-2, D68-5)", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });
  afterEach(() => {
    if (originalMatchMedia) Object.defineProperty(window, "matchMedia", originalMatchMedia);
    else delete (window as { matchMedia?: unknown }).matchMedia;
  });

  it("given_mouseenter_when_synced_then_interaction_slot_1", () => {
    const { registry, interaction } = setup();
    const b = button();
    const id = registry.observe(b);
    registry.sync();
    expect(interaction(id)).toBe(Interaction.IDLE);
    enter(b);
    registry.sync();
    expect(interaction(id)).toBe(Interaction.HOVER);
  });

  // D68-2 amended again 2026-10-06 (saga dec_e431420b): hover beats focus until slice 5.
  it("given_focus_while_hovered_when_synced_then_interaction_slot_1_hover_beats_focus", () => {
    const { registry, interaction } = setup();
    const b = button();
    const id = registry.observe(b);
    enter(b);
    b.focus();
    registry.sync();
    expect(interaction(id)).toBe(Interaction.HOVER);
  });

  it("given_hovered_button_focused_by_click_when_synced_then_hover_and_after_pointerleave_while_focused_then_focused", () => {
    const { registry, interaction } = setup();
    const b = button();
    const id = registry.observe(b);
    enter(b);
    registry.sync();
    expect(interaction(id), "hovered").toBe(Interaction.HOVER);
    // A click focuses a button in Chrome/Firefox; jsdom does not, so focus() stands in for it.
    b.dispatchEvent(new PointerEvent("pointerdown", { pointerType: "mouse", bubbles: true }));
    b.focus();
    b.dispatchEvent(new PointerEvent("pointerup", { pointerType: "mouse", bubbles: true }));
    b.click();
    expect(document.activeElement).toBe(b);
    registry.sync();
    expect(interaction(id), "hovered and focused by the click").toBe(Interaction.HOVER);
    leave(b);
    registry.sync();
    expect(interaction(id), "pointer gone, focus kept").toBe(Interaction.FOCUSED);
  });

  it("given_focused_when_mouse_leaves_then_interaction_slot_stays_2", () => {
    const { registry, interaction } = setup();
    const b = button();
    const id = registry.observe(b);
    enter(b);
    b.focus();
    leave(b);
    registry.sync();
    expect(interaction(id)).toBe(Interaction.FOCUSED);
  });

  // W68 ward review: no pointerleave reaches a detached or disabled element, so the swell stuck.
  it("given_hovered_element_detached_when_synced_then_not_hover_after_reattach", () => {
    const { registry, interaction } = setup();
    const b = button();
    const id = registry.observe(b);
    enter(b);
    registry.sync();
    expect(interaction(id), "precondition").toBe(Interaction.HOVER);
    b.remove();
    registry.sync();
    document.body.appendChild(b);
    registry.sync();
    expect(interaction(id)).not.toBe(Interaction.HOVER);
  });

  it("given_hovered_button_disabled_when_synced_then_not_hover", () => {
    const { registry, interaction } = setup();
    const b = button();
    const id = registry.observe(b);
    enter(b);
    registry.sync();
    expect(interaction(id), "precondition").toBe(Interaction.HOVER);
    b.disabled = true;
    registry.sync();
    expect(interaction(id)).not.toBe(Interaction.HOVER);
    b.disabled = false;
    registry.sync();
    expect(interaction(id), "re-enabling alone does not bring hover back").toBe(Interaction.IDLE);
  });

  it("given_blur_and_mouseleave_when_synced_then_interaction_slot_0", () => {
    const { registry, interaction } = setup();
    const b = button();
    const id = registry.observe(b);
    enter(b);
    b.focus();
    registry.sync();
    b.blur();
    registry.sync();
    expect(interaction(id)).toBe(Interaction.HOVER);
    leave(b);
    registry.sync();
    expect(interaction(id)).toBe(Interaction.IDLE);
  });

  it("given_element_already_focused_when_observed_then_interaction_slot_2_on_first_sync", () => {
    const { registry, interaction } = setup();
    const b = button();
    b.focus();
    const id = registry.observe(b);
    registry.sync();
    expect(interaction(id)).toBe(Interaction.FOCUSED);
  });

  it("given_reduced_motion_when_hovered_or_focused_then_interaction_slot_0", () => {
    const { registry, interaction, rm } = setup();
    rm.on = true;
    const hovered = button("Splash");
    const focused = button("Merge");
    const a = registry.observe(hovered);
    const c = registry.observe(focused);
    enter(hovered);
    focused.focus();
    registry.sync();
    expect(interaction(a)).toBe(Interaction.IDLE);
    expect(interaction(c)).toBe(Interaction.IDLE);
  });

  it("given_reduced_motion_turned_off_when_still_hovered_then_interaction_slot_1_on_next_sync", () => {
    const { registry, interaction, rm } = setup();
    rm.on = true;
    const b = button();
    const id = registry.observe(b);
    enter(b);
    registry.sync();
    expect(interaction(id)).toBe(Interaction.IDLE);
    rm.on = false;
    registry.sync();
    expect(interaction(id)).toBe(Interaction.HOVER);
  });

  // GUARD (passes at red: nothing writes the slot yet); pins focus/blur over focusin once implemented.
  it("given_child_of_observed_card_focused_when_synced_then_slot_idle", () => {
    const { registry, interaction } = setup();
    const card = document.createElement("div");
    const child = document.createElement("button");
    card.appendChild(child);
    stubRect(card, 100, 50, 140, 48);
    document.body.appendChild(card);
    const id = registry.observe(card);
    child.focus();
    registry.sync();
    expect(interaction(id)).toBe(Interaction.IDLE); // D68-2: focus/blur on the element itself, not focusin
  });

  it("given_element_already_hovered_when_observed_then_interaction_slot_1_on_first_sync", () => {
    const { registry, interaction } = setup();
    stubHoverMedia(true); // D68-2 amended: the initial :hover read needs (hover: hover)
    const b = button();
    b.matches = (s: string) => s === ":hover";
    const id = registry.observe(b);
    registry.sync();
    expect(interaction(id)).toBe(Interaction.HOVER);
  });

  it("given_unobserve_when_called_then_all_four_interaction_listeners_removed", () => {
    const { registry } = setup();
    const b = button();
    const add = vi.spyOn(b, "addEventListener");
    const remove = vi.spyOn(b, "removeEventListener");
    registry.observe(b);
    registry.unobserve(b);
    for (const type of ["pointerenter", "pointerleave", "focus", "blur"]) {
      const added = add.mock.calls.filter((c) => c[0] === type).map((c) => c[1]);
      const removed = remove.mock.calls.filter((c) => c[0] === type).map((c) => c[1]);
      expect(added, `${type} attached once`).toHaveLength(1);
      expect(removed, `${type} removed`).toContain(added[0]);
    }
  });

  it("given_observe_called_twice_when_listeners_counted_then_attached_once", () => {
    const { registry } = setup();
    const b = button();
    const add = vi.spyOn(b, "addEventListener");
    registry.observe(b);
    registry.observe(b);
    expect(add.mock.calls.filter((c) => c[0] === "pointerenter")).toHaveLength(1);
  });

  // ---- D68-2 amended 2026-10-06 (saga dec_58e41ded) ----

  it("given_touch_tap_with_compat_mouseenter_when_synced_then_slot_idle_and_no_stuck_swell", () => {
    const { registry, interaction } = setup();
    const b = button();
    const id = registry.observe(b);
    // A tap: pointerenter (touch), then the browser's compatibility mouseover/mouseenter, then
    // pointerleave (touch) on lift. No mouseleave follows until the next tap elsewhere.
    enter(b, "touch");
    b.dispatchEvent(new MouseEvent("mouseenter"));
    registry.sync();
    expect(interaction(id), "during the tap").toBe(Interaction.IDLE);
    leave(b, "touch");
    registry.sync();
    expect(interaction(id), "after the lift (no stuck swell)").toBe(Interaction.IDLE);
  });

  it("given_mouse_or_pen_pointerenter_when_synced_then_hover_and_pointerleave_clears_it", () => {
    for (const pointerType of ["mouse", "pen"]) {
      document.body.innerHTML = "";
      const { registry, interaction } = setup();
      const b = button();
      const id = registry.observe(b);
      enter(b, pointerType);
      registry.sync();
      expect(interaction(id), `${pointerType}: enter`).toBe(Interaction.HOVER);
      leave(b, pointerType);
      registry.sync();
      expect(interaction(id), `${pointerType}: leave`).toBe(Interaction.IDLE);
    }
  });

  it("given_element_matching_hover_at_observe_when_hover_none_then_idle_and_when_hover_hover_then_hover", () => {
    for (const [canHover, expected] of [
      [false, Interaction.IDLE],
      [true, Interaction.HOVER],
    ] as const) {
      document.body.innerHTML = "";
      stubHoverMedia(canHover);
      const { registry, interaction } = setup();
      const b = button();
      b.matches = (s: string) => s === ":hover";
      const id = registry.observe(b);
      registry.sync();
      expect(interaction(id), `(hover: ${canHover ? "hover" : "none"})`).toBe(expected);
    }
  });
});
