---
ward: 47
revision: 4
name: "@liquiddom/react Adapter Package"
epic: "framework-adapters-dx"
status: "complete"
dependencies: []
layer: "typescript"
estimated_tests: 9
created: "2026-05-10"
completed: "2026-05-13"
---
# Ward 047: @liquiddom/react Adapter Package

## Scope
First-party React bindings for LiquidDOM. A `<LiquidProvider>` owns a single instance and exposes it via React Context; a `useLiquidRef()` hook returns a callback ref that automatically observes/unobserves a host element across its lifecycle; a `<LiquidElement>` convenience component wraps any tag with auto-observation. React-only adapter — zero changes to the core library.

This ward pre-stages the adapter in `adapters/react/` (a flat directory inside the repo). W51 will later move it into a published `packages/react/` workspace with its own `@liquiddom/react` npm name. Until W51, the adapter is consumed via relative imports from the example app.

## Revision history
- **r1**: initial fleshed-out spec.
- **r2**: addresses initial spec-review findings.
  - Pre-condition added: `npm test` must report 145 tests before starting (baseline assertion).
  - Test #1 / #3 / #4 consumer-component and `getBoundingClientRect` mock patterns made explicit.
  - `vitest.config.ts` requirement dropped — Vitest's default TSX transform + per-file `@vitest-environment jsdom` directive is sufficient (verified against existing test pattern).
  - `tsconfig.json` `rootDir: "ts"` conflict resolved: remove `rootDir`, expand `include` to cover both `ts/**/*` and `adapters/**/*`.
  - SSR test added as test #8; `estimated_tests` 7 → 8.
  - Closure-capture explanation added to §4 strict-mode analysis.
  - `setInstance(null)` removed from provider cleanup (post-unmount state update is harmless but generates test warnings).
  - CLAUDE.md update text made concrete.
  - Example app: explicit pre-flight note + `dev` script that runs `npm run build:wasm` from repo root.
- **r3**: r2 review verified all 10 r1 items fixed. Surfaced two new should-fix items now addressed:
  - Verification section arithmetic corrected: 145 prior + 8 new = 153 (was incorrectly 152 / 7).
  - Tests #3 and #4 slot-index ambiguity resolved by mandating `capacity: 1` + `autoObserve: false` in the provider — guarantees the test's observed element lands in slot 0 deterministically.
- **r4** (this revision): red-phase test review surfaced 2 must-fix + 3 should-fix gaps. Test count expanded from 8 → 9.
  - Test #6 strict-mode: added `vi.spyOn(observe)` assertion for `toHaveBeenCalledTimes(2)` + same-id idempotency check.
  - **New test #9**: `useLiquidRef_forwards_liquidType_to_observe` — verifies slot[5] holds the passed `liquidType` (covers FFI strategy-selection path).
  - Test #2 destroy spy: explicit `vi.spyOn(instance, 'destroy')` before unmount.
  - Test #7: added `Capture` + observe spy to verify LiquidElement actually goes through `useLiquidRef`.
  - `afterEach` DOM cleanup added (matches `runtime-truth.test.ts` pattern).
  - Verification arithmetic: 145 prior + 9 new = 154; CONTEXT.md row updated accordingly.

## Inputs
- Public `LiquidDOM.create(options)` from `ts/src/index.ts`
- `LiquidDOMInstance` interface (observe/unobserve, getPhysicsConfig, setPhysicsConfig, destroy)
- W14 invariant: `observe()` is idempotent — verified at `ts/__tests__/liquiddom-api.test.ts:145` (test name `it duplicate observe returns same id`)
- React 18+ (Concurrent Mode, strict-mode double-effect-invoke discipline)
- `@testing-library/react` ^16 (supports React 18 and 19) for component-level tests in jsdom

## Pre-conditions
- Run `npm test` before starting; it MUST report exactly 145 tests (43 Rust + 102 TS). If the count differs, reconcile with `CONTEXT.md` and any in-flight wards before proceeding.

