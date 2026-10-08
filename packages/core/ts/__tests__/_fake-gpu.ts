/**
 * W71: a fake WebGPU for jsdom tests (README "Shared interfaces"; W72 extends it with
 * fallback-adapter and device-loss scenarios). `installFakeGpu()` installs `navigator.gpu`,
 * the `GPUBufferUsage` / `GPUTextureUsage` / `GPUShaderStage` globals and
 * `getContext("webgpu")` on every canvas (other context ids fall through, e.g. to the fake 2d
 * context of `_fake-canvas.ts`); `restore()` undoes all three.
 *
 * The real API reports validation errors asynchronously. The fake records the mistakes this
 * repo must never make in `calls.errors` instead: zero-size buffers, textures smaller than
 * 1×1 or with non-integer sizes, writes past a buffer's end, at an offset or of a size that is
 * not a multiple of 4 bytes, bind groups over destroyed buffers or textures (when created and
 * when set on a pass), and render passes into destroyed textures. A test then asserts that
 * `calls.errors` is empty.
 */

export interface FakeGpuOptions {
  adapter?: "ok" | "null" | "throws";
  isFallbackAdapter?: boolean;
  device?: "ok" | "rejects";
  /**
   * "null": `getContext("webgpu")` returns null. W72 "invalid-texture": the context configures,
   * but `getCurrentTexture().createView()` raises a validation error into the innermost open
   * error scope of the configured device (an `uncapturederror` without one), as Chromium's
   * headless shell does with a dead presentation surface (W71.5 review, Part B).
   */
  context?: "ok" | "null" | "invalid-texture";
  /** Thrown by `context.configure()`. */
  configureError?: Error;
  /** W72: raised by `createRenderPipeline()` into the innermost open error scope, so that scope's `popErrorScope()` resolves with `{ message }` (W71: every pop did). */
  validationError?: string;
  /** W72: park every popErrorScope() (i.e. renderer init, after requestDevice) until releaseInit(). */
  holdInit?: boolean;
  /** W71.4 review fix: `adapter.limits.maxTextureDimension2D` (default 8192, the WebGPU default limit). */
  maxTextureDimension2D?: number;
}

export interface FakeBuffer {
  readonly label: string | undefined;
  readonly size: number;
  readonly usage: number;
  destroyed: boolean;
  destroy(): void;
}

export interface FakeTexture {
  readonly label: string | undefined;
  readonly width: number;
  readonly height: number;
  readonly format: string;
  readonly usage: number;
  destroyed: boolean;
  destroy(): void;
  createView(): { readonly texture: FakeTexture };
}

export interface FakeDraw {
  readonly pipeline: unknown;
  readonly bindGroup: unknown;
  readonly vertexCount: number;
  readonly instanceCount: number;
}

export interface FakeAttachment {
  readonly view: { readonly texture: FakeTexture };
  readonly loadOp: string;
  readonly storeOp: string;
  readonly clearValue?: unknown;
}

export interface FakePass {
  readonly attachments: readonly FakeAttachment[];
  readonly draws: FakeDraw[];
  ended: boolean;
}

export interface FakeWrite {
  readonly buffer: FakeBuffer;
  readonly offset: number;
  readonly bytes: number;
  readonly values: number[];
}

/** What `createRenderPipeline` returns: the descriptor it was called with. */
export interface FakePipeline {
  readonly descriptor: GPURenderPipelineDescriptor;
}

/** W72: one handle per requestDevice(), in creation order. */
export interface FakeDeviceHandle {
  readonly index: number;
  /** device.destroy() calls on this device. */
  readonly destroyed: number;
  /** queue.submit() calls on this device. */
  readonly submits: number;
  /** Resolves this device's `lost` (the first resolution wins, as in browsers). */
  lose(reason?: GPUDeviceLostReason, message?: string): void;
}

/** W72: the message the "invalid-texture" knob raises (Chromium reports "Invalid Texture" / "Invalid TextureView"). */
export const FAKE_INVALID_TEXTURE_MESSAGE = "Invalid Texture: the presentation surface is unusable (fake)";

