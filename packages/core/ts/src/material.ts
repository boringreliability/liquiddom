/**
 * Material (spec §2 "Material parameters"): viscosity and cohesion are
 * normalised [0, 1]; recovery is seconds in [0.2, 3]. W64 created the type and
 * DEFAULT_MATERIAL; W66 adds validation (D66-8) and the full merge (D66-14);
 * W68 adds presets.
 */
export interface Material {
  viscosity: number;
  cohesion: number;
  recovery: number;
}

export const DEFAULT_MATERIAL: Readonly<Material> = Object.freeze({ viscosity: 0.5, cohesion: 0.5, recovery: 0.7 });

export const MATERIAL_RANGES: Readonly<Record<keyof Material, readonly [number, number]>> = Object.freeze({
  viscosity: [0, 1] as const,
  cohesion: [0, 1] as const,
  recovery: [0.2, 3] as const,
});

const MATERIAL_KEYS: readonly (keyof Material)[] = ["viscosity", "cohesion", "recovery"];

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** @internal Throws TypeError for non-objects, unknown keys, and non-finite or out-of-range values. `undefined` values are ignored. */
export function validateMaterial(m: Partial<Material>): void {
  const raw: unknown = m;
  if (!isObject(raw)) {
    throw new TypeError(`[liquiddom] material must be an object, got ${Array.isArray(raw) ? "an array" : String(raw)}`);
  }
  for (const key of Object.keys(raw)) {
    if (!(MATERIAL_KEYS as readonly string[]).includes(key)) {
      throw new TypeError(`[liquiddom] unknown material key "${key}" (allowed: ${MATERIAL_KEYS.join(", ")})`);
    }
  }
  for (const key of MATERIAL_KEYS) {
    const v = raw[key];
    if (v === undefined) continue;
    const [lo, hi] = MATERIAL_RANGES[key];
    if (typeof v !== "number" || !Number.isFinite(v) || v < lo || v > hi) {
      throw new TypeError(`[liquiddom] material.${key} must be a finite number in [${lo}, ${hi}], got ${typeof v === "string" ? JSON.stringify(v) : String(v)}`);
    }
  }
}

/** D66-14: a fresh, complete copy of `base` with every defined key of `partial` applied. Call validateMaterial first. */
export function mergeMaterial(base: Readonly<Material>, partial: Partial<Material>): Material {
  const out: Material = { viscosity: base.viscosity, cohesion: base.cohesion, recovery: base.recovery };
  for (const key of MATERIAL_KEYS) {
    const v = partial[key];
    if (v !== undefined) out[key] = v;
  }
  return out;
}
