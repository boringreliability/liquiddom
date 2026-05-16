/**
 * Ward 049: Visual Playground UI.
 *
 * Wires Tweakpane to LiquidDOM.setPhysicsConfig for live physics tweaking.
 * Color changes trigger an instance rebuild (v1 limitation — see W52 follow-up).
 * State persists to localStorage; URL params override init-only fields.
 */
import { Pane } from "tweakpane";
import { LiquidDOM, presets, type LiquidPhysicsConfig } from "liquiddom";
import {
  loadPlaygroundState,
  parseUrlParams,
  PLAYGROUND_STORAGE_KEY,
  type PlaygroundState,
} from "./playground-state";

const DEFAULT_THEME = {
  colorDefault: "rgba(15, 52, 96, 0.75)",
  colorHover: "rgba(233, 69, 96, 0.85)",
};

const DEFAULT_INIT = {
  capacity: 64,
  forceReducedMotion: false,
  preserveBackgrounds: true, // W53: rounded-rect clip now matches border-radius
};

type PresetName = "custom" | "goo" | "jelly" | "firm";

interface PlaygroundConfig {
  preset: PresetName;
  physics: Required<LiquidPhysicsConfig>;
  theme: { colorDefault: string; colorHover: string };
  init: { capacity: number; forceReducedMotion: boolean; preserveBackgrounds: boolean };
}

// `playground-state.ts` validates `physics` and `theme` but not `init` (it's
// playground-only, not part of the LiquidDOM core schema). We re-read it here
// as an optional extension of the saved payload.
type SavedWithInit = PlaygroundState & { init?: typeof DEFAULT_INIT };

function buildInitialState(): PlaygroundConfig {
  const saved = loadPlaygroundState() as SavedWithInit | null;
  const urlOverrides = parseUrlParams();
  const savedInit = saved?.init;
  const physics = { ...DEFAULT_PHYSICS, ...(saved?.physics ?? {}) };
  return {
    preset: detectPreset(physics),
    physics,
    theme: { ...DEFAULT_THEME, ...(saved?.theme ?? {}) },
    init: {
      capacity: urlOverrides.capacity ?? savedInit?.capacity ?? DEFAULT_INIT.capacity,
      forceReducedMotion: urlOverrides.forceReducedMotion ?? savedInit?.forceReducedMotion ?? DEFAULT_INIT.forceReducedMotion,
      preserveBackgrounds: urlOverrides.preserveBackgrounds ?? savedInit?.preserveBackgrounds ?? DEFAULT_INIT.preserveBackgrounds,
    },
  };
}

// Default physics constants (mirror of DEFAULT_PHYSICS in ts/src/index.ts —
// kept local to avoid an internal-export expansion just for the playground).
const DEFAULT_PHYSICS: Required<LiquidPhysicsConfig> = {
  tension: 100,
  damping: 5,
  repulsionRadius: 100,
  repulsionStrength: 5000,
  particleCount: 16,
  substeps: 1,
  neighborSpringK: 30,
};

function detectPreset(physics: Required<LiquidPhysicsConfig>): PresetName {
  for (const name of ["goo", "jelly", "firm"] as const) {
    if (matchesPreset(physics, presets[name])) return name;
  }
  return "custom";
}

function matchesPreset(physics: Required<LiquidPhysicsConfig>, preset: Partial<LiquidPhysicsConfig>): boolean {
  for (const [key, presetVal] of Object.entries(preset)) {
    if (presetVal === undefined) continue;
    const currentVal = physics[key as keyof LiquidPhysicsConfig] as number;
    if (key === "damping") {
      // step 0.1 — round to 1 decimal for comparison (spec §3)
      if (Math.round(currentVal * 10) !== Math.round((presetVal as number) * 10)) return false;
    } else {
      if (currentVal !== presetVal) return false;
    }
  }
  return true;
}

function debounce<T extends (...args: never[]) => void>(fn: T, ms: number) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const debounced = (...args: Parameters<T>) => {
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      fn(...args);
    }, ms);
  };
  const flush = () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
      fn();
    }
  };
  return { debounced, flush };
}

