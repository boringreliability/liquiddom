/** Resolution 9: chapter 8's code samples, pinned to the README quick start and `examples/{react,vue}`; public API only. */
export const INSTALL_LINE = "npm install liquiddom@alpha";

const VANILLA = `<button data-liquid>Pour me</button>

<script type="module">
  import { LiquidDOM } from "liquiddom";
  const liquid = await LiquidDOM.create({ autoObserve: true });
</script>`;

const REACT = `import { LiquidProvider, LiquidElement, useLiquidError } from "@liquiddom/react";

function Pills() {
  const error = useLiquidError();
  return (
    <>
      <LiquidElement as="button" className="pill">Pour me</LiquidElement>
      <LiquidElement as="button" className="pill" drag={false}>I stay put</LiquidElement>
      {error !== null ? <p role="status">The liquid stopped.</p> : null}
    </>
  );
}

export default function App() {
  return (
    <LiquidProvider config={{ material: { viscosity: 0.6, cohesion: 0.85, recovery: 0.4 } }}>
      <Pills />
    </LiquidProvider>
  );
}`;

const VUE = `// main.ts
import { createApp, defineComponent, h } from "vue";
import { LiquidPlugin, LiquidElement, useLiquidError } from "@liquiddom/vue";

const App = defineComponent({
  setup() {
    const error = useLiquidError();
    return () => [
      h(LiquidElement, { as: "button", class: "pill" }, { default: () => "Pour me" }),
      h(LiquidElement, { as: "button", class: "pill", drag: false }, { default: () => "I stay put" }),
      error.value !== null ? h("p", { role: "status" }, "The liquid stopped.") : null,
    ];
  },
});

createApp(App).use(LiquidPlugin, { material: { viscosity: 0.6 } }).mount("#app");`;

export const CODE_SAMPLES: Readonly<Record<"vanilla" | "react" | "vue", string>> = {
  vanilla: VANILLA,
  react: REACT,
  vue: VUE,
};
