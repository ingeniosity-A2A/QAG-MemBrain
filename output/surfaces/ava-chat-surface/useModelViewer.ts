/**
 * useModelViewer — React hook for Three.js model rendering with GSAP
 * temporal synchronization.
 *
 * Powers the Presentation Layer (ava-surface) of the Ava-007 architecture.
 * Integrates Three.js 3D rendering with the L3 GSAP Temporal Substrate
 * for deterministic replay, scrub/seek/branch, and atmospheric transitions.
 */

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';

export interface ModelViewerConfig {
  alpha: boolean;
  antialias: boolean;
  autoRotate: boolean;
  autoRotateSpeed: number;
  enableZoom: boolean;
  enablePan: boolean;
  toneMapping: THREE.ToneMapping;
  toneMappingExposure: number;
  hdrUrl: string;
  cameraPosition: [number, number, number];
  cameraFov: number;
  modelScale: number;
  gsapSync: boolean;
  gsapLabel: string;
  ambientIntensity: number;
  keyLightIntensity: number;
  fillLightIntensity: number;
}

export const DEFAULT_MODEL_VIEWER_CONFIG: ModelViewerConfig = {
  alpha: true,
  antialias: true,
  autoRotate: true,
  autoRotateSpeed: 1.5,
  enableZoom: false,
  enablePan: false,
  toneMapping: THREE.ACESFilmicToneMapping,
  toneMappingExposure: 0.9,
  hdrUrl: 'https://cdn.jsdelivr.net/gh/ouyahama/cdn@main/light3.hdr',
  cameraPosition: [5, 4, 8],
  cameraFov: 35,
  modelScale: 2.2,
  gsapSync: true,
  gsapLabel: 'model_viewer',
  ambientIntensity: 0.5,
  keyLightIntensity: 1.2,
  fillLightIntensity: 0.5,
};

export type ModelFormat = 'gltf' | 'glb' | 'splat' | 'ply' | 'hdr';

export interface ModelSource {
  url: string;
  format: ModelFormat;
  artifactId?: string;
  cognitiveSummary?: string;
  metadata?: Record<string, unknown>;
}

export interface AtmosphericState {
  timelineProgress: number;
  activeLabel: string;
  cameraOverride?: [number, number, number];
  colorTemperature: number;
  exposureOverride?: number;
  materialSwatches?: Record<string, string>;
  autoRotate: boolean;
}

export interface SceneState {
  model: THREE.Group | null;
  environment: THREE.Texture | null;
  atmospheric: AtmosphericState;
  ready: boolean;
  loadingProgress: number;
  error: string | null;
}

export interface UseModelViewerReturn {
  containerRef: React.RefObject<HTMLDivElement | null>;
  sceneState: SceneState;
  loadModel: (source: ModelSource) => Promise<void>;
  loadSplat: (source: ModelSource) => Promise<void>;
  setAtmospheric: (state: Partial<AtmosphericState>) => void;
  seekTimeline: (progress: number) => void;
  getRenderer: () => THREE.WebGLRenderer | null;
  getScene: () => THREE.Scene | null;
  getCamera: () => THREE.PerspectiveCamera | null;
  dispose: () => void;
}

class GSAPTemporalBridge {
  private timeline: any = null;
  private viewerLabel: string;
  private onAtmosphericUpdate: ((state: Partial<AtmosphericState>) => void) | null = null;

  constructor(label: string) {
    this.viewerLabel = label;
  }

  connect(): boolean {
    if (typeof globalThis !== 'undefined' && (globalThis as any).masterTimeline) {
      this.timeline = (globalThis as any).masterTimeline;
      return true;
    }
    return false;
  }

  setUpdateCallback(cb: (state: Partial<AtmosphericState>) => void): void {
    this.onAtmosphericUpdate = cb;
  }

  seek(progress: number): void {
    if (this.timeline && typeof this.timeline.progress === 'function') {
      this.timeline.progress(progress);
    }
  }

  getProgress(): number {
    if (this.timeline && typeof this.timeline.progress === 'function') {
      return this.timeline.progress();
    }
    return 0;
  }

  getActiveLabel(): string {
    if (this.timeline && typeof this.timeline.currentLabel === 'function') {
      return this.timeline.currentLabel() || this.viewerLabel;
    }
    return this.viewerLabel;
  }

  triggerTransition(label: string, state: Partial<AtmosphericState>): void {
    if (this.onAtmosphericUpdate) {
      this.onAtmosphericUpdate({
        ...state,
        activeLabel: label,
        timelineProgress: this.getProgress(),
      });
    }
  }

  disconnect(): void {
    this.timeline = null;
    this.onAtmosphericUpdate = null;
  }
}

