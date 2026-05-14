import { LiquidDOM } from "liquiddom";

async function main() {
  try {
    await LiquidDOM.create({
      capacity: 16,
      autoObserve: true,
      canvasZIndex: -1,
      colorDefault: "rgba(30, 20, 60, 0.7)",
      colorHover: "rgba(80, 50, 140, 0.85)",
      physics: {
        // Low tension + low damping = slow, organic "breathing"
        tension: 40,
        damping: 3,
        substeps: 1,
        repulsionRadius: 120,
        repulsionStrength: 4000,
      },
    });
    console.log("[LiquidDOM] Scroll Hero scene ready.");
  } catch (err) {
    console.error("Failed to initialize:", err);
  }
}

main();
