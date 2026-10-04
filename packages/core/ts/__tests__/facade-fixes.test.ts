/**
 * @vitest-environment jsdom
 * W66.5 fix round 1: regression tests for the review findings on the public
 * facade (shared-element decoration refcount, stale autoObserve candidates,
 * runtimeOf after destroy, autoDiscover root scoping).
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { LiquidDOM } from "../src/index";
import { runtimeOf } from "../src/internal";
import { ELEMENT_CLASS, STACK_ATTR } from "../src/stylesheet";
import type { FluidBackend } from "../src/wasm-loader";
import { ElementRegistry } from "../src/element-registry";
import { FluidBridge } from "../src/fluid-bridge";
import { addLiquid, freshBackend, instanceTracker, mockRect, resetDom, setupFacadeTestEnv } from "./_facade-helpers";

const tracker = instanceTracker();
beforeEach(() => {
  resetDom();
  setupFacadeTestEnv();
});
afterEach(() => tracker.destroyAll());

async function create(opts: Parameters<typeof LiquidDOM.create>[0] = {}) {
  return tracker.track(
    await LiquidDOM.create({ testBackend: freshBackend(), autoObserve: false, particles: 1024, maxElements: 8, ...opts }),
  );
}

describe("W66.5 fix 1: an element shared by two instances", () => {
  it("given_two_autoObserve_instances_on_one_element_when_A_destroyed_then_still_decorated_and_after_B_restored_exactly", async () => {
    const el = addLiquid("button", [0, 0, 100, 40]);
    el.className = "btn primary";
    const a = await create({ autoObserve: true });
    const b = await create({ autoObserve: true });
    expect(el.classList.contains(ELEMENT_CLASS)).toBe(true);
    const stack = el.getAttribute(STACK_ATTR);
    expect(stack).not.toBeNull();

    a.destroy();
    expect(el.classList.contains(ELEMENT_CLASS)).toBe(true);
    expect(el.getAttribute(STACK_ATTR)).toBe(stack);

    b.destroy();
    expect(el.className).toBe("btn primary");
    expect(el.hasAttribute(STACK_ATTR)).toBe(false);
  });

  it("given_shared_element_without_class_attr_when_both_unobserve_in_either_order_then_no_class_attr_left", async () => {
    const el = addLiquid("button", [0, 0, 100, 40]);
    expect(el.hasAttribute("class")).toBe(false);
    const a = await create();
    const b = await create();
    a.observe(el);
    b.observe(el);
    b.unobserve(el);
    expect(el.classList.contains(ELEMENT_CLASS)).toBe(true);
    a.unobserve(el);
    expect(el.hasAttribute("class")).toBe(false);
    expect(el.hasAttribute(STACK_ATTR)).toBe(false);
  });

  it("given_element_that_originally_had_the_liquid_class_and_a_stack_attr_when_both_instances_destroyed_then_original_state_kept", async () => {
    const el = addLiquid("button", [0, 0, 100, 40]);
    el.className = `x ${ELEMENT_CLASS}`;
    el.setAttribute(STACK_ATTR, "custom");
    const a = await create({ autoObserve: true });
    const b = await create({ autoObserve: true });
    a.destroy();
    b.destroy();
    expect(el.className).toBe(`x ${ELEMENT_CLASS}`);
    expect(el.getAttribute(STACK_ATTR)).toBe("custom");
  });

  it("given_shared_element_when_one_instance_observes_twice_then_refcount_counts_the_instance_once", async () => {
    const el = addLiquid("button", [0, 0, 100, 40], document.body, false);
    const a = await create();
    const b = await create();
    a.observe(el);
    a.observe(el); // idempotent
    b.observe(el);
    a.unobserve(el);
    expect(el.classList.contains(ELEMENT_CLASS)).toBe(true);
    b.unobserve(el);
    expect(el.hasAttribute("class")).toBe(false);
  });
});

describe("W66.5 fix round 2: the second observer's colour snapshot", () => {
  function registry(): ElementRegistry {
    const backend = freshBackend();
    const core = new backend.FluidCore(256, 4, 1280, 800, 0, 0, 1);
    return new ElementRegistry(new FluidBridge(backend, core), { coordOffset: () => ({ x: 0, y: 0 }), scheduleRedistribute: () => {} });
  }

  it("given_element_decorated_by_instance_A_when_instance_B_observes_then_B_snapshots_the_author_background_not_transparent", () => {
    // jsdom applies this cascade: with the class, the computed background is rgba(0, 0, 0, 0).
    const style = document.createElement("style");
    style.textContent = `.${ELEMENT_CLASS} { background-color: transparent !important }`;
    document.head.appendChild(style);
    const el = addLiquid("button", [0, 0, 100, 40], document.body, false);
    el.setAttribute("style", "background-color: rgb(10, 20, 30)");
    const a = registry();
    const b = registry();
    const idA = a.observe(el);
    expect(el.classList.contains(ELEMENT_CLASS)).toBe(true);
    const idB = b.observe(el);
    expect(Array.from(a.get(idA)!.background)).toEqual([10, 20, 30, 1]);
    expect(Array.from(b.get(idB)!.background)).toEqual([10, 20, 30, 1]);
    expect(el.classList.contains(ELEMENT_CLASS)).toBe(true); // the class is put back after the read
    b.unobserve(el);
    a.unobserve(el);
  });
});

describe("W66.5 fix 2: candidates removed during the async WASM load", () => {
  it("given_candidate_removed_before_loader_resolves_when_create_resolves_then_it_is_not_observed", async () => {
    const kept = addLiquid("button", [0, 0, 100, 40]);
    const removed = addLiquid("button", [0, 60, 100, 40]);
    let release!: (b: FluidBackend) => void;
    const loader = () => new Promise<FluidBackend>((r) => (release = r));
    const pending = LiquidDOM.create({ loader, autoObserve: true, particles: 1024, maxElements: 8 });
    await Promise.resolve();
    removed.remove();
    release(freshBackend());
    const inst = tracker.track(await pending);
    expect(kept.classList.contains(ELEMENT_CLASS)).toBe(true);
    expect(removed.classList.contains(ELEMENT_CLASS)).toBe(false);
    expect(removed.hasAttribute(STACK_ATTR)).toBe(false);
    expect(runtimeOf(inst)!.elementState(removed)).toBeUndefined();
    expect(runtimeOf(inst)!.elementState(kept)).toBeDefined();
  });
});

describe("W66.5 fix 3: runtimeOf after destroy", () => {
  it("given_instance_when_destroyed_then_runtimeOf_is_undefined", async () => {
    const inst = await create();
    expect(runtimeOf(inst)).toBeDefined();
    inst.destroy();
    expect(runtimeOf(inst)).toBeUndefined();
  });
});

describe("W66.5 fix 4: autoDiscover root", () => {
  it("given_container_mode_when_autoDiscover_with_root_outside_container_then_TypeError", async () => {
    const container = document.createElement("section");
    mockRect(container, 0, 0, 600, 400);
    document.body.appendChild(container);
    const inner = document.createElement("div");
    container.appendChild(inner);
    const outside = document.createElement("div");
    document.body.appendChild(outside);
    const inst = await create({ container });
    expect(() => inst.autoDiscover(outside)).toThrow(TypeError);
    expect(() => inst.autoDiscover(document.body)).toThrow(TypeError);
    expect(() => inst.autoDiscover(inner)).not.toThrow();
    inst.stopAutoDiscover();
    expect(() => inst.autoDiscover(container)).not.toThrow();
  });

  it("given_no_document_body_when_autoDiscover_without_root_then_clear_Error", async () => {
    const inst = await create();
    const body = document.body;
    document.documentElement.removeChild(body);
    try {
      expect(() => inst.autoDiscover()).toThrow(/autoDiscover needs a document body/);
    } finally {
      document.documentElement.appendChild(body);
    }
  });
});
