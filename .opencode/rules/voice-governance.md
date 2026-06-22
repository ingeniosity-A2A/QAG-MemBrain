# Voice Governance Auto-Injection Rule

This rule automatically injects the Voice Policy into the context when a voice interaction task is detected.

## Trigger Condition

```yaml
when:
  task.type: "voice"
  # Also trigger for voice patterns
  - task.description contains "speak"
  - task.description contains "voice"
  - task.description contains "say"
  - task.description contains "talk"
  - task.description contains "pronounce"
  - task.description contains "conversation"
  - task.description contains "interact"
  - task.channel: "voice"
  - runtime.node: "s25_ultra"
  - runtime.node: "s26_ultra"
```

## Injection

```yaml
inject:
  - file: "src/runtime/governance/policies/voice_policy.md"
    as: "system_prompt"
    priority: high
  - file: "docs/AVA007_RUNTIME_CONTRACT.md"
    section: "Voice Runtime Policy"
    as: "context"
    priority: medium
```

## Context Assembly

When triggered, the runtime assembles:

1. **Voice Policy** (full) - as system prompt
2. **Runtime Contract** (Voice section) - as context
3. **Voice Memory** - from Tashi Memory (intent, entities, objectives, completed steps)
4. **Current Timeline** - from Timeline Runtime
5. **Active Task** - from task context
6. **Node Profile** - S25 Authority or S26 Execution

## Validation

After voice response generation, the runtime validates:

- [ ] Speech rule: No markdown/tables/code/bullets/headings (natural speech only)
- [ ] Question rule: Only one question at a time
- [ ] Latency rule: Earliest useful response provided
- [ ] Number pronunciation: Phone/date/zip/ID formatted for speech
- [ ] Confirmation rule: Irreversible actions require explicit confirmation
- [ ] Interruption rule: State persists, resumable
- [ ] Clarification rule: One clarification question max
- [ ] Voice memory rule: No repetition of collected info
- [ ] Completion rule: Ends with next step, confirmation, or single question

If validation fails, the voice task is marked incomplete.