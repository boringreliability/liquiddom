---
ward: 24
revision: null
name: "Packaging, Exports, and NPM-Ready Distribution"
epic: "library-maturity"
status: "planned"
dependencies: [23]
layer: "typescript"
estimated_tests: 2
created: "2026-03-31"
completed: null
---
# Ward 024: Packaging, Exports, and NPM-Ready Distribution

## Scope
Klargjør LiquidDOM til NPM-distribution med ESM-first package, clean exports map, korrekte TypeScript declarations, og en build pipeline der producerer WASM + JS bundle. Sikrer at forbrugere kan `import { LiquidDOM } from 'liquiddom'` og få types, WASM og runtime i ét.

## Inputs
- Komplet public API fra Ward 013 (instance-based runtime)
- Configurable materials og types fra Ward 023
- Kompileret WASM modul fra Rust-kode

## Outputs
- `package.json` med korrekt `exports` map, `types`, `module` og `files` felter
- Build script der producerer: ESM bundle, TypeScript declarations, WASM binary
- Clean public API surface — kun intentional exports
- Klar til `npm publish`

## Specification

### Package.json Exports Map
```json
{
  "name": "liquiddom",
  "type": "module",
  "main": "./dist/index.js",
  "module": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    },
    "./wasm": {
      "types": "./dist/wasm.d.ts",
      "import": "./dist/wasm.js"
    }
  },
  "files": ["dist/", "README.md", "LICENSE"]
}
```

### Build Output Strategy
- `dist/index.js` — ESM entry med LiquidDOM class, config, presets, types re-export
- `dist/index.d.ts` — TypeScript declarations for hele public API
- `dist/wasm.js` — WASM loader/initializer (inline eller sidecar `.wasm` fil)
- `dist/wasm.d.ts` — Types for WASM exports
- `dist/*.wasm` — Compiled WASM binary

### Public API Surface
Kun disse eksporteres fra root entry:
- `LiquidDOM` class (instance-based API)
- `LiquidConfig` type
- `MaterialPreset` type
- `presets` objekt (goo, jelly, firm)
- `initWasm()` funktion (async WASM loader)

### Build Pipeline
- `wasm-pack build --target web` for Rust -> WASM
- TypeScript compilation med `declaration: true`
- Bundle step (evt. rollup/tsup) der samler output
- `prepublishOnly` script der kører fuld build

### Type Declarations
- Alle public types eksporteres og er tilgængelige for forbrugere
- Internal types (buffer offsets, FFI helpers) forbliver unexported
- `strict: true` i tsconfig

## Tests

| # | Test Name | Verifies |
|---|-----------|----------|
| 1 | `test_package_exports_resolve_correctly` | Node.js `import('liquiddom')` resolver til korrekt fil og eksporterer LiquidDOM, presets, initWasm |
| 2 | `test_types_are_valid` | `tsc --noEmit` på et test-projekt der importerer alle public types kompilerer uden fejl |

## Must NOT
- Ikke inkludere devDependencies, test-filer eller source maps i published package
- Ikke bruge CommonJS (`require`) — ESM-only
- Ikke eksponere interne buffer/FFI typer i public API
- Ikke bundle WASM som base64 string (hold som separat .wasm fil for streaming compilation)

## Must DO
- `"type": "module"` i package.json
- Exports map med `types` condition først (TypeScript resolution)
- `files` whitelist i package.json (kun dist/, README, LICENSE)
- `prepublishOnly` script der bygger alt
- WASM som sidecar fil med async loader

## Verification
- `npm pack --dry-run` viser kun forventede filer
- Et nyt tomt projekt kan `npm install ./liquiddom-x.x.x.tgz` og importere korrekt
- TypeScript compilation af consumer-projekt giver 0 errors
- Begge tests består
