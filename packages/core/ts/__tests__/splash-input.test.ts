/**
 * W67 – click and keyboard splash input (spec §2 "Interaction", §4 "Keyboard"; D67-9).
 * Splashes at the pointer position (detail ≥ 1), or at the rect centre for keyboard
 * activation (detail === 0).
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LiquidDOM, type LiquidDOMInstance } from "../src/index";
import { createManualClock } from "../src/clock";
import { installFakeCanvas2D, type FakeCanvasHandle } from "./_fake-canvas";
import { mockRect, spyBackend, type SpyBackend } from "./_facade-helpers";

let fake: FakeCanvasHandle;
let live: LiquidDOMInstance | null = null;
let sb: SpyBackend = spyBackend();

const splashCalls = (): unknown[][] => sb.calls.filter((c) => c.method === "splash").map((c) => c.args);

async function create(container?: HTMLElement): Promise<LiquidDOMInstance> {
  sb = spyBackend();
  live = await LiquidDOM.create({
    testBackend: sb.backend,
    clock: createManualClock(),
    renderer: "canvas2d",
    autoObserve: false,
    particles: 1024,
    maxElements: 4,
    seed: 1,
    ...(container ? { container } : {}),
  });
  return live;
}

function makeEl<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  rect: [number, number, number, number],
  parent: HTMLElement = document.body,
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  parent.appendChild(el);
  mockRect(el, ...rect);
  return el;
}

function click(el: Element, init: MouseEventInit): MouseEvent {
  const ev = new MouseEvent("click", { bubbles: true, cancelable: true, ...init });
  el.dispatchEvent(ev);
  return ev;
}

beforeEach(() => {
  fake = installFakeCanvas2D();
});

afterEach(() => {
  live?.destroy();
  live = null;
  fake.restore();
  document.body.replaceChildren();
});

describe("W67 click / keyboard splash input", () => {
  it("given_pointer_click_on_observed_element_when_dispatched_then_core_splash_at_pointer_in_buffer_space_strength_1", async () => {
    const liquid = await create();
    const el = makeEl("button", [10, 20, 140, 48]);
    const id = liquid.observe(el);
    click(el, { detail: 1, clientX: 30, clientY: 40 });
    expect(splashCalls()).toEqual([[id, 30, 40, 1]]);
  });

  it("given_keyboard_click_detail_0_when_dispatched_then_core_splash_at_rect_centre", async () => {
    const liquid = await create();
    const el = makeEl("button", [10, 20, 140, 48]);
    const id = liquid.observe(el);
    click(el, { detail: 0, clientX: 0, clientY: 0 });
    expect(splashCalls()).toEqual([[id, 80, 44, 1]]);
  });

  it("given_click_when_handled_then_default_not_prevented_and_exactly_one_splash", async () => {
    const liquid = await create();
    const el = makeEl("button", [10, 20, 140, 48]);
    liquid.observe(el);
    let seenByDocument = 0;
    document.addEventListener("click", () => seenByDocument++, { once: true });
    const ev = click(el, { detail: 1, clientX: 30, clientY: 40 });
    expect(ev.defaultPrevented).toBe(false);
    expect(seenByDocument).toBe(1);
    expect(splashCalls()).toHaveLength(1);
  });

  it("given_nested_observed_elements_when_inner_clicked_then_exactly_one_splash_on_inner", async () => {
    const liquid = await create();
    const card = makeEl("div", [0, 0, 400, 300]);
    const inner = makeEl("button", [10, 20, 140, 48], card);
    liquid.observe(card);
    const innerId = liquid.observe(inner);
    click(inner, { detail: 1, clientX: 30, clientY: 40 });
    expect(splashCalls()).toEqual([[innerId, 30, 40, 1]]);
  });

  it("given_click_on_child_of_observed_element_when_dispatched_then_splash_on_observed_element", async () => {
    const liquid = await create();
    const el = makeEl("button", [10, 20, 140, 48]);
    const label = makeEl("span", [40, 30, 60, 20], el);
    const id = liquid.observe(el);
    click(label, { detail: 1, clientX: 50, clientY: 35 });
    expect(splashCalls()).toEqual([[id, 50, 35, 1]]);
  });

  it("given_container_mode_when_clicked_then_splash_container_relative", async () => {
    const container = makeEl("div", [100, 50, 600, 400]);
    const liquid = await create(container);
    const el = makeEl("button", [110, 70, 140, 48], container);
    const id = liquid.observe(el);
    click(el, { detail: 1, clientX: 150, clientY: 90 });
    click(el, { detail: 0 });
    expect(splashCalls()).toEqual([
      [id, 50, 40, 1],
      [id, 80, 44, 1],
    ]);
  });

  it("given_unobserved_or_destroyed_when_clicked_then_no_splash", async () => {
    const liquid = await create();
    const el = makeEl("button", [10, 20, 140, 48]);
    liquid.observe(el);
    click(el, { detail: 1, clientX: 30, clientY: 40 });
    expect(splashCalls()).toHaveLength(1);
    liquid.unobserve(el);
    click(el, { detail: 1, clientX: 30, clientY: 40 });
    expect(splashCalls()).toHaveLength(1);
    liquid.observe(el);
    click(el, { detail: 1, clientX: 30, clientY: 40 });
    expect(splashCalls()).toHaveLength(2);
    liquid.destroy();
    click(el, { detail: 1, clientX: 30, clientY: 40 });
    expect(splashCalls()).toHaveLength(2);
  });
});
