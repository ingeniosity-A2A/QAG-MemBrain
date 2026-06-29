export interface SharedTensor {
  buffer: SharedArrayBuffer;
  view: Float32Array | Int32Array | Uint8Array;
  shape: number[];
  dtype: 'float32' | 'int32' | 'uint8';
  offset: number;
  length: number;
}

export interface TensorMetadata {
  id: string;
  name: string;
  shape: number[];
  dtype: 'float32' | 'int32' | 'uint8';
  byteLength: number;
  createdAt: number;
  lastAccessed: number;
  accessCount: number;
}

export class SharedTensorManager {
  private pool: Map<string, SharedTensor> = new Map();
  private metadata: Map<string, TensorMetadata> = new Map();
  private totalAllocated = 0;
  private maxPoolSize: number;

  constructor(maxPoolSizeMB = 256) {
    this.maxPoolSize = maxPoolSizeMB * 1024 * 1024;
  }

  allocate(id: string, shape: number[], dtype: 'float32' | 'int32' | 'uint8' = 'float32'): SharedTensor {
    const elementSize = dtype === 'float32' ? 4 : dtype === 'int32' ? 4 : 1;
    const length = shape.reduce((a, b) => a * b, 1);
    const byteLength = length * elementSize;

    if (this.totalAllocated + byteLength > this.maxPoolSize) {
      this.evictLRU(byteLength);
    }

    const buffer = new SharedArrayBuffer(byteLength);
    let view: Float32Array | Int32Array | Uint8Array;

    switch (dtype) {
      case 'float32':
        view = new Float32Array(buffer);
        break;
      case 'int32':
        view = new Int32Array(buffer);
        break;
      case 'uint8':
        view = new Uint8Array(buffer);
        break;
    }

    const tensor: SharedTensor = {
      buffer,
      view,
      shape,
      dtype,
      offset: 0,
      length: byteLength,
    };

    this.pool.set(id, tensor);
    this.metadata.set(id, {
      id,
      name: id,
      shape,
      dtype,
      byteLength,
      createdAt: Date.now(),
      lastAccessed: Date.now(),
      accessCount: 0,
    });
    this.totalAllocated += byteLength;

    return tensor;
  }

  get(id: string): SharedTensor | undefined {
    const tensor = this.pool.get(id);
    if (tensor) {
      const meta = this.metadata.get(id);
      if (meta) {
        meta.lastAccessed = Date.now();
        meta.accessCount++;
      }
    }
    return tensor;
  }

  release(id: string): void {
    const meta = this.metadata.get(id);
    if (meta) {
      this.totalAllocated -= meta.byteLength;
      this.metadata.delete(id);
    }
    this.pool.delete(id);
  }

  has(id: string): boolean {
    return this.pool.has(id);
  }

  getMetadata(id: string): TensorMetadata | undefined {
    return this.metadata.get(id);
  }

  getAllMetadata(): TensorMetadata[] {
    return Array.from(this.metadata.values());
  }

  getPoolStats(): { allocated: number; max: number; count: number; tensors: TensorMetadata[] } {
    return {
      allocated: this.totalAllocated,
      max: this.maxPoolSize,
      count: this.pool.size,
      tensors: this.getAllMetadata(),
    };
  }

  private evictLRU(requiredBytes: number): void {
    const sorted = Array.from(this.metadata.values()).sort((a, b) => a.lastAccessed - b.lastAccessed);
    
    let freed = 0;
    for (const meta of sorted) {
      if (freed >= requiredBytes) break;
      this.release(meta.id);
      freed += meta.byteLength;
    }
  }

  clear(): void {
    this.pool.clear();
    this.metadata.clear();
    this.totalAllocated = 0;
  }
}

export const sharedTensorManager = new SharedTensorManager();