# Sub-Agent Coordination

Dispatches tasks to specialist sub-agents based on atom classification.

## Sub-Agents

| Agent | Specialization | Trigger |
|-------|---------------|---------|
| Goose | Code execution, tool dispatch | `type: task.code.*` |
| RevIke | Philosophical retrieval, tactical→strategic transform | `source: revike` |
| GRPO Harness | Self-managing memory policy training | `type: training.*` |
