# Liquid DOM

## Identity
- **Name:** liquiddom
- **One-liner:** WASM/WGPU-driven fluid dynamics on web elements via hidden canvas, preserving a11y
- **License:** MIT

## North Star
The vision written as experiences, the canonical acceptance scene and the slice matrix live in [NORTH-STAR.md](NORTH-STAR.md). Every ward spec names the scene step(s) it moves (`North star:`), and every technique or scope choice passes a direction gate (`Decision:`) before the ward goes `red`. The fluid engine (Epic 15, W63+) replaces the soft-body model described under Architecture Overview; the soft-body engine is retired in W66.

## Architecture Overview
Rust er DOM-blind og Farve-blind — `wasm.tick()` genererer udelukkende matematisk fysik-tilstand (bounding boxes, partikler, fjedre). TypeScript ejer Render Loop, DOM-aflæsning og Theming. Kommunikation sker via en pre-allokeret flat `Float32Array` buffer i WASM memory (zero GC).

## Principles
- Rust beregner, TypeScript orkestrerer (Rule of Two)
- Zero-allocation FFI via flat buffer (ingen JSON over grænsen)
- Pre-allokeret memory pool (ingen entity churn)
- Defense-in-depth for buffer bounds
- A11y bevares via Phantom DOM

## Technology Stack
- Rust: Physics compute kernel, WGPU rendering
- TypeScript: DOM observation, render loop orchestration, theming
- WASM: FFI bridge (wasm-bindgen i senere Wards)
- WGPU/WGSL: GPU-accelereret rendering (SDF/Metaballs)

## Non-Goals
- Rust rører aldrig DOM eller farver
- Ingen JSON serialisering over FFI
- Ingen server-side rendering
