/**
 * W81 red stub (D81-2, D81-3): the world the fluid grid covers. Task W81.3 replaces this whole file.
 * `measureWorld` is still W64's B2 rule (container mode `max(client, scroll)`), moved out of runtime.ts.
 */
export const WORLD_MIN_PX = 64;
export const WORLD_MAX_PX = 8192;
export const WORLD_GROWTH = 1.25;
export const WORLD_RESIZE_INFO = "[liquiddom] the viewport outgrew the liquid's world; the grid grew to";

export interface WorldSize {
  readonly w: number;
  readonly h: number;
}

export function measureWorld(container?: HTMLElement): WorldSize {
  if (container) {
    return {
      w: Math.max(container.clientWidth, container.scrollWidth, 1),
      h: Math.max(container.clientHeight, container.scrollHeight, 1),
    };
  }
  const sw = typeof screen !== "undefined" ? screen.width || 0 : 0;
  const sh = typeof screen !== "undefined" ? screen.height || 0 : 0;
  return { w: Math.max(sw, window.innerWidth || 0, 1), h: Math.max(sh, window.innerHeight || 0, 1) };
}

export function clampWorld(s: WorldSize): WorldSize {
  return { w: s.w, h: s.h };
}

export function grownWorld(_current: WorldSize, _need: WorldSize): WorldSize | null {
  return null;
}
