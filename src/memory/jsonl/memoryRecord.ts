export interface MemoryRecord {
  id: string;
  type: 'working' | 'episodic' | 'semantic' | 'operational' | 'consensus' | 'archive';
  content: string;
  timestamp: number;
  metadata?: Record<string, unknown>;
}
