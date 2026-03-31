import init, { LiquidCore } from "../pkg/liquiddom.js";
import { PhantomObserver } from "../ts/src/phantom-observer.js";

async function main() {
  // 1. Initialize WASM
  const wasm = await init();

  // 2. Create LiquidCore (Rust-side buffer)
  const capacity = 64;
  const core = new LiquidCore(capacity);

  // 3. Create PhantomObserver backed by WASM memory (entity + particle buffers)
  const observer = new PhantomObserver(capacity, {
    memory: wasm.memory,
    ptr: core.ptr(),
    particlePtr: core.particle_ptr(),
  });

  // 4. Observe all [data-liquid] elements
  const elements = document.querySelectorAll<HTMLElement>("[data-liquid]");
  elements.forEach((el) => observer.observe(el));

  // 5. Setup canvas
  const canvas = document.getElementById("liquid-canvas") as HTMLCanvasElement;
  const ctx = canvas.getContext("2d")!;
  const fpsEl = document.getElementById("fps")!;

  function resizeCanvas() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
  }
  resizeCanvas();
  window.addEventListener("resize", resizeCanvas);

  // 6. Pointer tracking
  let pointerX = 0;
  let pointerY = 0;
  let pointerActive = false;

  document.addEventListener("mousemove", (e) => {
    pointerX = e.clientX;
    pointerY = e.clientY;
    pointerActive = true;
  });
  document.addEventListener("mouseleave", () => {
    pointerActive = false;
  });

  // 7. RAF loop
  let lastTime = performance.now();
  let frameCount = 0;
  let fpsAccum = 0;

  function loop(now: number) {
    const dt = now - lastTime;
    lastTime = now;

    // FPS counter (update every 30 frames)
    frameCount++;
    fpsAccum += dt;
    if (frameCount >= 30) {
      const avgFps = 1000 / (fpsAccum / frameCount);
      fpsEl.textContent = `${avgFps.toFixed(0)} FPS`;
      frameCount = 0;
      fpsAccum = 0;
    }

    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Sync DOM positions → WASM buffer
    observer.sync();

    // Call Rust tick (runs physics — dt is in ms, Rust converts to seconds)
    core.tick(dt, pointerX, pointerY, pointerActive);

    // Debug render: draw red boxes from WASM memory
    observer.debugRender(ctx);

    requestAnimationFrame(loop);
  }

  requestAnimationFrame(loop);
  console.log(
    `[LiquidDOM] Initialized: ${elements.length} elements tracked, capacity ${capacity}`,
  );
}

main();
