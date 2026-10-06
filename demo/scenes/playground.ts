/**
 * Ward 069: material playground (port of the W49 Tweakpane mechanism).
 *
 * Live: material (viscosity, cohesion, recovery) via setMaterial, presets
 * water/honey/jelly, splash/shake at a chosen strength, pause/resume.
 * Init-only (reload): particles, seed, renderer, forceReducedMotion.
 * State persists under liquiddom-playground-v2 (D69-1).
 */
import { Pane } from "tweakpane";
import {
  LiquidDOM,
  WebGPUUnavailableError,
  presets,
  type LiquidDOMInstance,
  type LiquidOptions,
  type Material,
} from "liquiddom";
import {
  DEFAULT_PLAYGROUND_INIT,
  MATERIAL_BOUNDS,
  MATERIAL_KEYS,
  PARTICLES_MAX,
  PARTICLES_MIN,
  PLAYGROUND_DEFAULT_MATERIAL,
  SEED_MAX,
  applyMaterialChange,
  buildInitialState,
  detectPreset,
  loadPlaygroundState,
  parseUrlParams,
  savePlaygroundState,
  type PlaygroundState,
  type PresetChoice,
  type PresetName,
} from "./playground-state";

const MATERIAL_SLIDERS: Readonly<Record<keyof Material, { step: number; label: string }>> = {
  viscosity: { step: 0.01, label: "viscosity" },
  cohesion: { step: 0.01, label: "cohesion (global)" },
  recovery: { step: 0.05, label: "recovery (s)" },
};

interface PlaygroundHandle {
  instance: LiquidDOMInstance;
  state: PlaygroundState;
  presets: typeof presets;
  applyPreset(name: PresetName): void;
}

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

async function createInstance(state: PlaygroundState): Promise<LiquidDOMInstance> {
  const options: LiquidOptions = {
    particles: state.init.particles,
    seed: state.init.seed,
    renderer: state.init.renderer,
    forceReducedMotion: state.init.forceReducedMotion,
    material: { ...state.material },
    autoObserve: true,
  };
  if (state.init.renderer !== "webgpu") return LiquidDOM.create(options);
  try {
    return await LiquidDOM.create(options);
  } catch (err) {
    if (!(err instanceof WebGPUUnavailableError)) throw err;
    console.warn("[playground] WebGPU unavailable, falling back to canvas2d:", err);
    return LiquidDOM.create({ ...options, renderer: "canvas2d" });
  }
}

function showRendererBadge(active: "canvas2d" | "webgpu"): void {
  const badge = document.getElementById("renderer-badge");
  if (badge === null) return;
  badge.textContent = `renderer: ${active}`;
  badge.dataset.renderer = active;
}

function showToast(msg: string): void {
  const toast = document.getElementById("toast");
  if (toast === null) return;
  toast.textContent = msg;
  toast.setAttribute("data-visible", "true");
  setTimeout(() => toast.setAttribute("data-visible", "false"), 1500);
}

async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // Fallback for insecure contexts and older browsers (W49).
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
  }
  showToast("Copied!");
}

