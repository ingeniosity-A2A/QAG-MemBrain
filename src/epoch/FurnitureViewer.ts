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

export class FurnitureViewer {
  private threeModule: typeof import('three') | null = null;
  private scene: unknown = null;
  private camera: unknown = null;
  private renderer: unknown = null;
  private activeModels: Map<string, unknown> = new Map();

  async init(opts: SceneInit): Promise<void> {
    this.threeModule = await import('three');
    const THREE = this.threeModule;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(opts.backgroundColor ?? 0x0a0a0a);
    this.camera = new THREE.PerspectiveCamera(60, opts.width / opts.height, 0.1, 1000);
    if (opts.cameraPos) {
      (this.camera as { position: { set: (x:number,y:number,z:number)=>void } }).position.set(...opts.cameraPos);
    } else {
      (this.camera as { position: { set: (x:number,y:number,z:number)=>void } }).position.set(0, 5, 10);
    }
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    (this.renderer as { setSize: (w:number,h:number)=>void; domElement: HTMLCanvasElement }).setSize(opts.width, opts.height);
    opts.container.appendChild((this.renderer as { domElement: HTMLCanvasElement }).domElement);
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
    (this.scene as { add: (o: unknown) => void }).add(mesh);
    this.activeModels.set(model.id, mesh);
  }

  /** Remove a model by ID. */
  removeModel(id: string): void {
    const mesh = this.activeModels.get(id);
    if (mesh) {
      // Real impl would dispose geometry + material
      (this.scene as { remove: (o: unknown) => void }).remove(mesh);
      this.activeModels.delete(id);
    }
  }

  /** Render a single frame. */
  render(): void {
    if (!this.renderer || !this.scene || !this.camera) return;
    (this.renderer as { render: (s: unknown, c: unknown) => void }).render(this.scene, this.camera);
  }

  /** Resize the viewport. */
  resize(width: number, height: number): void {
    if (!this.renderer || !this.camera) return;
    (this.renderer as { setSize: (w:number,h:number)=>void }).setSize(width, height);
    (this.camera as { aspect: number; updateProjectionMatrix: () => void }).aspect = width / height;
    (this.camera as { aspect: number; updateProjectionMatrix: () => void }).updateProjectionMatrix();
  }

  /** Clean up — release WebGL resources. */
  dispose(): void {
    if (this.renderer) {
      (this.renderer as { dispose: () => void }).dispose();
      this.renderer = null;
    }
    this.scene = null;
    this.camera = null;
    this.activeModels.clear();
  }
}
