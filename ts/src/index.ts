import { PhantomObserver } from "./phantom-observer";

export interface LiquidOptions {
  capacity?: number;
  autoObserve?: boolean;
  canvasZIndex?: number;
  colorDefault?: string;
  colorHover?: string;
}

type WasmInit = typeof import("../../pkg/liquiddom.js").default;
type LiquidCoreClass = typeof import("../../pkg/liquiddom.js").LiquidCore;

export class LiquidDOM {
  private static observer: PhantomObserver | null = null;
  private static canvas: HTMLCanvasElement | null = null;
  private static animationId = 0;

  static async init(options?: LiquidOptions): Promise<void> {
    const capacity = options?.capacity ?? 128;
    const autoObserve = options?.autoObserve ?? true;
    const canvasZIndex = options?.canvasZIndex ?? -1;

    // 1. Inject fullscreen canvas
    const canvas = document.createElement("canvas");
    canvas.style.position = "fixed";
    canvas.style.top = "0";
    canvas.style.left = "0";
    canvas.style.width = "100vw";
    canvas.style.height = "100vh";
    canvas.style.pointerEvents = "none";
    canvas.style.zIndex = String(canvasZIndex);
    document.body.appendChild(canvas);
    LiquidDOM.canvas = canvas;

    // 2. Try to initialize WASM (may fail in test environments)
    let core: InstanceType<LiquidCoreClass> | null = null;
    let wasmMemory: WebAssembly.Memory | null = null;

    try {
      const wasmModule = await import("../../pkg/liquiddom.js");
      const initWasm: WasmInit = wasmModule.default;
      const exports = await initWasm();
      wasmMemory = exports.memory;
      core = new wasmModule.LiquidCore(capacity);
    } catch {
      // WASM not available (e.g. test environment) — run in mock mode
    }

    // 3. Create PhantomObserver (WASM-backed or mock) with theme colors
    const observerOpts = {
      colorDefault: options?.colorDefault,
      colorHover: options?.colorHover,
      wasmSource: core && wasmMemory
        ? { memory: wasmMemory, ptr: core.ptr(), particlePtr: core.particle_ptr() }
        : undefined,
    };
    LiquidDOM.observer = new PhantomObserver(capacity, observerOpts);

    // 4. Auto-observe [data-liquid] elements
    if (autoObserve) {
      const elements =
        document.querySelectorAll<HTMLElement>("[data-liquid]");
      elements.forEach((el) => LiquidDOM.observer!.observe(el));
    }

    // 5. Pointer tracking
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

    // 6. Resize handler
    function resizeCanvas() {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    }
    resizeCanvas();
    window.addEventListener("resize", resizeCanvas);

    // 7. RAF loop (only if we have WASM + canvas context)
    const ctx = canvas.getContext("2d");
    if (ctx && core) {
      let lastTime = performance.now();

      const loop = (now: number) => {
        const dt = now - lastTime;
        lastTime = now;

        ctx.clearRect(0, 0, canvas.width, canvas.height);
        LiquidDOM.observer!.sync();
        core!.tick(dt, pointerX, pointerY, pointerActive);
        LiquidDOM.observer!.render(ctx);

        LiquidDOM.animationId = requestAnimationFrame(loop);
      };

      LiquidDOM.animationId = requestAnimationFrame(loop);
    }
  }

  static observe(el: HTMLElement): void {
    if (!LiquidDOM.observer) {
      throw new Error("LiquidDOM.init() must be called before observe()");
    }
    LiquidDOM.observer.observe(el);
  }

  static unobserve(el: HTMLElement): void {
    if (!LiquidDOM.observer) return;
    LiquidDOM.observer.unobserve(el);
  }
}
