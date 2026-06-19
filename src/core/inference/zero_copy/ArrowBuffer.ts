import { SharedTensor, SharedTensorManager, TensorMetadata } from './SharedTensor.js';

export interface ArrowField {
  name: string;
  type: 'float32' | 'int32' | 'uint8' | 'utf8' | 'bool';
  nullable: boolean;
  children?: ArrowField[];
}

export interface ArrowSchema {
  fields: ArrowField[];
  metadata?: Map<string, string>;
}

export interface ArrowRecordBatch {
  schema: ArrowSchema;
  columns: Map<string, SharedTensor>;
  length: number;
}

export class ArrowBuffer {
  private manager: SharedTensorManager;
  private batches: Map<string, ArrowRecordBatch> = new Map();

  constructor(manager: SharedTensorManager = sharedTensorManager) {
    this.manager = manager;
  }

  createBatch(id: string, schema: ArrowSchema, length: number): ArrowRecordBatch {
    const columns = new Map<string, SharedTensor>();

    for (const field of schema.fields) {
      const tensorId = `${id}_${field.name}`;
      const tensor = this.manager.allocate(tensorId, [length], field.type as 'float32' | 'int32' | 'uint8');
      columns.set(field.name, tensor);
    }

    const batch: ArrowRecordBatch = {
      schema,
      columns,
      length,
    };

    this.batches.set(id, batch);
    return batch;
  }

  getBatch(id: string): ArrowRecordBatch | undefined {
    return this.batches.get(id);
  }

  setValue(batchId: string, columnName: string, rowIndex: number, value: number | string | boolean): void {
    const batch = this.batches.get(batchId);
    if (!batch) throw new Error(`Batch ${batchId} not found`);

    const tensor = batch.columns.get(columnName);
    if (!tensor) throw new Error(`Column ${columnName} not found in batch ${batchId}`);

    const view = tensor.view;
    if (typeof value === 'number') {
      view[rowIndex] = value;
    } else if (typeof value === 'string') {
      const encoder = new TextEncoder();
      const encoded = encoder.encode(value);
      const uint8View = new Uint8Array(view.buffer, view.byteOffset + rowIndex * 4, encoded.length);
      uint8View.set(encoded);
    } else if (typeof value === 'boolean') {
      view[rowIndex] = value ? 1 : 0;
    }
  }

  getValue(batchId: string, columnName: string, rowIndex: number): number | string | boolean | undefined {
    const batch = this.batches.get(batchId);
    if (!batch) return undefined;

    const tensor = batch.columns.get(columnName);
    if (!tensor) return undefined;

    const view = tensor.view;
    const field = batch.schema.fields.find(f => f.name === columnName);
    
    if (!field) return undefined;

    if (field.type === 'utf8') {
      const uint8View = new Uint8Array(view.buffer, view.byteOffset + rowIndex * 4);
      const decoder = new TextDecoder();
      return decoder.decode(uint8View.subarray(0, uint8View.indexOf(0) ?? uint8View.length));
    } else if (field.type === 'bool') {
      return view[rowIndex] !== 0;
    }
    
    return view[rowIndex];
  }

  toContextBuffer(batchId: string): ContextBuffer {
    const batch = this.batches.get(batchId);
    if (!batch) throw new Error(`Batch ${batchId} not found`);

    const getColumnData = (name: string): Uint32Array => {
      const tensor = batch.columns.get(name);
      if (!tensor) return new Uint32Array(0);
      return new Uint32Array(tensor.view.buffer);
    };

    return {
      objective: getColumnData('objective'),
      memoryRefs: getColumnData('memory_refs'),
      graphRefs: getColumnData('graph_refs'),
      policyRefs: getColumnData('policy_refs'),
      toolRefs: getColumnData('tool_refs'),
    };
  }

  releaseBatch(id: string): void {
    const batch = this.batches.get(id);
    if (batch) {
      for (const [, tensor] of batch.columns) {
        this.manager.release(`${id}_${tensor.shape[0]}`);
      }
    }
    this.batches.delete(id);
  }

  getAllBatches(): ArrowRecordBatch[] {
    return Array.from(this.batches.values());
  }
}

export interface ContextBuffer {
  objective: Uint32Array;
  memoryRefs: Uint32Array;
  graphRefs: Uint32Array;
  policyRefs: Uint32Array;
  toolRefs: Uint32Array;
}

export const arrowBuffer = new ArrowBuffer();