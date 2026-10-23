/**
 * The playground's boot script (W86, D86-5): a port of the W69 demo playground
 * (`demo/scenes/playground.ts`) onto the site, on liquiddom's public API only.
 *
 * Live: material (setMaterial), presets, gravity (setGravity), drag per element
 * (unobserve + observe, since `drag` is read once), splash/shake, pause/resume.
 * Init-only (reload): particles, seed, renderer, forceReducedMotion.
 * State persists under liquiddom-playground-v3; v1 and v2 are removed on load.
 * A stop (onError) destroys the instance and offers a Restart (destroy + create).
 */
import { Pane } from "tweakpane";
import {
  LiquidDOM,
  WebGPUUnavailableError,
  presets,
  type GravityOptions,
  type LiquidDOMInstance,
  type LiquidOptions,
  type Material,
} from "liquiddom";
import { dialVector } from "../lib/dial";
import { toCode } from "./codegen";
import {
  DEFAULT_PLAYGROUND_GRAVITY,
  DEFAULT_PLAYGROUND_INIT,
  GRAVITY_STRENGTH_MAX,
  MATERIAL_BOUNDS,
  MATERIAL_KEYS,
  PARTICLES_MAX,
  PARTICLES_MIN,
  PLAYGROUND_DEFAULT_MATERIAL,
  PLAYGROUND_ELEMENT_IDS,
  SEED_MAX,
  applyMaterialChange,
  buildInitialState,
  detectPreset,
  loadPlaygroundState,
  parseUrlParams,
  savePlaygroundState,
  type PlaygroundElementId,
  type PlaygroundGravity,
  type PlaygroundState,
  type PresetChoice,
  type PresetName,
} from "./state";

const MATERIAL_SLIDERS: Readonly<Record<keyof Material, { step: number; label: string }>> = {
  viscosity: { step: 0.01, label: "viscosity" },
  cohesion: { step: 0.01, label: "cohesion" },
  recovery: { step: 0.05, label: "recovery (s)" },
};

/** Resolution 3: the site's own handle on its public instance ("open devtools and play with liquiddom.instance"). */
interface PlaygroundHandle {
  instance: LiquidDOMInstance;
  state: PlaygroundState;
  presets: typeof presets;
  applyPreset(name: PresetName): void;
}

declare global {
  interface Window {
    liquiddom?: PlaygroundHandle;
  }
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T | null;

function debounce(fn: () => void, ms: number): { debounced: () => void; flush: () => void } {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return {
    debounced: () => {
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        fn();
      }, ms);
    },
    flush: () => {
      if (timer === null) return;
      clearTimeout(timer);
      timer = null;
      fn();
    },
  };
}

/** The playground's gravity as liquiddom's GravityOptions (`fixed`: the dial angle as a unit vector). */
function toGravity(g: PlaygroundGravity): GravityOptions {
  if (g.source === "fixed") return { source: "fixed", vector: dialVector(g.angle), strength: g.strength };
  return { source: g.source, strength: g.strength };
}

