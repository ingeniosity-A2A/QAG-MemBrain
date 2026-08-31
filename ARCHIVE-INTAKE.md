# QAG-MemBrain — archive intake (three-repo cleanup)

QAG-MemBrain is **not** one of the three official product repos.
It receives **outdated, misfit, and source-mined** material so Agent-X, Cybernetic-Ava007, and a2a-exoskeleton stay clean.

## Official three (do not re-home product here)

1. Cybernetic-Ava007 — intellect
2. a2a-exoskeleton — substrate
3. Agent-X — capabilities + ESA/Help consoles

## Intake folders (create as material arrives)

```
archive/
  from-agent-x/          # destiny_*, s25_*, imports junk
  from-a2a-exoskeleton/  # rust zips, ticket scripts
  from-ava007-monorepo/  # Freebuff SKILL, mattpocock lock, mixed monorepo
  from-core-membrain/    # if contracts superseded
  from-bridge/           # ava007-bridge snapshots if retired
```

## Scheduled moves (checklist)

### From Agent-X
- [ ] `Modelfile.destiny`, `destiny_build/`, `merge_destiny.sh`
- [ ] `s25_proot_diagnostic.sh`
- [ ] `imports/` if unreferenced

### From a2a-exoskeleton
- [ ] `ava007-agent-exoskeleton-rust.zip`

### From old Ava007 (source only — not official)
- [ ] Root Freebuff `SKILL.md`
- [ ] `skills-lock.json` (mattpocock)
- [ ] Duplicate dashboard / monorepo UI that is neither ESA nor Help
- [ ] Keep *useful* `exoskeleton/` code paths documented for **port into a2a-exoskeleton**, not permanent residence in Ava007

## Rule

If it is not intellect, substrate, or Agent-X capability/console — it lands here or is deleted after archive copy.
