import { LiquidDOM, presets } from "liquiddom";

async function main() {
  try {
    await LiquidDOM.create({
      capacity: 16,
      autoObserve: true,
      canvasZIndex: -1,
      colorDefault: "rgba(15, 52, 96, 0.8)",
      colorHover: "rgba(233, 69, 96, 0.9)",
      physics: {
        ...presets.jelly,
        substeps: 2,
      },
    });
    console.log("[LiquidDOM] Dragable Cards scene ready.");
  } catch (err) {
    console.error("Failed to initialize:", err);
  }
}

main();