async function bootstrap() {
  const state = buildInitialState();

  let instance = await LiquidDOM.create({
    capacity: state.init.capacity,
    autoObserve: true,
    forceReducedMotion: state.init.forceReducedMotion,
    preserveBackgrounds: state.init.preserveBackgrounds,
    colorDefault: state.theme.colorDefault,
    colorHover: state.theme.colorHover,
    physics: state.physics,
  });

  // ── Persistence ──
  function save() {
    const payload: PlaygroundState & { init: typeof state.init } = {
      schema: 1,
      physics: state.physics,
      theme: state.theme,
      init: state.init,
    };
    try {
      localStorage.setItem(PLAYGROUND_STORAGE_KEY, JSON.stringify(payload));
    } catch {
      // Quota / private mode — silently skip.
    }
  }

  const { debounced: saveDebounced, flush: saveFlush } = debounce(save, 250);
  window.addEventListener("beforeunload", saveFlush);

  // ── Tweakpane ──
  const mount = document.getElementById("tweak-mount");
  if (!mount) throw new Error("playground: #tweak-mount not found");

  const pane = new Pane({ container: mount, title: "Liquid DOM" });

  // Feedback-loop guard (spec §3)
  let settingPreset = false;

  // Preset dropdown
  const presetBinding = pane.addBinding(state, "preset", {
    label: "Preset",
    options: { custom: "custom", goo: "goo", jelly: "jelly", firm: "firm" },
  });
  presetBinding.on("change", (ev) => {
    const name = ev.value as PresetName;
    if (name === "custom") return;
    settingPreset = true;
    Object.assign(state.physics, presets[name]);
    instance.setPhysicsConfig(state.physics);
    pane.refresh();
    settingPreset = false;
    saveDebounced();
  });

  // Physics folder (live-tunable)
  const physicsFolder = pane.addFolder({ title: "Physics" });
  const physicsBindings: Array<{ key: keyof LiquidPhysicsConfig; opts: Record<string, unknown> }> = [
    { key: "tension", opts: { min: 1, max: 500, step: 1 } },
    { key: "damping", opts: { min: 0, max: 30, step: 0.1 } },
    { key: "repulsionRadius", opts: { min: 0, max: 300, step: 1 } },
    { key: "repulsionStrength", opts: { min: 0, max: 20000, step: 100 } },
    { key: "substeps", opts: { min: 1, max: 8, step: 1 } },
    { key: "neighborSpringK", opts: { min: 0, max: 100, step: 1 } },
  ];
  for (const { key, opts } of physicsBindings) {
    physicsFolder.addBinding(state.physics, key, opts).on("change", () => {
      try {
        instance.setPhysicsConfig({ [key]: state.physics[key] });
      } catch {
        // Validation error — Tweakpane already wrote into state.physics.
        // Revert in a more sophisticated v2; for v1, allow visual feedback.
      }
      if (!settingPreset) {
        const detected = detectPreset(state.physics);
        if (state.preset !== detected) {
          state.preset = detected;
          pane.refresh();
        }
      }
      saveDebounced();
    });
  }

  // Theme folder (rebuild on change — v1 limitation)
  let rebuildSeq = 0;
  const rebuildColors = debounce(() => {
    const mySeq = ++rebuildSeq;
    instance.destroy();
    LiquidDOM.create({
      capacity: state.init.capacity,
      autoObserve: true,
      forceReducedMotion: state.init.forceReducedMotion,
      preserveBackgrounds: state.init.preserveBackgrounds,
      colorDefault: state.theme.colorDefault,
      colorHover: state.theme.colorHover,
      physics: state.physics,
    }).then((next) => {
      if (mySeq !== rebuildSeq) {
        next.destroy();
        return;
      }
      instance = next;
    }).catch((err) => {
      console.error("[playground] color rebuild failed:", err);
    });
  }, 150);
  const themeFolder = pane.addFolder({ title: "Theme" });
  function onThemeChange() {
    rebuildColors.debounced();
    saveDebounced();
  }
  themeFolder.addBinding(state.theme, "colorDefault").on("change", onThemeChange);
  themeFolder.addBinding(state.theme, "colorHover").on("change", onThemeChange);

  // Init-only folder (read-only display; reload button)
  const initFolder = pane.addFolder({ title: "Init-only (reload required)", expanded: false });
  initFolder.addBinding(state.init, "capacity", { min: 1, max: 512, step: 1 });
  initFolder.addBinding(state.init, "forceReducedMotion");
  initFolder.addBinding(state.init, "preserveBackgrounds");
  initFolder.addButton({ title: "Reload with these settings" }).on("click", () => {
    const params = new URLSearchParams({
      capacity: String(state.init.capacity),
      forceReducedMotion: String(state.init.forceReducedMotion),
      preserveBackgrounds: String(state.init.preserveBackgrounds),
    });
    window.location.search = "?" + params.toString();
  });

  // Actions
  const actions = pane.addFolder({ title: "Actions" });
  actions.addButton({ title: "Copy config" }).on("click", async () => {
    const json = JSON.stringify(
      { physics: state.physics, theme: state.theme, init: state.init },
      null,
      2,
    );
    try {
      await navigator.clipboard.writeText(json);
      showToast("Copied!");
    } catch {
      // Fallback for older browsers / insecure contexts
      const ta = document.createElement("textarea");
      ta.value = json;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      showToast("Copied!");
    }
  });
  actions.addButton({ title: "Reset to defaults" }).on("click", () => {
    // window.confirm is acceptable for v1 — known limitation: blocks event loop
    // and cannot be styled. Embedded contexts (iframes) may suppress it.
    if (!window.confirm("Reset all settings to defaults?")) return;
    Object.assign(state.physics, DEFAULT_PHYSICS);
    Object.assign(state.theme, DEFAULT_THEME);
    Object.assign(state.init, DEFAULT_INIT);
    state.preset = "custom";
    settingPreset = true;
    instance.setPhysicsConfig(state.physics);
    pane.refresh();
    settingPreset = false;
    localStorage.removeItem(PLAYGROUND_STORAGE_KEY);
    rebuildColors.debounced();
    saveDebounced();
  });
  let paused = false;
  actions.addButton({ title: "Pause / Resume" }).on("click", () => {
    if (paused) {
      instance.resume();
    } else {
      instance.pause();
    }
    paused = !paused;
  });

  // Mobile pane toggle
  const toggleBtn = document.getElementById("pane-toggle");
  toggleBtn?.addEventListener("click", () => {
    const collapsed = mount.getAttribute("data-collapsed") === "true";
    mount.setAttribute("data-collapsed", String(!collapsed));
  });
}

function showToast(msg: string) {
  const toast = document.getElementById("toast");
  if (!toast) return;
  toast.textContent = msg;
  toast.setAttribute("data-visible", "true");
  setTimeout(() => toast.setAttribute("data-visible", "false"), 1500);
}

bootstrap().catch((err) => {
  console.error("[playground] bootstrap failed:", err);
});
