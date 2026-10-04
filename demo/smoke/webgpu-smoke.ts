/**
 * W65 (spec §6, D65-5): time-boxed WebGPU smoke. requestAdapter, log
 * adapter.info (incl. isFallbackAdapter), render a known frame two ways
 * (clear; WGSL full-screen triangle), read both back.
 */
import type { WebGpuAdapterSummary, WebGpuSmokeResult } from "../test-hooks";

const SIZE = 4;
const BYTES_PER_ROW = 256; // copyTextureToBuffer requires a multiple of 256
const FILL: GPUColorDict = { r: 0.25, g: 0.5, b: 0.75, a: 1 };
const BLACK: GPUColorDict = { r: 0, g: 0, b: 0, a: 1 };
const PROBES: ReadonlyArray<readonly [number, number]> = [
  [0, 0],
  [SIZE - 1, SIZE - 1],
  [SIZE / 2, SIZE / 2],
];

const WGSL = /* wgsl */ `
@vertex
fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  var p = array<vec2f, 3>(vec2f(-1.0, -3.0), vec2f(3.0, 1.0), vec2f(-1.0, 1.0));
  return vec4f(p[i], 0.0, 1.0);
}
@fragment
fn fs() -> @location(0) vec4f {
  return vec4f(0.25, 0.5, 0.75, 1.0);
}
`;

function fail(stage: string, error: unknown, partial: Partial<WebGpuSmokeResult> = {}): WebGpuSmokeResult {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  console.warn(`[webgpu-smoke] ${stage} failed: ${message}`);
  return { ok: false, stage, adapterInfo: null, clearPixels: null, drawPixels: null, error: message, ...partial };
}

function makePipeline(device: GPUDevice, module: GPUShaderModule, format: GPUTextureFormat): GPURenderPipeline {
  return device.createRenderPipeline({
    layout: "auto",
    vertex: { module, entryPoint: "vs" },
    fragment: { module, entryPoint: "fs", targets: [{ format }] },
    primitive: { topology: "triangle-list" },
  });
}

function renderPass(
  encoder: GPUCommandEncoder,
  view: GPUTextureView,
  clearValue: GPUColorDict,
  pipeline: GPURenderPipeline | null,
): void {
  const pass = encoder.beginRenderPass({ colorAttachments: [{ view, clearValue, loadOp: "clear", storeOp: "store" }] });
  if (pipeline) {
    pass.setPipeline(pipeline);
    pass.draw(3);
  }
  pass.end();
}

function makeTarget(device: GPUDevice): { texture: GPUTexture; readback: GPUBuffer } {
  const texture = device.createTexture({
    size: [SIZE, SIZE],
    format: "rgba8unorm",
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
  });
  const readback = device.createBuffer({ size: BYTES_PER_ROW * SIZE, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  return { texture, readback };
}

async function readPixels(buffer: GPUBuffer): Promise<number[][]> {
  await buffer.mapAsync(GPUMapMode.READ);
  const bytes = new Uint8Array(buffer.getMappedRange());
  const out = PROBES.map(([x, y]) => {
    const o = y * BYTES_PER_ROW + x * 4;
    return Array.from(bytes.subarray(o, o + 4));
  });
  buffer.unmap();
  return out;
}

async function run(): Promise<WebGpuSmokeResult> {
  const gpu = navigator.gpu;
  if (!gpu) return fail("navigator.gpu", "navigator.gpu is undefined");

  let adapter: GPUAdapter | null;
  try {
    adapter = await gpu.requestAdapter();
  } catch (e) {
    return fail("requestAdapter", e);
  }
  if (!adapter) return fail("requestAdapter", "requestAdapter() returned null");

  const info = adapter.info as GPUAdapterInfo & { isFallbackAdapter?: boolean };
  const legacy = adapter as GPUAdapter & { isFallbackAdapter?: boolean };
  const adapterInfo: WebGpuAdapterSummary = {
    vendor: info.vendor,
    architecture: info.architecture,
    device: info.device,
    description: info.description,
    isFallbackAdapter: info.isFallbackAdapter ?? legacy.isFallbackAdapter ?? null,
  };
  console.info(`[webgpu-smoke] adapter.info ${JSON.stringify(adapterInfo)}`);

  let device: GPUDevice;
  try {
    device = await adapter.requestDevice();
  } catch (e) {
    return fail("requestDevice", e, { adapterInfo });
  }
  const uncaptured: string[] = [];
  device.addEventListener("uncapturederror", (ev) => {
    uncaptured.push((ev as GPUUncapturedErrorEvent).error.message);
  });

  device.pushErrorScope("validation");
  const module = device.createShaderModule({ code: WGSL });
  const clearTarget = makeTarget(device);
  const drawTarget = makeTarget(device);
  const encoder = device.createCommandEncoder();
  renderPass(encoder, clearTarget.texture.createView(), FILL, null);
  renderPass(encoder, drawTarget.texture.createView(), BLACK, makePipeline(device, module, "rgba8unorm"));
  for (const t of [clearTarget, drawTarget]) {
    encoder.copyTextureToBuffer(
      { texture: t.texture },
      { buffer: t.readback, bytesPerRow: BYTES_PER_ROW, rowsPerImage: SIZE },
      [SIZE, SIZE],
    );
  }
  const canvas = document.querySelector<HTMLCanvasElement>("#smoke-canvas");
  const ctx = canvas?.getContext("webgpu") ?? null;
  if (ctx) {
    const format = gpu.getPreferredCanvasFormat();
    ctx.configure({ device, format, alphaMode: "premultiplied" });
    renderPass(encoder, ctx.getCurrentTexture().createView(), BLACK, makePipeline(device, module, format));
  }
  device.queue.submit([encoder.finish()]);
  const validation = await device.popErrorScope();
  if (validation) return fail("validation", validation.message, { adapterInfo });

  const clearPixels = await readPixels(clearTarget.readback);
  const drawPixels = await readPixels(drawTarget.readback);
  if (uncaptured.length > 0) return fail("uncapturederror", uncaptured.join("; "), { adapterInfo, clearPixels, drawPixels });
  return { ok: true, stage: "done", adapterInfo, clearPixels, drawPixels, error: null };
}

const result = run().catch((e: unknown) => fail("unexpected", e));
(window as Window & { __webgpuSmoke?: Promise<WebGpuSmokeResult> }).__webgpuSmoke = result;
void result.then((r) => {
  const status = document.getElementById("smoke-status");
  if (status) status.textContent = JSON.stringify(r, null, 2);
});
