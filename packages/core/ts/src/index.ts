/**
 * liquiddom 0.3 public facade (W66, spec §5). Wraps the internal fluid
 * runtime (runtime.ts, W64) behind LiquidDOM.create(). Everything not listed
 * in the exports below is internal.
 */
import { createFluidRuntime } from "./runtime";
import {
  resolveOptions,
  validateElementOptions,
  validateShakeStrength,
  validateSplashOptions,
  type ElementOptions,
  type GravityOptions,
  type LiquidOptions,
  type SplashOptions,
} from "./options";
import { mergeMaterial, snapshotMaterial, validateMaterial, type Material } from "./material";
import { LiquidWasmLoadError } from "./wasm-loader";
import { WebGPUUnavailableError } from "./renderers/webgpu/errors";
import { bindRuntime, unbindRuntime } from "./internal";

export { LiquidWasmLoadError, WebGPUUnavailableError, validateMaterial };
export { presets } from "./material";
export type { ElementOptions, GravityOptions, LiquidOptions, Material, SplashOptions };

export interface LiquidDOMInstance {
  /** Observe an element (idempotent). Returns its slot id. RangeError when all maxElements slots are taken. */
  observe(el: HTMLElement, opts?: ElementOptions): number;
  /** Stop observing; the element is restored exactly. Silent no-op after destroy(). */
  unobserve(el: HTMLElement): void;
  /** Re-read the element's background-color and color (needed after colour changes until slice 4). */
  refresh(el: HTMLElement): void;
  /**
   * Splash an observed element (spec §5). `strength` 0–2 (default 1, 0 = no-op);
   * `at` in client px (default: the rect centre). Throws `TypeError` for invalid
   * options or a non-element, and `Error` if `el` is not observed or the instance
   * is destroyed. Ignored under reduced motion.
   */
  splash(el: HTMLElement, opts?: SplashOptions): void;
  /**
   * Shake every observed element. `strength` 0–2 (default 1, 0 = no-op). Throws
   * `TypeError` when `strength` is not a finite number in [0, 2], and `Error` when
   * the instance is destroyed. Ignored under reduced motion.
   */
  shake(strength?: number): void;
  /** Validate, merge and apply a material change atomically (TypeError on invalid input; state unchanged). */
  setMaterial(partial: Partial<Material>): void;
  /** A copy of the current material. */
  getMaterial(): Material;
  pause(): void;
  resume(): void;
  destroy(): void;
  /** iOS 13+: call from a user gesture. True when granted or not required. */
  requestOrientationPermission(): Promise<boolean>;
  /** Observe/unobserve `[data-liquid]` nodes as they are added/removed under `root`. */
  autoDiscover(root?: Element): void;
  stopAutoDiscover(): void;
  readonly isPaused: boolean;
  readonly activeRenderer: "canvas2d" | "webgpu";
  readonly particleCapacity: number;
  readonly elementCapacity: number;
}

const AUTO_ATTR = "data-liquid";

function candidatesIn(root: ParentNode): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(`[${AUTO_ATTR}]`));
}

export class LiquidDOM {
  private constructor() {}

