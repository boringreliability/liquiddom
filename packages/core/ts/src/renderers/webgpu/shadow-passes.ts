/**
 * W88 (D88-6, D88-10, D88-11): the WebGPU shadow passes, encoded between the liquid splat and the
 * screen pass. Per frame with casters (shadow-plan.ts):
 * 1. one density pass per used layer of the density array (rgba16float, half resolution, 4 sources
 *    per layer), one scissored draw per source;
 * 2. per radius group: a resolve pass (one quad per layer record, the offset applied in the
 *    resolve), then — blur > 0 — a horizontal and a vertical gaussian pass; the vertical one (or the
 *    resolve, for blur 0) blends over into the group's accumulator (half or quarter resolution);
 * 3. one knockout pass (r8unorm, half resolution): the casters' closed own coverage;
 * 4. in the screen pass, before all liquid: the accumulators × (1 − knockout).
 * Every pass is scissored to its rect, clamped to its target (Review Focus 4). Targets are created on
 * the first frame with shadows and kept (like T1); a resize drops them. An element at rest, without
 * outer layers, or past the source cap costs nothing here. No DOM.
 */
import type { RenderFrame } from "../frame";
import {
  EMPTY_PLAN,
  planShadows,
  type Rect,
  SHADOW_CHANNELS,
  SHADOW_SCALE_HALF,
  SHADOW_SCALE_QUARTER,
  ShadowCasters,
  type ShadowPlan,
} from "../shadow-plan";
import { KNOCKOUT_CLOSE_PER_KERNEL } from "../shadow-plan";
import { SHADOW_MAX_TAPS } from "./shaders";

/** Floats per ShadowPass record (WGSL `struct ShadowPass`, 128 bytes) and per 256-byte slot. */
export const SHADOW_PASS_FLOATS = 32;
export const SHADOW_SLOT_FLOATS = 64;
export const SHADOW_SLOT_BYTES = SHADOW_SLOT_FLOATS * 4;
/** Slots per frame: ≤ 16 sources + 2 per group (≤ 11 groups) + knockout + composite. */
export const SHADOW_MAX_SLOTS = 64;
/** Offsets in a ShadowPass record. */
export const SP = {
  TARGET_W: 0, TARGET_H: 1, DIR_X: 2, DIR_Y: 3, SIGMA: 4, TAPS: 5, ELEMENT: 6, KERNEL_R: 7, WEIGHT: 8, CLOSE: 9, LAYERS: 10, FLAGS: 11, MASK: 12, MASKS: 16,
} as const;
/** Floats per ShadowRecord (WGSL: rect, offset, src, colour = 48 bytes). */
export const SHADOW_RECORD_FLOATS = 12;
/** Records per frame: 16 sources × 4 layers. */
export const SHADOW_MAX_RECORDS = 64;
export const SHADOW_DENSITY_FORMAT: GPUTextureFormat = "rgba16float";
export const SHADOW_ACC_FORMAT: GPUTextureFormat = "rgba16float";
export const SHADOW_KNOCKOUT_FORMAT: GPUTextureFormat = "r8unorm";

/** The shadow pipelines and layouts (built at init with the liquid's, in its validation scope). */
export interface ShadowPipelines {
  readonly shadowDensityLayout: GPUBindGroupLayout;
  readonly shadowResolveLayout: GPUBindGroupLayout;
  readonly shadowBlurLayout: GPUBindGroupLayout;
  readonly shadowKnockoutLayout: GPUBindGroupLayout;
  readonly shadowCompositeLayout: GPUBindGroupLayout;
  readonly shadowDensity: GPURenderPipeline;
  readonly shadowResolve: GPURenderPipeline;
  readonly shadowBlurH: GPURenderPipeline;
  readonly shadowBlurV: GPURenderPipeline;
  readonly shadowKnockout: GPURenderPipeline;
  readonly shadowComposite: GPURenderPipeline;
}

const CLEAR: GPUColorDict = { r: 0, g: 0, b: 0, a: 0 };

interface ScaleTargets {
  readonly scale: number;
  readonly width: number;
  readonly height: number;
  readonly resolve: GPUTexture;
  readonly temp: GPUTexture;
  readonly acc: GPUTexture;
  readonly resolveView: GPUTextureView;
  readonly tempView: GPUTextureView;
  readonly accView: GPUTextureView;
  /** Bind groups for the blur passes: H reads `resolve`, V reads `temp`. */
  readonly blurFromResolve: GPUBindGroup;
  readonly blurFromTemp: GPUBindGroup;
}