## Outputs
- `adapters/react/index.tsx` — single-file public API (sub-modules optional, deferred until size warrants split)
- `adapters/react/__tests__/react-adapter.test.tsx` — 8 unit tests (uses `@vitest-environment jsdom` directive at file top, matching existing test pattern)
- `examples/react/` — minimal Vite + React sample (entry `index.html`, `main.tsx`, `package.json`, `tsconfig.json`, `vite.config.ts`) using the adapter via relative import
- `package.json` updated with devDependencies: `react@^18.2.0`, `react-dom@^18.2.0`, `@types/react@^18.2.0`, `@types/react-dom@^18.2.0`, `@testing-library/react@^16.0.0`, `@testing-library/dom@^10.0.0`. No runtime additions to the core library.
- `tsconfig.json` updated: REMOVE `"rootDir": "ts"` (it conflicts with `adapters/**/*` inclusion); expand `include` to `["ts/**/*", "adapters/**/*"]`; add `"jsx": "react-jsx"`. `tsconfig.build.json` continues to exclude `adapters/**` — the adapter does NOT ship with the core `liquiddom` package.

## Specification

### 1. Public API surface (`adapters/react/index.tsx`)

```tsx
import { type LiquidDOMInstance, type LiquidOptions } from "../../ts/src/index";

/** Context value: the live instance, or null before init / after destroy. */
export const LiquidContext: React.Context<LiquidDOMInstance | null>;

/** Provider props. `config` is read ONCE on mount; subsequent changes are ignored
 *  (call `instance.setPhysicsConfig(...)` for live tweaks). */
export interface LiquidProviderProps {
  config?: LiquidOptions;
  children: React.ReactNode;
}
export function LiquidProvider(props: LiquidProviderProps): JSX.Element;

/** Read the live instance from context. Returns null before init / after destroy /
 *  outside a provider. Callers must handle null. */
export function useLiquid(): LiquidDOMInstance | null;

/** Callback-ref hook: attach to an element to auto-observe it across mount/unmount.
 *  Safe to use before the provider's instance is ready — observation deferred until ready. */
export interface UseLiquidRefOptions {
  liquidType?: number;
}
export function useLiquidRef<T extends HTMLElement>(opts?: UseLiquidRefOptions): React.RefCallback<T>;

/** Convenience component: renders a tag (default `div`) and auto-observes it.
 *  Forwards all standard HTML attributes via spread. Polymorphic generic
 *  deferred to W51 — see §5 prose and the TODO(W51) marker in index.tsx. */
export interface LiquidElementProps {
  as?: keyof JSX.IntrinsicElements;
  liquidType?: number;
  children?: React.ReactNode;
}
export function LiquidElement(
  props: LiquidElementProps & React.HTMLAttributes<HTMLElement>,
): JSX.Element;
```

### 2. `<LiquidProvider>` lifecycle

```tsx
function LiquidProvider({ config, children }: LiquidProviderProps) {
  const [instance, setInstance] = useState<LiquidDOMInstance | null>(null);
  const configRef = useRef(config); // captured once

  useEffect(() => {
    if (typeof window === "undefined") return; // SSR guard

    let cancelled = false;
    let created: LiquidDOMInstance | null = null;

    LiquidDOM.create(configRef.current).then((inst) => {
      if (cancelled) {
        inst.destroy();
        return;
      }
      created = inst;
      setInstance(inst);
    }).catch((err) => {
      console.error("[liquiddom/react] LiquidProvider failed to create instance:", err);
    });

    return () => {
      cancelled = true;
      if (created) {
        created.destroy();
      }
      // No setInstance(null) here — the provider is unmounting, so the
      // context value is going away regardless. Calling setState on an
      // unmounted component generates noise in test output.
    };
  }, []); // empty deps — config captured by ref, ignored after mount

  return <LiquidContext.Provider value={instance}>{children}</LiquidContext.Provider>;
}
```

**Why empty deps**: re-creating the instance on every config-object identity change would tear down the canvas and observed elements unnecessarily. Live tweaks belong on `setPhysicsConfig`. Re-mounting the provider (e.g., key change) is the documented escape hatch for full re-initialization.

**Strict-mode safety**: React 18 dev mode double-invokes the effect. First mount: create. Cleanup: cancel + destroy. Second mount: create again. The `cancelled` flag prevents the first `create()` resolution from setting an instance that the cleanup already discarded. The double-create pattern is wasteful in dev but correct — the cleanup destroys the first instance before the second is created.

### 3. `useLiquid()`

```tsx
export function useLiquid(): LiquidDOMInstance | null {
  return useContext(LiquidContext);
}
```

Returns `null` outside a provider, before instance ready, after destroy. Callers must handle null. Documented in JSDoc.

### 4. `useLiquidRef<T>()`

Callback-ref pattern with state-trigger:

