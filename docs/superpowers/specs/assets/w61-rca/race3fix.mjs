// HISTORICAL (W66): uses the retired LiquidCore; run against a `git checkout softbody-final` build. The fluid port is packages/core/ts/__tests__/multi-instance-wasm.test.ts and demo/scenes/stress.ts.
import { readFileSync } from "node:fs";
const PKG = new URL("../../../../../pkg/", import.meta.url).pathname; // repo-root pkg/ (run `npm run build:wasm` first)
const bytes = readFileSync(PKG + "liquiddom_bg.wasm");
const mod = await import(PKG + "liquiddom.js");
let instantiations = 0;
const origS = WebAssembly.instantiateStreaming, origI = WebAssembly.instantiate;
WebAssembly.instantiateStreaming = (...a) => { instantiations++; return origS(...a); };
WebAssembly.instantiate = (...a) => { instantiations++; return origI(...a); };
const resp = () => new Response(bytes, { headers: { "Content-Type": "application/wasm" } });
const tickArgs = [16, 0, 0, false, 120, 8, 4, 100, 5000, 30, 0, 0, 800, 600, 100, 0, 0];
// Emulate two LiquidDOM.create() calls started in the same task (squish cap 8 + hero cap 16)
async function create(cap, tag) {
  const exports = await (globalThis.__init ??= mod.default({ module_or_path: resp() }));
  const core = new mod.LiquidCore(cap);
  return { tag, cap, exports, core };
}
const order = process.argv[2] === "rev" ? [[16, "hero"], [8, "squish"]] : [[8, "squish"], [16, "hero"]];
let release; const gate = new Promise(r => release = r);
async function createGated(cap, tag) { const exports = await (globalThis.__init ??= mod.default({ module_or_path: gate.then(resp) })); const core = new mod.LiquidCore(cap); return { tag, cap, exports, core }; }
const pB = createGated(order[1][0], order[1][1]);
setTimeout(() => release(), 0); const A = await create(order[0][0], order[0][1]);
release(); const B = await pB;
console.log("instantiations:", instantiations, "same memory:", A.exports.memory === B.exports.memory,
  "ptrs:", A.core.__wbg_ptr, B.core.__wbg_ptr);
for (const X of [A, B]) {
  const v = new Float32Array(X.exports.memory.buffer, X.core.ptr(), X.cap * 9);
  for (let s = 0; s < X.cap; s++) v.set([100 + s * 10, 100, 120, 40, 0, 0, 0, 0, 8], s * 9);
}
for (let f = 0; f < 5; f++) for (const X of [B, A]) {
  try { X.core.tick(...tickArgs); console.log(X.tag, "frame", f, "ok"); }
  catch (e) { console.log(X.tag, "frame", f, "THROW:", e.constructor.name, String(e.message).slice(0, 100)); }
}
