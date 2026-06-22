/**
 * FurnitureViewer — Three.js 3D scene viewer for AMOS.
 *
 * Renders 3D furniture / scene geometry for spatial reconstruction,
 * holographic replay, and AR-style overlays. Uses the Adreno GPU
 * for hardware-accelerated rendering.
 *
 * Real implementation requires `three` npm package. This module lazily
 * imports it.
 */

export interface SceneInit {
  /** Container element to mount the canvas in */
  container: HTMLElement;
  /** Width in pixels */
  width: number;
  /** Height in pixels */
  height: number;
  /** Optional camera position */
  cameraPos?: [number, number, number];
  /** Optional background color (hex) */
  backgroundColor?: number;
}

export interface FurnitureModel {
  id: string;
  /** glTF / GLB binary data URL or ArrayBuffer */
  data: string | ArrayBuffer;
  /** Position in scene */
  position?: [number, number, number];
  /** Rotation as Euler angles (radians) */
  rotation?: [number, number, number];
  /** Scale factor */
  scale?: number;
}


// Minimal Three.js interface for type-safety without requiring the three
// types at dev time. Real `three` module satisfies this interface.
interface ThreeLike {
  Scene: new () => ThreeSceneLike;
  Color: new (hex: number) => unknown;
  PerspectiveCamera: new (fov: number, aspect: number, near: number, far: number) => ThreeCameraLike;
  WebGLRenderer: new (opts: { antialias?: boolean; powerPreference?: string }) => ThreeRendererLike;
  BoxGeometry: new (w: number, h: number, d: number) => unknown;
  MeshStandardMaterial: new (opts: { color: number }) => unknown;
  Mesh: new (geo: unknown, mat: unknown) => ThreeMeshLike;
}

interface ThreeSceneLike {
  background: unknown;
  add(o: ThreeMeshLike): void;
  remove(o: ThreeMeshLike): void;
}

interface ThreeCameraLike {
  position: { set(x: number, y: number, z: number): void };
  aspect: number;
  updateProjectionMatrix(): void;
}

interface ThreeRendererLike {
  setSize(w: number, h: number): void;
  domElement: HTMLCanvasElement;
  render(scene: ThreeSceneLike, camera: ThreeCameraLike): void;
  dispose(): void;
}

interface ThreeMeshLike {
  position: { set(x: number, y: number, z: number): void };
  rotation: { set(x: number, y: number, z: number): void };
  scale: { setScalar(s: number): void };
}

export class FurnitureViewer {
  private threeModule: ThreeLike | null = null;
  private scene: ThreeSceneLike | null = null;
  private camera: ThreeCameraLike | null = null;
  private renderer: ThreeRendererLike | null = null;
  private activeModels: Map<string, ThreeMeshLike> = new Map();

  async init(opts: SceneInit): Promise<void> {
    // @ts-ignore — three is an optional peer dep; lazy-loaded at runtime
    this.threeModule = (await import('three')) as unknown as ThreeLike;
    const THREE = this.threeModule;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(opts.backgroundColor ?? 0x0a0a0a);
    this.camera = new THREE.PerspectiveCamera(60, opts.width / opts.height, 0.1, 1000);
    if (opts.cameraPos) {
      this.camera!.position.set(...opts.cameraPos);
    } else {
      this.camera!.position.set(0, 5, 10);
    }
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer!.setSize(opts.width, opts.height);
    opts.container.appendChild(this.renderer!.domElement);
  }

  /** Add a furniture model to the scene. */
  async addModel(model: FurnitureModel): Promise<void> {
    if (!this.threeModule || !this.scene) {
      throw new Error('FurnitureViewer not initialized — call init() first');
    }
    // Real impl would use GLTFLoader to parse model.data into a THREE.Object3D
    // For now, create a placeholder box
    const THREE = this.threeModule;
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    const material = new THREE.MeshStandardMaterial({ color: 0x88aaff });
    const mesh = new THREE.Mesh(geometry, material);
    if (model.position) mesh.position.set(...model.position);
    if (model.rotation) mesh.rotation.set(...model.rotation);
    if (model.scale) mesh.scale.setScalar(model.scale);
    this.scene!.add(mesh);
    this.activeModels.set(model.id, mesh);
  }

  /** Remove a model by ID. */
  removeModel(id: string): void {
    const mesh = this.activeModels.get(id);
    if (mesh) {
      // Real impl would dispose geometry + material
      this.scene!.remove(mesh);
      this.activeModels.delete(id);
    }
  }

  /** Render a single frame. */
  render(): void {
    if (!this.renderer || !this.scene || !this.camera) return;
    this.renderer!.render(this.scene!, this.camera!);
  }

  /** Resize the viewport. */
  resize(width: number, height: number): void {
    if (!this.renderer || !this.camera) return;
    this.renderer!.setSize(width, height);
    this.camera!.aspect = width / height;
    this.camera!.updateProjectionMatrix();
  }

  /** Clean up — release WebGL resources. */
  dispose(): void {
    if (this.renderer) {
      this.renderer!.dispose();
      this.renderer = null;
    }
    this.scene = null;
    this.camera = null;
    this.activeModels.clear();
  }
}
