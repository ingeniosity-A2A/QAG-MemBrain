// GSAP temporal engine configuration — AMOS v2.1
// Wired into src/temporal/ via Meta Harness
export const gsapConfig = {
  // Default timeline duration (ms)
  defaultDuration: 1200,
  // Holographic reconstruction settings
  reconstruction: {
    frameRate: 60,
    resolution: 'device',
    enableAdrenoGPU: true,
  },
  // Replay settings (overnight synthesis)
  replay: {
    batchSize: 100,
    entropyThreshold: 0.3,
  },
};
