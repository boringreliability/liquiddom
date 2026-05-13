import { LiquidProvider, useLiquidRef, LiquidElement } from "../../../adapters/react";
import { presets } from "../../../ts/src/index";

function HookButton() {
  const ref = useLiquidRef<HTMLButtonElement>();
  return (
    <button ref={ref} className="pill">
      via useLiquidRef
    </button>
  );
}

export default function App() {
  return (
    <LiquidProvider config={{ physics: presets.jelly }}>
      <main>
        <h1>liquiddom/react</h1>
        <p>Two ways to use the adapter.</p>
        <HookButton />
        <LiquidElement as="button" className="pill">
          via LiquidElement
        </LiquidElement>
      </main>
    </LiquidProvider>
  );
}