interface Targets {
  readonly width: number;
  readonly height: number;
  readonly layers: number;
  readonly density: GPUTexture;
  readonly densityLayerViews: readonly GPUTextureView[];
  readonly densityArrayView: GPUTextureView;
  readonly knockout: GPUTexture;
  readonly knockoutView: GPUTextureView;
  readonly half: ScaleTargets;
  readonly quarter: ScaleTargets;
}

const clampInt = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** `r` (CSS px) in a target of `w × h` px at `pxPerCss`: integers inside the target; null when empty. */
export function scissorOf(r: Rect, pxPerCss: number, w: number, h: number): [number, number, number, number] | null {
  if (![r.x0, r.y0, r.x1, r.y1].every(Number.isFinite)) return null;
  const x0 = clampInt(Math.floor(r.x0 * pxPerCss), 0, w);
  const y0 = clampInt(Math.floor(r.y0 * pxPerCss), 0, h);
  const x1 = clampInt(Math.ceil(r.x1 * pxPerCss), 0, w);
  const y1 = clampInt(Math.ceil(r.y1 * pxPerCss), 0, h);
  return x1 > x0 && y1 > y0 ? [x0, y0, x1 - x0, y1 - y0] : null;
}

export class ShadowPasses {
  private readonly casters = new ShadowCasters();
  private plan: ShadowPlan = EMPTY_PLAN;
  private drawnIds = new Uint8Array(0);
  private targets: Targets | null = null;
  private paramsBuffer: GPUBuffer | null = null;
  private recordsBuffer: GPUBuffer | null = null;
  private readonly params = new Float32Array(SHADOW_MAX_SLOTS * SHADOW_SLOT_FLOATS);
  private readonly records = new Float32Array(SHADOW_MAX_RECORDS * SHADOW_RECORD_FLOATS);
  private densityGroup: GPUBindGroup | null = null;
  private densityGroupFor: { particles: GPUBuffer; homes: GPUBuffer } | null = null;
  private resolveGroup: GPUBindGroup | null = null;
  private knockoutGroup: GPUBindGroup | null = null;
  private compositeGroup: GPUBindGroup | null = null;
  private dpr = 1;
  private compositeSlot = 0;
  private knockoutSlot = 0;
  private knockoutRect: Rect | null = null;
  private closePx = 1;
  private readonly sourceSlots: number[] = [];
  private readonly groupSlots: number[] = [];

  constructor(
    private readonly device: GPUDevice,
    private readonly pipelines: ShadowPipelines,
    private readonly sampler: GPUSampler,
    private readonly viewBuffer: GPUBuffer,
  ) {}

  /** True when the last prepared frame drew slot `id`'s shadow (the runtime's toggle reads it). */
  drawn(id: number): boolean {
    return Number.isInteger(id) && id >= 0 && id < this.drawnIds.length && this.drawnIds[id] === 1;
  }

  /** Called first in every render(): nothing is drawn until prepare() says so. */
  resetDrawn(): void {
    this.drawnIds.fill(0);
  }

  /**
   * Plans the frame's shadows, sizes the targets and writes the pass records and layer records.
   * False (nothing to encode) without casters. `widthPx × heightPx` is the canvas backing size.
   */
  prepare(frame: RenderFrame, widthPx: number, heightPx: number, particles: GPUBuffer, homes: GPUBuffer, maxDim: number): boolean {
    this.plan = EMPTY_PLAN;
    if (this.casters.collect(frame) === 0) return false;
    const dpr = Number.isFinite(frame.viewport.dpr) && frame.viewport.dpr > 0 ? frame.viewport.dpr : 1;
    this.dpr = dpr;
    const plan = planShadows(this.casters, frame, 1 / (dpr * SHADOW_SCALE_HALF));
    if (plan.drawn.length === 0 || plan.records.length === 0) return false;
    this.ensureTargets(widthPx, heightPx, plan.densityLayers, maxDim);
    this.ensureBuffers();
    const t = this.targets;
    if (!t || !this.paramsBuffer || !this.recordsBuffer) return false;
    this.ensureGroups(particles, homes);
    this.plan = plan;
    this.writeParams(plan, t);
    this.writeRecords(plan);
    if (this.drawnIds.length < frame.paints.length) this.drawnIds = new Uint8Array(frame.paints.length);
    for (const id of plan.drawn) this.drawnIds[id] = 1;
    return true;
  }

