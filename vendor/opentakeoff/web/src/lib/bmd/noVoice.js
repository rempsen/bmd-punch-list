// BMD change: voice dictation is not part of the BMD build (see docs/superpowers/specs/2026-11-22-opentakeoff-integration-design.md,
// Non-goals). This stands in for the speech library so its 550 KB bundle and 45 MB of speech models are never shipped.
// The voice command box is already off by default in OpenTakeoff (VITE_COMMAND_BOX), so nothing reaches this in normal use.
const off = () => {
  throw new Error("Voice dictation is not included in BMD Projects.");
};
export const pipeline = off;
export const env = { allowLocalModels: false, backends: { onnx: { wasm: {} } } };
export default { pipeline, env };
