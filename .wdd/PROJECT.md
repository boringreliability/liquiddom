# Liquid DOM

## Identity
- **Name:** liquiddom
- **One-liner:** WASM/WGPU-driven fluid dynamics on web elements via hidden canvas, preserving a11y
- **License:** MIT

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
