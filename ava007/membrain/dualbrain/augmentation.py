"""
augmentation.py — Query Augmentation for QAG-MemBrain DualBrain Layer (L6).

Detects factual queries and augments them with structured context derived
from graph data and policy constraints.  Provides contradiction detection
between graph-sourced and LLM-sourced answers.

Core classes:
    QueryAugmenter   — Factual detection, entity extraction, augmentation
    AugmentedQuery   — Enriched query data structure
    Contradiction    — Detected graph-vs-prompt contradiction
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Set, Tuple


# ---------------------------------------------------------------------------
# Data structures
# ---------------------------------------------------------------------------

@dataclass
class AugmentedQuery:
    """A query enriched with structured context from graph and policy sources.

    Attributes:
        original:        The raw user query string.
        augmented:       The query with context prepended / embedded.
        entities:        Extracted entity names from the query.
        context_sources: Labels for the context sources used (e.g.
                         ``"graph:node_A"``, ``"policy:access_control"``).
        is_factual:      Whether the query was classified as factual.
    """
    original: str
    augmented: str
    entities: List[str] = field(default_factory=list)
    context_sources: List[str] = field(default_factory=list)
    is_factual: bool = False


@dataclass
class Contradiction:
    """A detected contradiction between a graph answer and a prompt answer.

    Attributes:
        topic:         The subject on which the two answers disagree.
        graph_claim:   The claim made by the graph-based retrieval.
        prompt_claim:  The claim made by the LLM-based generation.
        severity:      ``"low"``, ``"medium"``, or ``"high"``.
    """
    topic: str
    graph_claim: str
    prompt_claim: str
    severity: str  # "low" | "medium" | "high"


# ---------------------------------------------------------------------------
# Factual-detection regex patterns
# ---------------------------------------------------------------------------

_WH_QUESTION_RE = re.compile(
    r"\b(who|what|when|where|how many|how much|how old|how long|which)\b",
    re.IGNORECASE,
)

_QUANTITATIVE_RE = re.compile(
    r"\b(\d+[\d,]*\.?\d*)\s*"
    r"(percent|%|million|billion|trillion|thousand|hundred|"
    r"units?|items?|people|users?|requests?|nodes?|edges?)\b",
    re.IGNORECASE,
)

_LOOKUP_RE = re.compile(
    r"\b(definition of|meaning of|capital of|population of|"
    r"status of|state of|value of|location of|address of|"
    r"is there|does .+ have|list all|show me|find the)\b",
    re.IGNORECASE,
)

_BOOLEAN_QUERY_RE = re.compile(
    r"^(is|are|was|were|does|do|did|has|have|had|can|could|will|would|should)\b",
    re.IGNORECASE,
)


# ---------------------------------------------------------------------------
# Entity extraction regex patterns
# ---------------------------------------------------------------------------

# Capitalized multi-word sequences (2+ words starting with uppercase)
_PROPER_NOUN_RE = re.compile(
    r"\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)\b"
)

# Quoted strings
_QUOTED_RE = re.compile(
    r'["\u201c\u201d]([^"\u201c\u201d]+)["\u201c\u201d]'
)

# "X of Y" pattern — e.g. "Republic of Korea", "University of Cambridge"
# The trailing group only captures sequences that end on an uppercase word or
# a single lowercase word to avoid greedy over-matching (e.g. "University of
# Cambridge ranking" should yield "University of Cambridge", not the whole
# phrase including "ranking").
_X_OF_Y_RE = re.compile(
    r"\b([A-Z][a-zA-Z]*(?:\s+[a-z]{1,3})*\s+of\s+[A-Z][a-zA-Z]*(?:\s+[A-Z][a-zA-Z]+)*)\b"
)

# Identifier-style entities — e.g. deploy_42, service_api, node-123
_IDENTIFIER_RE = re.compile(
    r"\b([a-zA-Z][a-zA-Z0-9]*[_\-][a-zA-Z0-9_\-]+)\b"
)

# Single capitalized word that is not at sentence start (heuristic)
_SINGLE_CAPITAL_RE = re.compile(
    r"(?:^|[.!?]\s+|\s)([A-Z][a-z]{2,})(?:\s|$|[,;:.!?])"
)


# ---------------------------------------------------------------------------
# Contradiction-detection helpers
# ---------------------------------------------------------------------------

_NEGATION_WORDS = frozenset({
    "not", "no", "never", "none", "nobody", "nothing",
    "nowhere", "neither", "nor", "cannot", "can't",
    "don't", "doesn't", "didn't", "won't", "wouldn't",
    "shouldn't", "couldn't", "isn't", "aren't", "wasn't",
    "weren't", "hasn't", "haven't", "hadn't",
})

_NUMBER_RE = re.compile(r"-?\d+[\d,]*\.?\d*")

_COMPARATIVE_RE = re.compile(
    r"\b(more|less|fewer|greater|smaller|larger|higher|lower|"
    r"older|newer|faster|slower|better|worse)\b",
    re.IGNORECASE,
)


def _sentence_tokenize(text: str) -> List[str]:
    """Split *text* into sentences on punctuation boundaries."""
    parts = re.split(r"(?<=[.!?])\s+", text.strip())
    return [p.strip() for p in parts if p.strip()]


def _contains_negation(sentence: str) -> bool:
    """Return True if *sentence* contains a negation word."""
    words = set(re.findall(r"\b\w+\b", sentence.lower()))
    return bool(words & _NEGATION_WORDS)


def _extract_numbers(text: str) -> Set[str]:
    """Return all numeric tokens found in *text*."""
    return set(_NUMBER_RE.findall(text))


def _extract_comparatives(text: str) -> Set[str]:
    """Return all comparative words found in *text*."""
    return set(m.lower() for m in _COMPARATIVE_RE.findall(text))


# ---------------------------------------------------------------------------
# QueryAugmenter
# ---------------------------------------------------------------------------

class QueryAugmenter:
    """Detects factual queries and augments them with structured context.

    The augmenter provides:

    - **Factual detection**: regex-based WH-question, quantitative, and
      lookup-style query recognition.
    - **Entity extraction**: proper nouns, quoted strings, "X of Y"
      patterns.
    - **Graph context augmentation**: prepends graph-derived facts to the
      query so that downstream LLM calls can leverage deterministic
      knowledge.
    - **Policy context augmentation**: appends policy constraints so that
      LLM outputs respect governance rules.
    - **Contradiction detection**: compares graph and prompt answers for
      negation flips, numeric discrepancies, and comparative inversions.
    """

    # -- Factual detection ----------------------------------------------------

    @staticmethod
    def is_factual(query: str) -> bool:
        """Determine whether *query* is factual.

        A query is factual if it matches any of:
          - WH-question patterns (who / what / when / where / how many …)
          - Quantitative patterns (numbers + units)
          - Lookup-style patterns ("definition of", "status of", …)
          - Boolean yes/no question patterns ("is …", "does …")

        Args:
            query: The raw query string.

        Returns:
            True if the query is classified as factual.
        """
        if not query or not query.strip():
            return False

        q = query.strip()

        if _WH_QUESTION_RE.search(q):
            return True
        if _QUANTITATIVE_RE.search(q):
            return True
        if _LOOKUP_RE.search(q):
            return True
        if _BOOLEAN_QUERY_RE.search(q):
            return True

        return False

    # -- Entity extraction ----------------------------------------------------

    @staticmethod
    def extract_entities(query: str) -> List[str]:
        """Extract likely entity names from *query*.

        Extraction strategies (in priority order, deduplicated):

        1. "X of Y" patterns — e.g. ``"University of Cambridge"``
        2. Quoted strings — e.g. ``"Project Aurora"``
        3. Multi-word capitalised sequences — e.g. ``"New York"``
        4. Single capitalised words (heuristic, not sentence-initial)

        Args:
            query: The raw query string.

        Returns:
            A deduplicated list of extracted entity strings, ordered by
            first appearance in the query.
        """
        if not query or not query.strip():
            return []

        entities: List[str] = []
        seen: Set[str] = set()

        # 1. "X of Y" patterns
        for m in _X_OF_Y_RE.finditer(query):
            ent = m.group(1).strip()
            if ent not in seen:
                entities.append(ent)
                seen.add(ent)

        # 2. Quoted strings
        for m in _QUOTED_RE.finditer(query):
            ent = m.group(1).strip()
            if ent and ent not in seen:
                entities.append(ent)
                seen.add(ent)

        # 3. Multi-word capitalised sequences
        for m in _PROPER_NOUN_RE.finditer(query):
            ent = m.group(1).strip()
            if ent not in seen:
                entities.append(ent)
                seen.add(ent)

        # 4. Single capitalised words (avoid sentence-initial false positives
        #    by requiring at least 3 chars and checking position)
        for m in _SINGLE_CAPITAL_RE.finditer(query):
            ent = m.group(1).strip()
            if len(ent) >= 3 and ent not in seen:
                # Skip common sentence starters that are not entities
                if ent.lower() not in {
                    "the", "this", "that", "these", "those",
                    "what", "which", "when", "where", "while",
                    "how", "why", "who", "whom", "whose",
                }:
                    entities.append(ent)
                    seen.add(ent)

        # 5. Identifier-style entities (deploy_42, service-api, node_1)
        for m in _IDENTIFIER_RE.finditer(query):
            ent = m.group(1).strip()
            if ent not in seen:
                entities.append(ent)
                seen.add(ent)

        return entities

    # -- Graph context augmentation -------------------------------------------

    def augment_with_graph_context(self, query: str,
                                   graph_data: dict) -> AugmentedQuery:
        """Augment *query* with structured context from *graph_data*.

        The *graph_data* dictionary is expected to contain:

        - ``"nodes"``: list of dicts with ``"id"``, ``"labels"``,
          ``"properties"`` keys.
        - ``"edges"``: list of dicts with ``"source"``, ``"target"``,
          ``"type"``, ``"properties"`` keys.
        - ``"paths"``: optional list of dicts representing graph paths.

        Extracted entities are matched against graph node IDs and labels.
        Matching node properties are formatted as ``key: value`` pairs and
        prepended to the query as context.

        Args:
            query:      The raw query string.
            graph_data: Graph data dictionary (nodes, edges, paths).

        Returns:
            An ``AugmentedQuery`` with graph-derived context embedded.
        """
        entities = self.extract_entities(query)
        is_fact = self.is_factual(query)
        context_parts: List[str] = []
        context_sources: List[str] = []

        nodes = graph_data.get("nodes", [])
        edges = graph_data.get("edges", [])
        paths = graph_data.get("paths", [])

        # Build a lookup for nodes by ID and labels
        node_by_id: Dict[str, dict] = {}
        node_by_label_value: Dict[str, List[dict]] = {}
        for node in nodes:
            nid = node.get("id", "")
            if nid:
                node_by_id[nid] = node
            for label in node.get("labels", []):
                key = label.lower()
                node_by_label_value.setdefault(key, []).append(node)

        # Match entities to nodes
        matched_nodes: List[dict] = []
        for ent in entities:
            # Direct ID match
            if ent in node_by_id:
                matched_nodes.append(node_by_id[ent])
                continue
            # Label match
            key = ent.lower().replace(" ", "_")
            if key in node_by_label_value:
                matched_nodes.extend(node_by_label_value[key])
                continue
            # Partial match on properties
            ent_lower = ent.lower()
            for node in nodes:
                for prop_key, prop_val in node.get("properties", {}).items():
                    if ent_lower in str(prop_val).lower():
                        matched_nodes.append(node)
                        break

        # Fallback: if no entities matched, try keyword matching against
        # node IDs and properties.  This ensures that queries like
        # "What is the status of deploy_42?" still find the relevant node
        # even when the identifier isn't extracted as a named entity.
        if not matched_nodes:
            query_tokens = set(re.findall(r"\b\w{2,}\b", query.lower()))
            _STOP = {"the", "and", "for", "are", "but", "not", "you", "all",
                     "can", "had", "her", "was", "one", "our", "out", "has",
                     "have", "from", "been", "some", "them", "than", "its",
                     "over", "such", "that", "this", "with", "will", "each",
                     "what", "about", "which", "when", "where", "who", "how",
                     "why", "does", "did", "was", "were", "is", "are", "of",
                     "in", "on", "at", "to", "a", "an", "be", "do", "if",
                     "or", "no", "so", "as", "by", "my", "up", "me"}
            query_tokens -= _STOP
            for node in nodes:
                nid = node.get("id", "")
                labels = node.get("labels", [])
                props = node.get("properties", {})
                # Build searchable text from node
                node_text = f"{nid} {' '.join(labels)} {' '.join(str(v) for v in props.values())}".lower()
                node_tokens = set(re.findall(r"\b\w{2,}\b", node_text))
                # Match if any query keyword appears in the node
                if query_tokens & node_tokens:
                    matched_nodes.append(node)

        # Deduplicate matched nodes
        seen_ids: Set[str] = set()
        for node in matched_nodes:
            nid = node.get("id", "")
            if nid in seen_ids:
                continue
            seen_ids.add(nid)

            # Format node properties as context
            props = node.get("properties", {})
            labels = node.get("labels", [])
            if props:
                prop_lines = [f"  {k}: {v}" for k, v in props.items()]
                context_parts.append(
                    f"Node [{nid}] ({', '.join(labels)}):\n"
                    + "\n".join(prop_lines)
                )
                context_sources.append(f"graph:node:{nid}")

        # Add edge context for matched nodes
        for edge in edges:
            src = edge.get("source", "")
            tgt = edge.get("target", "")
            if src in seen_ids or tgt in seen_ids:
                etype = edge.get("type", "RELATED_TO")
                eprops = edge.get("properties", {})
                edge_desc = f"Edge ({src})-[{etype}]->({tgt})"
                if eprops:
                    edge_desc += " " + ", ".join(
                        f"{k}={v}" for k, v in eprops.items()
                    )
                context_parts.append(edge_desc)
                context_sources.append(f"graph:edge:{src}->{tgt}")

        # Add path summaries
        for i, path in enumerate(paths[:5]):  # limit to 5 paths
            path_nodes = path.get("nodes", [])
            path_edges = path.get("edges", [])
            context_parts.append(
                f"Path {i + 1}: {' -> '.join(str(n) for n in path_nodes)} "
                f"({len(path_edges)} hops)"
            )
            context_sources.append(f"graph:path:{i + 1}")

        # Build augmented query
        if context_parts:
            context_block = "\n".join(context_parts)
            augmented = (
                f"[Graph Context]\n{context_block}\n\n"
                f"[Query]\n{query}"
            )
        else:
            augmented = query

        return AugmentedQuery(
            original=query,
            augmented=augmented,
            entities=entities,
            context_sources=context_sources,
            is_factual=is_fact,
        )

    # -- Policy context augmentation ------------------------------------------

    def augment_with_policy_context(self, query: str,
                                    policies: List[dict]) -> AugmentedQuery:
        """Augment *query* with policy constraints from *policies*.

        Each policy dict should contain:
          - ``"name"``: policy name
          - ``"rules"``: list of rule strings
          - ``"priority"``: optional priority (higher = more important)
          - ``"enforcement"``: optional enforcement mode (``"strict"``,
            ``"advisory"``)

        Policies are sorted by priority (descending) and formatted as
        constraint blocks appended to the query.

        Args:
            query:    The raw query string.
            policies: List of policy dictionaries.

        Returns:
            An ``AugmentedQuery`` with policy constraints embedded.
        """
        entities = self.extract_entities(query)
        is_fact = self.is_factual(query)
        context_parts: List[str] = []
        context_sources: List[str] = []

        # Sort policies by priority (highest first)
        sorted_policies = sorted(
            policies,
            key=lambda p: p.get("priority", 0),
            reverse=True,
        )

        for policy in sorted_policies:
            name = policy.get("name", "unnamed_policy")
            rules = policy.get("rules", [])
            enforcement = policy.get("enforcement", "advisory")

            if not rules:
                continue

            rule_lines = [f"  - {r}" for r in rules]
            block = (
                f"Policy [{name}] (enforcement: {enforcement}):\n"
                + "\n".join(rule_lines)
            )
            context_parts.append(block)
            context_sources.append(f"policy:{name}")

        if context_parts:
            policy_block = "\n\n".join(context_parts)
            augmented = (
                f"{query}\n\n"
                f"[Policy Constraints]\n{policy_block}"
            )
        else:
            augmented = query

        return AugmentedQuery(
            original=query,
            augmented=augmented,
            entities=entities,
            context_sources=context_sources,
            is_factual=is_fact,
        )

    # -- Prompt prefix building -----------------------------------------------

    @staticmethod
    def build_prompt_prefix(query: str, context: dict) -> str:
        """Build a structured prompt prefix for LLM calls.

        The *context* dict may contain:

        - ``"role"``: system role description
        - ``"graph_facts"``: list of graph-derived fact strings
        - ``"policies"``: list of policy rule strings
        - ``"entities"``: list of entity names to ground
        - ``"constraints"``: list of additional constraint strings
        - ``"tier"``: orchestrator tier (``"reflex"``, ``"executive"``,
          ``"cortex"``)

        The prefix is formatted as a structured block that precedes the
        actual user query in the LLM prompt.

        Args:
            query:   The user query.
            context: Structured context dictionary.

        Returns:
            A formatted prompt prefix string.
        """
        parts: List[str] = []

        # Role
        role = context.get("role", "")
        if role:
            parts.append(f"Role: {role}")

        # Tier
        tier = context.get("tier", "")
        if tier:
            parts.append(f"Processing Tier: {tier}")

        # Graph facts
        graph_facts = context.get("graph_facts", [])
        if graph_facts:
            fact_lines = [f"  - {f}" for f in graph_facts]
            parts.append("Established Facts:\n" + "\n".join(fact_lines))

        # Entities
        entities = context.get("entities", [])
        if entities:
            parts.append(f"Grounding Entities: {', '.join(entities)}")

        # Policies
        policies = context.get("policies", [])
        if policies:
            pol_lines = [f"  - {p}" for p in policies]
            parts.append("Policy Rules:\n" + "\n".join(pol_lines))

        # Constraints
        constraints = context.get("constraints", [])
        if constraints:
            con_lines = [f"  - {c}" for c in constraints]
            parts.append("Constraints:\n" + "\n".join(con_lines))

        if not parts:
            return query

        prefix = "\n".join(parts)
        return f"{prefix}\n\nQuery: {query}"

    # -- Contradiction detection ----------------------------------------------

    def detect_contradictions(self, graph_answer: str,
                              prompt_answer: str) -> List[Contradiction]:
        """Detect contradictions between a graph answer and a prompt answer.

        Detection strategies:

        1. **Negation flip**: One answer affirms X while the other denies it
           (detected via negation word presence in one but not the other).
        2. **Numeric discrepancy**: Both answers contain numbers but the
           numbers differ significantly.
        3. **Comparative inversion**: One answer uses a comparative in one
           direction and the other uses the opposite direction.

        Each contradiction is assigned a severity:

        - **high**: Negation flip or numeric discrepancy > 50%
        - **medium**: Numeric discrepancy 20-50% or comparative inversion
        - **low**: Minor numeric discrepancy < 20%

        Args:
            graph_answer:  Answer from graph-based retrieval.
            prompt_answer: Answer from LLM-based generation.

        Returns:
            A list of ``Contradiction`` instances, sorted by severity
            (high → medium → low).
        """
        if not graph_answer or not prompt_answer:
            return []

        contradictions: List[Contradiction] = []

        g_sentences = _sentence_tokenize(graph_answer)
        p_sentences = _sentence_tokenize(prompt_answer)

        # Strategy 1: Negation flip detection
        g_has_neg = any(_contains_negation(s) for s in g_sentences)
        p_has_neg = any(_contains_negation(s) for s in p_sentences)

        if g_has_neg != p_has_neg:
            # Find the most relevant topic — use the most common non-stopword
            negating_side = "prompt" if p_has_neg else "graph"
            affirming_side = "graph" if p_has_neg else "prompt"
            topic = self._extract_topic(graph_answer + " " + prompt_answer)

            g_claim = g_sentences[0] if g_sentences else graph_answer[:200]
            p_claim = p_sentences[0] if p_sentences else prompt_answer[:200]

            contradictions.append(Contradiction(
                topic=topic,
                graph_claim=g_claim,
                prompt_claim=p_claim,
                severity="high",
            ))

        # Strategy 2: Numeric discrepancy
        g_numbers = _extract_numbers(graph_answer)
        p_numbers = _extract_numbers(prompt_answer)

        # Find numbers that appear in both (by position proximity heuristic)
        # We compare any shared numeric strings or overlapping values
        common_topics = g_numbers | p_numbers
        if g_numbers and p_numbers:
            # Check each pair of numbers for discrepancy
            g_num_list = sorted(g_numbers, key=lambda x: float(x.replace(",", "")) if x.replace(",", "").replace("-", "").replace(".", "") else 0)
            p_num_list = sorted(p_numbers, key=lambda x: float(x.replace(",", "")) if x.replace(",", "").replace("-", "").replace(".", "") else 0)

            for g_num_str in g_num_list:
                try:
                    g_val = float(g_num_str.replace(",", ""))
                except ValueError:
                    continue
                for p_num_str in p_num_list:
                    try:
                        p_val = float(p_num_str.replace(",", ""))
                    except ValueError:
                        continue
                    if g_val == 0 and p_val == 0:
                        continue
                    if g_val == 0 or p_val == 0:
                        # One is zero and the other is not
                        discrepancies_pct = 100.0
                    else:
                        discrepancies_pct = abs(g_val - p_val) / max(abs(g_val), abs(p_val)) * 100.0

                    if discrepancies_pct >= 20.0:
                        if discrepancies_pct > 50.0:
                            severity = "high"
                        else:
                            severity = "medium"

                        topic = self._extract_topic(
                            graph_answer + " " + prompt_answer
                        )
                        contradictions.append(Contradiction(
                            topic=f"{topic} (numeric: {g_num_str} vs {p_num_str})",
                            graph_claim=f"Value: {g_num_str}",
                            prompt_claim=f"Value: {p_num_str}",
                            severity=severity,
                        ))
                        break  # One discrepancy per g_num is enough

        # Strategy 3: Comparative inversion
        g_comps = _extract_comparatives(graph_answer)
        p_comps = _extract_comparatives(prompt_answer)

        inversion_pairs = {
            ("more", "less"), ("less", "more"),
            ("greater", "smaller"), ("smaller", "greater"),
            ("higher", "lower"), ("lower", "higher"),
            ("larger", "smaller"), ("smaller", "larger"),
            ("faster", "slower"), ("slower", "faster"),
            ("older", "newer"), ("newer", "older"),
            ("better", "worse"), ("worse", "better"),
        }

        for g_comp in g_comps:
            for p_comp in p_comps:
                if (g_comp, p_comp) in inversion_pairs:
                    topic = self._extract_topic(
                        graph_answer + " " + prompt_answer
                    )
                    contradictions.append(Contradiction(
                        topic=f"{topic} (comparative: {g_comp} vs {p_comp})",
                        graph_claim=f"Described as '{g_comp}'",
                        prompt_claim=f"Described as '{p_comp}'",
                        severity="medium",
                    ))

        # Sort by severity (high → medium → low)
        severity_order = {"high": 0, "medium": 1, "low": 2}
        contradictions.sort(key=lambda c: severity_order.get(c.severity, 3))

        return contradictions

    # -- Private helpers ------------------------------------------------------

    @staticmethod
    def _extract_topic(text: str) -> str:
        """Extract the most significant topic word from *text*.

        Uses a simple heuristic: the most frequent non-stopword noun-like
        word (capitalised or long).
        """
        _STOPWORDS = frozenset({
            "the", "a", "an", "is", "are", "was", "were", "be", "been",
            "being", "have", "has", "had", "do", "does", "did", "will",
            "would", "could", "should", "may", "might", "shall", "can",
            "not", "no", "but", "or", "and", "if", "then", "than", "so",
            "as", "by", "for", "with", "about", "against", "between",
            "through", "during", "before", "after", "above", "below",
            "to", "from", "up", "down", "in", "out", "on", "off", "over",
            "under", "again", "further", "that", "this", "these", "those",
            "it", "its", "of", "at", "which", "what", "who", "whom",
            "how", "why", "when", "where", "there", "here", "all", "each",
            "every", "both", "few", "more", "most", "other", "some",
            "such", "only", "own", "same", "too", "very", "just", "also",
        })

        words = re.findall(r"\b[A-Za-z][a-z]{2,}\b", text)
        freq: Dict[str, int] = {}
        for w in words:
            wl = w.lower()
            if wl in _STOPWORDS:
                continue
            freq[wl] = freq.get(wl, 0) + 1

        if not freq:
            # Fallback: use the longest capitalised word
            caps = re.findall(r"\b[A-Z][a-z]{2,}\b", text)
            return caps[0] if caps else "unknown"

        # Prefer capitalised words; break ties by frequency
        best = max(
            freq.keys(),
            key=lambda w: (freq[w], 1 if w[0].isupper() else 0),
        )
        return best
