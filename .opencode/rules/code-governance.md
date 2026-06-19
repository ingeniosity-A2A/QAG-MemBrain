# Code Governance Auto-Injection Rule

This rule automatically injects the Code Governance Policy into the context when a coding task is detected.

## Trigger Condition

```yaml
when:
  task.type: "code"
  # Also trigger for common coding task patterns
  - task.description contains "implement"
  - task.description contains "refactor"
  - task.description contains "fix"
  - task.description contains "add feature"
  - task.description contains "create"
  - task.description contains "modify"
  - task.description contains "update"
```

## Injection

```yaml
inject:
  - file: "src/runtime/governance/policies/code_policy.md"
    as: "system_prompt"
    priority: high
  - file: "docs/AVA007_RUNTIME_CONTRACT.md"
    section: "Code Governance Policy"
    as: "context"
    priority: medium
```

## Context Assembly

When triggered, the runtime assembles:

1. **Code Governance Policy** (full) - as system prompt
2. **Runtime Contract** (Code Governance section) - as context
3. **Relevant repository files** - via FastContext discovery
4. **Current task** - from task context
5. **Authority state** - from governance runtime

## Validation

After code generation, the runtime validates:

- [ ] Function standards met (purpose, inputs, outputs, failure conditions)
- [ ] Single responsibility rule followed
- [ ] Type safety rule followed (no `any`, explicit returns)
- [ ] Logging rule followed for critical operations
- [ ] Tests added (happy path, failure path, edge case)
- [ ] Tests passed
- [ ] Documentation updated
- [ ] No security violations
- [ ] No authority violations

If validation fails, the task is marked incomplete and returned to the agent with specific failure reasons.