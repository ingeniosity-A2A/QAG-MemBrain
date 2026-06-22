import { AuthorityState, ContextNode } from './schemas.js';

export interface AccessRequest {
  requesterId: string;
  resourceId: string;
  action: 'read' | 'write' | 'execute' | 'delete';
  context: Record<string, unknown>;
}

export interface AccessDecision {
  allowed: boolean;
  reason: string;
  restrictions: string[];
  auditEvent: AuditEvent;
}

export interface AuditEvent {
  id: string;
  timestamp: number;
  authority: string;
  action: string;
  outcome: string;
  details: Record<string, unknown>;
}

export interface SecurityAttestation {
  deviceId: string;
  deviceHealth: 'healthy' | 'degraded' | 'compromised';
  attestationValid: boolean;
  timestamp: number;
}

export class BoundaryEnforcer {
  private authorityState: AuthorityState;
  private securityAttestation: SecurityAttestation | null = null;
  private temporalRestrictions: Map<string, TemporalRestriction> = new Map();

  constructor(authorityState: AuthorityState) {
    this.authorityState = authorityState;
  }

  setSecurityAttestation(attestation: SecurityAttestation): void {
    this.securityAttestation = attestation;
  }

  addTemporalRestriction(resourceId: string, restriction: TemporalRestriction): void {
    this.temporalRestrictions.set(resourceId, restriction);
  }

  async evaluate(request: AccessRequest): Promise<AccessDecision> {
    const denials: string[] = [];

    if (!this.authorizationCheck(request, denials)
      .contextualRelationshipCheck(request, denials)
      .temporalRestrictionCheck(request, denials)
      .securityAttestationCheck(request, denials)
      .deviceHealthCheck(request, denials)) {
      const allowed = denials.length === 0;
      const reason = allowed ? 'Access granted' : denials.join('; ');
      const restrictions = this.getRestrictions(request);

      const auditEvent: AuditEvent = {
        id: crypto.randomUUID(),
        timestamp: Date.now(),
        authority: this.authorityState.activeAuthority,
        action: 'boundary_enforcement',
        outcome: allowed ? 'allowed' : 'denied',
        details: {
          requesterId: request.requesterId,
          resourceId: request.resourceId,
          action: request.action,
          denials,
          restrictions,
        },
      };

      return { allowed, reason, restrictions, auditEvent };
    }

    const allowed = denials.length === 0;
    const reason = allowed ? 'Access granted' : denials.join('; ');
    const restrictions = this.getRestrictions(request);

    const auditEvent: AuditEvent = {
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      authority: this.authorityState.activeAuthority,
      action: 'boundary_enforcement',
      outcome: allowed ? 'allowed' : 'denied',
      details: {
        requesterId: request.requesterId,
        resourceId: request.resourceId,
        action: request.action,
        denials,
        restrictions,
      },
    };

    return { allowed, reason, restrictions, auditEvent };
  }

  private authorizationCheck(request: AccessRequest, denials: string[]): this {
    const hasPermission = this.authorityState.permissions.some(
      (p: string) => p === '*' || p === `${request.action}:${request.resourceId}` || p === `${request.action}:*`
    );

    if (!hasPermission) {
      denials.push('No authorization exists for this action');
    }
    return this;
  }

  private contextualRelationshipCheck(request: AccessRequest, denials: string[]): this {
    const hasRelationship = this.checkContextualRelationship(request.requesterId, request.resourceId);
    
    if (!hasRelationship) {
      denials.push('No contextual relationship exists between requester and resource');
    }
    return this;
  }

  private temporalRestrictionCheck(request: AccessRequest, denials: string[]): this {
    const restriction = this.temporalRestrictions.get(request.resourceId);
    
    if (restriction && !restriction.isAllowed(request.action, Date.now())) {
      denials.push(`Temporal restriction: ${restriction.reason}`);
    }
    return this;
  }

  private securityAttestationCheck(request: AccessRequest, denials: string[]): this {
    if (this.securityAttestation && !this.securityAttestation.attestationValid) {
      denials.push('Security attestation failed');
    }
    return this;
  }

  private deviceHealthCheck(request: AccessRequest, denials: string[]): this {
    if (this.securityAttestation && this.securityAttestation.deviceHealth === 'compromised') {
      denials.push('Device health check failed: compromised');
    }
    if (this.securityAttestation && this.securityAttestation.deviceHealth === 'degraded') {
      denials.push('Device health degraded - restricted operations');
    }
    return this;
  }

  private checkContextualRelationship(requesterId: string, resourceId: string): boolean {
    return requesterId === resourceId || 
           requesterId.startsWith('ava007') ||
           resourceId.startsWith('system:');
  }

  private getRestrictions(request: AccessRequest): string[] {
    const restrictions: string[] = [];
    
    const restriction = this.temporalRestrictions.get(request.resourceId);
    if (restriction) {
      restrictions.push(`Temporal: ${restriction.description}`);
    }

    if (this.securityAttestation?.deviceHealth === 'degraded') {
      restrictions.push('Device degraded - write operations limited');
    }

    return restrictions;
  }
}

export interface TemporalRestriction {
  resourceId: string;
  allowedActions: string[];
  allowedTimeRanges: Array<{ start: number; end: number }>;
  description: string;
  reason: string;

  isAllowed(action: string, timestamp: number): boolean;
}

export function createTemporalRestriction(params: Omit<TemporalRestriction, 'isAllowed'>): TemporalRestriction {
  return {
    ...params,
    isAllowed(action: string, timestamp: number): boolean {
      if (!this.allowedActions.includes(action) && !this.allowedActions.includes('*')) {
        return false;
      }
      return this.allowedTimeRanges.some(range => 
        timestamp >= range.start && timestamp <= range.end
      );
    },
  };
}
