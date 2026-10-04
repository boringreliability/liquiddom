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
import { LiquidDOM, type ElementOptions, type LiquidDOMInstance, type LiquidOptions } from "liquiddom";

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

/** Element options (viscosity, recovery), captured once at setup (D66-4). */
export type UseLiquidRefOptions = ElementOptions;

function pickElementOptions(opts?: ElementOptions): ElementOptions | undefined {
  if (!opts) return undefined;
  const out: ElementOptions = {};
  if (opts.viscosity !== undefined) out.viscosity = opts.viscosity;
  if (opts.recovery !== undefined) out.recovery = opts.recovery;
  return out.viscosity === undefined && out.recovery === undefined ? undefined : out;
}

/**
 * Template-ref composable: auto-observes when both element and instance are ready.
 * `flush: "post"` so the watch fires after Vue's DOM commit. Options are read
 * once at setup; changing a bound prop later has no effect (v1 limitation).
 */
export function useLiquidRef<T extends HTMLElement = HTMLElement>(opts?: UseLiquidRefOptions): Ref<T | null> {
  const instance = useLiquid();
  const elRef = ref<T | null>(null) as Ref<T | null>;
  const elementOptions = pickElementOptions(opts);

  watch(
    [elRef, instance],
    ([el, inst], _prev, onCleanup) => {
      if (!el || !inst) return;
      inst.observe(el as T, elementOptions);
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
    viscosity: { type: Number, default: undefined },
    recovery: { type: Number, default: undefined },
  },
  setup(props, { slots, attrs }) {
    const elRef = useLiquidRef<HTMLElement>({ viscosity: props.viscosity, recovery: props.recovery });
    return () => h(props.as, { ...attrs, ref: elRef }, slots.default?.());
  },
});
