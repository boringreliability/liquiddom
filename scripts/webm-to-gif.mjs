#!/usr/bin/env node
// W69 (D69-2): convert the whole-picture Playwright video (webm) into a GIF.
// Usage: node scripts/webm-to-gif.mjs <input.webm|manifest.json> <output.gif> [--width 640] [--fps 12]
// Needs ffmpeg on PATH (local only; not assumed in CI).
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const DEFAULT_WIDTH = 640;
export const DEFAULT_FPS = 12;
export const MAX_GIF_BYTES = 10 * 1024 * 1024;

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
  const run = spawnSync("ffmpeg", buildFfmpegArgs({ ...args, input }), { stdio: "inherit" });
  if (run.status !== 0) {
    console.error(`[webm-to-gif] ffmpeg exited with ${String(run.status)}`);
    return 1;
  }
  const bytes = statSync(args.output).size;
  console.log(
    `[webm-to-gif] wrote ${args.output} (${(bytes / 1048576).toFixed(2)} MiB, ${args.width}px, ${args.fps} fps)`,
  );
  if (bytes > MAX_GIF_BYTES) {
    console.error(`[webm-to-gif] GIF exceeds ${MAX_GIF_BYTES} bytes; re-run with --fps 8 or --width 480`);
    return 2;
  }
  return 0;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (err) {
    console.error(`[webm-to-gif] ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  }
}
