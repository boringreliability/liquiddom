---
ward: 48
revision: 3
name: "@liquiddom/vue Adapter Package"
epic: "framework-adapters-dx"
status: "complete"
dependencies: []
layer: "typescript"
estimated_tests: 9
created: "2026-05-10"
completed: "2026-05-13"
---
# Ward 048: @liquiddom/vue Adapter Package

## Scope
First-party Vue 3 bindings, structural mirror of W47 (React adapter) adapted to Vue's Composition API. A `<LiquidProvider>` component owns a single instance and exposes it via `provide`/`inject`. A `useLiquid()` composable returns a `Ref<LiquidDOMInstance | null>` (reactive — updates when the async create resolves). A `useLiquidRef<T>()` composable returns a `Ref<T | null>` that consumers assign to a template ref; an internal `watch` triggers `observe`/`unobserve` across the element + instance lifecycle. A `<LiquidElement>` convenience component renders any tag with the ref pre-attached. An optional `LiquidPlugin` exposes the same Context for `app.use(...)`-style consumers.

Vue-only adapter — zero changes to the core library. Pre-staged in `adapters/vue/` (W51 will move it to `packages/vue/` and publish as `@liquiddom/vue`). Until W51, consumed via relative imports from the example app.

## Revision history
- **r1**: initial fleshed-out spec.
- **r2** (this revision): addresses spec-review findings (3 must-fix + 4 should-fix).
  - **`DefineComponent` typing**: switched from explicit `DefineComponent<...>` return annotations to letting TypeScript infer from `defineComponent({...})`. The exports use `typeof LiquidProvider` style — no `DefineComponent` import needed.
  - **`inheritAttrs: false` on `LiquidElement`**: the setup function manually spreads `attrs` into the rendered tag; without `inheritAttrs: false`, Vue auto-applies attrs ALSO, double-firing event handlers and merging class twice. Critical for test #6 correctness.
  - **Test #3/#4 element-attach timing corrected**: the r1 "pre-created mockedButton via callback ref" pattern bypasses jsdom DOM. New pattern: mount component → grab rendered element via `wrapper.find('button').element` → override `getBoundingClientRect` → `await flushPromises() + nextTick()` (post-flush watch fires after instance resolves). Spec §10 (Tests) now spells out the precise sequence.
  - **Test #4 unmount via reactive ref outside component tree** (not slot-prop, which is awkward): wrap in a stateful `TestRoot` whose `show: Ref<boolean>` toggles the conditional render.
  - **Dropped `display: contents` wrapper**: Vue 3 supports multi-root fragments natively (since 3.0). Provider's render function returns `slots.default?.()` directly — no host-CSS-defeatable trick needed.
  - **liquidType reactivity gap** documented as intentional v1 behavior (captured once, matches W47).
  - **Plugin race path** documented as covered by the `unmounted` flag (no separate test).

## Pre-conditions
- Run `npm test` before starting; baseline MUST be 167 tests (43 Rust + 124 TS). If different, reconcile.

## Inputs
- Public `LiquidDOM.create(options)` from `ts/src/index.ts`
- `LiquidDOMInstance` interface (observe / unobserve / destroy / getPhysicsConfig / setPhysicsConfig / refreshTheme)
- W14 invariant: `observe()` is idempotent
- Vue 3.4+ (Composition API, `<script setup>` syntax, `provide`/`inject`, `watch`)
- `@vue/test-utils` ^2.4 for component-level tests in jsdom
- `@vue/server-renderer` ^3.4 for SSR test
- W47 as reference: `adapters/react/index.tsx` + `adapters/react/__tests__/react-adapter.test.tsx`

## Outputs
- `adapters/vue/index.ts` — single-file public API. Pure TypeScript using `defineComponent` + render functions (no `.vue` SFCs, no vite-plugin-vue dependency for the adapter itself)
- `adapters/vue/__tests__/vue-adapter.test.ts` — 9 unit tests
- `examples/vue/` — minimal Vite + Vue 3 sample (`index.html`, `src/main.ts`, `src/App.vue`, `package.json`, `vite.config.ts`, `tsconfig.json`) — example MAY use `.vue` SFCs since it's a real Vue app
- `package.json` updated with devDependencies: `vue@^3.4.0`, `@vue/test-utils@^2.4.0`, `@vue/server-renderer@^3.4.0`. No runtime additions to the core library.
- `tsconfig.json` updated: `adapters/**/*` already included from W47; no new changes needed (the W47 `jsx: "react-jsx"` setting doesn't conflict with Vue when the adapter doesn't use JSX).
- `CLAUDE.md`: new "Vue adapter (Ward 048)" section
- `CONTEXT.md`: decision row + test count row

