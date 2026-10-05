/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
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

const enter = (el: Element) => el.dispatchEvent(new MouseEvent("mouseenter"));
const leave = (el: Element) => el.dispatchEvent(new MouseEvent("mouseleave"));

describe("hover and focus → interaction slot (W68, D68-2, D68-5)", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
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

  it("given_focus_while_hovered_when_synced_then_interaction_slot_2", () => {
    const { registry, interaction } = setup();
    const b = button();
    const id = registry.observe(b);
    enter(b);
    b.focus();
    registry.sync();
    expect(interaction(id)).toBe(Interaction.FOCUSED);
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
    for (const type of ["mouseenter", "mouseleave", "focus", "blur"]) {
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
    expect(add.mock.calls.filter((c) => c[0] === "mouseenter")).toHaveLength(1);
  });
});
