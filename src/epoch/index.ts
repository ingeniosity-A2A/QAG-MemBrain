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
 *     from './src/epoch';
 */

export { AnimatedUI } from './AnimatedUI';
export { AgentSandbox } from './AgentSandbox';
export { FurnitureViewer } from './FurnitureViewer';
export { FrameScheduler } from './FrameScheduler';
export { AdaptiveLayout } from './AdaptiveLayout';
