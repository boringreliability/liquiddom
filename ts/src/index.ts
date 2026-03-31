import { PhantomObserver } from "./phantom-observer";

export interface LiquidOptions {
  capacity?: number;
  autoObserve?: boolean;
  canvasZIndex?: number;
  colorDefault?: string;
  colorHover?: string;
}

export interface LiquidDOMInstance {
  observe(el: HTMLElement, liquidType?: number): number;
  unobserve(el: HTMLElement): void;
  destroy(): void;
}

type WasmInit = typeof import("../../pkg/liquiddom.js").default;
type LiquidCoreClass = typeof import("../../pkg/liquiddom.js").LiquidCore;

export class LiquidDOM {
  /**
   * Create an isolated LiquidDOM runtime instance.
   * Each instance owns its own canvas, observer, WASM core, and RAF loop.
   */
  static async create(options?: LiquidOptions): Promise<LiquidDOMInstance> {
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
    const observer = new PhantomObserver(capacity, {
      colorDefault: options?.colorDefault,
      colorHover: options?.colorHover,
      wasmSource: core && wasmMemory
        ? { memory: wasmMemory, ptr: core.ptr(), particlePtr: core.particle_ptr() }
        : undefined,
    });

    // 4. Auto-observe [data-liquid] elements
    if (autoObserve) {
      const elements =
        document.querySelectorAll<HTMLElement>("[data-liquid]");
      elements.forEach((el) => observer.observe(el));
    }

    // 5. Pointer tracking (per-instance)
    let pointerX = 0;
    let pointerY = 0;
    let pointerActive = false;

    const onMouseMove = (e: MouseEvent) => {
      pointerX = e.clientX;
      pointerY = e.clientY;
      pointerActive = true;
    };
    const onMouseLeave = () => {
      pointerActive = false;
    };

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseleave", onMouseLeave);

    // 6. Resize handler (per-instance)
    const onResize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    onResize();
    window.addEventListener("resize", onResize);

    // 7. RAF loop (per-instance, only if we have WASM + canvas context)
    let animationId = 0;
    const ctx = canvas.getContext("2d");
    if (ctx && core) {
      let lastTime = performance.now();

      const loop = (now: number) => {
        const dt = now - lastTime;
        lastTime = now;

        ctx.clearRect(0, 0, canvas.width, canvas.height);
        observer.sync();
        core!.tick(dt, pointerX, pointerY, pointerActive);
        observer.render(ctx);

        animationId = requestAnimationFrame(loop);
      };

      animationId = requestAnimationFrame(loop);
    }

    // 8. Build instance — all state is closure-captured, zero global/static state
    let destroyed = false;

    const instance: LiquidDOMInstance = {
      observe(el: HTMLElement, liquidType?: number): number {
        if (destroyed) {
          throw new Error("Cannot observe on a destroyed LiquidDOM instance");
        }
        return observer.observe(el, liquidType);
      },

      unobserve(el: HTMLElement): void {
        if (destroyed) return;
        observer.unobserve(el);
      },

      destroy(): void {
        if (destroyed) return;
        destroyed = true;

        if (animationId) {
          cancelAnimationFrame(animationId);
          animationId = 0;
        }
        canvas.remove();
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("mouseleave", onMouseLeave);
        window.removeEventListener("resize", onResize);
        if (core) {
          core.free();
          core = null;
        }
      },
    };

    return instance;
  }
}
