/**
 * AdaptiveLayout — adapts UI layout based on device state + content type.
 *
 * Inputs:
 *   - Device orientation (portrait/landscape)
 *   - Device form factor (phone/tablet/foldable)
 *   - Available viewport size
 *   - Current thermal state
 *   - Battery level
 *   - Content type (text/code/3D/chart/agent-output)
 *
 * Outputs:
 *   - Layout mode (full-screen, split, stacked, overlay)
 *   - Density (compact/comfortable/spacious)
 *   - Animation budget (off/reduced/full)
 *   - Render quality (low/medium/high)
 */

export type FormFactor = 'phone' | 'tablet' | 'foldable';
export type Orientation = 'portrait' | 'landscape';
export type ContentType = 'text' | 'code' | '3d' | 'chart' | 'agent-output' | 'mixed';
export type LayoutMode = 'full-screen' | 'split' | 'stacked' | 'overlay';
export type Density = 'compact' | 'comfortable' | 'spacious';
export type AnimationBudget = 'off' | 'reduced' | 'full';
export type RenderQuality = 'low' | 'medium' | 'high';

export interface DeviceState {
  formFactor: FormFactor;
  orientation: Orientation;
  viewportWidth: number;
  viewportHeight: number;
  thermal: number;        // 0..1
  batteryLevel: number;   // 0..1
  batterySaver: boolean;
}

export interface LayoutDecision {
  mode: LayoutMode;
  density: Density;
  animationBudget: AnimationBudget;
  renderQuality: RenderQuality;
  /** Effective viewport size after layout adjustments */
  effectiveWidth: number;
  effectiveHeight: number;
  /** Why this decision was made */
  rationale: string;
}

export class AdaptiveLayout {
  decide(state: DeviceState, contentType: ContentType): LayoutDecision {
    const rationale: string[] = [];
    let mode: LayoutMode;
    let density: Density;
    let animationBudget: AnimationBudget;
    let renderQuality: RenderQuality;

    // Layout mode
    if (state.formFactor === 'foldable' && state.viewportWidth > 1200) {
      mode = 'split';
      rationale.push('foldable unfolded -> split layout');
    } else if (state.formFactor === 'tablet' && state.orientation === 'landscape') {
      mode = 'split';
      rationale.push('tablet landscape -> split layout');
    } else if (contentType === '3d') {
      mode = 'full-screen';
      rationale.push('3D content -> full-screen');
    } else if (contentType === 'agent-output') {
      mode = 'overlay';
      rationale.push('agent output -> overlay');
    } else if (state.viewportWidth < 600) {
      mode = 'stacked';
      rationale.push('narrow viewport -> stacked');
    } else {
      mode = 'full-screen';
      rationale.push('default -> full-screen');
    }

    // Density
    if (state.viewportWidth < 400) {
      density = 'compact';
      rationale.push('narrow viewport -> compact density');
    } else if (state.viewportWidth > 1200) {
      density = 'spacious';
      rationale.push('wide viewport -> spacious density');
    } else {
      density = 'comfortable';
    }

    // Animation budget — driven by thermal + battery
    if (state.batterySaver || state.batteryLevel < 0.15) {
      animationBudget = 'off';
      rationale.push('low battery / battery saver -> animations off');
    } else if (state.thermal > 0.7) {
      animationBudget = 'reduced';
      rationale.push('thermal throttling -> reduced animations');
    } else {
      animationBudget = 'full';
    }

    // Render quality — driven by thermal + battery + content type
    if (contentType === '3d') {
      if (state.thermal > 0.7 || state.batteryLevel < 0.2) {
        renderQuality = 'low';
        rationale.push('3D + thermal/battery stress -> low render quality');
      } else if (state.thermal > 0.4) {
        renderQuality = 'medium';
        rationale.push('3D + mild thermal -> medium render quality');
      } else {
        renderQuality = 'high';
        rationale.push('3D + nominal thermal -> high render quality');
      }
    } else {
      renderQuality = state.thermal > 0.7 ? 'low' : 'medium';
    }

    return {
      mode,
      density,
      animationBudget,
      renderQuality,
      effectiveWidth: state.viewportWidth,
      effectiveHeight: state.viewportHeight,
      rationale: rationale.join('; '),
    };
  }
}
