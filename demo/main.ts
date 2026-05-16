import { LiquidDOM, presets } from "liquiddom";

async function bootstrap() {
  try {
    const liquid = await LiquidDOM.create({
      capacity: 64,
      autoObserve: true,
      colorDefault: "rgba(15, 52, 96, 0.75)",
      colorHover: "rgba(233, 69, 96, 0.85)",
      physics: {
        ...presets.jelly,
        tension: 60,
        damping: 4,
        substeps: 2,
      },
    });

    // Wire up impulse buttons
    document.querySelectorAll<HTMLElement>("[data-shake]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const type = btn.getAttribute("data-shake");
        switch (type) {
          case "soft":
            liquid.impulse(btn, { direction: [0, -1], magnitude: 30, duration: 400 });
            break;
          case "hard":
            liquid.impulse(btn, { direction: [1, 0], magnitude: 80, duration: 200 });
            break;
          case "bounce":
            liquid.impulse(btn, { direction: [0, 1], magnitude: 60, duration: 500 });
            break;
        }
      });
    });

    console.log("[LiquidDOM] Everything flows.");
  } catch (err) {
    console.error("Failed to initialize Liquid DOM:", err);
  }
}

bootstrap();

// FPS counter
const fpsEl = document.getElementById("fps");
if (fpsEl) {
  let lastTime = performance.now();
  let frameCount = 0;
  let fpsAccum = 0;

  function fpsLoop(now: number) {
    const dt = now - lastTime;
    lastTime = now;
    frameCount++;
    fpsAccum += dt;
    if (frameCount >= 30) {
      fpsEl!.textContent = `${(1000 / (fpsAccum / frameCount)).toFixed(0)} FPS`;
      frameCount = 0;
      fpsAccum = 0;
    }
    requestAnimationFrame(fpsLoop);
  }
  requestAnimationFrame(fpsLoop);
}
