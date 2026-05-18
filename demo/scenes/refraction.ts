import { LiquidDOM, presets, WebGPUUnavailableError } from "liquiddom";

function setBadge(active: "canvas2d" | "webgpu"): void {
  const badge = document.getElementById("renderer-badge");
  if (!badge) return;
  badge.textContent = `renderer: ${active}`;
  badge.dataset.renderer = active;
}

function parseUrlOverrides(): {
  renderer?: "canvas2d" | "webgpu";
  strength?: number;
  refractionOff: boolean;
} {
  const params = new URLSearchParams(window.location.search);
  const out: { renderer?: "canvas2d" | "webgpu"; strength?: number; refractionOff: boolean } = {
    refractionOff: params.get("refraction") === "off",
  };
  const r = params.get("renderer");
  if (r === "canvas2d" || r === "webgpu") out.renderer = r;
  const s = params.get("strength");
  if (s !== null && /^\d+(\.\d+)?$/.test(s)) {
    const n = Number(s);
    if (Number.isFinite(n) && n >= 0) out.strength = n;
  }
  return out;
}

// Paint the visible backdrop panel to an offscreen canvas and produce an
// ImageBitmap suitable for instance.setBackgroundTexture(). This mirrors the
// pattern hosts would use to snapshot DOM (without pulling in html2canvas).
async function captureBackdropBitmap(): Promise<ImageBitmap> {
  const dpr = window.devicePixelRatio || 1;
  const w = window.innerWidth;
  const h = window.innerHeight;
  const canvas = document.createElement("canvas");
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  const ctx = canvas.getContext("2d")!;
  ctx.scale(dpr, dpr);

  // Match #backdrop's gradient panel for the lensing payoff.
  ctx.fillStyle = "#0a0a12";
  ctx.fillRect(0, 0, w, h);

  const panelW = Math.min(640, w - 64);
  const panelH = 240;
  const panelX = (w - panelW) / 2;
  const panelY = (h - panelH) / 2;
  const grad = ctx.createLinearGradient(panelX, panelY, panelX + panelW, panelY + panelH);
  grad.addColorStop(0, "rgba(120, 60, 200, 0.85)");
  grad.addColorStop(1, "rgba(220, 70, 120, 0.7)");
  ctx.fillStyle = grad;
  // Use roundRect when available; falls back to rect on older browsers.
  if (typeof ctx.roundRect === "function") {
    ctx.beginPath();
    ctx.roundRect(panelX, panelY, panelW, panelH, 16);
    ctx.fill();
  } else {
    ctx.fillRect(panelX, panelY, panelW, panelH);
  }

  ctx.fillStyle = "rgba(240, 230, 255, 0.95)";
  ctx.font = "18px system-ui, sans-serif";
  const lines = [
    "Lorem ipsum dolor sit amet, consectetur",
    "adipiscing elit. Sed do eiusmod tempor",
    "incididunt ut labore et dolore magna aliqua.",
    "Ut enim ad minim veniam, quis nostrud",
    "exercitation ullamco laboris nisi ut aliquip",
    "ex ea commodo consequat.",
  ];
  lines.forEach((line, i) => ctx.fillText(line, panelX + 32, panelY + 48 + i * 30));

  return await createImageBitmap(canvas);
}

async function main() {
  const overrides = parseUrlOverrides();
  const requestedRenderer = overrides.renderer ?? "webgpu";
  const strength = overrides.strength ?? 12;
  const refractionEnabled = !overrides.refractionOff;

  const baseConfig = {
    capacity: 8,
    autoObserve: true,
    colorDefault: "rgba(30, 130, 220, 0.65)",
    colorHover: "rgba(233, 69, 96, 0.8)",
    physics: { ...presets.jelly, tension: 80, substeps: 2 },
    theme: {
      fusionRadius: 50,
      refraction: { enabled: refractionEnabled, strength },
    },
  };

  let active: "canvas2d" | "webgpu" = "canvas2d";
  let instance;
  try {
    instance = await LiquidDOM.create({ ...baseConfig, renderer: requestedRenderer });
    active = requestedRenderer;
  } catch (err) {
    if (err instanceof WebGPUUnavailableError) {
      console.warn("[refraction-demo] WebGPU unavailable, falling back to canvas2d:", err);
      instance = await LiquidDOM.create(baseConfig);
      active = "canvas2d";
    } else {
      throw err;
    }
  }

  setBadge(active);

  // Host-supplied texture: paint the visible backdrop to an offscreen canvas,
  // hand the bitmap to the renderer. On window resize, re-snapshot.
  if (active === "webgpu" && refractionEnabled) {
    const bitmap = await captureBackdropBitmap();
    instance.setBackgroundTexture(bitmap);

    let resizeTimer: ReturnType<typeof setTimeout> | null = null;
    window.addEventListener("resize", () => {
      if (resizeTimer !== null) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(async () => {
        const next = await captureBackdropBitmap();
        instance.setBackgroundTexture(next);
      }, 200);
    });
  }

  console.log(
    `[LiquidDOM] Refraction scene ready — renderer=${active}, ` +
    `refraction=${refractionEnabled ? "on" : "off"}, strength=${strength}`,
  );
}

main();
