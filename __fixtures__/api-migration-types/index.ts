/**
 * W66 (A3, B9, B10, D66-11): type-level old→new migration fixture. Each
 * `@ts-expect-error` line is a removed 0.2 API that MUST no longer compile;
 * every other line is 0.3 API that MUST compile. Checked from
 * api-migration.test.ts with `npx tsc --noEmit -p` (needs `npm run build`:
 * it resolves dist/*.d.ts through the workspace symlinks, like types-smoke).
 */
import { LiquidDOM } from "liquiddom";
import type * as Core from "liquiddom";
import type { ElementOptions, GravityOptions, LiquidDOMInstance, LiquidOptions, Material } from "liquiddom";
import type { LiquidElementProps, UseLiquidRefOptions } from "@liquiddom/react";
import type { UseLiquidRefOptions as VueUseLiquidRefOptions } from "@liquiddom/vue";

// ── Removed type exports ─────────────────────────────────────────────
// @ts-expect-error LiquidInstancePanicDetail is gone with the liquiddom:instance-panic event
import type { LiquidInstancePanicDetail } from "liquiddom";
// @ts-expect-error SpawnDropletOptions is gone: droplets are ordinary particles
import type { SpawnDropletOptions } from "liquiddom";
// @ts-expect-error LiquidPhysicsConfig is gone: use Material { viscosity, cohesion, recovery }
import type { LiquidPhysicsConfig } from "liquiddom";

// ── SplashOptions changed shape (B9) ────────────────────────────────
// 0.2: { threshold, count, jitter?, speedScale?, lifetimeMs?, radius? } (impulse() droplets).
// 0.3: { strength?, at? } for splash(el, opts), added in W67. Before W67 the
// type is absent; after W67 the old fields are excess properties. Both are errors.
// @ts-expect-error the 0.2 SplashOptions shape no longer type-checks
const oldSplash: Core.SplashOptions = { threshold: 5, count: 4, jitter: 1, speedScale: 0.3, lifetimeMs: 500, radius: 4 };

// ── Removed / renamed instance members ──────────────────────────────
declare const inst: LiquidDOMInstance;
declare const el: HTMLElement;
// @ts-expect-error grow() is gone: the pool is fixed at create()
inst.grow(256);
// @ts-expect-error observe(el, liquidType) is gone: pass ElementOptions
inst.observe(el, 3);
// @ts-expect-error getBuffer() is gone
inst.getBuffer();
// @ts-expect-error capacity was renamed to elementCapacity
void inst.capacity;
// @ts-expect-error tween() is gone
inst.tween(el, { toX: 0, toY: 0, duration: 100 });
// @ts-expect-error impulse() is gone (use splash(), W67)
inst.impulse(el, { magnitude: 10 });
// @ts-expect-error spawnDroplet() is gone
inst.spawnDroplet({ x: 0, y: 0, vx: 0, vy: 0 });
// @ts-expect-error despawnDroplet() is gone
inst.despawnDroplet(0);
// @ts-expect-error setPhysicsConfig() is gone (setMaterial() arrives in W68)
inst.setPhysicsConfig({ tension: 80 });
// @ts-expect-error getPhysicsConfig() is gone (getMaterial() arrives in W68)
inst.getPhysicsConfig();
// @ts-expect-error refreshTheme() was merged into refresh()
inst.refreshTheme(el);
// @ts-expect-error refreshShadow() was merged into refresh()
inst.refreshShadow(el);
// @ts-expect-error setBackgroundTexture() is gone with refraction
inst.setBackgroundTexture(null);
// @ts-expect-error isReducedMotion is gone (D66-5)
void inst.isReducedMotion;
// @ts-expect-error isScrolling is gone (D66-5)
void inst.isScrolling;
// @ts-expect-error pointerActive is gone (D66-5)
void inst.pointerActive;
// @ts-expect-error pointerX is gone
void inst.pointerX;
// @ts-expect-error pointerY is gone
void inst.pointerY;
// @ts-expect-error the preserveBackgrounds getter is gone
void inst.preserveBackgrounds;
// @ts-expect-error isScrollSnapping is gone with the W55 scroll lerp
void inst.isScrollSnapping;

