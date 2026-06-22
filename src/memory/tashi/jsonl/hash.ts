export function hash(data: string): string {
  // Simple hash implementation
  let hash = 0;
  for (let i = 0; i < data.length; i++) {
    const char = data.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return Math.abs(hash).toString(16);
}

export function computeRecordHash(record: { id: string; content: string; timestamp: number; type: string }): string {
  return hash(`${record.id}:${record.content}:${record.timestamp}:${record.type}`);
}
