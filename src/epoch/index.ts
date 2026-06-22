/**
 * EPOCH — AMOS v2.1 structured adaptive presentation pillar.
 *
 * Combines ArrowJS Sandbox (for safe agent output rendering) with GSAP
 * (for animation). Streams frames to Adreno GPU via Three.js.
 *
 * Architecture:
 *   Meta Harness -> EPOCH -> {AnimatedUI, AgentSandbox, FurnitureViewer, FrameScheduler}
 *
 * Public API:
 *   import { AnimatedUI, AgentSandbox, FurnitureViewer, FrameScheduler, AdaptiveLayout }
 *     from './src/epoch.js';
 */

export { AnimatedUI } from './AnimatedUI.js';
export { AgentSandbox } from './AgentSandbox.js';
export { FurnitureViewer } from './FurnitureViewer.js';
export { FrameScheduler } from './FrameScheduler.js';
export { AdaptiveLayout } from './AdaptiveLayout.js';
