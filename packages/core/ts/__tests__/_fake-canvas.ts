/**
 * Shared fake Canvas2D for jsdom tests (plan resolution A6). jsdom has no
 * canvas backend: `getContext("2d")` returns null and neither `ImageData`
 * nor `OffscreenCanvas` exists. The fluid renderer only calls what is
 * recorded here. Adapter tests import this file by relative path:
 *   packages/react/__tests__/… → "../../core/ts/__tests__/_fake-canvas"
 *   packages/vue/__tests__/…   → "../../core/ts/__tests__/_fake-canvas"
 */

export interface FakeCall {
  op: string;
  args: unknown[];
  /** `fillStyle` and `globalAlpha` at the moment of the call. */
  fillStyle: string;
  globalAlpha: number;
}

export interface FakeImageData {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

export class FakeContext2D {
  readonly calls: FakeCall[] = [];
  fillStyle = "#000000";
  globalAlpha = 1;
  imageSmoothingEnabled = true;
  imageSmoothingQuality = "low";
  /** Copy of the last image passed to putImageData. */
  lastImage: FakeImageData | null = null;

  constructor(readonly canvas: HTMLCanvasElement) {}

  ops(op: string): FakeCall[] {
    return this.calls.filter((c) => c.op === op);
  }

  createImageData(width: number, height: number): FakeImageData {
    this.record("createImageData", [width, height]);
    return { width, height, data: new Uint8ClampedArray(width * height * 4) };
  }

  putImageData(img: FakeImageData, dx: number, dy: number): void {
    this.record("putImageData", [img, dx, dy]);
    this.lastImage = { width: img.width, height: img.height, data: new Uint8ClampedArray(img.data) };
  }

  drawImage(...args: unknown[]): void {
    this.record("drawImage", args);
  }

  roundRect(...args: unknown[]): void {
    this.record("roundRect", args);
  }

  clearRect(...args: unknown[]): void {
    this.record("clearRect", args);
  }

  fillRect(...args: unknown[]): void {
    this.record("fillRect", args);
  }

  beginPath(): void {
    this.record("beginPath", []);
  }

  fill(): void {
    this.record("fill", []);
  }

  save(): void {
    this.record("save", []);
  }

  restore(): void {
    this.record("restore", []);
  }

  setTransform(...args: unknown[]): void {
    this.record("setTransform", args);
  }

  /** Recorded so tests can assert it is never used (DPR via setTransform only). */
  scale(...args: unknown[]): void {
    this.record("scale", args);
  }

  private record(op: string, args: unknown[]): void {
    this.calls.push({ op, args, fillStyle: String(this.fillStyle), globalAlpha: this.globalAlpha });
  }
}

export interface FakeCanvasHandle {
  /** Every context handed out, in creation order. */
  readonly contexts: FakeContext2D[];
  ctxFor(canvas: HTMLCanvasElement): FakeContext2D | undefined;
  restore(): void;
}

/** Patches `HTMLCanvasElement.prototype.getContext("2d")`; call `restore()` in afterEach. */
export function installFakeCanvas2D(): FakeCanvasHandle {
  const proto = HTMLCanvasElement.prototype;
  const original = proto.getContext;
  const byCanvas = new WeakMap<HTMLCanvasElement, FakeContext2D>();
  const contexts: FakeContext2D[] = [];
  proto.getContext = function getContext(this: HTMLCanvasElement, type: string) {
    if (type !== "2d") return null;
    let ctx = byCanvas.get(this);
    if (!ctx) {
      ctx = new FakeContext2D(this);
      byCanvas.set(this, ctx);
      contexts.push(ctx);
    }
    return ctx;
  } as unknown as typeof proto.getContext;
  return {
    contexts,
    ctxFor: (canvas) => byCanvas.get(canvas),
    restore: () => {
      proto.getContext = original;
    },
  };
}
