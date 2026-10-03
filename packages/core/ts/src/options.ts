/**
 * Public option types. W64 creates only `ElementOptions` (decision D64-10,
 * plan resolution A5); W66 adds `LiquidOptions`, `GravityOptions`,
 * `resolveOptions()` and the validation (C3), W68 adds `SplashOptions`.
 */
export interface ElementOptions {
  /** Per-element viscosity override in [0, 1]. Omitted = material default. */
  viscosity?: number;
  /** Per-element recovery override in seconds, [0.2, 3]. Omitted = material default. */
  recovery?: number;
}