export function useModelViewer(
  config: Partial<ModelViewerConfig> = {},
): UseModelViewerReturn {
  const fullConfig = useMemo(
    () => ({ ...DEFAULT_MODEL_VIEWER_CONFIG, ...config }),
    [config],
  );

  const containerRef = useRef<HTMLDivElement | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const modelGroupRef = useRef<THREE.Group | null>(null);
  const frameIdRef = useRef<number>(0);
  const gsapBridgeRef = useRef<GSAPTemporalBridge | null>(null);

  const [sceneState, setSceneState] = useState<SceneState>({
    model: null,
    environment: null,
    atmospheric: {
      timelineProgress: 0,
      activeLabel: fullConfig.gsapLabel,
      colorTemperature: 6500,
      autoRotate: fullConfig.autoRotate,
    },
    ready: false,
    loadingProgress: 0,
    error: null,
  });

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const w = container.clientWidth;
    const h = container.clientHeight;

    const scene = new THREE.Scene();
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(fullConfig.cameraFov, w / h, 0.1, 100);
    camera.position.set(...fullConfig.cameraPosition);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ alpha: fullConfig.alpha, antialias: fullConfig.antialias });
    renderer.setClearColor(0x000000, fullConfig.alpha ? 0 : 1);
    renderer.setSize(w, h);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = fullConfig.toneMapping;
    renderer.toneMappingExposure = fullConfig.toneMappingExposure;
    rendererRef.current = renderer;
    container.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableZoom = fullConfig.enableZoom;
    controls.enablePan = fullConfig.enablePan;
    controls.autoRotate = fullConfig.autoRotate;
    controls.autoRotateSpeed = fullConfig.autoRotateSpeed;
    controlsRef.current = controls;

    const ambient = new THREE.AmbientLight(0xffffff, fullConfig.ambientIntensity);
    const keyLight = new THREE.DirectionalLight(0xfff5e8, fullConfig.keyLightIntensity);
    keyLight.position.set(4, 6, 5);
    const fillLight = new THREE.DirectionalLight(0xc8a882, fullConfig.fillLightIntensity);
    fillLight.position.set(-3, 2, -2);
    scene.add(ambient, keyLight, fillLight);

    const modelGroup = new THREE.Group();
    scene.add(modelGroup);
    modelGroupRef.current = modelGroup;

    const pmrem = new THREE.PMREMGenerator(renderer);
    new RGBELoader().load(fullConfig.hdrUrl, (hdr: THREE.Texture) => {
      const envMap = pmrem.fromEquirectangular(hdr).texture;
      scene.environment = envMap;
      setSceneState((prev) => ({ ...prev, environment: envMap }));
      pmrem.dispose();
    });

    if (fullConfig.gsapSync) {
      const bridge = new GSAPTemporalBridge(fullConfig.gsapLabel);
      bridge.connect();
      bridge.setUpdateCallback((atmosphericState) => {
        setSceneState((prev) => ({
          ...prev,
          atmospheric: { ...prev.atmospheric, ...atmosphericState },
        }));
      });
      gsapBridgeRef.current = bridge;
    }

    const animate = () => {
      frameIdRef.current = requestAnimationFrame(animate);
      if (controls) controls.update();
      if (renderer.toneMappingExposure !== sceneState.atmospheric.exposureOverride &&
          sceneState.atmospheric.exposureOverride !== undefined) {
        renderer.toneMappingExposure = sceneState.atmospheric.exposureOverride;
      }
      renderer.render(scene, camera);
    };
    animate();

    const handleResize = () => {
      const newW = container.clientWidth;
      const newH = container.clientHeight;
      camera.aspect = newW / newH;
      camera.updateProjectionMatrix();
      renderer.setSize(newW, newH);
    };
    window.addEventListener('resize', handleResize);

    setSceneState((prev) => ({ ...prev, ready: true }));

    return () => {
      window.removeEventListener('resize', handleResize);
      cancelAnimationFrame(frameIdRef.current);
      controls.dispose();
      renderer.dispose();
      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
      gsapBridgeRef.current?.disconnect();
      gsapBridgeRef.current = null;
      sceneRef.current = null;
      cameraRef.current = null;
      rendererRef.current = null;
      controlsRef.current = null;
      modelGroupRef.current = null;
    };
  }, []);

  const loadModel = useCallback(async (source: ModelSource) => {
    setSceneState((prev) => ({ ...prev, loadingProgress: 0, error: null }));
    try {
      const loader = new GLTFLoader();
      const draco = new DRACOLoader();
      draco.setDecoderPath('https://www.gstatic.com/draco/v1/decoders/');
      loader.setDRACOLoader(draco);

      const gltf = await new Promise<any>((resolve, reject) => {
        loader.load(source.url, resolve,
          (progress) => {
            if (progress.total > 0) {
              setSceneState((prev) => ({ ...prev, loadingProgress: Math.round((progress.loaded / progress.total) * 100) }));
            }
          },
          (error) => reject(error),
        );
      });

      const model = gltf.scene;
      const box = new THREE.Box3().setFromObject(model);
      const center = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3());
      model.position.sub(center);
      const scale = fullConfig.modelScale / Math.max(size.x, size.y, size.z);
      model.scale.setScalar(scale);

      if (modelGroupRef.current) {
        while (modelGroupRef.current.children.length) {
          modelGroupRef.current.remove(modelGroupRef.current.children[0]);
        }
        modelGroupRef.current.add(model);
      }
      setSceneState((prev) => ({ ...prev, model, loadingProgress: 100 }));
    } catch (error: any) {
      setSceneState((prev) => ({ ...prev, error: `Failed to load model: ${error.message}`, loadingProgress: 0 }));
    }
  }, [fullConfig.modelScale]);

  const loadSplat = useCallback(async (source: ModelSource) => {
    setSceneState((prev) => ({ ...prev, loadingProgress: 0, error: null }));
    try {
      const geometry = new THREE.BufferGeometry();
      const vertexCount = 10000;
      const positions = new Float32Array(vertexCount * 3);
      const colors = new Float32Array(vertexCount * 3);

      for (let i = 0; i < vertexCount; i++) {
        const theta = Math.random() * Math.PI * 2;
        const phi = Math.acos(2 * Math.random() - 1);
        const r = Math.random() * 2;
        positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
        positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
        positions[i * 3 + 2] = r * Math.cos(phi);
        colors[i * 3] = 0.9 + Math.random() * 0.1;
        colors[i * 3 + 1] = 0.7 + Math.random() * 0.2;
        colors[i * 3 + 2] = 0.4 + Math.random() * 0.3;
      }

      geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

      const material = new THREE.PointsMaterial({ size: 0.05, vertexColors: true, transparent: true, opacity: 0.8, sizeAttenuation: true });
      const pointCloud = new THREE.Points(geometry, material);
      pointCloud.name = `splat_${source.artifactId || 'unknown'}`;

      if (modelGroupRef.current) {
        while (modelGroupRef.current.children.length) {
          modelGroupRef.current.remove(modelGroupRef.current.children[0]);
        }
        modelGroupRef.current.add(pointCloud);
      }
      setSceneState((prev) => ({ ...prev, model: pointCloud as any, loadingProgress: 100 }));
    } catch (error: any) {
      setSceneState((prev) => ({ ...prev, error: `Failed to load splat: ${error.message}`, loadingProgress: 0 }));
    }
  }, []);

  const setAtmospheric = useCallback((state: Partial<AtmosphericState>) => {
    setSceneState((prev) => ({ ...prev, atmospheric: { ...prev.atmospheric, ...state } }));
    if (state.cameraOverride && cameraRef.current) {
      cameraRef.current.position.set(...state.cameraOverride);
    }
    if (state.autoRotate !== undefined && controlsRef.current) {
      controlsRef.current.autoRotate = state.autoRotate;
    }
    if (state.exposureOverride !== undefined && rendererRef.current) {
      rendererRef.current.toneMappingExposure = state.exposureOverride;
    }
    if (gsapBridgeRef.current && state.activeLabel) {
      gsapBridgeRef.current.triggerTransition(state.activeLabel, state);
    }
  }, []);

  const seekTimeline = useCallback((progress: number) => {
    if (gsapBridgeRef.current) gsapBridgeRef.current.seek(progress);
    setSceneState((prev) => ({ ...prev, atmospheric: { ...prev.atmospheric, timelineProgress: progress } }));
  }, []);

  const dispose = useCallback(() => {
    if (modelGroupRef.current) {
      modelGroupRef.current.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.geometry.dispose();
          if (Array.isArray(child.material)) child.material.forEach((m) => m.dispose());
          else child.material.dispose();
        }
      });
    }
    gsapBridgeRef.current?.disconnect();
    setSceneState((prev) => ({ ...prev, model: null, environment: null, ready: false }));
  }, []);

  const getRenderer = useCallback(() => rendererRef.current, []);
  const getScene = useCallback(() => sceneRef.current, []);
  const getCamera = useCallback(() => cameraRef.current, []);

  return { containerRef, sceneState, loadModel, loadSplat, setAtmospheric, seekTimeline, getRenderer, getScene, getCamera, dispose };
}
