/**
 * Builder.io Configuration
 *
 * Builder.io provides visual editing for AVA007's UI components.
 * Components registered here become editable in the Builder.io visual editor.
 *
 * Setup:
 *   1. Create a free account at https://builder.io
 *   2. Get your API key from Settings > Organization
 *   3. Set BUILDER_API_KEY in your .env
 *   4. Register components below — they'll appear in the visual editor
 */

import { Builder } from '@builder.io/react';
import ProductRenderer from './components/ProductRenderer';
import AvaChatSurface from './components/flagship/AvaChatSurface';
import InputConsole from './components/flagship/InputConsole';
import TrainModelHeader from './components/flagship/TrainModelHeader';
import SocialGlassBar from './components/flagship/SocialGlassBar';
import SplitFlapBoard from './components/flagship/SplitFlapBoard';
import AtlantaWeather from './components/flagship/AtlantaWeather';

const BUILDER_API_KEY = import.meta.env?.VITE_BUILDER_API_KEY || '';

if (BUILDER_API_KEY) {
  Builder.initialize(BUILDER_API_KEY);

  // ── Register AVA007 components for visual editing ──────────────

  Builder.registerComponent(ProductRenderer, {
    name: 'ProductRenderer',
    description: '3D product viewer with Ava voice + quote generation',
    inputs: [
      { name: 'modelUrl', type: 'string', defaultValue: '' },
    ],
  });

  Builder.registerComponent(AvaChatSurface, {
    name: 'AvaChatSurface',
    description: 'AVA007 chat interface with Gemma 2B inference',
  });

  Builder.registerComponent(InputConsole, {
    name: 'InputConsole',
    description: 'Voice + text input with AVA007 dispatch',
  });

  Builder.registerComponent(TrainModelHeader, {
    name: 'TrainModelHeader',
    description: 'Header with model training status',
  });

  Builder.registerComponent(SocialGlassBar, {
    name: 'SocialGlassBar',
    description: 'Social proof + reviews bar',
  });

  Builder.registerComponent(SplitFlapBoard, {
    name: 'SplitFlapBoard',
    description: 'Split-flap display for schedule/ETA',
  });

  Builder.registerComponent(AtlantaWeather, {
    name: 'AtlantaWeather',
    description: 'Atlanta weather widget for outdoor job planning',
  });

  console.log('[Builder.io] Components registered for visual editing');
} else {
  console.warn('[Builder.io] No API key set — set VITE_BUILDER_API_KEY in .env');
}

export { Builder };
