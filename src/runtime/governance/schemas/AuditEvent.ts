export interface AuditEvent {
  id: string;
  timestamp: number;
  authority: string;
  action: string;
  outcome: 'allowed' | 'denied' | 'blocked' | 'passed' | 'failed' | 'error' | 'completed' | 'compressed' | 'success';
  details: Record<string, unknown>;
  severity: 'critical' | 'warning' | 'info' | 'debug';
  correlationId?: string;
  causationId?: string;
}

export interface PolicyViolationEvent extends AuditEvent {
  action: 'policy_violation';
  outcome: 'denied' | 'blocked';
  details: {
    policyId: string;
    violationType: string;
    message: string;
    severity: 'critical' | 'warning' | 'info';
    remediation?: string;
    contextHash: string;
  };
}

export interface AgentInterceptEvent extends AuditEvent {
  action: 'agent_stop_intercept';
  outcome: 'passed' | 'blocked';
  details: {
    agentId: string;
    taskId: string;
    confidence: number;
    violations: string[];
    filtered: boolean;
  };
}

export interface BoundaryEnforcementEvent extends AuditEvent {
  action: 'boundary_enforcement';
  outcome: 'allowed' | 'denied';
  details: {
    requesterId: string;
    resourceId: string;
    action: 'read' | 'write' | 'execute' | 'delete';
    denials: string[];
    restrictions: string[];
  };
}

export interface GovernanceEvaluationEvent extends AuditEvent {
  action: 'governance_evaluation';
  outcome: 'allowed' | 'denied';
  details: {
    authority: string;
    violations: string[];
    requiredActions: string[];
    contextHash: string;
  };
}

export interface ContextAssemblyEvent extends AuditEvent {
  action: 'context_assembly';
  outcome: 'completed' | 'compressed' | 'failed';
  details: {
    objective: string;
    tokenEstimate: number;
    maxTokens: number;
    compressed: boolean;
    sectionsIncluded: string[];
    sectionsCompressed: string[];
  };
}

export interface MemoryOperationEvent extends AuditEvent {
  action: 'memory_store' | 'memory_retrieve' | 'memory_consolidate' | 'memory_archive';
  outcome: 'success' | 'failed';
  details: {
    memoryClass: 'working' | 'episodic' | 'semantic' | 'operational' | 'consensus' | 'archive';
    recordId?: string;
    classification: string;
    retentionPolicy: string;
  };
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

export function createAuditEvent(
  authority: string,
  action: string,
  outcome: AuditEvent['outcome'],
  details: Record<string, unknown>,
  severity: AuditEvent['severity'] = 'info'
): AuditEvent {
  return {
    id: crypto.randomUUID(),
    timestamp: Date.now(),
    authority,
    action,
    outcome,
    details,
    severity,
  };
}