## Specification

### 1. Public API surface (`adapters/vue/index.ts`)

```ts
import {
  defineComponent,
  h,
  inject,
  onBeforeUnmount,
  onMounted,
  provide,
  ref,
  watch,
  type App,
  type InjectionKey,
  type Plugin,
  type Ref,
  type PropType,
} from "vue";
import { LiquidDOM, type LiquidDOMInstance, type LiquidOptions } from "../../ts/src/index";

/** Injection key used by both `<LiquidProvider>` and `LiquidPlugin`. */
export const LiquidKey: InjectionKey<Ref<LiquidDOMInstance | null>>;

// `LiquidProvider`, `LiquidElement`, `LiquidPlugin` are exported as the
// `defineComponent({...})` / plugin objects directly — TypeScript infers
// their full props/emits/slots shape. No explicit `DefineComponent<...>`
// annotation (avoids the mismatch-with-inferred-shape trap).

/** Read the live instance from injection. Returns a `Ref<LiquidDOMInstance | null>` — reactive. */
export function useLiquid(): Ref<LiquidDOMInstance | null>;

/** Template-ref composable: assign to a `ref` attribute; auto-observes when element + instance are both ready. */
export interface UseLiquidRefOptions {
  liquidType?: number;
}
export function useLiquidRef<T extends HTMLElement = HTMLElement>(
  opts?: UseLiquidRefOptions,
): Ref<T | null>;

// LiquidProvider, LiquidElement, LiquidPlugin: see §2, §3, §6 for the
// `export const` declarations.
```

### 2. `<LiquidProvider>` implementation

```ts
export const LiquidProvider = defineComponent({
  name: "LiquidProvider",
  props: { config: { type: Object as PropType<LiquidOptions>, default: undefined } },
  setup(props, { slots }) {
    const instance = ref<LiquidDOMInstance | null>(null);
    provide(LiquidKey, instance);

    let cancelled = false;
    let created: LiquidDOMInstance | null = null;

    onMounted(async () => {
      if (typeof window === "undefined") return; // SSR guard
      try {
        const inst = await LiquidDOM.create(props.config);
        if (cancelled) {
          inst.destroy();
          return;
        }
        created = inst;
        instance.value = inst;
      } catch (err) {
        console.error("[liquiddom/vue] LiquidProvider failed to create instance:", err);
      }
    });

    onBeforeUnmount(() => {
      cancelled = true;
      if (created) created.destroy();
      // Do not set instance.value = null — provider is unmounting, ref discards.
    });

    return () => slots.default?.();
  },
});
```

**Multi-root (fragment) render**: Vue 3 supports multi-root components natively since v3.0. Returning `slots.default?.()` directly produces a fragment — no wrapper element, no host-CSS interference, no `display: contents` workaround needed.

**Why empty deps on the effect**: same logic as W47 — config-prop identity changes shouldn't tear down the instance. For full re-init, remount the provider with a `:key`.

**SSR guard**: `typeof window === "undefined"` early-returns in `onMounted` (which only runs client-side in Vue SSR, but the guard is defensive and matches W47).

### 3. `LiquidPlugin` implementation

```ts
export const LiquidPlugin: Plugin<[LiquidOptions?]> = {
  install(app: App, config?: LiquidOptions) {
    const instance = ref<LiquidDOMInstance | null>(null);
    app.provide(LiquidKey, instance);

    if (typeof window === "undefined") return; // SSR — no DOM access

    let unmounted = false;
    LiquidDOM.create(config)
      .then((inst) => {
        if (unmounted) {
          // Race path: app.unmount() fired before create() resolved.
          // The unmount wrapper below could not destroy because instance.value was still null,
          // so this branch owns the destroy. Do NOT delete without restoring the symmetric guard.
          inst.destroy();
          return;
        }
        instance.value = inst;
      })
      .catch((err) => {
        console.error("[liquiddom/vue] LiquidPlugin failed to create instance:", err);
      });

    const origUnmount = app.unmount.bind(app);
    app.unmount = () => {
      unmounted = true;
      // Race-symmetric destroy: handles "app.unmount() AFTER create() resolved" path.
      // The "BEFORE create() resolved" path is handled in the .then() above. Both
      // branches are required for full cleanup coverage.
      if (instance.value) instance.value.destroy();
      origUnmount();
    };
  },
};
```

