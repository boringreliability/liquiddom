/**
 * W72: pixel reads for the manual-clock scene, as thin wrappers over W71's hook. A WebGPU canvas
 * holds its pixels only in the task that presented them, so __liquidTest.advance() snapshots the
 * liquid canvas in that task and __liquidTest.pixels() returns the copy (W71 plan, Corrections 6).
 * Every read advances ≥ 1 frame first, so the copy is the frame just drawn. Works for Canvas2D too.
 */
import type { Page } from "@playwright/test";

export async function advanceFrames(page: Page, frames: number): Promise<void> {
  await page.evaluate((n) => window.__liquidTest!.advance(n), frames);
}

type ReadKind = "hash" | "opaque" | "outside";

async function advanceAndRead(page: Page, frames: number, kind: ReadKind): Promise<number | string> {
  if (!Number.isInteger(frames) || frames < 1) {
    throw new Error("frame-readback: advance at least one frame (pixels() is the snapshot of the last advance())");
  }
  return page.evaluate(
    ([n, what]) => {
      const t = window.__liquidTest!;
      t.advance(n);
      const img = t.pixels();
      const data = img.data;
      if (what === "hash") {
        let h = 0x811c9dc5;
        for (let i = 0; i < data.length; i++) {
          h ^= data[i];
          h = Math.imul(h, 0x01000193) >>> 0;
        }
        return h.toString(16);
      }
      if (what === "opaque") {
        let n2 = 0;
        for (let i = 3; i < data.length; i += 4) if (data[i] > 128) n2++;
        return n2;
      }
      // "outside": opaque pixels outside every .liquid-element rect inflated by 8 px (W67 metric).
      const src = document.querySelector<HTMLCanvasElement>("canvas.liquid-canvas");
      if (!src) throw new Error("frame-readback: canvas.liquid-canvas not found");
      const cr = src.getBoundingClientRect();
      const sx = img.width / cr.width;
      const sy = img.height / cr.height;
      const rects = Array.from(document.querySelectorAll(".liquid-element")).map((e) => e.getBoundingClientRect());
      if (rects.length === 0) throw new Error("frame-readback: no .liquid-element found");
      let out = 0;
      for (let py = 0; py < img.height; py++) {
        const y = py / sy + cr.top;
        for (let px = 0; px < img.width; px++) {
          if (data[(py * img.width + px) * 4 + 3] <= 128) continue;
          const x = px / sx + cr.left;
          let inside = false;
          for (const r of rects) {
            if (x >= r.left - 8 && x <= r.right + 8 && y >= r.top - 8 && y <= r.bottom + 8) {
              inside = true;
              break;
            }
          }
          if (!inside) out++;
        }
      }
      return out;
    },
    [frames, kind] as const,
  );
}

/** FNV-1a of the canvas pixels after `frames` frames. */
export async function advanceAndHash(page: Page, frames: number): Promise<string> {
  return (await advanceAndRead(page, frames, "hash")) as string;
}

/** Pixels with alpha > 128 after `frames` frames. */
export async function advanceAndCountOpaque(page: Page, frames: number): Promise<number> {
  return (await advanceAndRead(page, frames, "opaque")) as number;
}

/** Opaque pixels outside the 8 px-inflated element rects after `frames` frames. */
export async function advanceAndCountOutside(page: Page, frames: number): Promise<number> {
  return (await advanceAndRead(page, frames, "outside")) as number;
}
