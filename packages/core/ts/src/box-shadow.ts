/**
 * Ward 054: box-shadow margin parser for clip-hole inflation under
 * `preserveBackgrounds: true`.
 *
 * Operates on `getComputedStyle(el).boxShadow`, which browsers normalize to:
 *   `<color> <offsetX>px <offsetY>px <blur>px <spread>px [inset]`
 * with shadows comma-separated. Multiple color formats appear in the wild
 * (`rgb()`, `rgba()`, `hsl()`, `color()`, etc.) — we split paren-aware
 * rather than maintaining an allowlist.
 */

export interface ShadowMargin {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export const ZERO_MARGIN: ShadowMargin = Object.freeze({
  top: 0,
  right: 0,
  bottom: 0,
  left: 0,
});

/** Split a comma-separated string but ignore commas inside parens. */
function splitTopLevel(raw: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    if (c === "(") depth++;
    else if (c === ")") depth--;
    else if (c === "," && depth === 0) {
      out.push(raw.slice(start, i));
      start = i + 1;
    }
  }
  out.push(raw.slice(start));
  return out;
}

const PX_TOKEN = /(-?\d+(?:\.\d+)?)px/gi;

function marginForSegment(segment: string): ShadowMargin | null {
  if (/\binset\b/i.test(segment)) return null;

  const nums: number[] = [];
  let match: RegExpExecArray | null;
  PX_TOKEN.lastIndex = 0;
  while ((match = PX_TOKEN.exec(segment)) !== null) {
    nums.push(parseFloat(match[1]));
  }

  if (nums.length < 2) return null;

  const offsetX = nums[0];
  const offsetY = nums[1];
  const blur = nums[2] ?? 0;
  const spread = nums[3] ?? 0;

  return {
    left: Math.max(0, blur + spread - offsetX),
    right: Math.max(0, blur + spread + offsetX),
    top: Math.max(0, blur + spread - offsetY),
    bottom: Math.max(0, blur + spread + offsetY),
  };
}

export function parseBoxShadowMargin(raw: string): ShadowMargin {
  if (!raw || raw === "none") return ZERO_MARGIN;

  let top = 0;
  let right = 0;
  let bottom = 0;
  let left = 0;

  for (const seg of splitTopLevel(raw)) {
    const m = marginForSegment(seg);
    if (!m) continue;
    if (m.top > top) top = m.top;
    if (m.right > right) right = m.right;
    if (m.bottom > bottom) bottom = m.bottom;
    if (m.left > left) left = m.left;
  }

  if (top === 0 && right === 0 && bottom === 0 && left === 0) return ZERO_MARGIN;
  return { top, right, bottom, left };
}
