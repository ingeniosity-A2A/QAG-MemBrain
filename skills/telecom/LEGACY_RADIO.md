# Provenance — NOT buried

This package is **valuable**. It has been **promoted for active use** to:

## **`Ava007-Omni-OS/Omnibus/skills/telecom-dli/`**

| Capability | Active path |
|------------|-------------|
| JCAS / IMSI-catcher sensing | Omnibus `telecom-dli/jcas.py` |
| Identity rotation | Omnibus `telecom-dli/identity_rotation.py` |
| Backhaul steering | Omnibus `telecom-dli/backhaul.py` |
| Ephemeral log policy | Omnibus `telecom-dli/ephemeral_log.py` |
| DLI config | Omnibus `telecom-dli/dli_config.json` |

**This directory remains** as the historical source of truth for git archaeology.

**Do not** treat this path as dead code — treat it as **upstream provenance**.  
**Do not** delete these files until Omnibus has been validated in your pipeline.

Utilization flow:

```text
QAG-MemBrain/skills/telecom  (provenance)
        → promoted copy
Omnibus/skills/telecom-dli   (ACTIVE — use this)
        → capability route
Agent-X containers           (hardware harness)
```