```tsx
export function useLiquidRef<T extends HTMLElement>(opts?: UseLiquidRefOptions): RefCallback<T> {
  const instance = useLiquid();
  const [el, setEl] = useState<T | null>(null);
  const liquidType = opts?.liquidType;

  useEffect(() => {
    if (!el || !instance) return;
    instance.observe(el, liquidType);
    return () => {
      instance.unobserve(el);
    };
  }, [el, instance, liquidType]);

  return setEl as RefCallback<T>;
}
```

**Why useState + useEffect**: callback refs in React 18 don't have a cleanup phase (unlike React 19). Storing the element in state triggers an effect when both `el` and `instance` are non-null, and the effect's cleanup runs on element unmount or instance change.

**Strict-mode safety**: the effect's cleanup runs on remount; `instance.observe` is idempotent (W14 invariant — duplicate observe returns same id; documented in CLAUDE.md and verified by `it duplicate observe returns same id` in `liquiddom-api.test.ts`). The cleanup `unobserve` zeros the slot; the remount `observe` re-registers cleanly.

**Closure-capture invariant**: the effect's cleanup function captures `el` and `instance` by closure at the time the effect ran. A subsequent `setEl(null)` state update does NOT change which element the captured cleanup unobserves — this is the standard React pattern for callback-based observation. Reading `el` from a ref inside the cleanup would be a bug (would read the post-update null).

### 5. `<LiquidElement>`

```tsx
export function LiquidElement<E extends keyof JSX.IntrinsicElements = "div">(
  props: LiquidElementProps<E> & React.HTMLAttributes<HTMLElement>,
): JSX.Element {
  const { as, liquidType, children, ...rest } = props;
  const ref = useLiquidRef<HTMLElement>({ liquidType });
  const Tag = (as ?? "div") as React.ElementType;
  return <Tag ref={ref} {...rest}>{children}</Tag>;
}
```

Forwards all HTML attributes via spread. The polymorphic typing is loose for v1 (consumer can suppress with `as` cast); full polymorphic types deferred to a follow-up.

### 6. Example app (`examples/react/`)

Minimal Vite + React 18 app demonstrating both usage patterns. Files:

```
examples/react/
  index.html
  package.json
  vite.config.ts
  tsconfig.json
  src/
    main.tsx
    App.tsx
```

`App.tsx` (target: ~25 lines, demonstrates both `useLiquidRef` and `<LiquidElement>`):

```tsx
import { LiquidProvider, useLiquidRef, LiquidElement } from "../../../adapters/react";
import { presets } from "../../../ts/src";

function HookButton() {
  const ref = useLiquidRef<HTMLButtonElement>();
  return <button ref={ref} className="pill">via useLiquidRef</button>;
}

export default function App() {
  return (
    <LiquidProvider config={{ physics: presets.jelly }}>
      <main>
        <h1>liquiddom/react</h1>
        <HookButton />
        <LiquidElement as="button" className="pill">via LiquidElement</LiquidElement>
      </main>
    </LiquidProvider>
  );
}
```

### 6.1 Example app pre-flight

The example app imports from `../../../ts/src/index.ts` which dynamically imports `../../pkg/liquiddom.js` at runtime. The WASM build must exist before `npm run dev` in `examples/react/`. Two options:

(a) Document a manual step in `examples/react/README.md`: "Run `npm run build:wasm` from the repo root before `npm run dev` here."
(b) Add a `predev` script to `examples/react/package.json`: `"predev": "cd ../.. && npm run build:wasm"`.

Pick (b) — it's automatic and matches the existing repo pattern (`dev` script chains `build:wasm`).

### 7. SSR / Window guards

