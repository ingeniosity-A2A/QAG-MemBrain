# Code Governance Policy

**Authority:** AVA007 (Layer 6)
**Enforcement:** Runtime Validation
**Applicability:** All coding tasks where `task.type === "code"`

---

## Purpose

All coding agents must produce code that is consistent, maintainable, testable, and auditable.

Code generation is governed by AVA007.

Models may generate code.

Models may not define repository standards.

---

## Agent Workflow

Every coding task follows:

```
Acknowledge
→ Discover
→ Read
→ Analyze
→ Plan
→ Modify
→ Verify
→ Test
→ Record Outcome
```

- Never write before reading.
- Never modify before understanding.
- Never complete without verification.

---

## Repository Boundaries

Agents may only modify files relevant to the active task.

Agents must not:

- Refactor unrelated systems.
- Rename unrelated files.
- Change runtime policies.
- Modify authority hierarchy.
- Alter repository structure without authorization.

---

## Read Before Write Rule

Before editing:

1. Read target file.
2. Read dependencies.
3. Read imports.
4. Read interfaces.
5. Read tests.

Only then propose changes.

---

## Context-Aware Development

Before generating code, load:

- Current Task
- Relevant Context Nodes
- Relevant Timeline
- Related Memory
- Graph Dependencies
- Authority Policies

**Code is generated from context. Not prompts.**

---

## Function Standards

Every function must contain:

- Purpose
- Inputs
- Outputs
- Failure Conditions

**Example:**

```typescript
/**
 * Creates a ContextNode.
 * 
 * Inputs:
 * id: string
 * type: string
 * 
 * Returns:
 * ContextNode
 * 
 * Throws:
 * ValidationError
 */
```

---

## Single Responsibility Rule

- One function.
- One responsibility.
- Avoid multi-purpose functions.
- Avoid hidden side effects.

---

## Type Safety Rule

**Prefer:**

- TypeScript interfaces
- Types
- Enums
- Explicit returns

**Avoid:**

- `any`
- implicit returns
- untyped objects

---

## Logging Rule

Critical operations must log:

- Authority
- Action
- Timestamp
- Outcome

**Example:**

```typescript
logger.info({
  authority: "AVA007",
  action: "promote_memory",
  outcome: "success"
});
```

---

## Testing Rule

Every modification requires:

- Unit Test
- Integration Validation
- Runtime Validation

**Minimum:**

- 1 happy path
- 1 failure path
- 1 edge case

---

## Verification Rule

After modifications:

1. Run tests.
2. Inspect failures.
3. Fix failures.
4. Re-run tests.

Do not mark complete without verification.

---

## Documentation Rule

**Public APIs require:**

- Description
- Inputs
- Outputs
- Examples

**Internal APIs require:**

- Purpose
- Expected behavior

---

## Security Rule

Agents may not:

- Expose secrets
- Expose tokens
- Commit credentials
- Disable validation
- Bypass authority checks

---

## Runtime Boundary Rule

Models may generate code.

**Only AVA007 may approve:**

- Authority Changes
- Memory Schema Changes
- Context Graph Changes
- Governance Changes
- Repository Structure Changes

---

## Completion Checklist

Before completion:

- [ ] Context loaded
- [ ] Dependencies reviewed
- [ ] Code follows standards
- [ ] Tests added
- [ ] Tests passed
- [ ] Documentation updated
- [ ] No authority violations
- [ ] No security violations

If any item fails: **Task is not complete.**

---

## Golden Rule

- Readable code is preferred over clever code.
- Deterministic code is preferred over magical code.
- Maintainability is preferred over brevity.
- Repository consistency is preferred over individual model preferences.