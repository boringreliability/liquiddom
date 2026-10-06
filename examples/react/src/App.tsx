import { LiquidProvider, LiquidElement, useLiquid, useLiquidRef } from "@liquiddom/react";

function HookButton() {
  const ref = useLiquidRef<HTMLButtonElement>({ viscosity: 0.3 });
  return (
    <button ref={ref} className="pill">
      via useLiquidRef
    </button>
  );
}

/**
 * W69 (D69-6): `data-liquid-ready` appears once useLiquid() returns the instance,
 * i.e. after LiquidDOM.create() has resolved. e2e/dist.spec.ts waits for it.
 */
function Demo() {
  const liquid = useLiquid();
  return (
    <main data-liquid-ready={liquid !== null ? "true" : undefined}>
      <h1>liquiddom/react</h1>
      <p>Two ways to use the adapter.</p>
      <HookButton />
      <LiquidElement as="button" className="pill" recovery={1.2}>
        via LiquidElement
      </LiquidElement>
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
