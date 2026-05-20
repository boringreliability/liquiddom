import { LiquidDOM, presets, WebGPUUnavailableError } from "liquiddom";

function setBadge(active: "canvas2d" | "webgpu"): void {
  const badge = document.getElementById("renderer-badge");
  if (!badge) return;
  badge.textContent = `renderer: ${active}`;
  badge.dataset.renderer = active;
}

function parseUrlOverrides(): { renderer?: "canvas2d" | "webgpu"; fusionRadius?: number } {
  const params = new URLSearchParams(window.location.search);
  const out: { renderer?: "canvas2d" | "webgpu"; fusionRadius?: number } = {};
  const r = params.get("renderer");
  if (r === "canvas2d" || r === "webgpu") out.renderer = r;
  const f = params.get("fusionRadius");
  if (f !== null && /^\d+(\.\d+)?$/.test(f)) {
    const n = Number(f);
    if (Number.isFinite(n) && n >= 0) out.fusionRadius = n;
  }
  return out;
}

async function main() {
  const overrides = parseUrlOverrides();
  const fusionRadius = overrides.fusionRadius ?? 60;

  // W41: the `'auto'` default handles fallback inside core. We only opt out of
  // it for explicit URL overrides (`?renderer=webgpu` for the hard-fail demo,
  // `?renderer=canvas2d` to skip probing entirely).
  const baseConfig = {
    capacity: 8,
    autoObserve: true,
    theme: { fusionRadius },
    colorDefault: "rgba(30, 130, 220, 0.85)",
    colorHover: "rgba(233, 69, 96, 0.9)",
    physics: { ...presets.jelly, tension: 80, substeps: 2 },
  };

  let instance;
  if (overrides.renderer === "webgpu") {
    // Explicit `?renderer=webgpu` keeps the legacy try/catch — proves the
    // hard-fail path and demonstrates how consumers handle it themselves.
    try {
      instance = await LiquidDOM.create({ ...baseConfig, renderer: "webgpu" });
    } catch (err) {
      if (!(err instanceof WebGPUUnavailableError)) throw err;
      console.warn("[fusion-demo] WebGPU unavailable, falling back to canvas2d:", err);
      instance = await LiquidDOM.create({ ...baseConfig, renderer: "canvas2d" });
    }
  } else if (overrides.renderer === "canvas2d") {
    instance = await LiquidDOM.create({ ...baseConfig, renderer: "canvas2d" });
  } else {
    // No URL override → use the new W41 'auto' default.
    instance = await LiquidDOM.create(baseConfig);
  }

  setBadge(instance.activeRenderer);
  console.log(
    `[LiquidDOM] Metaball Fusion scene ready — renderer=${instance.activeRenderer}, fusionRadius=${fusionRadius}`,
  );
}

main();
