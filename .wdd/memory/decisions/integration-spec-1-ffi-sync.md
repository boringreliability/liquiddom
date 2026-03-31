# Integration Spec 1: FFI Sync Protocol

**Date:** 2026-03-31
**Scope:** Integration mellem TypeScript PhantomObserver og Rust EntityBuffer

## Core Principle
Zero-Copy over FFI. Delt hukommelse — ikke JSON, ikke array-kopiering.

Rust allokerer bufferen (`EntityBuffer::new()`) og eksporterer pointer (`ptr()`).
TS opretter et `Float32Array` view direkte ind i Rusts RAM via WASM memory.

## Responsibility Matrix

| Concern | Owner | Where |
|---------|-------|-------|
| Allokering af Memory | Rust | `EntityBuffer::new()` |
| Reallokering (Grow) | Rust | `EntityBuffer::grow()` |
| Eksponering af Pointer | Rust | `EntityBuffer::ptr()` |
| Generering af WASM Bindings | Tooling | wasm-pack (Rust) |
| Oprettelse af JS Array View | TypeScript | `PhantomObserver` constructor/sync |
| Mutation af x,y,w,h | TypeScript | `PhantomObserver.sync()` skriver til array view |
| Fysik/Tick signal | TypeScript | Kalder exported `tick()` i Rust pr. frame |

## Data Flow (Frame Cycle)

1. **Setup:** TS instantierer Rust `EntityBuffer` via WASM
2. **View Creation:** TS henter pointer → `new Float32Array(wasm.memory.buffer, ptr, capacity * 8)`
3. **RAF Loop:**
   - TS `PhantomObserver.sync()` skriver x,y,w,h direkte i delt Float32Array
   - TS kalder `wasm_api.tick(delta_time)`
   - Rust tick() læser de nye koordinater (allerede i sin EntityBuffer — nul overhead)
   - Rust kører fysikberegninger (Ward 6)
   - Rust opdaterer samme adresser med nye resultater
4. **RAF Loop End**

## The Reallocation Trap

Når `Vec::resize` i `EntityBuffer::grow()` kører, kan OS flytte hele vektoren.
TS's `Float32Array` view bliver ugyldigt ("detached array buffer").

**Kontrakt:** Hvis TS anmoder om et nyt ID der kræver grow (`id >= capacity`),
SKAL TS hente ny pointer fra Rust og genskabe sit Float32Array view før der skrives.
