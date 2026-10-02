// Liquid renderer: splat particles into a low-res density grid with a smooth
// compact kernel, threshold into a silhouette (smoothstep = anti-aliased edge),
// colour each cell by the dominant home element, fake a little 3D shading
// from the field gradient, then upscale the ImageData with bilinear filtering.

function hexToRgb(hex) {
  const v = parseInt(hex.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

export class LiquidRenderer {
  constructor(canvas, colors, scale = 2) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.colors = colors.map(hexToRgb);
    this.scale = scale; // CSS px per grid cell
    this.off = document.createElement('canvas');
    this.offCtx = this.off.getContext('2d');
    this.resize(window.innerWidth, window.innerHeight);
  }

  resize(w, h) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.w = w;
    this.h = h;
    this.dpr = dpr;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.gw = Math.ceil(w / this.scale) + 1;
    this.gh = Math.ceil(h / this.scale) + 1;
    const cells = this.gw * this.gh;
    this.dens = new Float32Array(cells);
    this.elemW = new Float32Array(cells * this.colors.length);
    this.off.width = this.gw;
    this.off.height = this.gh;
    this.img = this.offCtx.createImageData(this.gw, this.gh);
  }

  /**
   * @param xs,ys  SoA particle positions (CSS px)
   * @param home   home element id per particle
   * @param spacing rest lattice spacing (CSS px) -> kernel radius + normalisation
   */
  draw(xs, ys, home, n, spacing, debug) {
    const { gw, gh, scale, dens, elemW } = this;
    const cells = gw * gh;
    const E = this.colors.length;
    dens.fill(0);
    elemW.fill(0);

    // Kernel radius in px, scaled with the lattice spacing so the field looks
    // the same at n=2000 and n=10000.
    // At high n the lattice is finer than the look we want; a floor on the
    // kernel radius keeps tiny voids from reading as foam.
    const Rpx = Math.max(spacing * 2.1, 8);
    const R = Rpx / scale;
    const R2 = R * R;
    const invR2 = 1 / R2;
    // Expected interior value: (particles per px^2) * integral of (1-r^2/R^2)^2
    const interior = (Math.PI * Rpx * Rpx) / 3 / (spacing * spacing);
    const norm = 1 / interior;
    const r = Math.ceil(R);

    // Track a bbox so the per-cell pass only touches the occupied region.
    let minX = gw, minY = gh, maxX = 0, maxY = 0;
    for (let i = 0; i < n; i++) {
      const gx = xs[i] / scale;
      const gy = ys[i] / scale;
      const e = home[i];
      const cx = gx | 0;
      const cy = gy | 0;
      const x0 = Math.max(0, cx - r), x1 = Math.min(gw - 1, cx + r);
      const y0 = Math.max(0, cy - r), y1 = Math.min(gh - 1, cy + r);
      if (x0 < minX) minX = x0;
      if (y0 < minY) minY = y0;
      if (x1 > maxX) maxX = x1;
      if (y1 > maxY) maxY = y1;
      const eo = e * cells;
      for (let y = y0; y <= y1; y++) {
        const dy = y + 0.5 - gy;
        const dy2 = dy * dy;
        let row = y * gw;
        for (let x = x0; x <= x1; x++) {
          const dx = x + 0.5 - gx;
          const q = (dx * dx + dy2) * invR2;
          if (q < 1) {
            const t = 1 - q;
            const w = t * t;
            dens[row + x] += w;
            elemW[eo + row + x] += w;
          }
        }
      }
    }

    const data = this.img.data;
    data.fill(0);
    const colors = this.colors;
    const lo = 0.43, hi = 0.53; // smoothstep band around threshold 0.48
    // light direction (top-left), used with the field gradient
    const lx = -0.55, ly = -0.75;
    if (maxX >= minX) {
      for (let y = Math.max(1, minY); y <= Math.min(gh - 2, maxY); y++) {
        for (let x = Math.max(1, minX); x <= Math.min(gw - 2, maxX); x++) {
          const c = y * gw + x;
          const f = dens[c] * norm;
          if (f <= lo) continue;
          let a = (f - lo) / (hi - lo);
          if (a > 1) a = 1;
          a = a * a * (3 - 2 * a);
          // dominant home element in this cell
          let best = 0, bw = -1;
          for (let e = 0; e < E; e++) {
            const w = elemW[e * cells + c];
            if (w > bw) { bw = w; best = e; }
          }
          // gradient of a soft "height" = clamp(f) -> fake normal
          const fl = Math.min(dens[c - 1] * norm, 0.85);
          const fr = Math.min(dens[c + 1] * norm, 0.85);
          const fu = Math.min(dens[c - gw] * norm, 0.85);
          const fd = Math.min(dens[c + gw] * norm, 0.85);
          const nx = (fl - fr) * 1.4;
          const ny = (fu - fd) * 1.4;
          const nl = Math.sqrt(nx * nx + ny * ny + 1);
          const ndl = (nx * lx + ny * ly) / nl; // >0 on the lit rim
          const rim = Math.min(Math.sqrt(nx * nx + ny * ny), 1);
          let shade = 1 + 0.18 * ndl - 0.10 * rim;
          let spec = ndl > 0.35 ? (ndl - 0.35) * 1.6 : 0;
          if (spec > 0.6) spec = 0.6;
          const col = colors[best];
          const o = c * 4;
          data[o] = Math.min(255, col[0] * shade + 255 * spec);
          data[o + 1] = Math.min(255, col[1] * shade + 255 * spec);
          data[o + 2] = Math.min(255, col[2] * shade + 255 * spec);
          data[o + 3] = a * 255;
        }
      }
    }
    this.offCtx.putImageData(this.img, 0, 0);

    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.w, this.h);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.globalAlpha = debug ? 0.35 : 1;
    // grid cell (x, y) covers px [x*scale, (x+1)*scale)
    ctx.drawImage(this.off, 0, 0, gw * scale, gh * scale);
    ctx.globalAlpha = 1;

    if (debug) {
      for (let e = 0; e < E; e++) {
        const [r0, g0, b0] = colors[e];
        ctx.fillStyle = `rgb(${r0 * 0.6},${g0 * 0.6},${b0 * 0.6})`;
        for (let i = 0; i < n; i++) {
          if (home[i] !== e) continue;
          ctx.fillRect(xs[i] - 1, ys[i] - 1, 2, 2);
        }
      }
    }
  }
}