  static async create(options?: LiquidOptions): Promise<LiquidDOMInstance> {
    const o = resolveOptions(options);
    if (typeof window === "undefined" || typeof document === "undefined") {
      throw new Error("[liquiddom] LiquidDOM.create() needs a browser environment (window and document)");
    }
    const root: ParentNode = o.container ?? document;
    // D66-13: the autoObserve candidates are the runtime's initialElements (area_hint).
    const initial = o.autoObserve ? candidatesIn(root) : [];
    // Gravity is resolved and validated but has no effect until slice 6 (spec §6 interim state).
    // silentFallback is validated only: no fallback log exists before slice 3 (B13).
    const runtime = await createFluidRuntime({
      particles: o.particles,
      maxElements: o.maxElements,
      seed: o.seed,
      container: o.container,
      initialElements: initial,
      forceReducedMotion: o.forceReducedMotion,
      material: o.material,
      renderer: o.renderer,
      testBackend: o.testBackend,
      loader: o.loader,
      clock: o.clock,
    });

    let destroyed = false;
    // W68 (D68-9): current material, the single source of truth for getMaterial().
    let material: Material = { ...o.material };
    let discovery: MutationObserver | null = null;
    let warnedOverflow = false;

    const live = (method: string): void => {
      if (destroyed) throw new Error(`[liquiddom] ${method}() called on a destroyed instance`);
    };

    /** D66-10: discovery never throws on overflow; it warns once and skips. */
    const observeQuietly = (el: HTMLElement): void => {
      try {
        runtime.observe(el);
      } catch (err) {
        if (!(err instanceof RangeError)) throw err;
        if (!warnedOverflow) {
          warnedOverflow = true;
          console.warn(`[liquiddom] more [${AUTO_ATTR}] elements than maxElements (${runtime.bridge.elementCapacity}); the extra elements are not observed`);
        }
      }
    };

    try {
      // W66.5 fix 2: the WASM load is async; a candidate removed meanwhile still fed
      // the area hint above, but it is not observed.
      for (const el of initial) if (el.isConnected) observeQuietly(el);
    } catch (err) {
      runtime.destroy();
      throw err;
    }

    const instance: LiquidDOMInstance = {
      observe(el: HTMLElement, opts?: ElementOptions): number {
        live("observe");
        if (typeof HTMLElement === "undefined" || !(el instanceof HTMLElement)) {
          throw new TypeError("[liquiddom] observe(el): el must be an HTMLElement");
        }
        validateElementOptions(opts);
        return runtime.observe(el, opts);
      },

      unobserve(el: HTMLElement): void {
        if (destroyed) return;
        runtime.unobserve(el);
      },

      refresh(el: HTMLElement): void {
        live("refresh");
        runtime.refresh(el);
      },

      splash(el: HTMLElement, opts?: SplashOptions): void {
        live("splash");
        if (typeof HTMLElement === "undefined" || !(el instanceof HTMLElement)) {
          throw new TypeError("[liquiddom] splash(el): el must be an HTMLElement");
        }
        const { strength, at } = validateSplashOptions(opts);
        if (!runtime.splash(el, at, strength)) {
          throw new Error("[liquiddom] splash: element is not observed");
        }
      },

      shake(strength?: number): void {
        live("shake");
        runtime.shake(validateShakeStrength(strength));
      },

      setMaterial(partial: Partial<Material>): void {
        live("setMaterial");
        // W68 green review: read the caller's values once (getters included), then
        // validate and merge that snapshot, so the core and getMaterial() agree.
        const snap = snapshotMaterial(partial);
        validateMaterial(snap); // W66: TypeError for non-objects, unknown keys (named), bad values
        const next = mergeMaterial(material, snap);
        runtime.setMaterial(next);
        material = next;
      },

      getMaterial(): Material {
        live("getMaterial");
        return { ...material };
      },

      pause(): void {
        live("pause");
        runtime.pause();
      },

      resume(): void {
        live("resume");
        runtime.resume();
      },

      destroy(): void {
        if (destroyed) return;
        destroyed = true;
        discovery?.disconnect();
        discovery = null;
        unbindRuntime(instance);
        runtime.destroy();
      },

      async requestOrientationPermission(): Promise<boolean> {
        live("requestOrientationPermission");
        const ctor = (window as unknown as {
          DeviceOrientationEvent?: { requestPermission?: () => Promise<"granted" | "denied"> };
        }).DeviceOrientationEvent;
        if (!ctor || typeof ctor.requestPermission !== "function") return true;
        try {
          return (await ctor.requestPermission()) === "granted";
        } catch {
          return false;
        }
      },

      autoDiscover(rootEl?: Element): void {
        live("autoDiscover");
        if (discovery) return;
        // W66.5 fix 4: in container mode the root must be the container or inside it.
        if (rootEl && o.container && !o.container.contains(rootEl)) {
          throw new TypeError("[liquiddom] autoDiscover(root): root must be the container or an element inside it");
        }
        const target: Node | null = rootEl ?? o.container ?? document.body;
        if (!target) {
          throw new Error("[liquiddom] autoDiscover needs a document body (or a root element) to observe");
        }
        discovery = new MutationObserver((records) => {
          if (destroyed) return;
          for (const record of records) {
            record.addedNodes.forEach((node) => {
              if (!(node instanceof HTMLElement)) return;
              if (node.hasAttribute(AUTO_ATTR)) observeQuietly(node);
              for (const child of candidatesIn(node)) observeQuietly(child);
            });
            record.removedNodes.forEach((node) => {
              if (!(node instanceof HTMLElement)) return;
              if (node.hasAttribute(AUTO_ATTR)) runtime.unobserve(node);
              for (const child of candidatesIn(node)) runtime.unobserve(child);
            });
          }
        });
        discovery.observe(target, { childList: true, subtree: true });
      },

      stopAutoDiscover(): void {
        live("stopAutoDiscover");
        discovery?.disconnect();
        discovery = null;
      },

      get isPaused(): boolean {
        return runtime.isPaused;
      },
      get activeRenderer(): "canvas2d" | "webgpu" {
        return runtime.activeRenderer;
      },
      get particleCapacity(): number {
        return runtime.bridge.particleCapacity;
      },
      get elementCapacity(): number {
        return runtime.bridge.elementCapacity;
      },
    };

    bindRuntime(instance, runtime);
    return instance;
  }
}
