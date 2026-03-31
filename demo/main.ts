import { LiquidDOM } from "../ts/src/index";

async function bootstrap() {
  try {
    await LiquidDOM.init({
      capacity: 64,
      autoObserve: true,
      canvasZIndex: -1,
      colorDefault: "rgba(15, 52, 96, 0.8)",
      colorHover: "rgba(233, 69, 96, 0.9)",
    });
    console.log("[LiquidDOM] Flowing!");
  } catch (err) {
    console.error("Failed to initialize Liquid DOM:", err);
  }
}

bootstrap();

// FPS counter (independent of LiquidDOM)
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
