/**
 * @liquiddom/react — React 18+ bindings.
 */
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type RefCallback,
  type HTMLAttributes,
  type ElementType,
} from "react";
import {
  LiquidDOM,
  type ElementOptions,
  type LiquidDOMInstance,
  type LiquidOptions,
} from "liquiddom";

/** Context value: the live instance, or null before init, after destroy and once it stopped (W85). */
export const LiquidContext = createContext<LiquidDOMInstance | null>(null);

/** W85 (D85-2, design resolution 10): why the provider has no instance; null otherwise. Private: read it with useLiquidError(). */
const LiquidErrorContext = createContext<unknown>(null);

/** Provider props. `config` is read ONCE on mount; subsequent changes are ignored. */
export interface LiquidProviderProps {
  config?: LiquidOptions;
  children: ReactNode;
}

/**
 * W85 (D85-2): `config` with the provider's handler chained in front of `config.onError`, which is
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

export function LiquidProvider({ config, children }: LiquidProviderProps): JSX.Element {
  const [instance, setInstance] = useState<LiquidDOMInstance | null>(null);
  const [error, setError] = useState<unknown>(null);
  const configRef = useRef(config);

  useEffect(() => {
    if (typeof window === "undefined") return; // SSR guard — never runs server-side

    let cancelled = false;
    let created: LiquidDOMInstance | null = null;
    // W85 (D85-2): set by the instance's onError. A stop can arrive before create() resolves (design
    // resolution 11); the instance is then destroyed on arrival.
    let stopped = false;

    // W85 (design resolution 2): synchronous, from inside core's onError, which runs last in the stop
    // (design resolution 1). useLiquid() never hands out a stopped instance; React 18 batches a
    // setState from a RAF or event callback.
    const onStop = (err: unknown): void => {
      if (cancelled || stopped) return;
      stopped = true;
      const inst = created;
      created = null;
      inst?.destroy();
      setInstance(null);
      setError(() => err); // an updater: the error itself may be a function
    };

    LiquidDOM.create(withOnError(configRef.current, onStop))
      .then((inst) => {
        if (cancelled || stopped) {
          // Provider unmounted (or strict-mode cleanup) before create resolved, or the instance
          // stopped while create() still ran.
          inst.destroy();
          return;
        }
        created = inst;
        setInstance(inst);
      })
      .catch((err: unknown) => {
        console.error("[liquiddom/react] LiquidProvider failed to create instance:", err);
        // W85 (D85-2): no retry; a remount creates a new instance.
        if (!cancelled) setError(() => err);
      });

    return () => {
      cancelled = true;
      if (created) created.destroy();
      created = null;
      // Ward-fix M1: the context must never hand out a destroyed instance
      // ("null after destroy"), e.g. when React re-runs this effect on a kept
      // component (Fast Refresh, strict-mode reconnects). React 18 ignores the
      // update after a real unmount.
      setInstance(null);
      setError(null); // W85: a re-run effect starts without an error
    };
  }, []); // empty deps — config captured by ref, ignored after mount

  return (
    <LiquidErrorContext.Provider value={error}>
      <LiquidContext.Provider value={instance}>{children}</LiquidContext.Provider>
    </LiquidErrorContext.Provider>
  );
}

/** Read the live instance from context. Null before init, outside a provider and once it stopped. */
export function useLiquid(): LiquidDOMInstance | null {
  return useContext(LiquidContext);
}

/**
 * W85 (D85-2): the error that left the provider without an instance: a stop's error (a frame that
 * threw, a failed grid growth or rebuild; the provider has destroyed the instance) or the create()
 * rejection. Null otherwise and outside a provider. No retry: remount the provider (a new `key`)
 * to create a new instance.
 */
export function useLiquidError(): unknown {
  return useContext(LiquidErrorContext);
}

/** Element options (viscosity, recovery, drag), captured at first attach (D66-4). */
export type UseLiquidRefOptions = ElementOptions;

/** W85 (D85-3, design resolution 8): every own key whose value is defined; none → undefined. */
function pickElementOptions(opts?: ElementOptions): ElementOptions | undefined {
  if (!opts) return undefined;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(opts)) if (value !== undefined) out[key] = value;
  return Object.keys(out).length === 0 ? undefined : (out as ElementOptions);
}

/**
 * Callback ref that auto-observes the attached element. Safe before the
 * provider's instance is ready (the effect re-runs when it arrives). Options
 * are captured once, on first render (D66-4).
 *
 * Strict-mode safe: cleanup unobserves, remount re-observes; observe is idempotent.
 */
export function useLiquidRef<T extends HTMLElement>(opts?: UseLiquidRefOptions): RefCallback<T> {
  const instance = useLiquid();
  const [el, setEl] = useState<T | null>(null);
  const optsRef = useRef<ElementOptions | undefined>(pickElementOptions(opts));

  useEffect(() => {
    if (!el || !instance) return;
    instance.observe(el, optsRef.current);
    return () => {
      instance.unobserve(el);
    };
  }, [el, instance]);

  return setEl as RefCallback<T>;
}

export interface LiquidElementProps {
  as?: keyof JSX.IntrinsicElements;
  /** [0, 1]; captured at first attach. */
  viscosity?: number;
  /** Seconds in [0.2, 3]; captured at first attach. */
  recovery?: number;
  /** W85 (D85-3): `false` opts the element out of every drag (mouse, pen, touch); captured at first attach. */
  drag?: boolean;
  children?: ReactNode;
}

/**
 * Renders the chosen tag (default `div`) and auto-observes it. `viscosity`,
 * `recovery` and `drag` are consumed (not forwarded to the DOM); every other prop is spread.
 */
export function LiquidElement(props: LiquidElementProps & HTMLAttributes<HTMLElement>): JSX.Element {
  const { as, viscosity, recovery, drag, children, ...rest } = props;
  const ref = useLiquidRef<HTMLElement>({ viscosity, recovery, drag });
  const Tag = (as ?? "div") as ElementType;
  return (
    <Tag ref={ref} {...rest}>
      {children}
    </Tag>
  );
}