- `LiquidProvider`'s effect is guarded by `typeof window === "undefined"`. Server render emits children inside the context with `null` value; no DOM access.
- `useLiquidRef` is safe under SSR: `useState(null)` is fine, the effect doesn't run server-side, the returned `setEl` callback is unused there.
- `useLiquid()` returns `null` during server render and during the initial client render (before the provider's effect runs). Documented.

### 8. Build / packaging (deferred to W51)

For W47 itself: NO published package, NO npm publish, NO workspace setup. The adapter lives in `adapters/react/` and is consumed via relative import by the example app. Production build of the core `liquiddom` library is unaffected (`tsconfig.build.json` excludes `adapters/**`).

W51 will: move `adapters/react/` to `packages/react/`, add a `package.json` with `"name": "@liquiddom/react"` and `peerDependencies: { react, react-dom }`, set up npm workspaces, and publish on tag.

### 9. Configuration files

- **`tsconfig.json`** — REMOVE the `"rootDir": "ts"` line (conflicts with `adapters/**/*` inclusion); update `include` to `["ts/**/*", "adapters/**/*"]`; add `"jsx": "react-jsx"` to `compilerOptions`. Leave existing `types: ["node"]` unchanged.
- **`tsconfig.build.json`** — unchanged. Continues to exclude `adapters/` and `ts/__tests__/`.
- **No `vitest.config.ts`** — Vitest's default TSX transform (esbuild with automatic JSX runtime via `tsconfig.json`'s `jsx: "react-jsx"`) handles adapter tests. Per-file `@vitest-environment jsdom` directive is used (matches `liquiddom-api.test.ts` pattern). If a future test file needs a non-jsdom environment, the per-file pattern continues to work.
- **`package.json` devDependencies**: add `react@^18.2.0`, `react-dom@^18.2.0`, `@types/react@^18.2.0`, `@types/react-dom@^18.2.0`, `@testing-library/react@^16.0.0`, `@testing-library/dom@^10.0.0`. No runtime additions to `dependencies`.

## Tests

All tests in `adapters/react/__tests__/react-adapter.test.tsx`, with `// @vitest-environment jsdom` directive at the file top (mirrors `liquiddom-api.test.ts:1-3`). Uses `@testing-library/react` `render`, `act`, `waitFor`, `renderHook`, and `unmount` helpers.

**Test patterns required by all tests:**

1. **Reading the instance from context**: wrap a minimal `Consumer` component that calls `useLiquid()` and writes the value into a `useRef` exposed to the test. Pattern:
   ```tsx
   const instanceRef: { current: LiquidDOMInstance | null } = { current: null };
   function Capture() {
     const inst = useLiquid();
     instanceRef.current = inst;
     return null;
   }
   ```

2. **Mocking `getBoundingClientRect`** (jsdom returns zeros by default): set per-element override before render. Pattern from `liquiddom-api.test.ts:135-138`:
   ```tsx
   const el = document.createElement("button");
   el.getBoundingClientRect = () => ({
     x: 10, y: 20, width: 100, height: 50,
     top: 20, left: 10, right: 110, bottom: 70,
     toJSON: () => {},
   });
   ```
   For component tests, attach the override after mount via `screen.getByTestId(...)` cast and assignment.

3. **Polyfilling `ResizeObserver`**: jsdom lacks it; match the no-op polyfill in `runtime-truth.test.ts:11-18`.

