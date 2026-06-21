// Placeholder — Mobile Runtime pillar (Hexagon NPU bridge via QNN)
// Calls native QNNPlugin.kt through Capacitor
export interface NPUBridge {
  isAvailable(): Promise<boolean>;
  loadModel(modelPath: string): Promise<void>;
  infer(input: Float32Array): Promise<Float32Array>;
}

export class QNNNPUBridge implements NPUBridge {
  async isAvailable(): Promise<boolean> {
    // Calls QNNPlugin.kt via Capacitor — pending implementation
    return false;
  }
  async loadModel(_modelPath: string): Promise<void> {
    throw new Error('QNNNPUBridge.loadModel — not implemented (placeholder)');
  }
  async infer(_input: Float32Array): Promise<Float32Array> {
    throw new Error('QNNNPUBridge.infer — not implemented (placeholder)');
  }
}