  /** Passes 1–3 (density, per group resolve/blur, knockout). After prepare() returned true. */
  encode(encoder: GPUCommandEncoder, count: number): void {
    const t = this.targets;
    const plan = this.plan;
    const p = this.pipelines;
    if (!t || plan.records.length === 0 || !this.densityGroup || !this.resolveGroup || !this.knockoutGroup) return;
    // 1. Density: one pass per layer, one scissored draw per source.
    for (let layer = 0; layer < plan.densityLayers; layer++) {
      const view = t.densityLayerViews[layer];
      if (!view) continue;
      const pass = encoder.beginRenderPass({
        label: `liquiddom shadow density ${layer}`,
        colorAttachments: [{ view, clearValue: CLEAR, loadOp: "clear", storeOp: "store" }],
      });
      pass.setPipeline(p.shadowDensity);
      plan.sources.forEach((src, s) => {
        if (src.layer !== layer) return;
        const sc = scissorOf(src.rect, this.dpr * SHADOW_SCALE_HALF, t.width, t.height);
        if (!sc) return;
        pass.setScissorRect(...sc);
        pass.setBindGroup(0, this.densityGroup!, [(this.sourceSlots[s] ?? 0) * SHADOW_SLOT_BYTES]);
        pass.draw(6, count);
      });
      pass.end();
    }
    // 2. Groups: resolve (+ blur H, blur V) into the accumulators, over.
    let halfWritten = false;
    let quarterWritten = false;
    plan.groups.forEach((g, gi) => {
      const st = g.scale === SHADOW_SCALE_QUARTER ? t.quarter : t.half;
      const sc = scissorOf(g.reach, this.dpr * st.scale, st.width, st.height);
      if (!sc) return;
      const first = st === t.quarter ? !quarterWritten : !halfWritten;
      if (st === t.quarter) quarterWritten = true;
      else halfWritten = true;
      const accLoad: GPULoadOp = first ? "clear" : "load";
      const blurred = g.blur > 0;
      const resolve = encoder.beginRenderPass({
        label: "liquiddom shadow resolve",
        colorAttachments: [{ view: blurred ? st.resolveView : st.accView, clearValue: CLEAR, loadOp: blurred ? "clear" : accLoad, storeOp: "store" }],
      });
      resolve.setPipeline(p.shadowResolve);
      resolve.setScissorRect(...sc);
      resolve.setBindGroup(0, this.resolveGroup!);
      resolve.draw(6, g.count, 0, g.first);
      resolve.end();
      if (!blurred) return;
      const slot = this.groupSlots[gi] ?? 0;
      const h = encoder.beginRenderPass({
        label: "liquiddom shadow blur h",
        colorAttachments: [{ view: st.tempView, clearValue: CLEAR, loadOp: "clear", storeOp: "store" }],
      });
      h.setPipeline(p.shadowBlurH);
      h.setScissorRect(...sc);
      h.setBindGroup(0, st.blurFromResolve, [slot * SHADOW_SLOT_BYTES]);
      h.draw(3);
      h.end();
      const v = encoder.beginRenderPass({
        label: "liquiddom shadow blur v",
        colorAttachments: [{ view: st.accView, clearValue: CLEAR, loadOp: accLoad, storeOp: "store" }],
      });
      v.setPipeline(p.shadowBlurV);
      v.setScissorRect(...sc);
      v.setBindGroup(0, st.blurFromTemp, [(slot + 1) * SHADOW_SLOT_BYTES]);
      v.draw(3);
      v.end();
    });
    // The composite reads only the accumulators written this frame (flags).
    this.params[this.compositeSlot * SHADOW_SLOT_FLOATS + SP.FLAGS] = (halfWritten ? 1 : 0) + (quarterWritten ? 2 : 0);
    this.device.queue.writeBuffer(this.paramsBuffer!, this.compositeSlot * SHADOW_SLOT_BYTES, this.params, this.compositeSlot * SHADOW_SLOT_FLOATS, SHADOW_PASS_FLOATS);
    // 3. Knockout: the casters' closed own coverage.
    const knock = encoder.beginRenderPass({
      label: "liquiddom shadow knockout",
      colorAttachments: [{ view: t.knockoutView, clearValue: CLEAR, loadOp: "clear", storeOp: "store" }],
    });
    const ksc = this.knockoutRect ? scissorOf(this.knockoutRect, this.dpr * SHADOW_SCALE_HALF, t.width, t.height) : null;
    if (ksc) {
      knock.setPipeline(p.shadowKnockout);
      knock.setScissorRect(...ksc);
      knock.setBindGroup(0, this.knockoutGroup, [this.knockoutSlot * SHADOW_SLOT_BYTES]);
      knock.draw(3);
    }
    knock.end();
  }

