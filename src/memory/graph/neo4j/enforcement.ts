import { MemoryStore } from '../../jsonl/index.js';

const MAX_DEPTH = 5;

export class DepthExceededError extends Error {
  constructor(depth: number) {
    super(`Graph traversal depth ${depth} exceeds maximum allowed depth ${MAX_DEPTH}`);
    this.name = 'DepthExceededError';
  }
}

export interface GraphNode { id: string; label: string; properties: Record<string, unknown>; }
export interface GraphEdge { id: string; source: string; target: string; type: string; properties: Record<string, unknown>; }
export interface TraversalResult { nodes: GraphNode[]; edges: GraphEdge[]; depth: number; }

export function enforceMaxDepth(depth: number): void {
  if (depth > MAX_DEPTH) throw new DepthExceededError(depth);
}

export class GraphStore {
  private nodes: Map<string, GraphNode> = new Map();
  private edges: Map<string, GraphEdge> = new Map();
  private adjacency: Map<string, string[]> = new Map();

  constructor(private memory: MemoryStore) {}

  addNode(node: GraphNode): GraphNode {
    this.nodes.set(node.id, node);
    if (!this.adjacency.has(node.id)) this.adjacency.set(node.id, []);
    this.memory.append(4, 'node_added', { id: node.id, label: node.label });
    return node;
  }

  addEdge(edge: GraphEdge): GraphEdge {
    if (!this.nodes.has(edge.source) || !this.nodes.has(edge.target))
      throw new Error(`Edge references non-existent node: ${edge.source} -> ${edge.target}`);
    this.edges.set(edge.id, edge);
    this.adjacency.get(edge.source)!.push(edge.id);
    this.memory.append(4, 'edge_added', { id: edge.id, source: edge.source, target: edge.target, type: edge.type });
    return edge;
  }

  traverse(startId: string, maxDepth: number = MAX_DEPTH): TraversalResult {
    enforceMaxDepth(maxDepth);
    const visited = new Set<string>();
    const resultNodes: GraphNode[] = [];
    const resultEdges: GraphEdge[] = [];
    const queue: Array<{ id: string; depth: number }> = [{ id: startId, depth: 0 }];
    while (queue.length > 0) {
      const { id, depth } = queue.shift()!;
      if (visited.has(id) || depth > maxDepth) continue;
      visited.add(id);
      const node = this.nodes.get(id);
      if (node) resultNodes.push(node);
      for (const eid of (this.adjacency.get(id) || [])) {
        const edge = this.edges.get(eid);
        if (edge) {
          resultEdges.push(edge);
          queue.push({ id: edge.source === id ? edge.target : edge.source, depth: depth + 1 });
        }
      }
    }
    return { nodes: resultNodes, edges: resultEdges, depth: maxDepth };
  }

  getNode(id: string): GraphNode | undefined { return this.nodes.get(id); }
  queryByLabel(label: string): GraphNode[] { return Array.from(this.nodes.values()).filter(n => n.label === label); }
}