**Why the `app.unmount` monkey-patch**: Vue's plugin API has no native teardown hook. Wrapping `app.unmount` is the standard pattern for plugins that need cleanup.

### 4. `useLiquid()` composable

```ts
export function useLiquid(): Ref<LiquidDOMInstance | null> {
  const injected = inject(LiquidKey, null);
  if (injected === null) {
    // Outside a provider: return a stable null ref.
    return ref<LiquidDOMInstance | null>(null);
  }
  return injected;
}
```

When called outside any provider or plugin, returns a fresh `Ref<null>`. Callers must handle null. Vue's `inject` with a default of `null` distinguishes "no provider" from "provider exists but instance not yet ready".

### 5. `useLiquidRef<T>()` composable

```ts
export function useLiquidRef<T extends HTMLElement = HTMLElement>(
  opts?: UseLiquidRefOptions,
): Ref<T | null> {
  const instance = useLiquid();
  const elRef = ref<T | null>(null);
  const liquidType = opts?.liquidType;

  watch(
    [elRef, instance],
    ([el, inst], _prev, onCleanup) => {
      if (!el || !inst) return;
      inst.observe(el, liquidType);
      onCleanup(() => {
        inst.unobserve(el);
      });
    },
    { flush: "post" },
  );

  return elRef;
}
```

**Why `flush: "post"`**: ensures `watch` fires AFTER Vue has flushed DOM updates, so the element is fully mounted before `observe` runs.

**Why `watch` with `onCleanup`**: Vue's `watch` provides a cleanup callback that fires before the next run AND on component unmount — perfect mirror of React's `useEffect` cleanup. When `elRef` changes from a real element to `null` (or another element), the previous element gets `unobserve`'d.

**Lifecycle correctness**: when the component unmounts, Vue's reactivity cleans up the `watch` automatically. The cleanup callback fires, `unobserve` runs. No manual `onBeforeUnmount` needed for the typical case.

### 6. `<LiquidElement>` implementation

```ts
export const LiquidElement = defineComponent({
  name: "LiquidElement",
  inheritAttrs: false, // see note below
  props: {
    as: { type: String, default: "div" },
    liquidType: { type: Number, default: undefined },
  },
  setup(props, { slots, attrs }) {
    const elRef = useLiquidRef<HTMLElement>({ liquidType: props.liquidType });
    return () =>
      h(
        props.as,
        { ref: elRef, ...attrs },
        slots.default?.(),
      );
  },
});
```

**Why `inheritAttrs: false`**: the setup function manually spreads `attrs` into the rendered tag. With Vue's default `inheritAttrs: true`, Vue would ALSO auto-apply attrs to the root element — every `class`, `data-*`, and event handler would fire twice. This bug would manifest in test #6 as a click handler called twice. `inheritAttrs: false` disables the auto-apply so the spread is authoritative.

**`liquidType` reactivity gap (intentional, but visible as a binding illusion)**: `useLiquidRef` captures `opts?.liquidType` at setup time as a primitive const. Changing `props.liquidType` after mount does NOT re-observe with the new type. Vue users may write `<LiquidElement :liquidType="reactiveValue">` expecting reactivity — it looks reactive but is not. Matches W47's same behavior. Documented v1 limitation. To change `liquidType` post-mount, remount the component (e.g., via `:key`).

Spreads `attrs` (Vue's non-prop attributes — class, style, data-*, event handlers) onto the rendered tag. The tag itself is controlled by `props.as`. `slots.default` provides children.

### 7. SSR safety

- `<LiquidProvider>` and `LiquidPlugin` guard their async create with `typeof window === "undefined"`.
- `onMounted` doesn't fire during `renderToString` (Vue's SSR semantics).
- `useLiquidRef`'s `watch` is also `flush: "post"` and uses `onCleanup`, both of which are SSR-safe (no DOM access during render).
- `useLiquid()` returns `Ref<null>` on the server.

### 8. Example app (`examples/vue/`)

