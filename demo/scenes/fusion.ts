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
  const requestedRenderer = overrides.renderer ?? "webgpu";
  const fusionRadius = overrides.fusionRadius ?? 60;

  let active: "canvas2d" | "webgpu" = "canvas2d";
  try {
    await LiquidDOM.create({
      capacity: 8,
      autoObserve: true,
      renderer: requestedRenderer,
      theme: { fusionRadius },
      colorDefault: "rgba(30, 130, 220, 0.85)",
      colorHover: "rgba(233, 69, 96, 0.9)",
      physics: { ...presets.jelly, tension: 80, substeps: 2 },
    });
    active = requestedRenderer;
  } catch (err) {
    if (err instanceof WebGPUUnavailableError) {
      console.warn("[fusion-demo] WebGPU unavailable, falling back to canvas2d:", err);
      await LiquidDOM.create({
        capacity: 8,
        autoObserve: true,
        colorDefault: "rgba(30, 130, 220, 0.85)",
        colorHover: "rgba(233, 69, 96, 0.9)",
        physics: { ...presets.jelly, tension: 80, substeps: 2 },
      });
      active = "canvas2d";
    } else {
      throw err;
    }
  }
  setBadge(active);
  console.log(`[LiquidDOM] Metaball Fusion scene ready — renderer=${active}, fusionRadius=${fusionRadius}`);
}

main();
