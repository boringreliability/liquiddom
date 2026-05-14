import { LiquidDOM, presets, type SplashOptions } from "liquiddom";

interface SplashPreset {
  direction: [number, number];
  magnitude: number;
  duration: number;
  splash: SplashOptions;
}

const PRESETS: Record<string, SplashPreset> = {
  gentle: {
    direction: [1, 0],
    magnitude: 40,
    duration: 300,
    splash: { threshold: 0, count: 3, jitter: 8, speedScale: 0.4, lifetimeMs: 2000 },
  },
  explosion: {
    direction: [0, -1],
    magnitude: 120,
    duration: 250,
    splash: { threshold: 0, count: 16, jitter: 60, speedScale: 0.6, lifetimeMs: 3500, radius: 5 },
  },
  trickle: {
    // Threshold demo: clicked magnitude alternates between 5 (below) and 80 (above).
    direction: [1, 0],
    magnitude: 80,
    duration: 300,
    splash: { threshold: 50, count: 8, jitter: 20, speedScale: 0.5, lifetimeMs: 2500 },
  },
};

async function main() {
  try {
    const liquid = await LiquidDOM.create({
      capacity: 64,
      autoObserve: true,
      canvasZIndex: -1,
      colorDefault: "rgba(15, 52, 96, 0.85)",
      colorHover: "rgba(233, 69, 96, 0.9)",
      physics: { ...presets.jelly, tension: 80, damping: 5, substeps: 2 },
    });

    // Expose for DevTools console experimentation.
    (window as unknown as { liquid: typeof liquid }).liquid = liquid;

    // Threshold demo alternates magnitude between clicks so users can see
    // below-threshold (no droplets) and above-threshold (8 droplets) in turn.
    let trickleHard = true;

    document.querySelectorAll<HTMLElement>("[data-splash]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const presetName = btn.getAttribute("data-splash");
        if (!presetName) return;
        const preset = PRESETS[presetName];
        if (!preset) return;

        if (presetName === "trickle") {
          // Flip magnitude so the gate fires every other click.
          const mag = trickleHard ? preset.magnitude : 20;
          trickleHard = !trickleHard;
          liquid.impulse(btn, { ...preset, magnitude: mag });
          return;
        }

        liquid.impulse(btn, preset);
      });
    });

    console.log("[LiquidDOM] Splash Buttons scene ready. liquid is on window.");
  } catch (err) {
    console.error("Failed to initialize:", err);
  }
}

main();
