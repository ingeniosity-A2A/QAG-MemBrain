import { DepthExceededError, enforceMaxDepth } from '../../memory/graph/neo4j/index.js';
import { WriteDeniedError } from '../../memory/subconscious/index.js';

export type Layer = 1 | 2 | 3 | 4 | 5 | 6;

export interface AuthorityRequest {
  sourceLayer: Layer;
  targetLayer: Layer;
  action: 'read' | 'write' | 'decide' | 'execute';
}

const AUTHORITY_MATRIX: Record<Layer, Partial<Record<Layer, AuthorityRequest['action'][]>>> = {
  1: { 1: ['read', 'write'], 2: ['read'], 3: ['read'], 4: ['read'], 5: ['read'], 6: ['read'] },
  2: { 1: ['write'], 2: ['read', 'write'], 3: ['read'], 4: ['read'], 5: ['read'], 6: ['read'] },
  3: { 1: ['read'], 2: ['read'], 3: ['read'], 4: ['read'], 5: ['read'], 6: ['read'] },
  4: { 1: ['read', 'write'], 2: ['read'], 3: ['read'], 4: ['read', 'write'], 5: ['read'], 6: ['read'] },
  5: { 1: ['read'], 2: ['read'], 3: ['read'], 4: ['read'], 5: ['read'], 6: ['read'] },
  6: { 1: ['read', 'write'], 2: ['read', 'write'], 3: ['read', 'write'], 4: ['read', 'write'], 5: ['read'], 6: ['read', 'write', 'decide', 'execute'] },
};

export class AuthorityViolationError extends Error {
  constructor(req: AuthorityRequest) {
    super(`Authority violation: L${req.sourceLayer} cannot ${req.action} on L${req.targetLayer}`);
    this.name = 'AuthorityViolationError';
  }
}

export function enforceAuthority(req: AuthorityRequest): void {
  const allowed = AUTHORITY_MATRIX[req.sourceLayer]?.[req.targetLayer];
  if (!allowed || !allowed.includes(req.action)) throw new AuthorityViolationError(req);
}

export function isPermitted(req: AuthorityRequest): boolean {
  const allowed = AUTHORITY_MATRIX[req.sourceLayer]?.[req.targetLayer];
  return !!allowed && allowed.includes(req.action);
}

export { DepthExceededError, WriteDeniedError, enforceMaxDepth };
