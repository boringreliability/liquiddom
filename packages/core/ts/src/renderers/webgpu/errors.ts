/** WebGPU is not available (no `navigator.gpu`, no adapter, no device, no context). W71: moved from renderers/webgpu-renderer.ts; index.ts re-exports it. */
export class WebGPUUnavailableError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "WebGPUUnavailableError";
  }
}