  /** Pass 4, the first draw of the screen pass (D88-4): under all liquid. */
  drawComposite(screen: GPURenderPassEncoder): void {
    if (!this.compositeGroup || this.plan.records.length === 0) return;
    screen.setPipeline(this.pipelines.shadowComposite);
    screen.setBindGroup(0, this.compositeGroup, [this.compositeSlot * SHADOW_SLOT_BYTES]);
    screen.draw(3);
  }

  /** A new backing size: the targets are rebuilt on the next frame with shadows. */
  resize(): void {
    this.releaseTargets();
  }

  destroy(): void {
    this.releaseTargets();
    this.paramsBuffer?.destroy();
    this.recordsBuffer?.destroy();
    this.paramsBuffer = null;
    this.recordsBuffer = null;
    this.densityGroup = null;
    this.densityGroupFor = null;
    this.resolveGroup = null;
    this.knockoutGroup = null;
    this.compositeGroup = null;
    this.plan = EMPTY_PLAN;
    this.drawnIds = new Uint8Array(0);
  }

  private releaseTargets(): void {
    const t = this.targets;
    if (!t) return;
    for (const tex of [t.density, t.knockout, t.half.resolve, t.half.temp, t.half.acc, t.quarter.resolve, t.quarter.temp, t.quarter.acc]) tex.destroy();
    this.targets = null;
    this.resolveGroup = null;
    this.knockoutGroup = null;
    this.compositeGroup = null;
  }

  private ensureBuffers(): void {
    const usage = GPUBufferUsage.COPY_DST;
    this.paramsBuffer ??= this.device.createBuffer({ label: "liquiddom shadow params", size: SHADOW_MAX_SLOTS * SHADOW_SLOT_BYTES, usage: GPUBufferUsage.UNIFORM | usage });
    this.recordsBuffer ??= this.device.createBuffer({ label: "liquiddom shadow records", size: SHADOW_MAX_RECORDS * SHADOW_RECORD_FLOATS * 4, usage: GPUBufferUsage.STORAGE | usage });
  }

  private scaleTargets(scale: number, widthPx: number, heightPx: number, maxDim: number): ScaleTargets {
    const width = Math.min(maxDim, Math.max(1, Math.ceil(widthPx * scale)));
    const height = Math.min(maxDim, Math.max(1, Math.ceil(heightPx * scale)));
    const usage = GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING;
    const name = scale === SHADOW_SCALE_HALF ? "half" : "quarter";
    const make = (role: string): GPUTexture =>
      this.device.createTexture({ label: `liquiddom shadow ${role} ${name}`, size: [width, height], format: SHADOW_ACC_FORMAT, usage });
    const resolve = make("resolve");
    const temp = make("temp");
    const acc = make("acc");
    const resolveView = resolve.createView();
    const tempView = temp.createView();
    const blur = (view: GPUTextureView): GPUBindGroup =>
      this.device.createBindGroup({
        label: "liquiddom shadow blur",
        layout: this.pipelines.shadowBlurLayout,
        entries: [
          { binding: 0, resource: { buffer: this.paramsBuffer!, size: SHADOW_PASS_FLOATS * 4 } },
          { binding: 1, resource: view },
        ],
      });
    return {
      scale, width, height, resolve, temp, acc, resolveView, tempView, accView: acc.createView(),
      blurFromResolve: blur(resolveView),
      blurFromTemp: blur(tempView),
    };
  }

