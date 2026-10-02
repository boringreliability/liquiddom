// Liquid renderer (shared approach for the solver comparison):
// splat particles into a low-res density grid per home element with a smooth
// kernel, threshold the total density into a silhouette with a soft alpha ramp,
// colour each cell by the DOMINANT home element (per-particle colour, no
// blending), write ImageData, then upscale with bilinear smoothing.
// A cheap gradient-based rim light/shadow makes it read as a glossy liquid.

export type RGB = [number, number, number];

export class LiquidRenderer {
  readonly scale: number; // CSS px per density cell (2 => half resolution)
  private gw = 0;
  private gh = 0;
  private dens: Float32Array[] = [];
  private total = new Float32Array(0);
  private off: HTMLCanvasElement;
  private offCtx: CanvasRenderingContext2D;
  private img: ImageData | null = null;
  private pix = new Uint32Array(0);

  constructor(private colors: RGB[], scale = 2) {
    this.scale = scale;
    this.off = document.createElement("canvas");
    const c = this.off.getContext("2d", { willReadFrequently: false });
    if (!c) throw new Error("no 2d context");
    this.offCtx = c;
  }

  resize(vw: number, vh: number) {
    this.gw = Math.ceil(vw / this.scale) + 1;
    this.gh = Math.ceil(vh / this.scale) + 1;
    const cells = this.gw * this.gh;
    this.dens = this.colors.map(() => new Float32Array(cells));
    this.total = new Float32Array(cells);
    this.off.width = this.gw;
    this.off.height = this.gh;
    this.img = this.offCtx.createImageData(this.gw, this.gh);
    this.pix = new Uint32Array(this.img.data.buffer);
  }

  render(
    ctx: CanvasRenderingContext2D,
    pos: Float32Array,
    homes: Float32Array,
    n: number,
    spacingPx: number,
  ) {
    const { gw, gh, scale } = this;
    const ne = this.colors.length;
    for (let e = 0; e < ne; e++) this.dens[e].fill(0);
    this.total.fill(0);
    this.pix.fill(0);

    // kernel radius in cells: ~2.3x mean particle spacing, at least 3 cells
    const R = Math.max((2.3 * spacingPx) / scale, 3);
    const R2 = R * R;
    const ri = Math.ceil(R);
    const inv = 1 / scale;
    let minX = gw, minY = gh, maxX = 0, maxY = 0;

    for (let p = 0; p < n; p++) {
      const x = pos[2 * p] * inv;
      const y = pos[2 * p + 1] * inv;
      const d = this.dens[homes[p] | 0];
      const cx = Math.round(x);
      const cy = Math.round(y);
      const x0 = Math.max(cx - ri, 1), x1 = Math.min(cx + ri, gw - 2);
      const y0 = Math.max(cy - ri, 1), y1 = Math.min(cy + ri, gh - 2);
      if (x0 < minX) minX = x0;
      if (y0 < minY) minY = y0;
      if (x1 > maxX) maxX = x1;
      if (y1 > maxY) maxY = y1;
      for (let gy = y0; gy <= y1; gy++) {
        const dy = gy - y;
        const dy2 = dy * dy;
        const row = gy * gw;
        for (let gx = x0; gx <= x1; gx++) {
          const dx = gx - x;
          const q = 1 - (dx * dx + dy2) / R2;
          if (q <= 0) continue;
          const w = q * q;
          d[row + gx] += w;
          this.total[row + gx] += w;
        }
      }
    }

    // Normalise so a uniformly filled interior reads 1.0: integral of
    // (1 - r^2/R^2)^2 over the disk = pi R^2 / 3, times particles per cell.
    const particlesPerCell = (scale * scale) / (spacingPx * spacingPx);
    const invNorm = 1 / ((Math.PI * R2) / 3 * particlesPerCell);
    const lo = 0.4, hi = 0.58; // silhouette at ~0.5 = element edge at rest
    const cols = this.colors;
    const tot = this.total;
    const pix = this.pix;
    const Lx = -0.55, Ly = -0.83; // light from top-left

    for (let gy = Math.max(minY, 1); gy <= Math.min(maxY, gh - 2); gy++) {
      const row = gy * gw;
      for (let gx = Math.max(minX, 1); gx <= Math.min(maxX, gw - 2); gx++) {
        const i = row + gx;
        const rho = tot[i] * invNorm;
        if (rho <= lo) continue;
        let a = (rho - lo) / (hi - lo);
        if (a > 1) a = 1;
        a = a * a * (3 - 2 * a);

        // dominant home element in this cell
        let best = 0, bv = -1;
        for (let e = 0; e < ne; e++) {
          const v = this.dens[e][i];
          if (v > bv) { bv = v; best = e; }
        }
        let [r, g, b] = cols[best];

        // rim shading from the density gradient (outward normal = -grad)
        const gxv = (tot[i + 1] - tot[i - 1]) * invNorm;
        const gyv = (tot[i + gw] - tot[i - gw]) * invNorm;
        const gm = Math.sqrt(gxv * gxv + gyv * gyv);
        if (gm > 1e-4) {
          // 1 at the rim, 0 a little inside: keeps interior noise out of the shading
          let edge = (rho - 0.5) / 0.3;
          edge = edge <= 0 ? 1 : edge >= 1 ? 0 : 1 - edge * edge * (3 - 2 * edge);
          const ndl = (-gxv * Lx - gyv * Ly) / gm;
          if (ndl > 0) {
            const s = edge * ndl * ndl * 0.55;
            r += (255 - r) * s; g += (255 - g) * s; b += (255 - b) * s;
          } else {
            const s = edge * -ndl * 0.22;
            r *= 1 - s; g *= 1 - s; b *= 1 - s;
          }
        }
        pix[i] = ((a * 255) << 24) | ((b & 255) << 16) | ((g & 255) << 8) | (r & 255);
      }
    }

    if (!this.img) return;
    this.offCtx.putImageData(this.img, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(this.off, 0, 0, gw * scale, gh * scale);
  }

  renderDebug(ctx: CanvasRenderingContext2D, pos: Float32Array, homes: Float32Array, n: number) {
    for (let e = 0; e < this.colors.length; e++) {
      const [r, g, b] = this.colors[e];
      ctx.fillStyle = `rgb(${r},${g},${b})`;
      for (let p = 0; p < n; p++) {
        if ((homes[p] | 0) !== e) continue;
        ctx.fillRect(pos[2 * p] - 1, pos[2 * p + 1] - 1, 2, 2);
      }
    }
  }
}

export function hexToRgb(hex: string): RGB {
  const h = hex.replace("#", "");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
