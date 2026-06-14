/**
 * ModelViewer — React + Three.js component for the Ava-007 Presentation Layer
 * Converts standalone Three.js renderer into composable React component with
 * GSAP temporal synchronization, ModelArtifact loading, and Gaussian Splat support.
 */

import React, { useEffect, useState, useCallback } from 'react';
import {
  useModelViewer,
  ModelSource,
  AtmosphericState,
  ModelViewerConfig,
  DEFAULT_MODEL_VIEWER_CONFIG,
} from './useModelViewer';

export interface ModelViewerProps {
  modelSource?: ModelSource;
  config?: Partial<ModelViewerConfig>;
  className?: string;
  showLoading?: boolean;
  showError?: boolean;
  onModelLoaded?: (artifactId?: string) => void;
  onAtmosphericChange?: (state: AtmosphericState) => void;
  onError?: (error: string) => void;
  interactive?: boolean;
  gsapLabel?: string;
  accentColor?: string;
  showTimeline?: boolean;
}

export const ModelViewer: React.FC<ModelViewerProps> = ({
  modelSource,
  config = {},
  className = '',
  showLoading = true,
  showError = true,
  onModelLoaded,
  onAtmosphericChange,
  onError,
  interactive = true,
  gsapLabel = 'model_viewer',
  accentColor = '#e6b87e',
  showTimeline = false,
}) => {
  const viewerConfig: Partial<ModelViewerConfig> = {
    ...config,
    gsapLabel,
    gsapSync: config.gsapSync ?? true,
  };

  const {
    containerRef,
    sceneState,
    loadModel,
    loadSplat,
    setAtmospheric,
    seekTimeline,
    dispose,
  } = useModelViewer(viewerConfig);

  const [timelineValue, setTimelineValue] = useState(0);

  useEffect(() => {
    if (!modelSource || !sceneState.ready) return;
    const load = async () => {
      if (modelSource.format === 'splat' || modelSource.format === 'ply') {
        await loadSplat(modelSource);
      } else {
        await loadModel(modelSource);
      }
      onModelLoaded?.(modelSource.artifactId);
    };
    load();
  }, [modelSource, sceneState.ready, loadModel, loadSplat, onModelLoaded]);

  useEffect(() => {
    if (sceneState.error) onError?.(sceneState.error);
  }, [sceneState.error, onError]);

  useEffect(() => {
    onAtmosphericChange?.(sceneState.atmospheric);
  }, [sceneState.atmospheric, onAtmosphericChange]);

  const handleTimelineChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = parseFloat(e.target.value);
      setTimelineValue(value);
      seekTimeline(value);
    },
    [seekTimeline],
  );

  return (
    <div
      className={`model-viewer ${className}`}
      style={{
        position: 'relative',
        width: '100%',
        aspectRatio: '4 / 3',
        borderRadius: '1rem',
        overflow: 'hidden',
        background: '#00000022',
        border: '1px solid rgba(255,255,255,0.08)',
      }}
    >
      <div
        ref={containerRef}
        style={{
          width: '100%',
          height: '100%',
          cursor: interactive ? 'grab' : 'default',
        }}
      />

      {showLoading && sceneState.loadingProgress > 0 && sceneState.loadingProgress < 100 && (
        <div
          className="model-viewer__loading"
          style={{
            position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
            display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center',
            background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(8px)', zIndex: 10,
          }}
        >
          <div style={{ width: '60%', height: '3px', background: 'rgba(255,255,255,0.1)', borderRadius: '2px', overflow: 'hidden' }}>
            <div style={{ width: `${sceneState.loadingProgress}%`, height: '100%', background: accentColor, borderRadius: '2px', transition: 'width 0.3s ease' }} />
          </div>
          <span style={{ marginTop: '0.5rem', fontSize: '0.7rem', color: 'rgba(255,255,255,0.5)', fontFamily: 'monospace' }}>
            Loading 3D model... {sceneState.loadingProgress}%
          </span>
        </div>
      )}

      {showError && sceneState.error && (
        <div style={{
          position: 'absolute', bottom: '0.5rem', left: '0.5rem', right: '0.5rem',
          padding: '0.5rem 0.75rem', background: 'rgba(200,40,40,0.85)',
          borderRadius: '0.5rem', fontSize: '0.7rem', color: '#fff', zIndex: 20,
        }}>
          {sceneState.error}
        </div>
      )}

      {showTimeline && (
        <div style={{
          position: 'absolute', bottom: 0, left: 0, right: 0,
          padding: '0.5rem 1rem', background: 'linear-gradient(transparent, rgba(0,0,0,0.6))', zIndex: 15,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span style={{ fontSize: '0.6rem', color: 'rgba(255,255,255,0.4)', fontFamily: 'monospace', minWidth: '3rem' }}>
              {sceneState.atmospheric.activeLabel}
            </span>
            <input
              type="range" min={0} max={1} step={0.01} value={timelineValue}
              onChange={handleTimelineChange}
              style={{ flex: 1, accentColor, height: '3px' }}
              aria-label="GSAP Timeline Scrub"
            />
            <span style={{ fontSize: '0.6rem', color: 'rgba(255,255,255,0.4)', fontFamily: 'monospace' }}>
              {Math.round(timelineValue * 100)}%
            </span>
          </div>
        </div>
      )}

      {sceneState.atmospheric.activeLabel !== gsapLabel && (
        <div style={{
          position: 'absolute', top: '0.5rem', left: '0.5rem',
          padding: '0.2rem 0.6rem', background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(8px)',
          borderRadius: '1rem', fontSize: '0.6rem', color: accentColor, fontFamily: 'monospace', zIndex: 15,
        }}>
          {sceneState.atmospheric.activeLabel}
        </div>
      )}
    </div>
  );
};
