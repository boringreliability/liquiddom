import { defineComponent, h } from "vue";
import { LiquidElement, LiquidProvider, useLiquid, useLiquidError, useLiquidRef } from "@liquiddom/vue";

const HookButton = defineComponent({
  name: "HookButton",
  setup() {
    const el = useLiquidRef<HTMLButtonElement>({ viscosity: 0.3 });
    return () => h("button", { ref: el, class: "pill" }, "via useLiquidRef");
  },
});

/** W85 (D85-2): the provider's error state as text (a stop or a create() rejection). */
function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * W85 (D85-5): `data-liquid-ready` appears once useLiquid() holds the instance, i.e. after
 * LiquidDOM.create() has resolved. e2e/dist.spec.ts waits for it.
 */
const Demo = defineComponent({
  name: "Demo",
  setup() {
    const liquid = useLiquid();
    const error = useLiquidError();
    return () =>
      h("main", { "data-liquid-ready": liquid.value !== null ? "true" : undefined }, [
        h("h1", "liquiddom/vue"),
        h("p", "Two ways to use the adapter; the second pill opts out of drag."),
        h(HookButton),
        h(LiquidElement, { as: "button", class: "pill", recovery: 1.2, drag: false }, { default: () => "via LiquidElement (no drag)" }),
        error.value !== null ? h("p", { role: "alert" }, `Liquid stopped: ${describeError(error.value)}`) : null,
      ]);
  },
});

export default defineComponent({
  name: "App",
  setup() {
    return () =>
      h(LiquidProvider, { config: { material: { viscosity: 0.6, cohesion: 0.85, recovery: 0.4 } } }, { default: () => h(Demo) });
  },
});
