// Ward 060: hero-blobs factory.
//
// Creates a LiquidDOM instance with `autoObserve: false`, spawns 6 FreeDrop
// droplets drifting downward under gentle gravity, and respawns them at the
// top edge when they fall past the viewport (W45 auto-cull).
//
// KNOWN FFI COUPLING: reads `buf[id * FLOATS_PER_ENTITY + SLOT_DIAMETER] === 0`
// to detect culled droplets. The buffer layout (9 floats/entity, slot 2 =
// diameter/active marker for FreeDrop) is documented in CLAUDE.md and stable
// since W42. If FLOATS_PER_ENTITY ever changes, the constants below must
// update. A future ward should add `liquid.getDropletState(id)` public API
// to insulate consumers (W63 backlog).

import { LiquidDOM, type LiquidDOMInstance } from "liquiddom";
import type { RendererPreference } from "../lib/renderer-store";

export interface HeroBlobsHandle {
  instance: LiquidDOMInstance;
  activeRenderer: "canvas2d" | "webgpu";
  // Note: shape diverges from W59 `Showcase` — no DOM observation, no
  // renderer-toggle integration via wireDemoEmbed (LiveHero handles
  // renderer-change directly).
  destroy(): void;
}

const FLOATS_PER_ENTITY = 9;          // mirrors core constant (CLAUDE.md)
// Buffer slot INDEX (not value) for FreeDrop diameter / active-marker (W45).
// `buf[id * FLOATS_PER_ENTITY + DIAMETER_SLOT] === 0` means culled.
const DIAMETER_SLOT = 2;
const DROPLET_COUNT = 6;
const LIFETIME_MS = 15_000;
const RESPAWN_POLL_MS = 500;

export async function createHeroBlobs(
  root: HTMLElement,
  renderer: RendererPreference,
): Promise<HeroBlobsHandle> {
  const liquid = await LiquidDOM.create({
    capacity: 16,
    autoObserve: false,
    container: root,
    renderer,
    // Soft pastel — light enough that the headline text on top stays
    // crisp and accessibility-compliant against any contrast check.
    colorDefault: "rgba(120, 160, 220, 0.35)",
    gravity: { source: "fixed", vector: [0, 20] },
  });

  function spawn(x: number, y: number): number {
    return liquid.spawnDroplet({
      x,
      y,
      vx: (Math.random() - 0.5) * 20,
      vy: 5,
      // Consistent-ish radius for visual coherence — small jitter only.
      radius: 28 + Math.random() * 8,
      lifetimeMs: LIFETIME_MS,
    });
  }

  const initialRect = root.getBoundingClientRect();
  const ids = new Set<number>();
  for (let i = 0; i < DROPLET_COUNT; i++) {
    ids.add(spawn(
      Math.random() * initialRect.width,
      Math.random() * initialRect.height * 0.5,
    ));
  }

  // Respawn culled droplets at the top edge with fresh velocity.
  // Visibility-guarded: no CPU waste when tab is hidden.
  // Rect re-read: handles window resize without coordinate drift.
  const respawnTimer = setInterval(() => {
    if (document.visibilityState !== "visible") return;
    const buf = liquid.getBuffer();
    if (!buf) return;
    const currentRect = root.getBoundingClientRect();
    // Iterate a snapshot — we mutate `ids` inside the loop.
    for (const id of Array.from(ids)) {
      if (buf[id * FLOATS_PER_ENTITY + DIAMETER_SLOT] === 0) {
        ids.delete(id);
        // Hero is purely decorative — swallow spawn failures (capacity full
        // or instance destroyed mid-renderer-swap). Next tick retries.
        try {
          ids.add(spawn(Math.random() * currentRect.width, -50));
        } catch {
          // Intentional: respawn loop self-heals on next tick.
        }
      }
    }
  }, RESPAWN_POLL_MS);

  return {
    instance: liquid,
    activeRenderer: liquid.activeRenderer,
    destroy() {
      clearInterval(respawnTimer);
      liquid.destroy();
    },
  };
}
