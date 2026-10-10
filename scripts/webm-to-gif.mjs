#!/usr/bin/env node
// W69 (D69-2): convert the whole-picture Playwright video (webm) into a GIF.
// Usage: node scripts/webm-to-gif.mjs <input.webm|manifest.json> <output.gif> [--width 640] [--fps 12]
// Needs ffmpeg on PATH (local only; not assumed in CI).
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const DEFAULT_WIDTH = 640;
export const DEFAULT_FPS = 12;
export const MAX_GIF_BYTES = 10 * 1024 * 1024;
/** W76: tried in order when no --width/--fps is given; the first that fits MAX_GIF_BYTES wins. */
export const SIZE_LADDER = Object.freeze([
  { width: DEFAULT_WIDTH, fps: DEFAULT_FPS },
  { width: DEFAULT_WIDTH, fps: 10 },
  { width: 560, fps: 10 },
  { width: 480, fps: 8 },
]);

const USAGE =
  "usage: node scripts/webm-to-gif.mjs <input.webm|manifest.json> <output.gif> [--width 640] [--fps 12]";

/** @param {string[]} argv */
export function parseArgs(argv) {
  /** @type {string[]} */
  const positional = [];
  let width = DEFAULT_WIDTH;
  let fps = DEFAULT_FPS;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--width" || arg === "--fps") {
      const raw = argv[i + 1];
      i++;
      if (raw === undefined || !/^\d+$/.test(raw) || Number(raw) <= 0) {
        throw new Error(`${arg} needs a positive integer`);
      }
      if (arg === "--width") width = Number(raw);
      else fps = Number(raw);
    } else {
      positional.push(arg);
    }
  }
  if (positional.length !== 2) throw new Error(USAGE);
  return { input: positional[0], output: positional[1], width, fps };
}

/**
 * A `.json` input is the record spec's manifest; its `video` field is the webm path.
 * @param {string} input
 * @param {(path: string) => string} [readFile]
 */
export function resolveInput(input, readFile = (p) => readFileSync(p, "utf8")) {
  if (!input.endsWith(".json")) return input;
  const manifest = JSON.parse(readFile(input));
  if (typeof manifest.video !== "string" || manifest.video.length === 0) {
    throw new Error(`${input} has no "video" path`);
  }
  return manifest.video;
}

/** Single-pass palette GIF: palettegen + paletteuse in one filter graph, infinite loop. */
export function buildFfmpegArgs({ input, output, width, fps }) {
  const filter =
    `fps=${fps},scale=${width}:-1:flags=lanczos,split[a][b];` +
    "[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle";
  return ["-hide_banner", "-loglevel", "error", "-y", "-i", input, "-vf", filter, "-loop", "0", output];
}

/**
 * The temp path of one conversion attempt: same directory (so the rename stays on one file system),
 * still ending in `.gif` (ffmpeg picks the muxer from the extension).
 * @param {string} output
 */
export function attemptPath(output) {
  return `${output.replace(/\.gif$/i, "")}.partial-${process.pid}.gif`;
}

/** @param {string[]} argv @returns {number} exit code */
function main(argv) {
  const args = parseArgs(argv);
  const input = resolveInput(args.input);
  if (!existsSync(input)) {
    console.error(`[webm-to-gif] input not found: ${input}`);
    return 1;
  }
  const probe = spawnSync("ffmpeg", ["-version"], { stdio: "ignore" });
  if (probe.error !== undefined || probe.status !== 0) {
    console.error("[webm-to-gif] ffmpeg not found on PATH (macOS: brew install ffmpeg)");
    return 1;
  }
  mkdirSync(dirname(resolve(args.output)), { recursive: true });
  // W76: with neither flag given, step down the size ladder until the GIF fits MAX_GIF_BYTES
  // (the slice-4 recording is about twice as long as slice 2's). Explicit flags get one attempt.
  const explicit = argv.includes("--width") || argv.includes("--fps");
  const attempts = explicit ? [{ width: args.width, fps: args.fps }] : SIZE_LADDER;
  // W76 review (finding 6): every attempt writes a temp GIF next to the output and only a GIF that
  // fits is renamed onto the output, so a failing or oversized attempt never leaves its GIF there.
  const temp = attemptPath(args.output);
  for (const { width, fps } of attempts) {
    const run = spawnSync("ffmpeg", buildFfmpegArgs({ input, output: temp, width, fps }), { stdio: "inherit" });
    if (run.status !== 0) {
      const why = run.error !== undefined ? run.error.message : `ffmpeg exited with ${String(run.status)}`;
      console.error(`[webm-to-gif] ${why}`);
      rmSync(temp, { force: true });
      return 1;
    }
    const bytes = statSync(temp).size;
    if (bytes <= MAX_GIF_BYTES) {
      renameSync(temp, args.output);
      console.log(`[webm-to-gif] wrote ${args.output} (${(bytes / 1048576).toFixed(2)} MiB, ${width}px, ${fps} fps)`);
      return 0;
    }
    console.error(`[webm-to-gif] GIF exceeds ${MAX_GIF_BYTES} bytes at ${width}px, ${fps} fps (${(bytes / 1048576).toFixed(2)} MiB)`);
  }
  rmSync(temp, { force: true });
  console.error(`[webm-to-gif] no setting fits; ${args.output} left unchanged; re-run with a smaller --width or --fps`);
  return 2;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (err) {
    console.error(`[webm-to-gif] ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  }
}
