/**
 * @liquiddom/react — React 18+ bindings (Ward 047).
 *
 * Pre-staged in `adapters/react/`. W51 will move this to `packages/react/`
 * and publish as `@liquiddom/react` on npm.
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
  type LiquidDOMInstance,
  type LiquidOptions,
} from "../../ts/src/index";

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
      // No setInstance(null) on unmount — context is going away regardless,
      // and post-unmount state updates generate noise in test output.
    };
  }, []); // empty deps — config captured by ref, ignored after mount

  return <LiquidContext.Provider value={instance}>{children}</LiquidContext.Provider>;
}

/** Read the live instance from context. Null before init / outside a provider. */
export function useLiquid(): LiquidDOMInstance | null {
  return useContext(LiquidContext);
}

export interface UseLiquidRefOptions {
  liquidType?: number;
}

/**
 * Callback ref that auto-observes the attached element. Safe to use before
 * the provider's instance is ready — observation deferred via state-trigger
 * pattern (effect re-runs when `instance` becomes available).
 *
 * Strict-mode safe: cleanup unobserves, remount re-observes; `observe` is
 * idempotent (W14 invariant).
 *
 * Closure-capture: the effect cleanup captures `el` and `instance` at the
 * time the effect ran. A later `setEl(null)` does NOT change which element
 * the captured cleanup unobserves.
 */
export function useLiquidRef<T extends HTMLElement>(
  opts?: UseLiquidRefOptions,
): RefCallback<T> {
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

// TODO(W51): bump to a full polymorphic generic — `LiquidElementProps<E extends keyof JSX.IntrinsicElements = "div">` — so `<LiquidElement as="input" type="text">` picks up input-specific attrs. Deferred for v1 to keep the API surface narrow.
export interface LiquidElementProps {
  as?: keyof JSX.IntrinsicElements;
  liquidType?: number;
  children?: ReactNode;
}

/**
 * Convenience component: renders the chosen tag (default `div`) and auto-
 * observes it via `useLiquidRef`. All HTML attributes are forwarded via spread.
 *
 * Polymorphic typing is intentionally loose for v1 — props are typed as
 * `HTMLAttributes<HTMLElement>` so most common attributes typecheck across
 * tags. Tag-specific attributes (`type` on input, `disabled` on button) may
 * require a cast. Full polymorphic typing deferred to a follow-up ward.
 */
export function LiquidElement(
  props: LiquidElementProps & HTMLAttributes<HTMLElement>,
): JSX.Element {
  const { as, liquidType, children, ...rest } = props;
  const ref = useLiquidRef<HTMLElement>({ liquidType });
  const Tag = (as ?? "div") as ElementType;
  return (
    <Tag ref={ref} {...rest}>
      {children}
    </Tag>
  );
}