// ── Removed options ─────────────────────────────────────────────────
// @ts-expect-error capacity → maxElements
const o1: LiquidOptions = { capacity: 8 };
// @ts-expect-error physics → material
const o2: LiquidOptions = { physics: { tension: 80 } };
// @ts-expect-error colorDefault removed (computed style)
const o3: LiquidOptions = { colorDefault: "rgb(0, 0, 0)" };
// @ts-expect-error colorHover removed
const o4: LiquidOptions = { colorHover: "rgb(0, 0, 0)" };
// @ts-expect-error colorSource removed
const o5: LiquidOptions = { colorSource: "computed" };
// @ts-expect-error theme removed (fusion/refraction)
const o6: LiquidOptions = { theme: { fusionRadius: 8 } };
// @ts-expect-error preserveBackgrounds removed (D8)
const o7: LiquidOptions = { preserveBackgrounds: true };
// @ts-expect-error snapDurationMs removed
const o8: LiquidOptions = { snapDurationMs: 150 };
// @ts-expect-error canvasZIndex removed (D7 stacking)
const o9: LiquidOptions = { canvasZIndex: -1 };
// @ts-expect-error maxDt removed (Rust clamps 100 ms)
const o10: LiquidOptions = { maxDt: 50 };

// ── The 0.3 API compiles ────────────────────────────────────────────
const options: LiquidOptions = {
  particles: 8000, maxElements: 32, renderer: "auto", material: { viscosity: 0.5, cohesion: 0.5, recovery: 0.7 },
  gravity: { source: "fixed", vector: [0, 980], strength: 980 }, seed: 1, autoObserve: true, forceReducedMotion: false, silentFallback: false,
};
const elementOptions: ElementOptions = { viscosity: 0.3, recovery: 1.2 };
const material: Material = { viscosity: 0.5, cohesion: 0.5, recovery: 0.7 };
const gravity: GravityOptions = { source: "orientation", strength: 600 };
const id: number = inst.observe(el, elementOptions);
const capacities: number = inst.particleCapacity + inst.elementCapacity;
const renderer: "canvas2d" | "webgpu" = inst.activeRenderer;
const created: Promise<LiquidDOMInstance> = LiquidDOM.create(options);
inst.refresh(el);

// ── Adapter prop types keep their names but change shape (B10) ──────
const reactRefOptions: UseLiquidRefOptions = { viscosity: 0.2, recovery: 0.9 };
// @ts-expect-error useLiquidRef({ liquidType }) is gone
const reactOldRefOptions: UseLiquidRefOptions = { liquidType: 3 };
const elementProps: LiquidElementProps = { as: "button", viscosity: 0.4, recovery: 1.5 };
// @ts-expect-error <LiquidElement liquidType> is gone
const oldElementProps: LiquidElementProps = { liquidType: 4 };
const vueRefOptions: VueUseLiquidRefOptions = { recovery: 2 };
// @ts-expect-error Vue useLiquidRef({ liquidType }) is gone
const vueOldRefOptions: VueUseLiquidRefOptions = { liquidType: 3 };

export const migrationFixture = {
  oldSplash, o1, o2, o3, o4, o5, o6, o7, o8, o9, o10, options, elementOptions, material, gravity, id, capacities,
  renderer, created, reactRefOptions, reactOldRefOptions, elementProps, oldElementProps, vueRefOptions, vueOldRefOptions,
};

// W67: the 0.3 SplashOptions shape type-checks (B9).
export const w67SplashNew: Core.SplashOptions = { strength: 1.5, at: { x: 10, y: 20 } };
export const w67SplashDefault: Core.SplashOptions = {};
// @ts-expect-error — `strength` is a number, not a string
export const w67SplashBadStrength: Core.SplashOptions = { strength: "1" };