export interface FakeGpuCalls {
  requestAdapter: number;
  requestDevice: number;
  /** W71.4 review fix: the descriptor of each `requestDevice()` call (undefined when called without one). */
  deviceDescriptors: Array<GPUDeviceDescriptor | undefined>;
  configure: GPUCanvasConfiguration[];
  shaderModules: string[];
  bindGroupLayouts: GPUBindGroupLayoutDescriptor[];
  pipelines: FakePipeline[];
  buffers: FakeBuffer[];
  textures: FakeTexture[];
  bindGroups: GPUBindGroupDescriptor[];
  writes: FakeWrite[];
  passes: FakePass[];
  submits: number;
  deviceDestroyed: number;
  /** W72: getContext("webgpu") calls (also when it returns null). */
  getContextWebgpu: number;
  /** In call order: "pushErrorScope:validation", "createShaderModule", "createRenderPipeline", "popErrorScope" (W72: two scope pairs per init, the surface one first). */
  log: string[];
  errors: string[];
}

export interface FakeGpu {
  readonly calls: FakeGpuCalls;
  readonly adapterError: Error;
  readonly deviceError: Error;
  /** Resolves the newest device's `lost` promise. */
  loseDevice(message: string, reason?: GPUDeviceLostReason): void;
  /** Dispatches `uncapturederror` on the newest device. */
  fireUncapturedError(message: string): void;
  /** W72: per-device handles (two instances own two devices). */
  readonly devices: readonly FakeDeviceHandle[];
  /** W72: un-parks every init held by `holdInit` (and every later one). */
  releaseInit(): void;
  restore(): void;
}

const GPU_GLOBALS: Readonly<Record<string, Readonly<Record<string, number>>>> = {
  GPUBufferUsage: {
    MAP_READ: 0x1, MAP_WRITE: 0x2, COPY_SRC: 0x4, COPY_DST: 0x8, INDEX: 0x10,
    VERTEX: 0x20, UNIFORM: 0x40, STORAGE: 0x80, INDIRECT: 0x100, QUERY_RESOLVE: 0x200,
  },
  GPUTextureUsage: { COPY_SRC: 0x1, COPY_DST: 0x2, TEXTURE_BINDING: 0x4, STORAGE_BINDING: 0x8, RENDER_ATTACHMENT: 0x10 },
  GPUShaderStage: { VERTEX: 0x1, FRAGMENT: 0x2, COMPUTE: 0x4 },
};

const PREFERRED_FORMAT = "bgra8unorm";