| # | Test Name | Verifies |
|---|-----------|----------|
| 1 | `provider_creates_instance_after_mount` | `render(<LiquidProvider><Capture /></LiquidProvider>)` then `await waitFor(() => expect(instanceRef.current).not.toBeNull())`; assert `document.querySelector("canvas")` exists. |
| 2 | `provider_destroys_instance_on_unmount` | After mount + waitFor, capture canvas reference; call `unmount()`; assert `document.querySelector("canvas")` is null AND `instanceRef.current` (read via re-render of a sibling tree) shows the context is gone. (Acceptable: just verify canvas is removed.) |
| 3 | `useLiquidRef_observes_element_when_attached` | Render with `<LiquidProvider config={{ capacity: 1, autoObserve: false }}>` so the test's element is the ONLY one and lands in slot 0. Component renders `<button ref={useLiquidRef()}>` with mocked `getBoundingClientRect` returning x=10, y=20, w=100, h=50; after mount + waitFor, `instanceRef.current!.getBuffer()![0]` === 10 (entity 0 x-coord matches mocked rect.x). FLOATS_PER_ENTITY=9 so subsequent slots start at index 9. |
| 4 | `useLiquidRef_unobserves_on_unmount` | Same provider setup as #3 (`capacity: 1`, `autoObserve: false`); mount the component, verify slot[2] (width) === 100; then unmount the component (but NOT the provider); assert slot[2] === 0 (W14 unobserve zeros the slot). |
| 5 | `useLiquid_returns_null_outside_provider` | `renderHook(() => useLiquid())` with NO provider wrapper — `result.current` is `null`. |
| 6 | `strict_mode_tree_observes_correctly_and_is_idempotent` | Wrap with `<React.StrictMode>`; mount provider + HookButton with mocked rect; await ready; assert slot[2] === width (proves the strict-mode tree converges to correct state despite provider's double-invoked effect creating + destroying a transient instance). Also directly verify W14 idempotency: `instance.observe(el)` called twice returns same id. Note: React 18 strict-mode only double-invokes effects on the initial mount of the strict-mode tree — observing a re-invocation count via `vi.spyOn` is only meaningful on the provider's effect (not children mounted via rerender), so the test verifies the *outcome* (correct slot value + idempotency invariant) rather than per-call counts. |
| 7 | `liquidElement_forwards_html_attrs_and_uses_as_prop` | Render `<LiquidElement as="button" className="x" onClick={fn} data-test="y">child</LiquidElement>`. Assert the rendered tag is `<button>`, `className` is `"x"`, `data-test` is `"y"`, and firing a click event on the rendered element invokes `fn`. |
| 8 | `ssr_renderToString_does_not_throw` | `import { renderToString } from "react-dom/server";` then `expect(() => renderToString(<LiquidProvider><div /></LiquidProvider>)).not.toThrow()`. No assertion on output content — only that no DOM-access code path fires during server render. |
| 9 | `useLiquidRef_forwards_liquidType_to_observe` | `useLiquidRef({ liquidType: 4 })` attached to mocked element with `capacity: 1, autoObserve: false`: after waitFor, `buf[5] === 4` (FFI slot 5 = liquid_type per CLAUDE.md entity buffer table). Catches a buggy impl that silently drops the option. |

## Must NOT
- Mutate the core `LiquidDOM` public API to make React easier (any adapter need stays in `adapters/react/`).
- Bundle React into the published `liquiddom` package — `react`/`react-dom` MUST stay as devDependencies in `package.json`.
- Re-create the LiquidDOM instance on every `config` prop change — the prop is read once on mount.
- Run any DOM code during SSR — both the provider effect and `useLiquidRef`'s effect are gated.
- Block render on async `LiquidDOM.create()` — children render with `null` context until ready.
- Add `adapters/**` to `tsconfig.build.json` — the adapter does not ship with core.

## Must DO
- Provide a `<LiquidProvider>` that owns one instance and exposes it via Context.
- Provide `useLiquid()`, `useLiquidRef<T>()`, and `<LiquidElement>` as documented.
- Pass strict-mode double-mount cleanly (test #6).
- Render server-side without throwing.
- Cleanly destroy on provider unmount, including canceling in-flight `create()` promises.
- Update `CLAUDE.md`: add a section after the `Live config (Ward 049)` section with this exact heading and content:
  ```
  ### React adapter (Ward 047)

  React 18+ bindings live at `adapters/react/index.tsx`, consumed via relative
  import (publication as `@liquiddom/react` deferred to W51). Public API:

  - `<LiquidProvider config?>` — owns one `LiquidDOMInstance` via React Context, captures `config` once on mount.
  - `useLiquid()` — read the instance; returns `null` before init / outside a provider.
  - `useLiquidRef<T>(opts?)` — callback ref that auto-observes / unobserves an element on mount/unmount; safe before instance ready (deferred via state-trigger).
  - `<LiquidElement as? liquidType?>` — convenience tag that wraps `useLiquidRef`.

  Strict-mode safe via idempotent `observe` (W14 invariant). SSR-safe — provider effect is gated on `typeof window`.
  ```
- Update `CONTEXT.md`: append a decision row and a test-count row (do NOT modify W42/W49 rows).
- Concrete CONTEXT.md decision row to add:
  `| React adapter via Context + useLiquidRef | Zero core changes; provider owns instance, hook returns callback-ref with state-trigger pattern; strict-mode safe via idempotent observe | W47 |`
- Concrete CONTEXT.md Key Metrics row to append:
  `| Total tests | 154 (43 Rust + 111 TS) | W47 |`

## Verification
- `npm test` — full 154-test suite green (145 prior + 9 new = 154), 0 clippy warnings (Rust untouched), 0 TS errors.
- `npm run build` — core library build unaffected (no adapter code in the published tarball).
- `npm pack --dry-run` — `adapters/**` is NOT in the tarball.
- Manual: `cd examples/react && npm install && npm run dev` — example app loads, both buttons visibly behave as soft bodies, no React strict-mode warnings in console.
- `tsc --noEmit -p tsconfig.json` — passes (now covers adapter via updated `include`).
- `grep -r "@liquiddom/react" adapters/ examples/` returns ZERO hits (adapter is consumed via relative path, not yet published).
