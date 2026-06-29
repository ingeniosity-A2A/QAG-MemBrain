# Search Governance Auto-Injection Rule

This rule automatically injects the Search Policy into the context when a search/research task is detected.

## Trigger Condition

```yaml
when:
  task.type: "search"
  # Also trigger for research patterns
  - task.description contains "research"
  - task.description contains "find"
  - task.description contains "look up"
  - task.description contains "search"
  - task.description contains "investigate"
  - task.description contains "explore"
  - task.description contains "discover"
```

## Injection

```yaml
inject:
  - file: "src/runtime/governance/policies/search_policy.md"
    as: "system_prompt"
    priority: high
  - file: "docs/AVA007_RUNTIME_CONTRACT.md"
    section: "Search Policy"
    as: "context"
    priority: medium
```

## Context Assembly

When triggered, the runtime assembles:

1. **Search Policy** (full) - as system prompt
2. **Runtime Contract** (Search section) - as context
3. **Active Context** - from runtime
4. **Context Graph** - from graph runtime
4. **Tashi Memory** - from memory runtime
5. **Current task** - from task context

## Validation

After search completion, the runtime validates:

- [ ] Sequential query rule followed (narrow searches over broad)
- [ ] Search escalation order respected (context → graph → memory → KB → search → human)
- [ ] Source ranking applied correctly
- [ ] Conflicts surfaced (not silently resolved)
- [ ] Synthesis format: Conclusion → Evidence → Sources
- [ ] Search terminated when confidence sufficient
- [ ] Research outcome recorded (Research Node, Source List, Confidence Score, Timeline Entry, Memory Candidate)

If validation fails, the search task is marked incomplete.