export function installFakeGpu(opts: FakeGpuOptions = {}): FakeGpu {
  const calls: FakeGpuCalls = {
    requestAdapter: 0, requestDevice: 0, deviceDescriptors: [], configure: [], shaderModules: [], bindGroupLayouts: [], pipelines: [],
    buffers: [], textures: [], bindGroups: [], writes: [], passes: [], submits: 0, deviceDestroyed: 0, getContextWebgpu: 0, log: [], errors: [],
  };
  const adapterError = new Error("adapter exploded");
  const deviceError = new Error("device exploded");
  const devices: Array<{ lose: (info: GPUDeviceLostInfo) => void; listeners: Array<(ev: unknown) => void> }> = [];
  const handles: FakeDeviceHandle[] = [];
  /** W72: per device, raises a validation error into its innermost open scope (or as uncapturederror). */
  const raisers = new WeakMap<object, (message: string) => void>();
  let released = opts.holdInit !== true;
  const parked: Array<() => void> = [];
  const gate = (): Promise<void> => (released ? Promise.resolve() : new Promise<void>((resume) => parked.push(resume)));

  const adapterTextureLimit = opts.maxTextureDimension2D ?? 8192;
  const makeTexture = (
    label: string | undefined, width: number, height: number, format: string, usage: number, record: boolean, limit = Infinity,
  ): FakeTexture => {
    if (record && !(Number.isInteger(width) && Number.isInteger(height) && width >= 1 && height >= 1)) {
      calls.errors.push(`createTexture(${label ?? ""}): size ${width}x${height}`);
    }
    if (record && (width > limit || height > limit)) {
      calls.errors.push(`createTexture(${label ?? ""}): size ${width}x${height} exceeds maxTextureDimension2D ${limit}`);
    }
    const texture: FakeTexture = {
      label, width, height, format, usage, destroyed: false,
      destroy: () => {
        texture.destroyed = true;
      },
      createView: () => ({ texture }),
    };
    if (record) calls.textures.push(texture);
    return texture;
  };

  /** Destroyed buffers (`{ buffer }`) and texture views (`{ texture }`) in a bind group are validation errors. */
  const checkBindGroup = (where: string, d: GPUBindGroupDescriptor): void => {
    for (const entry of d.entries as Iterable<GPUBindGroupEntry>) {
      const resource = entry.resource as { buffer?: FakeBuffer; texture?: FakeTexture } | null;
      if (!resource || typeof resource !== "object") continue;
      if ("buffer" in resource && resource.buffer?.destroyed) {
        calls.errors.push(`${where}(${d.label ?? ""}): binding ${entry.binding} uses a destroyed buffer`);
      }
      if ("texture" in resource && resource.texture?.destroyed) {
        calls.errors.push(`${where}(${d.label ?? ""}): binding ${entry.binding} uses a destroyed texture`);
      }
    }
  };

  const makeDevice = (desc?: GPUDeviceDescriptor) => {
    const requested = (desc?.requiredLimits as { maxTextureDimension2D?: number } | undefined)?.maxTextureDimension2D;
    const textureLimit = requested ?? 8192;
    let lose: (info: GPUDeviceLostInfo) => void = () => {};
    const lost = new Promise<GPUDeviceLostInfo>((resolve) => {
      lose = resolve;
    });
    const listeners: Array<(ev: unknown) => void> = [];
    let destroyed = false;
    const state = { destroyed: 0, submits: 0 };
    /** W72: the error-scope stack; null = no error captured in that scope yet. */
    const scopes: Array<string | null> = [];
    const raise = (message: string): void => {
      const top = scopes.length - 1;
      if (top >= 0) {
        if (scopes[top] === null) scopes[top] = message; // the first error of a scope wins
        return;
      }
      for (const fn of listeners) fn({ type: "uncapturederror", error: { message } });
    };
    const device = {
      lost,
      limits: { maxTextureDimension2D: textureLimit },
      queue: {
        submit: () => {
          calls.submits += 1;
          state.submits += 1;
        },
        writeBuffer: (buffer: FakeBuffer, offset: number, data: Float32Array | Int32Array, dataOffset = 0, size?: number) => {
          const elements = size ?? data.length - dataOffset;
          const bytes = elements * data.BYTES_PER_ELEMENT;
          const name = buffer.label ?? "";
          if (buffer.destroyed) calls.errors.push(`writeBuffer(${name}): destroyed buffer`);
          if (bytes % 4 !== 0) calls.errors.push(`writeBuffer(${name}): ${bytes} bytes is not a multiple of 4`);
          if (offset % 4 !== 0) calls.errors.push(`writeBuffer(${name}): offset ${offset} is not a multiple of 4`);
          if (offset + bytes > buffer.size) calls.errors.push(`writeBuffer(${name}): ${offset} + ${bytes} > ${buffer.size}`);
          calls.writes.push({ buffer, offset, bytes, values: Array.from(data.subarray(dataOffset, dataOffset + elements)) });
        },
      },
      destroy: () => {
        calls.deviceDestroyed += 1;
        state.destroyed += 1;
        if (destroyed) return;
        destroyed = true;
        lose({ reason: "destroyed", message: "Device was destroyed." } as GPUDeviceLostInfo);
      },
      createShaderModule: (d: GPUShaderModuleDescriptor) => {
        calls.log.push("createShaderModule");
        calls.shaderModules.push(d.code);
        return { label: d.label, code: d.code, getCompilationInfo: async () => ({ messages: [] }) };
      },
      createBindGroupLayout: (d: GPUBindGroupLayoutDescriptor) => {
        calls.bindGroupLayouts.push(d);
        return { descriptor: d };
      },
      createPipelineLayout: (d: GPUPipelineLayoutDescriptor) => ({ descriptor: d }),
      createRenderPipeline: (d: GPURenderPipelineDescriptor) => {
        calls.log.push("createRenderPipeline");
        if (opts.validationError) raise(opts.validationError);
        const pipeline: FakePipeline = { descriptor: d };
        calls.pipelines.push(pipeline);
        return pipeline;
      },
      createSampler: (d: GPUSamplerDescriptor = {}) => ({ descriptor: d }),
      createBuffer: (d: GPUBufferDescriptor) => {
        if (!(d.size > 0)) calls.errors.push(`createBuffer(${d.label ?? ""}): size ${d.size}; a zero-size storage binding is invalid`);
        const buffer: FakeBuffer = {
          label: d.label, size: d.size, usage: d.usage, destroyed: false,
          destroy: () => {
            buffer.destroyed = true;
          },
        };
        calls.buffers.push(buffer);
        return buffer;
      },
      createTexture: (d: GPUTextureDescriptor) => {
        const size = d.size as number[] | GPUExtent3DDict;
        const [w, h] = Array.isArray(size) ? [size[0] ?? 0, size[1] ?? 1] : [size.width, size.height ?? 1];
        return makeTexture(d.label, w, h, d.format, d.usage, true, textureLimit);
      },
      createBindGroup: (d: GPUBindGroupDescriptor) => {
        checkBindGroup("createBindGroup", d);
        calls.bindGroups.push(d);
        return { descriptor: d };
      },
      pushErrorScope: (filter: GPUErrorFilter) => {
        calls.log.push(`pushErrorScope:${filter}`);
        scopes.push(null);
      },
      popErrorScope: async () => {
        calls.log.push("popErrorScope");
        // The browser pops synchronously at the call and resolves later; holdInit parks the resolution.
        const captured = scopes.length > 0 ? scopes.pop() ?? null : undefined;
        if (captured === undefined) calls.errors.push("popErrorScope: the error scope stack is empty");
        await gate();
        return captured ? { message: captured } : null;
      },
      addEventListener: (type: string, fn: (ev: unknown) => void) => {
        if (type === "uncapturederror") listeners.push(fn);
      },
      removeEventListener: (type: string, fn: (ev: unknown) => void) => {
        const i = listeners.indexOf(fn);
        if (type === "uncapturederror" && i >= 0) listeners.splice(i, 1);
      },
      createCommandEncoder: () => ({
        beginRenderPass: (d: GPURenderPassDescriptor) => {
          const pass: FakePass = { attachments: Array.from(d.colorAttachments as Iterable<FakeAttachment>), draws: [], ended: false };
          for (const a of pass.attachments) {
            if (a.view.texture.destroyed) calls.errors.push(`beginRenderPass: attachment ${a.view.texture.label ?? ""} is a destroyed texture`);
          }
          calls.passes.push(pass);
          let pipeline: unknown = null;
          let bindGroup: unknown = null;
          return {
            setPipeline: (p: unknown) => {
              pipeline = p;
            },
            setBindGroup: (_index: number, g: unknown) => {
              const desc = (g as { descriptor?: GPUBindGroupDescriptor } | null)?.descriptor;
              if (desc) checkBindGroup("setBindGroup", desc);
              bindGroup = g;
            },
            draw: (vertexCount: number, instanceCount = 1) => {
              pass.draws.push({ pipeline, bindGroup, vertexCount, instanceCount });
            },
            end: () => {
              pass.ended = true;
            },
          };
        },
        finish: () => ({}),
      }),
    };
    devices.push({ lose, listeners });
    raisers.set(device, raise);
    handles.push({
      index: handles.length,
      get destroyed() {
        return state.destroyed;
      },
      get submits() {
        return state.submits;
      },
      lose: (reason = "unknown", message = "fake device loss") => lose({ reason, message } as GPUDeviceLostInfo),
    });
    return device;
  };

  const adapter = {
    info: { vendor: "fake", architecture: "", device: "", description: "", isFallbackAdapter: opts.isFallbackAdapter === true },
    features: new Set<string>(),
    limits: { maxTextureDimension2D: adapterTextureLimit },
    requestDevice: async (desc?: GPUDeviceDescriptor) => {
      calls.requestDevice += 1;
      calls.deviceDescriptors.push(desc);
      if (opts.device === "rejects") throw deviceError;
      const requested = (desc?.requiredLimits as { maxTextureDimension2D?: number } | undefined)?.maxTextureDimension2D;
      if (requested !== undefined && requested > adapterTextureLimit) throw new Error("requiredLimits exceed the adapter");
      return makeDevice(desc);
    },
  };
  const gpu = {
    wgslLanguageFeatures: new Set<string>(),
    getPreferredCanvasFormat: () => PREFERRED_FORMAT,
    requestAdapter: async () => {
      calls.requestAdapter += 1;
      if (opts.adapter === "null") return null;
      if (opts.adapter === "throws") throw adapterError;
      return adapter;
    },
  };

  const contexts = new WeakMap<HTMLCanvasElement, object>();
  const contextFor = (canvas: HTMLCanvasElement): object => {
    let ctx = contexts.get(canvas);
    if (!ctx) {
      let configured: object | null = null;
      ctx = {
        canvas,
        configure: (cfg: GPUCanvasConfiguration) => {
          calls.configure.push(cfg);
          if (opts.configureError) throw opts.configureError;
          configured = cfg.device as unknown as object;
        },
        unconfigure: () => {},
        getCurrentTexture: () => {
          const texture = makeTexture("swapchain", Math.max(1, canvas.width), Math.max(1, canvas.height), PREFERRED_FORMAT, 0x10, false);
          if (opts.context !== "invalid-texture") return texture;
          // W72: a dead presentation surface: configure() and getCurrentTexture() succeed, createView() raises.
          return {
            ...texture,
            createView: () => {
              const raise = configured ? raisers.get(configured) : undefined;
              raise?.(FAKE_INVALID_TEXTURE_MESSAGE);
              return { texture };
            },
          };
        },
      };
      contexts.set(canvas, ctx);
    }
    return ctx;
  };

  const savedGpu = Object.getOwnPropertyDescriptor(navigator, "gpu");
  Object.defineProperty(navigator, "gpu", { value: gpu, configurable: true, writable: true });
  const g = globalThis as unknown as Record<string, unknown>;
  const savedGlobals = Object.keys(GPU_GLOBALS).map((key) => [key, Object.getOwnPropertyDescriptor(g, key)] as const);
  for (const [key, value] of Object.entries(GPU_GLOBALS)) Object.defineProperty(g, key, { value, configurable: true, writable: true });
  const proto = HTMLCanvasElement.prototype;
  const previous = proto.getContext;
  proto.getContext = function getContext(this: HTMLCanvasElement, type: string, ...rest: unknown[]) {
    if (type === "webgpu") {
      calls.getContextWebgpu += 1;
      return opts.context === "null" ? null : contextFor(this);
    }
    // W72: a canvas that handed out a webgpu context never gives a 2d one (HTML canvas rule), so a
    // missing remount fails in jsdom exactly as in a browser. No W71 test asks such a canvas for "2d".
    if (type === "2d" && contexts.has(this)) return null;
    return (previous as (this: HTMLCanvasElement, ...a: unknown[]) => unknown).call(this, type, ...rest);
  } as HTMLCanvasElement["getContext"];

  return {
    calls,
    adapterError,
    deviceError,
    devices: handles,
    releaseInit: () => {
      released = true;
      for (const resume of parked.splice(0)) resume();
    },
    loseDevice: (message, reason = "unknown") => {
      devices.at(-1)?.lose({ reason, message } as GPUDeviceLostInfo);
    },
    fireUncapturedError: (message) => {
      for (const fn of devices.at(-1)?.listeners ?? []) fn({ type: "uncapturederror", error: { message } });
    },
    restore: () => {
      proto.getContext = previous;
      if (savedGpu) Object.defineProperty(navigator, "gpu", savedGpu);
      else delete (navigator as { gpu?: unknown }).gpu;
      for (const [key, desc] of savedGlobals) {
        if (desc) Object.defineProperty(g, key, desc);
        else delete g[key];
      }
    },
  };
}

