export interface MemoryRecord {
  id: string;
  type: 'working' | 'episodic' | 'semantic' | 'operational' | 'consensus' | 'archive';
  content: string;
  timestamp: number;
  metadata?: Record<string, unknown>;
}

export interface MemoryEntity {
  id: string;
  type: 'customer' | 'technician' | 'product' | 'location' | 'tool';
  name: string;
  attributes?: Record<string, unknown>;
}

export class JsonLStore {
  private records: MemoryRecord[] = [];
  private index: Map<string, MemoryRecord> = new Map();

  addRecord(record: MemoryRecord): void {
    this.records.push(record);
    this.index.set(record.id, record);
  }

  getRecord(id: string): MemoryRecord | undefined {
    return this.index.get(id);
  }

  getAllRecords(): MemoryRecord[] {
    return [...this.records];
  }

  append(memoryClass: number, contentType: string, atom: unknown): void {
    const record: MemoryRecord = {
      id: `mem_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      type: memoryClass === 6 ? 'archive' : 'working',
      content: JSON.stringify(atom),
      timestamp: Date.now(),
    };
    this.addRecord(record);
  }
}

export class MemoryStore extends JsonLStore {
  constructor(private dir: string, private filename: string) {
    super();
  }

  append(memoryClass: number, contentType: string, atom: any): void {
    const record: MemoryRecord = {
      id: `${this.dir}/${this.filename}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      type: memoryClass === 6 ? 'archive' : 'working',
      content: JSON.stringify(atom),
      timestamp: Date.now(),
    };
    this.addRecord(record);
  }
}

export type MemoryStoreClass = typeof JsonLStore;

export const jsonlStore = new JsonLStore();
export { hash, computeRecordHash } from './hash.js';

// Simple query function for JSONL files
export async function* query(filePath: string): AsyncIterableIterator<any> {
  const fs = await import('fs');
  const readline = await import('readline');
  
  const fileStream = fs.createReadStream(filePath);
  const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });
  
  for await (const line of rl) {
    if (line.trim()) {
      try {
        yield JSON.parse(line);
      } catch {
        // Skip invalid lines
      }
    }
  }
}
