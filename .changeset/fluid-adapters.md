---
"liquiddom": minor
"@liquiddom/react": minor
"@liquiddom/vue": minor
---

A stopped instance is reported. The new option `onError(err)` is called once when an instance stops for good (a frame that throws, a failed grid allocation for a growth or the first area hint, a failed Canvas2D rebuild after a lost WebGPU device), after its `console.error`; it is never called for a `create()` rejection, a fallback or after `destroy()`. The React and Vue providers (and the Vue plugin) now destroy a stopped instance and expose the reason through the new `useLiquidError()` (Vue also exports `LiquidErrorKey`); a `create()` rejection sets it too, and `config.onError` is still called. `<LiquidElement drag={false}>` and `useLiquidRef({ drag: false })` pass the drag opt-out to `observe()`. An app that observes its elements after `create()` (every adapter app, or `autoObserve: false`) now gets the same grid resolution as `autoObserve`: the first observed elements set the area hint once. A Vue example joins the React one, and both are smoke-tested from the published packages.
