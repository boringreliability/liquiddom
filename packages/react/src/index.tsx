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

/** Context value: the live instance, or null before init / after destroy. */
export const LiquidContext = createContext<LiquidDOMInstance | null>(null);

/** Provider props. `config` is read ONCE on mount; subsequent changes are ignored. */
export interface LiquidProviderProps {
  config?: LiquidOptions;
  children: ReactNode;
}

export function LiquidProvider({ config, children }: LiquidProviderProps): JSX.Element {
  const [instance, setInstance] = useState<LiquidDOMInstance | null>(null);
  const configRef = useRef(config);

  useEffect(() => {
    if (typeof window === "undefined") return; // SSR guard — never runs server-side

    let cancelled = false;
    let created: LiquidDOMInstance | null = null;

    LiquidDOM.create(configRef.current)
      .then((inst) => {
        if (cancelled) {
          // Provider unmounted (or strict-mode cleanup) before create resolved.
          inst.destroy();
          return;
        }
        created = inst;
        setInstance(inst);
      })
      .catch((err) => {
        console.error("[liquiddom/react] LiquidProvider failed to create instance:", err);
      });

    return () => {
      cancelled = true;
      if (created) created.destroy();
      // Ward-fix M1: the context must never hand out a destroyed instance
      // ("null after destroy"), e.g. when React re-runs this effect on a kept
      // component (Fast Refresh, strict-mode reconnects). React 18 ignores the
      // update after a real unmount.
      setInstance(null);
    };
  }, []); // empty deps — config captured by ref, ignored after mount

  return <LiquidContext.Provider value={instance}>{children}</LiquidContext.Provider>;
}

/** Read the live instance from context. Null before init / outside a provider. */
export function useLiquid(): LiquidDOMInstance | null {
  return useContext(LiquidContext);
}

/** Element options (viscosity, recovery), captured at first attach (D66-4). */
export type UseLiquidRefOptions = ElementOptions;

function pickElementOptions(opts?: ElementOptions): ElementOptions | undefined {
  if (!opts) return undefined;
  const out: ElementOptions = {};
  if (opts.viscosity !== undefined) out.viscosity = opts.viscosity;
  if (opts.recovery !== undefined) out.recovery = opts.recovery;
  return out.viscosity === undefined && out.recovery === undefined ? undefined : out;
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
  children?: ReactNode;
}

/**
 * Renders the chosen tag (default `div`) and auto-observes it. `viscosity` and
 * `recovery` are consumed (not forwarded to the DOM); every other prop is spread.
 */
export function LiquidElement(props: LiquidElementProps & HTMLAttributes<HTMLElement>): JSX.Element {
  const { as, viscosity, recovery, children, ...rest } = props;
  const ref = useLiquidRef<HTMLElement>({ viscosity, recovery });
  const Tag = (as ?? "div") as ElementType;
  return (
    <Tag ref={ref} {...rest}>
      {children}
    </Tag>
  );
}