// =============================================================================
// W72 (D72-1 … D72-3, README Review Focus 5): the lifecycle view of installFakeGpu. Same fake
// (W71's globals, recorded validation mistakes and passes), with the reason-first lose(), the
// per-device handles, holdInit and the "invalid-texture" surface knob that the W72 selection,
// lifecycle and rebuild tests use.
// =============================================================================

export type FakeLostReason = "unknown" | "destroyed";

export type LifecycleGpuOptions = Pick<
  FakeGpuOptions,
  "adapter" | "isFallbackAdapter" | "device" | "context" | "holdInit" | "configureError" | "validationError"
>;

export interface LifecycleGpu {
  readonly calls: FakeGpuCalls;
  readonly devices: readonly FakeDeviceHandle[];
  readonly adapterError: Error;
  readonly deviceError: Error;
  /** Un-parks every init held by `holdInit` (and every later one). */
  releaseInit(): void;
  /** Loses the most recently created device. */
  lose(reason?: FakeLostReason, message?: string): void;
  /** Restores navigator.gpu, the GPU globals and HTMLCanvasElement.prototype.getContext. */
  restore(): void;
}

/** W72: installs the fake. Call restore() in afterEach (before restoring a fake 2d canvas). */
export function installFakeGpuLifecycle(opts: LifecycleGpuOptions = {}): LifecycleGpu {
  const fake = installFakeGpu(opts);
  return {
    calls: fake.calls,
    devices: fake.devices,
    adapterError: fake.adapterError,
    deviceError: fake.deviceError,
    releaseInit: () => fake.releaseInit(),
    lose: (reason = "unknown", message = "fake device loss") => {
      const d = fake.devices.at(-1);
      if (!d) throw new Error("installFakeGpuLifecycle: no device to lose");
      d.lose(reason, message);
    },
    restore: () => fake.restore(),
  };
}
