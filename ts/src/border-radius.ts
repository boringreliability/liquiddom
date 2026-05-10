/**
 * Pure parser for CSS `border-radius` values (Ward 042).
 * Resolves the first space-separated token to pixels.
 *
 *  - `'10px'` → 10
 *  - `'50%'` resolves against `min(w, h)`
 *  - `'10px 20px'` and `'10px / 5px'` use only the first token (v1 limitation)
 *  - `''` / `'normal'` / `'auto'` / unparseable / negative → 0
 *  - `calc(...)` / `min(...)` / `max(...)` typically resolved by `getComputedStyle`
 *    in the browser; if the function literal survives, fall back to 0 (v1 limitation)
 */
export function parseBorderRadius(value: string, w: number, h: number): number {
  if (typeof value !== "string" || value.length === 0) return 0;

  const first = value.trim().split(/\s+/)[0];
  if (!first) return 0;

  const lower = first.toLowerCase();
  if (lower === "normal" || lower === "auto") return 0;

  // Reject CSS functions that getComputedStyle didn't resolve.
  if (/^(calc|min|max|clamp|var)\s*\(/i.test(first)) return 0;

  // Percent value.
  if (first.endsWith("%")) {
    const num = parseFloat(first.slice(0, -1));
    if (!Number.isFinite(num) || num < 0) return 0;
    const minDim = Math.min(w, h);
    return (num / 100) * minDim;
  }

  // Pixel value (or unitless).
  // parseFloat accepts trailing units; we explicitly check the suffix.
  const num = parseFloat(first);
  if (!Number.isFinite(num) || num < 0) return 0;

  // Accept "px", "" (unitless 0), reject other units for v1.
  const suffix = first.replace(/^-?\d*\.?\d+(?:e[-+]?\d+)?/i, "");
  if (suffix !== "" && suffix.toLowerCase() !== "px") return 0;

  return num;
}
