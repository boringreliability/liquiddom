import { describe, it, expect, vi, afterEach } from "vitest";
import { CHAPTERS } from "../src/landing/chapters";
import { BODY_OPTIONS, POOL_OPTIONS, ARRIVAL_STRENGTH, HINT_STRENGTH, HINT_DELAY_MS, STOPPED_MESSAGE } from "../src/landing/config";
import { startArrival } from "../src/landing/arrival";
import { pauseOffscreen } from "../src/landing/offscreen";
import { showStopped } from "../src/landing/stopped";
import { CODE_SAMPLES, INSTALL_LINE } from "../src/landing/samples";
import { dialVector } from "../src/lib/dial";

function fakeInstance() {
  return { splash: vi.fn(), shake: vi.fn(), pause: vi.fn(), resume: vi.fn() };
}
function heroEls(n: number): HTMLElement[] {
  return Array.from({ length: n }, () => document.body.appendChild(document.createElement("button")));
}

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = "";
});

describe("W86: the landing (D86-2, D86-3, D86-4)", () => {
  it("given_the_chapters_when_read_then_nine_in_order_with_the_design_titles", () => {
    expect(CHAPTERS.map((c) => c.id)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    expect(CHAPTERS.map((c) => c.title)).toEqual([
      "The DOM, but liquid.",
      "It's still a button.",
      "Poke it.",
      "Water, honey, jelly.",
      "Grab it. Merge it.",
      "Tilt your phone.",
      "It follows you down.",
      "Calm when you need it.",
      "Pour it into your app.",
    ]);
  });

  it("given_the_config_when_read_then_the_gate_values", () => {
    expect(BODY_OPTIONS).toEqual({ particles: 18000, maxElements: 48, renderer: "auto" });
    expect(POOL_OPTIONS).toEqual({ particles: 1000, maxElements: 2, renderer: "auto" });
    expect(ARRIVAL_STRENGTH).toBe(0.8);
    expect(HINT_STRENGTH).toBe(0.5);
    expect(HINT_DELAY_MS).toBe(4000);
    expect(STOPPED_MESSAGE).toBe("The liquid stopped; the page works as usual.");
  });

  it("given_hero_elements_when_the_arrival_starts_then_each_is_splashed_at_0_8_at_once", () => {
    const inst = fakeInstance();
    const hero = heroEls(5);
    const stop = startArrival(inst, hero, { reducedMotion: false });
    expect(inst.splash.mock.calls).toEqual(hero.map((el) => [el, { strength: 0.8 }]));
    stop(); // no listener or timer leaks into row 12
  });

  it("given_reduced_motion_when_the_arrival_starts_then_no_splash_and_no_hint", () => {
    vi.useFakeTimers();
    const inst = fakeInstance();
    startArrival(inst, heroEls(2), { reducedMotion: true });
    vi.advanceTimersByTime(10_000);
    expect(inst.splash).not.toHaveBeenCalled();
    expect(inst.shake).not.toHaveBeenCalled();
  });

  it("given_no_interaction_for_4_s_when_waiting_then_one_shake_at_0_5", () => {
    vi.useFakeTimers();
    const inst = fakeInstance();
    startArrival(inst, heroEls(1), { reducedMotion: false });
    vi.advanceTimersByTime(3999);
    expect(inst.shake).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(inst.shake.mock.calls).toEqual([[0.5]]);
    vi.advanceTimersByTime(20_000);
    expect(inst.shake).toHaveBeenCalledTimes(1);
  });

  it("given_an_interaction_before_4_s_when_waiting_then_no_shake_and_the_listeners_are_gone", () => {
    for (const type of ["pointerdown", "keydown", "touchstart", "wheel", "scroll"]) {
      vi.useFakeTimers();
      const inst = fakeInstance();
      const remove = vi.spyOn(window, "removeEventListener");
      startArrival(inst, heroEls(1), { reducedMotion: false });
      vi.advanceTimersByTime(1000);
      window.dispatchEvent(new Event(type));
      vi.advanceTimersByTime(10_000);
      expect(inst.shake, type).not.toHaveBeenCalled();
      expect(remove.mock.calls.map((c) => c[0]).sort(), type).toEqual(["keydown", "pointerdown", "scroll", "touchstart", "wheel"]);
      remove.mockRestore();
      vi.useRealTimers();
    }
  });

  it("given_dial_angles_when_mapped_then_unit_vectors_with_0_down_and_90_right", () => {
    const close = (a: [number, number], b: [number, number]) => {
      expect(a[0]).toBeCloseTo(b[0], 9);
      expect(a[1]).toBeCloseTo(b[1], 9);
    };
    close(dialVector(0), [0, 1]);
    close(dialVector(90), [1, 0]);
    close(dialVector(180), [0, -1]);
    close(dialVector(270), [-1, 0]);
    close(dialVector(-90), [-1, 0]);
    close(dialVector(450), [1, 0]);
  });

  it("given_a_pool_when_it_leaves_and_enters_the_viewport_then_pause_and_resume", () => {
    let fire: (entries: { isIntersecting: boolean }[]) => void = () => {};
    const disconnect = vi.fn();
    class FakeIO {
      constructor(cb: (e: { isIntersecting: boolean }[]) => void) { fire = cb; }
      observe = vi.fn();
      disconnect = disconnect;
    }
    const inst = fakeInstance();
    const stop = pauseOffscreen(inst, document.createElement("div"), FakeIO as unknown as typeof IntersectionObserver);
    fire([{ isIntersecting: false }]);
    expect(inst.pause).toHaveBeenCalledTimes(1);
    fire([{ isIntersecting: true }]);
    expect(inst.resume).toHaveBeenCalledTimes(1);
    stop();
    expect(disconnect).toHaveBeenCalledTimes(1);
  });

  it("given_a_stop_when_shown_then_controls_hidden_and_the_line_visible_once", () => {
    document.body.innerHTML = `
      <button data-liquid-control>Splash</button>
      <input data-liquid-control type="range">
      <p data-liquid-stopped hidden></p>`;
    showStopped(document);
    showStopped(document);
    for (const el of document.querySelectorAll("[data-liquid-control]")) expect((el as HTMLElement).hidden).toBe(true);
    const line = document.querySelector<HTMLElement>("[data-liquid-stopped]")!;
    expect(line.hidden).toBe(false);
    expect(line.textContent).toBe("The liquid stopped; the page works as usual.");
  });

  it("given_the_code_samples_when_read_then_public_names_and_the_alpha_install_line", () => {
    expect(INSTALL_LINE).toBe("npm install liquiddom@alpha");
    expect(CODE_SAMPLES.vanilla).toContain("LiquidDOM.create(");
    expect(CODE_SAMPLES.react).toContain("LiquidProvider");
    expect(CODE_SAMPLES.react).toContain("LiquidElement");
    expect(CODE_SAMPLES.vue).toMatch(/LiquidPlugin|LiquidProvider/);
    for (const s of Object.values(CODE_SAMPLES)) expect(s).not.toMatch(/@internal|runtimeOf|testBackend|__liquid/);
  });
});
