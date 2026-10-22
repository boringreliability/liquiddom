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
  shallowRef,
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
/** W85 (D85-2): injection key of the error that left the provider (or the plugin) without an instance. */
export const LiquidErrorKey: InjectionKey<Ref<unknown>> = Symbol("LiquidDOMError");

/**
 * Kept identical to withOnError in packages/react/src/index.tsx.
 * W85 (D85-2): `config` with the adapter's handler chained in front of `config.onError`, which is
 * still called, after it. An `onError` that is not a function is passed on unchanged, so create()
 * rejects with core's TypeError (design resolution 9).
 */
function withOnError(config: LiquidOptions | undefined, own: (err: unknown) => void): LiquidOptions {
  const theirs: unknown = config?.onError;
  if (theirs !== undefined && typeof theirs !== "function") return { ...config };
  const chained = theirs as ((err: unknown) => void) | undefined;
  return {
    ...config,
    onError: (err: unknown) => {
      own(err);
      chained?.(err);
    },
  };
}

/**
 * W85 (D85-2): creates the instance of a provider or the plugin into its refs. On a stop (core's
 * onError; synchronous, design resolution 2) the instance is destroyed, `instance` becomes null and
 * `error` the stop's error; a create() rejection sets `error` too (its console.error stays). No
 * retry. Once `gone()` (unmounted) a resolving instance is destroyed on arrival, as is one that
 * stopped while create() still ran (design resolution 11).
 */
function createInto(
  config: LiquidOptions | undefined,
  instance: Ref<LiquidDOMInstance | null>,
  error: Ref<unknown>,
  gone: () => boolean,
  owner: string,
): void {
  let stopped = false;
  const onStop = (err: unknown): void => {
    if (gone() || stopped) return;
    stopped = true;
    const inst = instance.value;
    instance.value = null;
    inst?.destroy();
    error.value = err;
  };
  // A then pair, not then/catch: a throw inside the resolve body (a user's flush:"sync" watcher)
  // must not be reported as a create failure while the instance stays live.
  LiquidDOM.create(withOnError(config, onStop)).then(
    (inst) => {
      if (gone() || stopped) {
        // Race path: the owner unmounted before create() resolved — instance.value was never
        // assigned, so this branch owns the destroy (also for an instance that stopped meanwhile).
        inst.destroy();
        return;
      }
      instance.value = inst;
    },
    (err: unknown) => {
      console.error(`[liquiddom/vue] ${owner} failed to create instance:`, err);
      if (!gone()) error.value = err;
    },
  );
}

export const LiquidProvider = defineComponent({
  name: "LiquidProvider",
  props: { config: { type: Object as PropType<LiquidOptions> } },
  setup(props, { slots }) {
    const instance = ref<LiquidDOMInstance | null>(null);
    const error = shallowRef<unknown>(null);
    provide(LiquidKey, instance);
    provide(LiquidErrorKey, error);

    let cancelled = false;

    onMounted(() => {
      if (typeof window === "undefined") return;
      createInto(props.config, instance, error, () => cancelled, "LiquidProvider");
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
    const error = shallowRef<unknown>(null);
    app.provide(LiquidKey, instance);
    app.provide(LiquidErrorKey, error);

    if (typeof window === "undefined") return;

    let unmounted = false;
    // The "app.unmount() BEFORE create() resolved" path is handled in createInto (destroy on arrival).
    createInto(config, instance, error, () => unmounted, "LiquidPlugin");

    const origUnmount = app.unmount.bind(app);
    app.unmount = () => {
      unmounted = true;
      // Race-symmetric destroy: handles "app.unmount() AFTER create() resolved".
      // The "BEFORE create() resolved" path is handled in createInto. Both
      // branches are required for full cleanup coverage.
      instance.value?.destroy();
      instance.value = null;
      origUnmount();
    };
  },
};

/** Read the live instance from injection. Null ref outside a provider/plugin and once the instance stopped. */
export function useLiquid(): Ref<LiquidDOMInstance | null> {
  return inject(LiquidKey, () => ref<LiquidDOMInstance | null>(null), true);
}

/**
 * W85 (D85-2): `Ref` of the error that left the provider (or the plugin) without an instance: a
 * stop's error (the instance is destroyed) or the create() rejection; null otherwise and outside a
 * provider. No retry: remount the provider (`v-if`, `key`) to create a new instance.
 */
export function useLiquidError(): Ref<unknown> {
  return inject(LiquidErrorKey, () => shallowRef<unknown>(null), true);
}

/** Element options (viscosity, recovery, drag), captured once at setup (D66-4). */
export type UseLiquidRefOptions = ElementOptions;

/** Kept identical to pickElementOptions in packages/react/src/index.tsx. W85 (D85-3, design resolution 8): every own key whose value is defined; none → undefined. */
function pickElementOptions(opts?: ElementOptions): ElementOptions | undefined {
  if (!opts) return undefined;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(opts)) if (value !== undefined) out[key] = value;
  return Object.keys(out).length === 0 ? undefined : (out as ElementOptions);
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
    // W85 (D85-3): `default: undefined`, since Vue casts an absent Boolean prop to false.
    drag: { type: Boolean, default: undefined },
  },
  setup(props, { slots, attrs }) {
    const elRef = useLiquidRef<HTMLElement>({ viscosity: props.viscosity, recovery: props.recovery, drag: props.drag });
    return () => h(props.as, { ...attrs, ref: elRef }, slots.default?.());
  },
});
