/**
 * The runtime layer — executes plans on behalf of the Brain.
 *
 * Build a kernel with `createDefaultRuntime(registry)` and hand it to the Brain.
 * The Brain thinks; the runtime executes.
 */
export type { RuntimeKernel } from "./runtime-kernel-interface.js";
export { DefaultRuntimeKernel } from "./runtime-kernel.js";
export { createDefaultRuntime } from "./runtime-factory.js";