```
examples/vue/
  index.html
  package.json
  vite.config.ts
  tsconfig.json
  src/
    main.ts
    App.vue
```

`App.vue` (target ~25 lines, both patterns demonstrated):

```vue
<script setup lang="ts">
import { LiquidProvider, useLiquidRef, LiquidElement } from "../../../adapters/vue";
import { presets } from "../../../ts/src/index";

const hookButtonRef = useLiquidRef<HTMLButtonElement>();
</script>

<template>
  <LiquidProvider :config="{ physics: presets.jelly }">
    <main>
      <h1>liquiddom/vue</h1>
      <button :ref="hookButtonRef" class="pill">via useLiquidRef</button>
      <LiquidElement as="button" class="pill">via LiquidElement</LiquidElement>
    </main>
  </LiquidProvider>
</template>
```

`package.json` `scripts.predev` runs `cd ../.. && npm run build:wasm` (matches W47 pattern).

### 9. Configuration

- `tsconfig.json`: no changes (W47 already includes `adapters/**`). The Vue adapter uses pure TypeScript with `h()` render functions, no JSX — the existing `jsx: "react-jsx"` doesn't apply because no `.tsx` / JSX-syntax files are added.
- `package.json` devDependencies: `vue@^3.4.0`, `@vue/test-utils@^2.4.0`, `@vue/server-renderer@^3.4.0`. No runtime additions to `dependencies`.
- No `vitest.config.ts` needed; Vue + jsdom works with the per-file `@vitest-environment jsdom` directive.

## Tests

All tests in `adapters/vue/__tests__/vue-adapter.test.ts`, with `// @vitest-environment jsdom` directive. Uses `@vue/test-utils` `mount`, `flushPromises`, `nextTick`.

**Test patterns**:

