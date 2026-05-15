import { LiquidDOM, presets } from "liquiddom";

const statusEl = document.getElementById("status") as HTMLElement;
const enableBtn = document.getElementById("enable-tilt") as HTMLButtonElement;
const spawnBtn = document.getElementById("spawn-droplets") as HTMLButtonElement;
const resetBtn = document.getElementById("reset") as HTMLButtonElement;
const bowl = document.querySelector(".bowl") as HTMLElement;

async function main() {
  // Start in orientation mode — gravity will be zero on devices that don't
  // grant permission. Desktop without DevTools sensor emulation also sees zero.
  const liquid = await LiquidDOM.create({
    capacity: 32,
    autoObserve: true,
    canvasZIndex: -1,
    colorDefault: "rgba(15, 52, 96, 0.9)",
    colorHover: "rgba(233, 69, 96, 0.9)",
    physics: { ...presets.jelly, tension: 60, damping: 6, substeps: 2 },
    gravity: { source: "orientation", strength: 500 },
  });

  (window as unknown as { liquid: typeof liquid }).liquid = liquid;

  // ── Enable tilt (iOS permission) ──
  enableBtn.addEventListener("click", async () => {
    enableBtn.disabled = true;
    enableBtn.textContent = "Requesting…";
    const granted = await liquid.requestOrientationPermission();
    if (granted) {
      enableBtn.textContent = "Tilt enabled ✓";
      statusEl.textContent = "Gravity: orientation (tilt your device)";
    } else {
      enableBtn.textContent = "Tilt denied";
      statusEl.textContent = "Permission denied — fallback to DevTools Sensors.";
    }
  });

  // ── Spawn droplets at bowl center ──
  spawnBtn.addEventListener("click", () => {
    const rect = bowl.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    for (let j = 0; j < 12; j++) {
      const angle = (j / 12) * Math.PI * 2;
      const speed = 80 + Math.random() * 40;
      liquid.spawnDroplet({
        x: cx,
        y: cy,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        radius: 4,
        lifetimeMs: 4000,
      });
    }
  });

  // ── Reset: despawn all droplets via destroy + recreate is overkill;
  //    instead we walk dropletIds privately. Cleaner: just wait for them.
  //    For W46 demo this button is mostly for the "let me see again" UX. ──
  resetBtn.addEventListener("click", () => {
    statusEl.textContent = "Waiting for droplets to lifetime-cull…";
    setTimeout(() => {
      statusEl.textContent = liquid.isReducedMotion
        ? "Reduced motion: gravity clamped to (0, 0)"
        : "Gravity: orientation (tilt your device)";
    }, 4500);
  });

  console.log("[LiquidDOM] Tilt Bowl scene ready. liquid is on window.");
}

main().catch((err) => {
  console.error("Failed to initialize:", err);
  statusEl.textContent = `Init failed: ${(err as Error).message ?? err}`;
});