  private ensureTargets(widthPx: number, heightPx: number, layers: number, maxDim: number): void {
    const width = Math.min(maxDim, Math.max(1, Math.ceil(widthPx * SHADOW_SCALE_HALF)));
    const height = Math.min(maxDim, Math.max(1, Math.ceil(heightPx * SHADOW_SCALE_HALF)));
    const t = this.targets;
    if (t && t.width === width && t.height === height && t.layers >= layers) return;
    const keepLayers = Math.max(layers, t && t.width === width && t.height === height ? t.layers : 0);
    this.releaseTargets();
    this.ensureBuffers();
    const usage = GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING;
    const density = this.device.createTexture({ label: "liquiddom shadow density", size: [width, height, keepLayers], format: SHADOW_DENSITY_FORMAT, usage });
    const densityLayerViews = Array.from({ length: keepLayers }, (_, l) => density.createView({ dimension: "2d", baseArrayLayer: l, arrayLayerCount: 1 }));
    const densityArrayView = density.createView({ dimension: "2d-array", baseArrayLayer: 0, arrayLayerCount: keepLayers });
    const knockout = this.device.createTexture({ label: "liquiddom shadow knockout", size: [width, height], format: SHADOW_KNOCKOUT_FORMAT, usage });
    const knockoutView = knockout.createView();
    this.targets = {
      width, height, layers: keepLayers, density, densityLayerViews, densityArrayView, knockout, knockoutView,
      half: this.scaleTargets(SHADOW_SCALE_HALF, widthPx, heightPx, maxDim),
      quarter: this.scaleTargets(SHADOW_SCALE_QUARTER, widthPx, heightPx, maxDim),
    };
  }

  private ensureGroups(particles: GPUBuffer, homes: GPUBuffer): void {
    const t = this.targets;
    const params = this.paramsBuffer;
    const records = this.recordsBuffer;
    if (!t || !params || !records) return;
    const slot = { buffer: params, size: SHADOW_PASS_FLOATS * 4 };
    if (!this.densityGroup || this.densityGroupFor?.particles !== particles || this.densityGroupFor.homes !== homes) {
      this.densityGroup = this.device.createBindGroup({
        label: "liquiddom shadow density",
        layout: this.pipelines.shadowDensityLayout,
        entries: [
          { binding: 0, resource: { buffer: this.viewBuffer } },
          { binding: 1, resource: slot },
          { binding: 2, resource: { buffer: particles } },
          { binding: 3, resource: { buffer: homes } },
        ],
      });
      this.densityGroupFor = { particles, homes };
    }
    this.resolveGroup ??= this.device.createBindGroup({
      label: "liquiddom shadow resolve",
      layout: this.pipelines.shadowResolveLayout,
      entries: [
        { binding: 0, resource: { buffer: this.viewBuffer } },
        { binding: 1, resource: { buffer: records } },
        { binding: 2, resource: t.densityArrayView },
        { binding: 3, resource: this.sampler },
      ],
    });
    this.knockoutGroup ??= this.device.createBindGroup({
      label: "liquiddom shadow knockout",
      layout: this.pipelines.shadowKnockoutLayout,
      entries: [
        { binding: 0, resource: slot },
        { binding: 1, resource: t.densityArrayView },
      ],
    });
    this.compositeGroup ??= this.device.createBindGroup({
      label: "liquiddom shadow composite",
      layout: this.pipelines.shadowCompositeLayout,
      entries: [
        { binding: 0, resource: { buffer: this.viewBuffer } },
        { binding: 1, resource: slot },
        { binding: 2, resource: t.half.accView },
        { binding: 3, resource: t.quarter.accView },
        { binding: 4, resource: t.knockoutView },
        { binding: 5, resource: this.sampler },
      ],
    });
  }

