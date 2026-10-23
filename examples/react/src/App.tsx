import { LiquidProvider, LiquidElement, useLiquid, useLiquidError, useLiquidRef } from "@liquiddom/react";

function HookButton() {
  const ref = useLiquidRef<HTMLButtonElement>({ viscosity: 0.3 });
  return (
    <button ref={ref} className="pill">
      via useLiquidRef
    </button>
  );
}

/** W85 (D85-2): the provider's error state as text (a stop or a create() rejection). */
function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * W69 (D69-6): `data-liquid-ready` appears once useLiquid() returns the instance,
 * i.e. after LiquidDOM.create() has resolved. e2e/dist.spec.ts waits for it.
 * W85 (D85-5): the LiquidElement pill opts out of drag; the error line documents useLiquidError().
 */
function Demo() {
  const liquid = useLiquid();
  const error = useLiquidError();
  return (
    <main data-liquid-ready={liquid !== null ? "true" : undefined}>
      <h1>liquiddom/react</h1>
      <p>Two ways to use the adapter; the second pill opts out of drag.</p>
      <HookButton />
      <LiquidElement as="button" className="pill" recovery={1.2} drag={false}>
        via LiquidElement (no drag)
      </LiquidElement>
      {error !== null ? <p role="alert">Liquid stopped: {describeError(error)}</p> : null}
    </main>
  );
}

export default function App() {
  return (
    <LiquidProvider config={{ material: { viscosity: 0.6, cohesion: 0.85, recovery: 0.4 } }}>
      <Demo />
    </LiquidProvider>
  );
}
