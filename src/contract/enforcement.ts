import { DepthExceededError, enforceMaxDepth } from '@graph/neo4j/index.js';
import { WriteDeniedError } from '@subconscious/index.js';

const AUTHORITY_MATRIX: Record<number, Record<number, string[]>> = {
  1: { 1: ['read', 'write'], 2: ['read'], 3: ['read'], 4: ['read'], 5: ['read'], 6: ['read'] },
  2: { 1: ['write'], 2: ['read', 'write'], 3: ['read'], 4: ['read'], 5: ['read'], 6: ['read'] },
  3: { 1: ['read'], 2: ['read'], 3: ['read'], 4: ['read'], 5: ['read'], 6: ['read'] },
  4: { 1: ['read', 'write'], 2: ['read'], 3: ['read'], 4: ['read', 'write'], 5: ['read'], 6: ['read'] },
  5: { 1: ['read'], 2: ['read'], 3: ['read'], 4: ['read'], 5: ['read'], 6: ['read'] },
  6: { 1: ['read', 'write'], 2: ['read', 'write'], 3: ['read', 'write'], 4: ['read', 'write'], 5: ['read'], 6: ['read', 'write', 'decide', 'execute'] },
};

export class AuthorityViolationError extends Error {
  constructor(public readonly req: { sourceLayer: number; targetLayer: number; action: string }) {
    super(`Authority violation: L${req.sourceLayer} cannot ${req.action} on L${req.targetLayer}`);
    this.name = 'AuthorityViolationError';
  }
}

export function enforceAuthority(req: { sourceLayer: number; targetLayer: number; action: string }): void {
  const allowed = AUTHORITY_MATRIX[req.sourceLayer]?.[req.targetLayer];
  if (!allowed || !allowed.includes(req.action)) {
    throw new AuthorityViolationError(req);
  }
}

export function isPermitted(req: { sourceLayer: number; targetLayer: number; action: string }): boolean {
  const allowed = AUTHORITY_MATRIX[req.sourceLayer]?.[req.targetLayer];
  return !!allowed && allowed.includes(req.action);
}

export function assertCanWrite(layer: string): void {
  // For now, allow all writes; authority enforcement can be added later
  return;
}

export { DepthExceededError, WriteDeniedError, enforceMaxDepth };