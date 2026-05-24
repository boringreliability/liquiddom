import { LiquidDOM, presets } from "liquiddom";

// W59 bug-fix: drag-mode is now explicitly opt-in via `observe(el, 3)`.
// Previously the W30 PointerDown handler hijacked every `[data-liquid]`
// click into drag-mode — that hid a contract bug where you had to specify
// liquid_type=3 to actually intend dragging. autoObserve picks elements
// up with default type (0); we observe them manually with type=3 instead.

async function main() {
  try {
    const instance = await LiquidDOM.create({
      capacity: 16,
      autoObserve: false, // we observe manually below to set liquid_type=3
      colorDefault: "rgba(15, 52, 96, 0.8)",
      colorHover: "rgba(233, 69, 96, 0.9)",
      physics: {
        ...presets.jelly,
        substeps: 2,
      },
    });

    for (const card of document.querySelectorAll<HTMLElement>("[data-liquid]")) {
      instance.observe(card, 3); // 3 = Dragged
    }

    console.log("[LiquidDOM] Dragable Cards scene ready.");
  } catch (err) {
    console.error("Failed to initialize:", err);
  }
}

main();