1. **Vue template ref + post-mount mock pattern** (different from W47's pre-created element approach). Vue's `flush: "post"` watch fires AFTER Vue's DOM commit. `getBoundingClientRect` override must happen on the actual rendered DOM node AFTER `mount()` returns but BEFORE `flushPromises()` triggers the watch:
```ts
const wrapper = mount(LiquidProvider, {
  props: { config: { capacity: 1, autoObserve: false } },
  slots: { default: () => h(TestComp) },
  attachTo: document.body,
});
// DOM is committed synchronously; template ref is assigned; watch is scheduled.
const btn = wrapper.find('button').element as HTMLButtonElement;
btn.getBoundingClientRect = () => ({
  x: 10, y: 20, width: 100, height: 50,
  top: 20, left: 10, right: 110, bottom: 70,
  toJSON: () => {},
});
await flushPromises(); // LiquidDOM.create resolves → instance.value set → watch re-runs
await nextTick();      // post-flush watch runs → observe(btn) executes
// instance.getBuffer()![0] now reflects btn.getBoundingClientRect().x
```

2. **ResizeObserver polyfill**: no-op polyfill installed at module scope (matches existing test pattern). MutationObserver polyfill if W52 tests have set it up — also no-op acceptable here since computed theme is not exercised.

3. **Reading the instance from outside the component tree**: use a custom inner test component that calls `useLiquid()` and pushes the value into an external ref:
```ts
const instanceRef: { current: LiquidDOMInstance | null } = { current: null };
const Capture = defineComponent({
  setup() {
    const inst = useLiquid();
    watch(inst, (v) => { instanceRef.current = v; }, { immediate: true });
    return () => null;
  },
});
```

4. **Toggling unmount for test #4** (cannot use slot props elegantly): wrap in a stateful root whose `show: Ref<boolean>` controls conditional render. Test flips `show.value = false` then awaits flushPromises + nextTick:
```ts
const show = ref(true);
const TestRoot = defineComponent({
  setup: () => () => h(LiquidProvider, { config: { capacity: 1, autoObserve: false } }, {
    default: () => show.value ? h(HookButton) : null,
  }),
});
const wrapper = mount(TestRoot, { attachTo: document.body });
// ... setup + verify observe ran ...
show.value = false;
await flushPromises();
await nextTick();
// assert slot[2] === 0 (unobserve fired via watch cleanup)
```

| # | Test Name | Verifies |
|---|-----------|----------|
| 1 | `provider_creates_instance_after_mount` | `mount(LiquidProvider, { slots: { default: () => h(Capture) } })`, await `flushPromises()` and `nextTick()`. Assert `instanceRef.current !== null` AND `document.querySelector("canvas") !== null`. |
| 2 | `provider_destroys_instance_on_unmount` | After mount + waitFor: `vi.spyOn(instanceRef.current!, "destroy")`. Call `wrapper.unmount()`. Assert spy was called once AND `document.querySelector("canvas")` is null. |
| 3 | `useLiquidRef_observes_element_when_attached` | Test component renders `h("button", { ref: elRef })` where `elRef = useLiquidRef()`. Mount under `<LiquidProvider config="{ capacity: 1, autoObserve: false }">` with `attachTo: document.body`. Synchronously after `mount()` returns: `wrapper.find("button").element.getBoundingClientRect = () => ({ x: 10, y: 20, width: 100, height: 50, top: 20, left: 10, right: 110, bottom: 70, toJSON: () => {} })`. Then `await flushPromises(); await nextTick();`. Assert `instanceRef.current!.getBuffer()![0] === 10` (entity 0 x-coord). The override-before-watch-fires timing relies on `flush: "post"` deferring the watch until after the LiquidDOM.create microtask resolves. |
| 4 | `useLiquidRef_unobserves_on_unmount` | Use the `TestRoot` + `show` reactive pattern (Test patterns §4). Mount with `show=true`, follow test #3's rect-override sequence, verify `buf[2] === 100`. Then `show.value = false; await flushPromises(); await nextTick();` — the watch's `onCleanup` fires (elRef → null), calls `unobserve(btn)`, slot zeroed. Assert `buf[2] === 0`. |
| 5 | `useLiquid_returns_null_outside_provider` | Component using `useLiquid()` mounted with NO `LiquidProvider` wrapper. `instanceRef.current` remains `null` after mount + `flushPromises`. |
| 6 | `liquidElement_forwards_attrs_and_uses_as_prop` | `mount(LiquidProvider, { slots: { default: () => h(LiquidElement, { as: "button", class: "my-button", "data-test": "x", onClick }, () => "child") } })`. After mount: assert `wrapper.find("button").exists()`, class === "my-button", attr "data-test" === "x", text === "child". Fire click event via `wrapper.find("button").trigger("click")`, assert `onClick` spy was called. |
| 7 | `ssr_renderToString_does_not_throw` | `import { renderToString } from "@vue/server-renderer"; const app = createSSRApp({ ... LiquidProvider with content ... }); await expect(renderToString(app)).resolves.toBeDefined();` (Vue 3 SSR returns a Promise). |
| 8 | `useLiquidRef_forwards_liquidType_to_observe` | `useLiquidRef({ liquidType: 4 })` attached to mocked button (capacity 1, autoObserve false); after mount + flush, assert `instanceRef.current!.getBuffer()![5] === 4` (slot 5 = `liquid_type` per CLAUDE.md). |
| 9 | `plugin_install_provides_instance` | `const app = createApp(Capture); app.use(LiquidPlugin, { capacity: 4 }); app.mount(document.body)`. After `flushPromises` + `nextTick`, assert `instanceRef.current !== null` AND `document.querySelector("canvas")` exists. Cleanup: `app.unmount()`. |

### 11. Test cleanup (new file boilerplate)

Both test #1 (`LiquidProvider` mount) and test #9 (`LiquidPlugin` install with `app.mount(document.body)`) attach to `document.body`. Without explicit cleanup the canvas may persist across tests. Required boilerplate at the file head:

```ts
let lastWrapper: ReturnType<typeof mount> | null = null;
afterEach(() => {
  if (lastWrapper) {
    lastWrapper.unmount();
    lastWrapper = null;
  }
  document.body.innerHTML = "";
});
```

Each test assigns the returned wrapper to `lastWrapper` (or omits it for plugin-only tests, which destroy via `app.unmount()`).

### 11. Test cleanup (new file boilerplate)

Both test #1 (`LiquidProvider` mount) and test #9 (`LiquidPlugin` install with `app.mount(document.body)`) attach to `document.body`. Without explicit cleanup the canvas may persist across tests. Required boilerplate at the file head:

```ts
let lastWrapper: ReturnType<typeof mount> | null = null;
afterEach(() => {
  if (lastWrapper) {
    lastWrapper.unmount();
    lastWrapper = null;
  }
  document.body.replaceChildren();
});
```

Each test assigns the returned wrapper to `lastWrapper` (or omits it for plugin-only tests, which destroy via `app.unmount()`).

## Must NOT
- Mutate the core `LiquidDOM` public API to make Vue easier (any adapter need stays in `adapters/vue/`).
- Imply that `<LiquidElement :liquidType="reactiveValue">` is reactive — the value is captured once at setup. Document this clearly; consumers who need to change `liquidType` at runtime must remount via `:key`.
- Bundle Vue into the published `liquiddom` package — `vue` MUST stay as devDependency in `package.json`.
- Re-create the LiquidDOM instance on every `config` prop change — the prop is read once on mount.
- Run any DOM code during SSR — both the provider and plugin guard on `typeof window`.
- Block render on async `LiquidDOM.create()` — children render with `Ref<null>` until ready.
- Add `adapters/**` to `tsconfig.build.json` — the adapter does not ship with core.
- Use SFC (`.vue` files) for the adapter source — the test file would need vite-plugin-vue to compile; `defineComponent` + `h()` keeps the adapter pure-TS and SFC-free.
- Require users to wrap `<LiquidProvider>` in `<Suspense>` — the async create is internal and non-blocking.

## Must DO
- Provide `<LiquidProvider>`, `useLiquid`, `useLiquidRef<T>`, `<LiquidElement>`, and `LiquidPlugin` as documented in §1.
- `useLiquid()` returns a `Ref<LiquidDOMInstance | null>` (reactive ref, not the raw value) — consumers can `watch` or unwrap in template.
- `useLiquidRef`'s `watch` uses `{ flush: "post" }` so the element is mounted before `observe` fires.
- Cleanly destroy on provider unmount AND on `app.unmount()` (plugin path), including canceling in-flight `create()` promises.
- Concrete CLAUDE.md section to add:
  ```
  ### Vue adapter (Ward 048)

  Vue 3.4+ bindings live at `adapters/vue/index.ts`, consumed via relative
  import (publication as `@liquiddom/vue` deferred to W51). Public API:

  - `<LiquidProvider :config>` — owns one `LiquidDOMInstance` via provide/inject. Captures `config` once on mount.
  - `LiquidPlugin` — alternative install path: `app.use(LiquidPlugin, config?)`. Monkey-patches `app.unmount` for cleanup.
  - `useLiquid()` — returns `Ref<LiquidDOMInstance | null>`; reactive (updates when async create resolves).
  - `useLiquidRef<T>(opts?)` — returns `Ref<T | null>` template ref; internal `watch` auto-observes/unobserves across lifecycle (`flush: "post"` so element is mounted before observe fires).
  - `<LiquidElement :as :liquidType>` — wraps a tag with the ref pre-attached. Forwards Vue `attrs` (class/style/events/data-*).

  SSR-safe: provider effect gated on `typeof window`; `useLiquidRef`'s watch doesn't fire on the server. Adapter is pure TypeScript with `h()` render functions — no `.vue` SFCs, no vite-plugin-vue dependency.
  ```
- Concrete CONTEXT.md decision row to APPEND:
  `| Vue 3 adapter via provide/inject + useLiquidRef watch | Zero core changes; pure-TS adapter (no SFCs); both <LiquidProvider> component and LiquidPlugin install paths share the same InjectionKey; useLiquidRef uses watch with flush: "post" so element is mounted before observe; W51 will move to packages/vue/ and publish as @liquiddom/vue | W48 |`
- Concrete CONTEXT.md Key Metrics row to APPEND (do NOT modify prior rows):
  `| Total tests | 176 (43 Rust + 133 TS) | W48 |`

## Verification
- `npm test` — full 176-test suite green (167 prior + 9 new = 176), 0 clippy warnings (Rust untouched), 0 TS errors.
- `npm run build` — core library build unaffected (no adapter code in the published tarball).
- `npm pack --dry-run` — `adapters/**` is NOT in the tarball.
- Manual: `cd examples/vue && npm install && npm run dev` — example app loads, both buttons visibly behave as soft bodies, no Vue dev-mode warnings in console.
- `tsc --noEmit -p tsconfig.json` — passes.
- `grep -r "@liquiddom/vue" adapters/ examples/` returns ZERO hits (consumed via relative path, not yet published).
