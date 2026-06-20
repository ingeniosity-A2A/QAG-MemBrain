export interface AuthorityState {
  activeAuthority: string;
  delegationChain: string[];
  permissions: string[];
  restrictions: string[];
}

export interface ContextNode {
  id: string;
  type: string;
  name?: string;
  attributes?: Record<string, unknown>;
  parentId?: string;
  children?: ContextNode[];
}

export interface TimelineEvent {
  id: string;
  timestamp: number;
  type: 'created' | 'activated' | 'modified' | 'consolidated' | 'archived' | 'replayed' | 'reconstructed';
  entityId: string;
  entityType: string;
  previousState?: Record<string, unknown>;
  newState: Record<string, unknown>;
  authority: string;
  correlationId?: string;
}

export interface AuditEvent {
  id: string;
  timestamp: number;
  authority: string;
  action: string;
  outcome: 'allowed' | 'denied' | 'blocked' | 'passed' | 'failed' | 'error';
  details: Record<string, unknown>;
  severity: 'critical' | 'warning' | 'info' | 'debug';
  correlationId?: string;
  causationId?: string;
}
