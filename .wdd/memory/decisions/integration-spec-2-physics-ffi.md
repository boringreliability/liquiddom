# Integration Spec 2: Physics FFI Protocol

**Date:** 2026-03-31
**Scope:** Integration mellem EntityBuffer (DOM state) og EntityBody (Soft Body Physics)

## Core Principle
DOM State is King. Physics follows.

TS ejer sandheden om elementers position (skrevet i EntityBuffer).
Rust tick(): læser x,y,w,h fra buffer → opdaterer base_pos → kører Hookes lov → skriver partikler til particle_data.

## Particle Memory Buffer
Separat flad buffer: `particle_data: Vec<f32>`
Layout: `[x0, y0, x1, y1, ...]` for alle partikler på tværs af entities.
`PARTICLES_PER_BODY = 16` → 32 floats per entity.
Eksponeret via `particle_ptr()`.

## Reallocation Trap 2.0
`grow()` skal resize bodies, particle_data. TS skal re-fetch `particle_ptr()`.
