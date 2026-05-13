/**
 * @liquiddom/vue — Vue 3.4+ bindings.
 */
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
  type PropType,
  type Ref,
} from "vue";
import { LiquidDOM, type LiquidDOMInstance, type LiquidOptions } from "liquiddom";

/** Injection key used by both `<LiquidProvider>` and `LiquidPlugin`. */
export const LiquidKey: InjectionKey<Ref<LiquidDOMInstance | null>> = Symbol("LiquidDOM");

export const LiquidProvider = defineComponent({
  name: "LiquidProvider",
  props: { config: { type: Object as PropType<LiquidOptions> } },
  setup(props, { slots }) {
    const instance = ref<LiquidDOMInstance | null>(null);
    provide(LiquidKey, instance);

    let cancelled = false;

    onMounted(async () => {
      if (typeof window === "undefined") return;
      try {
        const inst = await LiquidDOM.create(props.config);
        if (cancelled) {
          // Race path: unmount fired before create resolved — instance.value
          // was never assigned, so this branch owns the destroy.
          inst.destroy();
          return;
        }
        instance.value = inst;
      } catch (err) {
        console.error("[liquiddom/vue] LiquidProvider failed to create instance:", err);
      }
    });

    onBeforeUnmount(() => {
      cancelled = true;
      instance.value?.destroy();
      instance.value = null;
    });

    return () => slots.default?.();
  },
});

export const LiquidPlugin: Plugin<[LiquidOptions?]> = {
  install(app: App, config?: LiquidOptions) {
    const instance = ref<LiquidDOMInstance | null>(null);
    app.provide(LiquidKey, instance);

    if (typeof window === "undefined") return;

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
      // Race-symmetric destroy: handles "app.unmount() AFTER create() resolved".
      // The "BEFORE create() resolved" path is handled in the .then() above. Both
      // branches are required for full cleanup coverage.
      instance.value?.destroy();
      instance.value = null;
      origUnmount();
    };
  },
};

/** Read the live instance from injection. Null ref outside a provider/plugin. */
export function useLiquid(): Ref<LiquidDOMInstance | null> {
  return inject(LiquidKey, () => ref<LiquidDOMInstance | null>(null), true);
}

export interface UseLiquidRefOptions {
  liquidType?: number;
}

/**
 * Template-ref composable: auto-observes when both element and instance are ready.
 *
 * `flush: "post"` is required so the watch fires AFTER Vue's DOM commit — observing
 * earlier would miss the mounted node. `liquidType` is captured once at setup;
 * changes to a `:liquidType="..."` binding after mount are NOT reactive (v1 limitation).
 */
export function useLiquidRef<T extends HTMLElement = HTMLElement>(
  opts?: UseLiquidRefOptions,
): Ref<T | null> {
  const instance = useLiquid();
  // Vue's generic Ref<T> erases to Ref<UnwrapRef<T> | null> through `ref()`,
  // which doesn't structurally match the function signature `Ref<T | null>`.
  // Casting at the type-construction site keeps the public API contract clean.
  const elRef = ref<T | null>(null) as Ref<T | null>;
  const liquidType = opts?.liquidType;

  watch(
    [elRef, instance],
    ([el, inst], _prev, onCleanup) => {
      if (!el || !inst) return;
      inst.observe(el as T, liquidType);
      onCleanup(() => {
        inst.unobserve(el as T);
      });
    },
    { flush: "post" },
  );

  return elRef;
}

export const LiquidElement = defineComponent({
  name: "LiquidElement",
  inheritAttrs: false,
  props: {
    as: { type: String, default: "div" },
    liquidType: { type: Number, default: undefined },
  },
  setup(props, { slots, attrs }) {
    const elRef = useLiquidRef<HTMLElement>({ liquidType: props.liquidType });
    return () => h(props.as, { ...attrs, ref: elRef }, slots.default?.());
  },
});