  /** One slot per source, two per blurred group, then the knockout and the composite. */
  private writeParams(plan: ShadowPlan, t: Targets): void {
    const P = this.params;
    let slot = 0;
    const at = (s: number): number => s * SHADOW_SLOT_FLOATS;
    this.sourceSlots.length = 0;
    this.groupSlots.length = 0;
    let close = 0;
    const masks = [0, 0, 0, 0].map(() => [0, 0, 0, 0]);
    let knock: Rect | null = null;
    for (const src of plan.sources) {
      const o = at(slot);
      P.fill(0, o, o + SHADOW_SLOT_FLOATS);
      P[o + SP.TARGET_W] = t.width;
      P[o + SP.TARGET_H] = t.height;
      P[o + SP.ELEMENT] = src.id;
      P[o + SP.KERNEL_R] = src.radius;
      P[o + SP.WEIGHT] = src.weight;
      P[o + SP.MASK + src.channel] = 1;
      this.sourceSlots.push(slot++);
      if (src.spread === 0) {
        const row = masks[src.layer];
        if (row) row[src.channel] = 1;
        close = Math.max(close, src.radius);
        const g = { x0: src.rect.x0 - KNOCKOUT_CLOSE_PER_KERNEL * src.radius, y0: src.rect.y0 - KNOCKOUT_CLOSE_PER_KERNEL * src.radius, x1: src.rect.x1 + KNOCKOUT_CLOSE_PER_KERNEL * src.radius, y1: src.rect.y1 + KNOCKOUT_CLOSE_PER_KERNEL * src.radius };
        knock = knock === null ? g : { x0: Math.min(knock.x0, g.x0), y0: Math.min(knock.y0, g.y0), x1: Math.max(knock.x1, g.x1), y1: Math.max(knock.y1, g.y1) };
      }
    }
    for (const g of plan.groups) {
      this.groupSlots.push(slot);
      if (!(g.blur > 0)) continue;
      const st = g.scale === SHADOW_SCALE_QUARTER ? t.quarter : t.half;
      const sigma = (g.blur / 2) * this.dpr * st.scale;
      const taps = Math.min(SHADOW_MAX_TAPS, Math.ceil(3 * sigma));
      for (const [dx, dy] of [[1, 0], [0, 1]] as const) {
        const o = at(slot++);
        P.fill(0, o, o + SHADOW_SLOT_FLOATS);
        P[o + SP.TARGET_W] = st.width;
        P[o + SP.TARGET_H] = st.height;
        P[o + SP.DIR_X] = dx;
        P[o + SP.DIR_Y] = dy;
        P[o + SP.SIGMA] = sigma;
        P[o + SP.TAPS] = taps;
      }
    }
    this.knockoutSlot = slot++;
    const ko = at(this.knockoutSlot);
    P.fill(0, ko, ko + SHADOW_SLOT_FLOATS);
    P[ko + SP.TARGET_W] = t.width;
    P[ko + SP.TARGET_H] = t.height;
    this.closePx = Math.max(1, Math.round(KNOCKOUT_CLOSE_PER_KERNEL * close * this.dpr * SHADOW_SCALE_HALF));
    P[ko + SP.CLOSE] = this.closePx;
    P[ko + SP.LAYERS] = plan.densityLayers;
    for (let l = 0; l < masks.length; l++) for (let c = 0; c < SHADOW_CHANNELS; c++) P[ko + SP.MASKS + 4 * l + c] = masks[l]?.[c] ?? 0;
    this.knockoutRect = knock;
    this.compositeSlot = slot++;
    const co = at(this.compositeSlot);
    P.fill(0, co, co + SHADOW_SLOT_FLOATS);
    this.device.queue.writeBuffer(this.paramsBuffer!, 0, this.params, 0, slot * SHADOW_SLOT_FLOATS);
  }

  private writeRecords(plan: ShadowPlan): void {
    const R = this.records;
    const n = Math.min(plan.records.length, SHADOW_MAX_RECORDS);
    for (let i = 0; i < n; i++) {
      const r = plan.records[i];
      const src = r ? plan.sources[r.source] : undefined;
      if (!r || !src) continue;
      const o = i * SHADOW_RECORD_FLOATS;
      R[o] = r.rect.x0;
      R[o + 1] = r.rect.y0;
      R[o + 2] = r.rect.x1;
      R[o + 3] = r.rect.y1;
      R[o + 4] = r.dx;
      R[o + 5] = r.dy;
      R[o + 6] = src.layer;
      R[o + 7] = src.channel;
      R[o + 8] = r.color[0];
      R[o + 9] = r.color[1];
      R[o + 10] = r.color[2];
      R[o + 11] = r.color[3];
    }
    this.device.queue.writeBuffer(this.recordsBuffer!, 0, R, 0, Math.max(1, n) * SHADOW_RECORD_FLOATS);
  }
}
