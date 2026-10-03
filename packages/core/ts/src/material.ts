/**
 * Global liquid material (spec §2 "Material parameters"). W64 creates the
 * type and the defaults (decision D64-10, plan resolution A5); W66 adds
 * `validateMaterial` (@internal), W68 the presets and `setMaterial`/`getMaterial`.
 */
export interface Material {
  /** [0, 1], log-mapped to 100–2000 px²/s in Rust. */
  viscosity: number;
  /** [0, 1], mapped to TENSION_MAX 0.02–0.30. Global only. */
  cohesion: number;
  /** Seconds, [0.2, 3]. */
  recovery: number;
}

export const DEFAULT_MATERIAL: Readonly<Material> = Object.freeze({
  viscosity: 0.5,
  cohesion: 0.5,
  recovery: 0.7,
});
