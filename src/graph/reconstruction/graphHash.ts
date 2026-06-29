export function graphHash(graphData: any): string {
  let hash = 0;
  const jsonStr = JSON.stringify(graphData);
  for (let i = 0; i < jsonStr.length; i++) {
    const char = jsonStr.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(16);
}

export function jsonlGraphProjection(jsonlPath: string, repository: any): Promise<any> {
  return Promise.resolve({
    nodes: [],
    relationships: [],
  });
}