async function bootstrap(): Promise<void> {
  const state = buildInitialState(loadPlaygroundState(), parseUrlParams(), PLAYGROUND_DEFAULT_MATERIAL);
  const instance = await createInstance(state);
  Object.assign(state.material, instance.getMaterial()); // the instance is the source of truth
  showRendererBadge(instance.activeRenderer);

  const ui: { preset: PresetChoice; strength: number } = { preset: detectPreset(state.material, presets), strength: 1 };
  const info = {
    activeRenderer: instance.activeRenderer,
    particles: String(instance.particleCapacity),
    elements: String(instance.elementCapacity),
  };

  const { debounced: saveDebounced, flush: saveFlush } = debounce(() => {
    // Tweakpane's step constraint rewrites bound values on refresh (0.7 becomes
    // 0.7000000000000001). The instance holds the exact accepted material.
    Object.assign(state.material, instance.getMaterial());
    savePlaygroundState(state);
  }, 250);
  window.addEventListener("beforeunload", saveFlush);

  const mount = document.getElementById("tweak-mount");
  if (mount === null) throw new Error("[playground] #tweak-mount not found");
  const pane = new Pane({ container: mount, title: "liquiddom: material" });

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
    instance.setMaterial({ ...presets[name] });
    ui.preset = name;
    refreshPane();
    saveDebounced();
  }

  pane
    .addBinding(ui, "preset", {
      label: "preset",
      options: { custom: "custom", water: "water", honey: "honey", jelly: "jelly" },
    })
    .on("change", (ev) => {
      if (refreshing || ev.value === "custom") return;
      applyPreset(ev.value);
    });

  const materialFolder = pane.addFolder({ title: "Material (live)" });
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
        const accepted = applyMaterialChange(instance, state, key);
        ui.preset = detectPreset(state.material, presets);
        refreshPane();
        if (accepted) saveDebounced();
      });
  }

  const interaction = pane.addFolder({ title: "Interaction" });
  interaction.addBinding(ui, "strength", { min: 0, max: 2, step: 0.05, label: "strength" });
  interaction.addButton({ title: "Splash every element" }).on("click", () => {
    for (const el of document.querySelectorAll<HTMLElement>("[data-liquid]")) {
      instance.splash(el, { strength: ui.strength });
    }
  });
  interaction.addButton({ title: "Shake" }).on("click", () => {
    instance.shake(ui.strength);
  });

  const initFolder = pane.addFolder({ title: "Init-only (reload required)", expanded: false });
  initFolder.addBinding(state.init, "particles", { min: PARTICLES_MIN, max: PARTICLES_MAX, step: 256 }).on("change", () => saveDebounced());
  initFolder.addBinding(state.init, "seed", { min: 0, max: SEED_MAX, step: 1 }).on("change", () => saveDebounced());
  initFolder
    .addBinding(state.init, "renderer", { options: { auto: "auto", canvas2d: "canvas2d", webgpu: "webgpu" } })
    .on("change", () => saveDebounced());
  initFolder.addBinding(state.init, "forceReducedMotion").on("change", () => saveDebounced());
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
  infoFolder.addBinding(info, "activeRenderer", { readonly: true, label: "renderer" });
  infoFolder.addBinding(info, "particles", { readonly: true, label: "particles" });
  infoFolder.addBinding(info, "elements", { readonly: true, label: "max elements" });

  const actions = pane.addFolder({ title: "Actions" });
  actions.addButton({ title: "Copy material JSON" }).on("click", () => {
    void copyText(JSON.stringify(instance.getMaterial(), null, 2));
  });
  actions.addButton({ title: "Reset to defaults" }).on("click", () => {
    if (!window.confirm("Reset material and init settings to defaults?")) return;
    Object.assign(state.material, PLAYGROUND_DEFAULT_MATERIAL);
    Object.assign(state.init, DEFAULT_PLAYGROUND_INIT);
    instance.setMaterial({ ...PLAYGROUND_DEFAULT_MATERIAL });
    ui.preset = detectPreset(state.material, presets);
    refreshPane();
    savePlaygroundState(state);
  });
  actions.addButton({ title: "Pause / Resume" }).on("click", () => {
    if (instance.isPaused) instance.resume();
    else instance.pause();
  });

  const toggle = document.getElementById("pane-toggle");
  toggle?.addEventListener("click", () => {
    const collapsed = mount.getAttribute("data-collapsed") === "true";
    mount.setAttribute("data-collapsed", String(!collapsed));
  });

  const handle: PlaygroundHandle = { instance, state, presets, applyPreset };
  (window as unknown as { __playground: PlaygroundHandle }).__playground = handle;
}

bootstrap().catch((err: unknown) => {
  console.error("[playground] bootstrap failed:", err);
});