function sceneElement(id: PlaygroundElementId): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[data-pg-id="${id}"]`);
}

function sceneElements(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>("[data-pg-id]")];
}

function showRendererBadge(active: "canvas2d" | "webgpu" | null): void {
  const badge = $("renderer-badge");
  if (badge === null) return;
  badge.textContent = active === null ? "stopped" : active;
  badge.dataset.renderer = active ?? "none";
}

let toastTimer: ReturnType<typeof setTimeout> | null = null;
function showToast(msg: string): void {
  const toast = $("toast");
  if (toast === null) return;
  toast.textContent = msg;
  toast.dataset.visible = "true";
  if (toastTimer !== null) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (toast.dataset.visible = "false"), 1600);
}

async function copyText(text: string, done: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    showToast(done);
  } catch (err) {
    // Insecure contexts and blocked permissions: hand the text over through the console instead.
    console.warn("[playground] the clipboard is unavailable; here is the text instead:\n\n" + text, err);
    showToast("Clipboard blocked: the text is in the console");
  }
}

/** The stopped line: hidden while an instance runs, shown with Restart after a stop or a failed create(). */
function showStopped(message: string | null): void {
  const line = $("stopped");
  const text = $("stopped-text");
  if (line === null || text === null) return;
  if (message === null) {
    line.hidden = true;
    return;
  }
  text.textContent = message;
  line.hidden = false;
}

function bootstrap(): void {
  // loadPlaygroundState() removes the v1/v2 keys; it runs before any instance exists (E5).
  const state = buildInitialState(loadPlaygroundState(), parseUrlParams(), PLAYGROUND_DEFAULT_MATERIAL);

  /** The live instance, or null while one is being created and after a stop. */
  let instance: LiquidDOMInstance | null = null;
  /** Bumped by every create; an older attempt's stop or arrival is ignored. */
  let attempt = 0;

  const ui: { preset: PresetChoice; strength: number } = { preset: detectPreset(state.material, presets), strength: 1 };
  const info = { renderer: "…", particles: "…", elements: "…" };
  const drag: Record<PlaygroundElementId, boolean> = Object.fromEntries(
    PLAYGROUND_ELEMENT_IDS.map((id) => [id, !state.dragOff.includes(id)]),
  ) as Record<PlaygroundElementId, boolean>;

  const { debounced: saveDebounced, flush: saveFlush } = debounce(() => {
    // Tweakpane's step constraint rewrites bound values on refresh (0.7 becomes
    // 0.7000000000000001). The instance holds the exact accepted material.
    if (instance !== null) Object.assign(state.material, instance.getMaterial());
    savePlaygroundState(state);
  }, 250);
  window.addEventListener("pagehide", saveFlush);
  window.addEventListener("beforeunload", saveFlush);

  const mount = $("tweak-mount");
  if (mount === null) throw new Error("[playground] #tweak-mount not found");
  const pane = new Pane({ container: mount, title: "liquiddom" });

  // Feedback-loop guard: pane.refresh() re-emits "change" on bindings (W49 §3).
  let refreshing = false;
  function refreshPane(): void {
    refreshing = true;
    try {
      pane.refresh();
    } finally {
      refreshing = false;
    }
  }

  function applyPreset(name: PresetName): void {
    Object.assign(state.material, presets[name]);
    instance?.setMaterial({ ...presets[name] });
    ui.preset = name;
    refreshPane();
    saveDebounced();
  }

  function observeAll(inst: LiquidDOMInstance): void {
    for (const el of sceneElements()) {
      const id = el.dataset.pgId as PlaygroundElementId;
      inst.observe(el, state.dragOff.includes(id) ? { drag: false } : undefined);
    }
  }

  async function create(): Promise<LiquidDOMInstance> {
    const mine = ++attempt;
    let stoppedEarly = false;
    const onError = (err: unknown): void => {
      if (mine !== attempt) return;
      console.warn("[playground] the liquid stopped", err);
      const inst = instance;
      instance = null;
      if (inst === null) stoppedEarly = true; // a stop during create(): destroyed on arrival
      else inst.destroy();
      showRendererBadge(null);
      showStopped("The liquid stopped.");
    };
    const options: LiquidOptions = {
      particles: state.init.particles,
      seed: state.init.seed,
      renderer: state.init.renderer,
      forceReducedMotion: state.init.forceReducedMotion,
      material: { ...state.material },
      gravity: toGravity(state.gravity),
      autoObserve: false,
      onError,
    };
    let inst: LiquidDOMInstance;
    try {
      inst = await LiquidDOM.create(options);
    } catch (err) {
      if (state.init.renderer !== "webgpu" || !(err instanceof WebGPUUnavailableError)) throw err;
      console.warn("[playground] WebGPU is unavailable; falling back to canvas2d", err);
      inst = await LiquidDOM.create({ ...options, renderer: "canvas2d" });
    }
    if (stoppedEarly || mine !== attempt) {
      inst.destroy();
      throw new Error("[playground] the liquid stopped while it was being created");
    }
    instance = inst;
    observeAll(inst);
    Object.assign(state.material, inst.getMaterial()); // the instance is the source of truth
    ui.preset = detectPreset(state.material, presets);
    info.renderer = inst.activeRenderer;
    info.particles = String(inst.particleCapacity);
    info.elements = String(inst.elementCapacity);
    refreshPane();
    showRendererBadge(inst.activeRenderer);
    showStopped(null);
    window.liquiddom = { instance: inst, state, presets, applyPreset };
    return inst;
  }

  function start(): void {
    create().catch((err: unknown) => {
      if (instance !== null) return;
      console.warn("[playground] the liquid could not start", err);
      showRendererBadge(null);
      if ($("stopped")?.hidden !== false) showStopped("The liquid could not start.");
    });
  }

  // ── Presets and material ───────────────────────────────────────────────
  pane
    .addBinding(ui, "preset", {
      label: "preset",
      options: { custom: "custom", water: "water", honey: "honey", jelly: "jelly" },
    })
    .on("change", (ev) => {
      if (refreshing || ev.value === "custom") return;
      applyPreset(ev.value);
    });

  const materialFolder = pane.addFolder({ title: "Material" });
  for (const key of MATERIAL_KEYS) {
    const slider = MATERIAL_SLIDERS[key];
    materialFolder
      .addBinding(state.material, key, {
        min: MATERIAL_BOUNDS[key].min,
        max: MATERIAL_BOUNDS[key].max,
        step: slider.step,
        label: slider.label,
      })
      .on("change", () => {
        if (refreshing) return;
        const accepted = instance === null || applyMaterialChange(instance, state, key);
        ui.preset = detectPreset(state.material, presets);
        refreshPane();
        if (accepted) saveDebounced();
      });
  }

  // ── Gravity (W83: only changes act, so turn the dial) ──────────────────
  const gravityFolder = pane.addFolder({ title: "Gravity" });
  const pushGravity = (): void => {
    if (instance === null) return;
    try {
      instance.setGravity(toGravity(state.gravity));
    } catch (err) {
      console.warn("[playground] setGravity rejected the change", err);
    }
  };
  gravityFolder
    .addBinding(state.gravity, "source", { options: { none: "none", fixed: "fixed", orientation: "orientation" } })
    .on("change", (ev) => {
      if (refreshing) return;
      saveDebounced();
      if (ev.value !== "orientation" || instance === null) {
        pushGravity();
        return;
      }
      // iOS asks for permission from a user gesture; this change is one.
      instance
        .requestOrientationPermission()
        .then((granted) => {
          if (granted) pushGravity();
          else showToast("Device tilt was not allowed");
        })
        .catch((err: unknown) => console.warn("[playground] device tilt is unavailable", err));
    });
  gravityFolder
    .addBinding(state.gravity, "angle", { min: 0, max: 359, step: 1, label: "angle (0 = down)" })
    .on("change", () => {
      if (refreshing) return;
      pushGravity();
      saveDebounced();
    });
  gravityFolder
    .addBinding(state.gravity, "strength", { min: 0, max: GRAVITY_STRENGTH_MAX, step: 10, label: "strength" })
    .on("change", () => {
      if (refreshing) return;
      pushGravity();
      saveDebounced();
    });

  // ── Drag per element (drag is read once: unobserve, then observe again) ─
  const dragFolder = pane.addFolder({ title: "Drag", expanded: false });
  for (const id of PLAYGROUND_ELEMENT_IDS) {
    dragFolder.addBinding(drag, id, { label: id }).on("change", (ev) => {
      if (refreshing) return;
      const off = !ev.value;
      state.dragOff = PLAYGROUND_ELEMENT_IDS.filter((x) => (x === id ? off : state.dragOff.includes(x)));
      const el = sceneElement(id);
      if (instance !== null && el !== null) {
        instance.unobserve(el);
        instance.observe(el, off ? { drag: false } : undefined);
      }
      saveDebounced();
    });
  }

  // ── Interaction ────────────────────────────────────────────────────────
  const interaction = pane.addFolder({ title: "Interaction" });
  interaction.addBinding(ui, "strength", { min: 0, max: 2, step: 0.05, label: "strength" });
  interaction.addButton({ title: "Splash every element" }).on("click", () => {
    if (instance === null) return;
    for (const el of sceneElements()) instance.splash(el, { strength: ui.strength });
  });
  interaction.addButton({ title: "Shake" }).on("click", () => instance?.shake(ui.strength));

  // ── Init-only ──────────────────────────────────────────────────────────
  const initFolder = pane.addFolder({ title: "Init (reload)", expanded: false });
  initFolder.addBinding(state.init, "particles", { min: PARTICLES_MIN, max: PARTICLES_MAX, step: 256 }).on("change", () => saveDebounced());
  initFolder.addBinding(state.init, "seed", { min: 0, max: SEED_MAX, step: 1 }).on("change", () => saveDebounced());
  initFolder
    .addBinding(state.init, "renderer", { options: { auto: "auto", canvas2d: "canvas2d", webgpu: "webgpu" } })
    .on("change", () => saveDebounced());
  initFolder.addBinding(state.init, "forceReducedMotion", { label: "reduced motion" }).on("change", () => saveDebounced());
  initFolder.addButton({ title: "Reload with these settings" }).on("click", () => {
    savePlaygroundState(state);
    const params = new URLSearchParams({
      particles: String(state.init.particles),
      seed: String(state.init.seed),
      renderer: state.init.renderer,
      forceReducedMotion: String(state.init.forceReducedMotion),
    });
    window.location.search = `?${params.toString()}`;
  });

  const infoFolder = pane.addFolder({ title: "Instance", expanded: false });
  infoFolder.addBinding(info, "renderer", { readonly: true });
  infoFolder.addBinding(info, "particles", { readonly: true });
  infoFolder.addBinding(info, "elements", { readonly: true, label: "max elements" });

  // ── Actions ────────────────────────────────────────────────────────────
  const actions = pane.addFolder({ title: "Actions" });
  actions.addButton({ title: "Copy as code" }).on("click", () => {
    if (instance !== null) Object.assign(state.material, instance.getMaterial());
    void copyText(toCode(state), "Code copied");
  });
  actions.addButton({ title: "Copy material JSON" }).on("click", () => {
    void copyText(JSON.stringify(instance?.getMaterial() ?? state.material, null, 2), "Material copied");
  });
  actions.addButton({ title: "Pause / Resume" }).on("click", () => {
    if (instance === null) return;
    if (instance.isPaused) instance.resume();
    else instance.pause();
  });
  actions.addButton({ title: "Reset to defaults" }).on("click", () => {
    if (!window.confirm("Reset material, gravity, drag and init settings to the defaults?")) return;
    Object.assign(state.material, PLAYGROUND_DEFAULT_MATERIAL);
    Object.assign(state.init, DEFAULT_PLAYGROUND_INIT);
    Object.assign(state.gravity, DEFAULT_PLAYGROUND_GRAVITY);
    const hadOff = state.dragOff;
    state.dragOff = [];
    for (const id of PLAYGROUND_ELEMENT_IDS) drag[id] = true;
    if (instance !== null) {
      instance.setMaterial({ ...PLAYGROUND_DEFAULT_MATERIAL });
      pushGravity();
      for (const id of hadOff) {
        const el = sceneElement(id);
        if (el === null) continue;
        instance.unobserve(el);
        instance.observe(el);
      }
    }
    ui.preset = detectPreset(state.material, presets);
    refreshPane();
    savePlaygroundState(state);
  });

  // ── Page chrome ────────────────────────────────────────────────────────
  // On a narrow screen the pane is a bottom sheet; it starts closed so the scene shows first.
  const toggle = $("pane-toggle");
  const setCollapsed = (collapsed: boolean): void => {
    mount.dataset.collapsed = String(collapsed);
    toggle?.setAttribute("aria-expanded", String(!collapsed));
  };
  if (window.matchMedia("(max-width: 1000px)").matches) setCollapsed(true);
  toggle?.addEventListener("click", () => setCollapsed(mount.dataset.collapsed !== "true"));
  $("restart")?.addEventListener("click", () => {
    const old = instance;
    instance = null;
    old?.destroy();
    showStopped(null);
    start();
  });

  start();
}

bootstrap();
