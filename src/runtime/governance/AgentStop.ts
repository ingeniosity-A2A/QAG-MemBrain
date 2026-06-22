import { GovernanceContract, GovernanceContext, GovernanceResult } from './GovernanceContract.js';

export interface SubAgentOutput {
  agentId: string;
  taskId: string;
  output: unknown;
  confidence: number;
  reasoning: string;
  timestamp: number;
}

export interface AgentStopResult {
  allowed: boolean;
  filteredOutput: unknown;
  violations: PolicyViolation[];
  auditEvent: AuditEvent;
}

export interface PolicyViolation {
  policyId: string;
  severity: 'critical' | 'warning' | 'info';
  message: string;
  agentId: string;
}

export interface AuditEvent {
  id: string;
  timestamp: number;
  authority: string;
  action: string;
  outcome: string;
  details: Record<string, unknown>;
}

export class AgentStop {
  private governanceContract: GovernanceContract;

  constructor(governanceContract: GovernanceContract) {
    this.governanceContract = governanceContract;
  }

  async intercept(agentOutput: SubAgentOutput, context: GovernanceContext): Promise<AgentStopResult> {
    const violations: PolicyViolation[] = [];
    
    if (agentOutput.confidence < 0.7) {
      violations.push({
        policyId: 'agent_confidence_threshold',
        severity: 'warning',
        message: `Agent ${agentOutput.agentId} confidence ${agentOutput.confidence} below threshold 0.7`,
        agentId: agentOutput.agentId,
      });
    }

    if (!this.validateOutputStructure(agentOutput)) {
      violations.push({
        policyId: 'agent_output_structure',
        severity: 'critical',
        message: `Agent ${agentOutput.agentId} output missing required fields`,
        agentId: agentOutput.agentId,
      });
    }

    const hasCriticalViolations = violations.some(v => v.severity === 'critical');
    const allowed = !hasCriticalViolations;

    const filteredOutput = this.filterOutput(agentOutput, context);
    
    const auditEvent: AuditEvent = {
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      authority: context.authorityState.activeAuthority,
      action: 'agent_stop_intercept',
      outcome: allowed ? 'passed' : 'blocked',
      details: {
        agentId: agentOutput.agentId,
        taskId: agentOutput.taskId,
        violations: violations.map(v => v.policyId),
        confidence: agentOutput.confidence,
      },
    };

    return {
      allowed,
      filteredOutput,
      violations,
      auditEvent,
    };
  }

  private validateOutputStructure(output: SubAgentOutput): boolean {
    return !!(
      output.agentId &&
      output.taskId &&
      output.output !== undefined &&
      typeof output.confidence === 'number' &&
      typeof output.reasoning === 'string' &&
      typeof output.timestamp === 'number'
    );
  }

  private filterOutput(output: SubAgentOutput, context: GovernanceContext): unknown {
    const allowedKeys = this.getAllowedOutputKeys(context);
    const filtered: Record<string, unknown> = {};

    if (typeof output.output === 'object' && output.output !== null) {
      for (const [key, value] of Object.entries(output.output)) {
        if (allowedKeys.includes(key) || allowedKeys.includes('*')) {
          filtered[key] = value;
        }
      }
    } else {
      filtered.result = output.output;
    }

    return filtered;
  }

  private getAllowedOutputKeys(context: GovernanceContext): string[] {
    const keys = ['result', 'decision', 'action', 'data', 'status'];
    
    for (const tool of context.toolDefinitions) {
      keys.push(tool.name);
    }

    return keys;
  }
}

export const agentStop = new AgentStop(governanceContract);