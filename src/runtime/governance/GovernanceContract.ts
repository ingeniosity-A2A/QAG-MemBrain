export interface GovernancePolicy {
  id: string;
  name: string;
  version: string;
  evaluate: (context: GovernanceContext) => GovernanceResult;
}

export interface GovernanceContext {
  objective: string;
  contextNodes: ContextNode[];
  memorySummary: string;
  toolDefinitions: ToolDefinition[];
  applicablePolicies: GovernancePolicy[];
  authorityState: AuthorityState;
  timeline: TimelineEvent[];
}

export interface GovernanceResult {
  allowed: boolean;
  decision: GovernanceDecision;
  violations: PolicyViolation[];
  requiredActions: RequiredAction[];
  contextUpdates: ContextUpdate[];
  auditEvent: AuditEvent;
}

export interface GovernanceDecision {
  action: string;
  authority: string;
  rationale: string;
  confidence: number;
  timestamp: number;
}

export interface PolicyViolation {
  policyId: string;
  severity: 'critical' | 'warning' | 'info';
  message: string;
  remediation?: string;
}

export interface RequiredAction {
  type: 'compress' | 'retrieve' | 'escalate' | 'terminate' | 'confirm';
  target: string;
  reason: string;
}

export interface ContextUpdate {
  nodeId: string;
  updates: Partial<ContextNode>;
  source: string;
}

export interface AuthorityState {
  activeAuthority: string;
  delegationChain: string[];
  permissions: string[];
  restrictions: string[];
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  requiredAuthority: string;
  category: string;
}

export class GovernanceContract {
  private policies: Map<string, GovernancePolicy> = new Map();
  private auditLog: AuditEvent[] = [];

  registerPolicy(policy: GovernancePolicy): void {
    this.policies.set(policy.id, policy);
  }

  async evaluate(context: GovernanceContext): Promise<GovernanceResult> {
    const violations: PolicyViolation[] = [];
    const requiredActions: RequiredAction[] = [];
    const contextUpdates: ContextUpdate[] = [];
    let allowed = true;

    for (const policy of this.policies.values()) {
      const result = policy.evaluate(context);
      
      if (!result.allowed) {
        allowed = false;
      }
      
      violations.push(...result.violations);
      requiredActions.push(...result.requiredActions);
      contextUpdates.push(...result.contextUpdates);
    }

    const auditEvent: AuditEvent = {
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      authority: context.authorityState.activeAuthority,
      action: 'governance_evaluation',
      outcome: allowed ? 'allowed' : 'denied',
      violations: violations.map(v => v.policyId),
      contextHash: this.hashContext(context),
    };

    this.auditLog.push(auditEvent);

    return {
      allowed,
      decision: {
        action: allowed ? 'proceed' : 'block',
        authority: context.authorityState.activeAuthority,
        rationale: allowed 
          ? 'All governance policies satisfied'
          : `Policy violations: ${violations.map(v => v.message).join('; ')}`,
        confidence: allowed ? 1.0 : 0.0,
        timestamp: Date.now(),
      },
      violations,
      requiredActions,
      contextUpdates,
      auditEvent,
    };
  }

  getAuditLog(): AuditEvent[] {
    return [...this.auditLog];
  }

  private hashContext(context: GovernanceContext): string {
    const data = JSON.stringify({
      objective: context.objective,
      nodeCount: context.contextNodes.length,
      memoryLength: context.memorySummary.length,
      toolCount: context.toolDefinitions.length,
      policyCount: context.applicablePolicies.length,
    });
    
    let hash = 0;
    for (let i = 0; i < data.length; i++) {
      hash = ((hash << 5) - hash) + data.charCodeAt(i);
      hash |= 0;
    }
    return hash.toString(16);
  }
}

export const governanceContract = new GovernanceContract();