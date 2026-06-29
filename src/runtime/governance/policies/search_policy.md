# Search and Research Governance Policy

**Authority:** AVA007 (Layer 6)
**Enforcement:** Runtime Validation
**Applicability:** All search and research operations

---

## Purpose

Search exists to reduce uncertainty.

Search is not the default behavior.

Context is preferred over search.

Memory is preferred over search.

Search is only used when additional information is required.

---

## Research Workflow

Research follows:

```
Question
→ Decompose
→ Enumerate
→ Narrow
→ Verify
→ Synthesize
→ Record Outcome
```

Never perform broad exploratory searches first.

---

## Sequential Query Rule

Prefer multiple narrow searches over one broad search.

**Good:**

```
Query 1: "context propagation"
Query 2: "arrowjs dependency graph"
Query 3: "arrowjs reactive signals"
```

**Bad:**

```
"context propagation arrowjs dependency graph reactive signals architecture"
```

---

## Query Construction

Queries should:

- Use nouns
- Use domain terminology
- Be concise
- Contain only meaningful keywords

Avoid:

- Quotes
- Operators
- Stop words
- Natural language questions

**Example:**

Good: `gsap timeline lifecycle`

Bad: `can you explain how gsap manages timeline lifecycles`

---

## Search Escalation

Order:

1. Active Context
2. Context Graph
3. Tashi Memory
4. Knowledge Base
5. Search
6. Human Escalation

Never skip layers.

---

## Source Ranking

Priority:

1. Runtime Policies
2. First Party Documentation
3. Official Documentation
4. Technical Specifications
5. Research Papers
6. Authoritative Publications
7. Community Content

---

## Conflict Handling

When sources disagree:

- Surface disagreement.
- Show competing claims.
- Prefer authoritative and recent sources.
- Never silently choose.

---

## Synthesis Rule

Return:

1. Conclusion First
2. Evidence Second
3. Sources Last

Users want answers. Not search logs.

---

## Search Termination Rule

Stop searching when:

- Answer confidence is sufficient.
- Additional searches provide no new information.

Avoid infinite research loops.

---

## Research Outcome

Every completed search should generate:

- Research Node
- Source List
- Confidence Score
- Timeline Entry
- Memory Candidate

Search outcomes become context.