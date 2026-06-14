"""
QAG-MemBrain GSAP Temporal Synchronization Layer (LAYER 5)
Ava007 Cognitive Runtime

Cognitive Epoch Visualization — ASCII/Unicode terminal rendering for
temporal memory epochs, superposition branches, heatmaps, and state
transitions.

Uses only Python stdlib. No matplotlib or external dependencies.
"""

from __future__ import annotations

import hashlib
import json
import math
import textwrap
from collections import Counter
from typing import Any, Dict, List, Optional


# ── Unicode block characters for heatmap density ───────────────────────
DENSITY_CHARS = " ░▒▓█"
DENSITY_LEVELS = len(DENSITY_CHARS) - 1  # 0..4

# ── Arrow and connector characters ─────────────────────────────────────
ARROW_RIGHT = "──→"
BRANCH_TEE = "├──"
BRANCH_LAST = "└──"
BRANCH_PIPE = "│  "
BRANCH_SPACE = "   "
STATE_ARROW = " ──→ "


class CognitiveEpochVisualizer:
    """
    Visualizes cognitive epochs as ASCII/Unicode art for terminal output.

    EpochRecord is a dict with keys:
        { id, timelineId, timestamp, label, data, hash }
    """

    # ── Timeline Bar ───────────────────────────────────────────────────

    def render_timeline(
        self,
        epochs: List[Dict[str, Any]],
        width: int = 80,
    ) -> str:
        """
        Render epochs as an ASCII timeline bar.

        Format:  |--[E1]---[E2]------[E3]--->
        Epochs are placed proportionally to their timestamps.

        Args:
            epochs: List of EpochRecord dicts.
            width:  Total width of the rendered bar (minimum 20).

        Returns:
            Multi-line string with the timeline bar and a legend.
        """
        if not epochs:
            return "(no epochs to render)"

        width = max(20, width)

        # Sort epochs by timestamp
        sorted_epochs = sorted(epochs, key=lambda e: e.get("timestamp", 0))
        min_ts = sorted_epochs[0].get("timestamp", 0)
        max_ts = sorted_epochs[-1].get("timestamp", 0)
        ts_range = max_ts - min_ts if max_ts != min_ts else 1.0

        # Reserve space for arrow at end (4 chars) and start marker (2 chars)
        usable = width - 6  # |-- ... --->
        if usable < 10:
            usable = 10

        # Build a character grid for the bar
        bar_chars = list(" " * usable)

        # Place epoch markers
        markers: List[Dict[str, Any]] = []
        for i, ep in enumerate(sorted_epochs):
            ts = ep.get("timestamp", 0)
            norm_pos = (ts - min_ts) / ts_range
            char_idx = int(norm_pos * (usable - 1))
            char_idx = max(0, min(char_idx, usable - 1))

            label = ep.get("label", f"E{i+1}")
            # Shorten label to fit
            short = self._shorten_label(label, max_len=6)
            marker_tag = f"[{short}]"

            markers.append({
                "index": i,
                "char_pos": char_idx,
                "tag": marker_tag,
                "epoch": ep,
            })

        # Resolve overlaps: if markers are too close, shift them
        markers = self._resolve_marker_overlaps(markers, usable)

        # Build the bar line with markers embedded
        # Strategy: build the base bar, then overlay markers
        bar_line = list("·" * usable)  # use middle-dot for empty timeline

        for m in markers:
            pos = m["char_pos"]
            tag = m["tag"]
            tag_len = len(tag)
            end_pos = min(pos + tag_len, usable)
            for ci in range(pos, end_pos):
                bar_line[ci] = " "
            # Write tag characters
            for ti, ch in enumerate(tag):
                ci = pos + ti
                if ci < usable:
                    bar_line[ci] = ch

        bar_str = "".join(bar_line)
        top_line = f"|─{bar_str}──→"

        # Build legend
        legend_lines = []
        for m in markers:
            ep = m["epoch"]
            label = ep.get("label", "?")
            ts = ep.get("timestamp", 0)
            ep_id = ep.get("id", "?")
            short = self._shorten_label(label, max_len=6)
            legend_lines.append(f"  [{short}] = {label} @ t={ts:.3f}s  (id: {ep_id})")

        result_lines = [top_line, ""]
        result_lines.extend(legend_lines)

        return "\n".join(result_lines)

    # ── Superposition Tree ─────────────────────────────────────────────

    def render_superposition_tree(
        self,
        branches: List[Dict[str, Any]],
    ) -> str:
        """
        Render superposition branches as a Unicode tree.

        Each branch dict should have:
            { branchId, probability, collapsed, collapsedAt, registeredAt, depth }

        Uncollapsed branches show their probability; collapsed branches
        are marked with [✓].

        Args:
            branches: List of branch dicts.

        Returns:
            Multi-line string with the tree.
        """
        if not branches:
            return "(no superposition branches)"

        # Group branches by depth
        depth_groups: Dict[int, List[Dict[str, Any]]] = {}
        for b in branches:
            d = b.get("depth", 0)
            depth_groups.setdefault(d, []).append(b)

        max_depth = max(depth_groups.keys()) if depth_groups else 0

        lines = ["Timeline Root"]

        for depth in range(max_depth + 1):
            group = depth_groups.get(depth, [])
            is_last_depth = (depth == max_depth)

            for i, branch in enumerate(group):
                is_last_in_group = (i == len(group) - 1)
                connector = BRANCH_LAST if is_last_in_group else BRANCH_TEE

                bid = branch.get("branchId", "?")
                prob = branch.get("probability", 0)
                collapsed = branch.get("collapsed", False)
                reg_at = branch.get("registeredAt", 0)

                # Probability bar (visual indicator)
                bar_len = max(1, int(prob * 10))
                prob_bar = "█" * bar_len + "░" * (10 - bar_len)

                status = ""
                if collapsed:
                    coll_at = branch.get("collapsedAt", "?")
                    status = f" [✓ collapsed @ t={coll_at}]"
                else:
                    status = " [active]"

                prefix = BRANCH_PIPE * depth
                if depth > 0:
                    # Replace last pipe segment with appropriate connector
                    prefix = BRANCH_SPACE * (depth - 1) + connector + " "

                line = f"{prefix}{bid}  {prob_bar} p={prob:.3f}{status}  registered@t={reg_at:.3f}"
                lines.append(line)

                # If collapsed, show observed state summary
                if collapsed and branch.get("observedState"):
                    state = branch["observedState"]
                    state_str = json.dumps(state, default=str)
                    if len(state_str) > 60:
                        state_str = state_str[:57] + "..."
                    indent = BRANCH_SPACE * depth + ("│  " if not is_last_in_group else "   ")
                    lines.append(f"{indent}→ state: {state_str}")

        return "\n".join(lines)

    # ── Epoch Detail ───────────────────────────────────────────────────

    def render_epoch_detail(
        self,
        epoch: Dict[str, Any],
        indent: int = 0,
    ) -> str:
        """
        Render detailed information about a single epoch.

        Args:
            epoch:  EpochRecord dict.
            indent: Number of spaces to indent.

        Returns:
            Multi-line string with epoch details.
        """
        pad = " " * indent

        ep_id = epoch.get("id", "unknown")
        timeline_id = epoch.get("timelineId", "unknown")
        timestamp = epoch.get("timestamp", 0)
        label = epoch.get("label", "unlabeled")
        data = epoch.get("data", {})
        hash_val = epoch.get("hash", "N/A")

        lines = [
            f"{pad}╔══════════════════════════════════════════╗",
            f"{pad}║  EPOCH DETAIL                            ║",
            f"{pad}╠══════════════════════════════════════════╣",
            f"{pad}║  ID:          {ep_id:<27}║",
            f"{pad}║  Timeline:    {timeline_id:<27}║",
            f"{pad}║  Timestamp:   {timestamp:<27.6f}║",
            f"{pad}║  Label:       {label:<27}║",
            f"{pad}║  SHA-256:     {hash_val[:27]:<27}║",
            f"{pad}╠══════════════════════════════════════════╣",
            f"{pad}║  DATA:                                   ║",
        ]

        # Format data as wrapped lines
        data_json = json.dumps(data, indent=2, default=str, sort_keys=True)
        wrapped = textwrap.wrap(data_json, width=38)
        for wline in wrapped:
            lines.append(f"{pad}║  {wline:<40}║")

        lines.append(f"{pad}╚══════════════════════════════════════════╝")

        return "\n".join(lines)

    # ── Temporal Heatmap ───────────────────────────────────────────────

    def render_heatmap(
        self,
        epochs: List[Dict[str, Any]],
        bins: int = 20,
    ) -> str:
        """
        Render temporal activity as a heatmap using Unicode block chars.

        Density indicators: ░ (low) → ▒ → ▓ → █ (high)

        Args:
            epochs: List of EpochRecord dicts.
            bins:   Number of horizontal bins (columns).

        Returns:
            Multi-line string with the heatmap and scale.
        """
        if not epochs:
            return "(no epochs for heatmap)"

        bins = max(5, min(bins, 120))

        sorted_epochs = sorted(epochs, key=lambda e: e.get("timestamp", 0))
        min_ts = sorted_epochs[0].get("timestamp", 0)
        max_ts = sorted_epochs[-1].get("timestamp", 0)
        ts_range = max_ts - min_ts if max_ts != min_ts else 1.0

        # Bin the epochs
        bin_counts = [0] * bins
        for ep in sorted_epochs:
            ts = ep.get("timestamp", 0)
            norm = (ts - min_ts) / ts_range
            idx = int(norm * (bins - 1))
            idx = max(0, min(idx, bins - 1))
            bin_counts[idx] += 1

        max_count = max(bin_counts) if bin_counts else 1
        if max_count == 0:
            max_count = 1

        # Build heatmap rows — we render 3 rows for visual height
        rows = []
        for row_idx in range(3):
            row_chars = []
            for count in bin_counts:
                # Scale density
                density = (count / max_count) * DENSITY_LEVELS
                # Add vertical variation for visual texture
                adjusted = density + (row_idx - 1) * 0.3
                adjusted = max(0, min(DENSITY_LEVELS, adjusted))
                char_idx = round(adjusted)
                char_idx = max(0, min(char_idx, DENSITY_LEVELS))
                row_chars.append(DENSITY_CHARS[char_idx])
            rows.append("".join(row_chars))

        # Build header with time labels
        header = self._render_time_axis(min_ts, max_ts, bins)

        # Build scale legend
        scale = "Density: " + " ".join(
            f"{DENSITY_CHARS[i]}={label}"
            for i, label in enumerate(["none", "low", "med", "high", "max"])
        )

        # Build count annotation (show count for non-zero bins)
        count_line = list(" " * bins)
        for i, count in enumerate(bin_counts):
            if count > 0:
                count_str = str(count)
                # Place count centered on bin
                start = max(0, i - len(count_str) // 2)
                for ci, ch in enumerate(count_str):
                    if start + ci < bins:
                        count_line[start + ci] = ch

        lines = [header]
        for row in rows:
            lines.append(f"  {row}")
        lines.append(f"  {''.join(count_line)}")
        lines.append("")
        lines.append(scale)

        return "\n".join(lines)

    # ── State Transition Diagram ───────────────────────────────────────

    def render_state_transition(
        self,
        epochs: List[Dict[str, Any]],
    ) -> str:
        """
        Render state transition diagram from epochs.

        Looks for epochs with labels matching 'timeline:*' patterns
        to extract state transitions.

        Format: IDLE ──→ PLAYING ──→ PAUSED ──→ PLAYING ──→ DONE

        Args:
            epochs: List of EpochRecord dicts.

        Returns:
            Multi-line string with the state transition diagram.
        """
        if not epochs:
            return "(no epochs for state diagram)"

        # Extract state transitions from epoch labels
        # Expected labels: timeline:created, timeline:paused, timeline:resumed,
        #                 timeline:complete, superposition:observed, etc.
        sorted_epochs = sorted(epochs, key=lambda e: e.get("timestamp", 0))

        # Map labels to states
        state_sequence = []
        for ep in sorted_epochs:
            label = ep.get("label", "")
            state = self._label_to_state(label)
            if state:
                state_sequence.append({
                    "state": state,
                    "timestamp": ep.get("timestamp", 0),
                    "label": label,
                })

        if not state_sequence:
            return "(no state transitions detected in epochs)"

        # Deduplicate consecutive same states
        deduped = [state_sequence[0]]
        for s in state_sequence[1:]:
            if s["state"] != deduped[-1]["state"]:
                deduped.append(s)

        # Build the diagram
        # Line 1: state boxes with arrows
        # Line 2: timestamps
        state_parts = []
        time_parts = []

        for i, s in enumerate(deduped):
            state_name = s["state"]
            ts = s["timestamp"]

            if i > 0:
                state_parts.append(STATE_ARROW)
                time_parts.append("       ")

            # Pad state name to 8 chars minimum
            padded = f" {state_name} "
            state_parts.append(padded)
            time_str = f" t={ts:.2f} "
            # Align time string with state
            if len(time_str) < len(padded):
                time_str = time_str + " " * (len(padded) - len(time_str))
            elif len(time_str) > len(padded):
                padded = padded + " " * (len(time_str) - len(padded))
                state_parts[-1] = padded
            time_parts.append(time_str)

        # Build box drawing around states
        state_line = "".join(state_parts)
        time_line = "".join(time_parts)

        # Add top and bottom borders for each state box
        top_border = []
        bottom_border = []
        for i, s in enumerate(deduped):
            if i > 0:
                top_border.append(STATE_ARROW)
                bottom_border.append(STATE_ARROW)

            state_name = s["state"]
            padded = f" {state_name} "
            box_w = len(padded)
            top_border.append("─" * box_w)
            bottom_border.append("─" * box_w)

        top_line = "".join(top_border)
        bottom_line = "".join(bottom_border)

        lines = [
            f"  {top_line}",
            f"  {state_line}",
            f"  {bottom_line}",
            f"  {time_line}",
        ]

        # Summary
        lines.append("")
        total = len(deduped)
        unique = len(set(s["state"] for s in deduped))
        lines.append(f"  Transitions: {total - 1}  |  Unique states: {unique}")

        return "\n".join(lines)

    # ── Private Helpers ────────────────────────────────────────────────

    @staticmethod
    def _shorten_label(label: str, max_len: int = 6) -> str:
        """Shorten a label to fit within max_len characters."""
        if len(label) <= max_len:
            return label
        # Try splitting on common delimiters
        parts = label.replace(":", " ").replace("_", " ").replace("-", " ").split()
        if parts:
            # Use first letter of each part
            short = "".join(p[0].upper() for p in parts if p)
            if len(short) <= max_len:
                return short
        # Truncate with ellipsis indicator
        return label[: max_len - 1] + "·"

    @staticmethod
    def _resolve_marker_overlaps(
        markers: List[Dict[str, Any]], usable: int
    ) -> List[Dict[str, Any]]:
        """
        Resolve marker position overlaps by shifting markers apart.
        """
        if len(markers) <= 1:
            return markers

        # Sort by char_pos
        markers.sort(key=lambda m: m["char_pos"])

        # Minimum gap between markers (tag length + 1)
        for i in range(1, len(markers)):
            prev_end = markers[i - 1]["char_pos"] + len(markers[i - 1]["tag"])
            curr_start = markers[i]["char_pos"]
            if curr_start < prev_end + 1:
                # Shift current marker right
                markers[i]["char_pos"] = prev_end + 1
                # Clamp
                if markers[i]["char_pos"] >= usable:
                    markers[i]["char_pos"] = usable - len(markers[i]["tag"])

        return markers

    @staticmethod
    def _render_time_axis(min_ts: float, max_ts: float, width: int) -> str:
        """Render a time axis with start/end labels."""
        start_label = f"{min_ts:.1f}s"
        end_label = f"{max_ts:.1f}s"

        if width <= len(start_label) + len(end_label) + 4:
            return f"{start_label} .. {end_label}"

        gap = width - len(start_label) - len(end_label)
        axis_line = "─" * gap
        return f"  {start_label}{axis_line}{end_label}"

    @staticmethod
    def _label_to_state(label: str) -> Optional[str]:
        """
        Map an epoch label to a cognitive state name.
        """
        label_lower = label.lower()

        mapping = {
            "timeline:created": "IDLE",
            "timeline:resumed": "PLAYING",
            "timeline:paused": "PAUSED",
            "timeline:complete": "DONE",
            "timeline:scrubbed": "SCRUB",
            "superposition:observed": "OBSERVE",
            "superposition:registered": "BRANCH",
        }

        # Direct match
        if label in mapping:
            return mapping[label]

        # Partial match
        for key, state in mapping.items():
            if key in label_lower:
                return state

        # Generic extraction from label
        if "creat" in label_lower:
            return "IDLE"
        if "resum" in label_lower or "play" in label_lower or "start" in label_lower:
            return "PLAYING"
        if "paus" in label_lower or "stop" in label_lower:
            return "PAUSED"
        if "complet" in label_lower or "done" in label_lower or "finish" in label_lower:
            return "DONE"
        if "observ" in label_lower or "collaps" in label_lower:
            return "OBSERVE"
        if "branch" in label_lower or "super" in label_lower:
            return "BRANCH"
        if "scrub" in label_lower or "seek" in label_lower:
            return "SCRUB"

        return None


# ── Standalone convenience functions ───────────────────────────────────

def render_timeline(epochs: List[Dict[str, Any]], width: int = 80) -> str:
    """Convenience: render timeline without instantiating the class."""
    return CognitiveEpochVisualizer().render_timeline(epochs, width)


def render_superposition_tree(branches: List[Dict[str, Any]]) -> str:
    """Convenience: render superposition tree without instantiating the class."""
    return CognitiveEpochVisualizer().render_superposition_tree(branches)


def render_epoch_detail(epoch: Dict[str, Any], indent: int = 0) -> str:
    """Convenience: render epoch detail without instantiating the class."""
    return CognitiveEpochVisualizer().render_epoch_detail(epoch, indent)


def render_heatmap(epochs: List[Dict[str, Any]], bins: int = 20) -> str:
    """Convenience: render heatmap without instantiating the class."""
    return CognitiveEpochVisualizer().render_heatmap(epochs, bins)


def render_state_transition(epochs: List[Dict[str, Any]]) -> str:
    """Convenience: render state transition diagram without instantiating the class."""
    return CognitiveEpochVisualizer().render_state_transition(epochs)


# ── Self-test ──────────────────────────────────────────────────────────

def _self_test() -> None:
    """
    Run a quick self-test to verify all visualization methods produce output.
    """
    print("=== Cognitive Epoch Visualizer Self-Test ===\n")

    viz = CognitiveEpochVisualizer()

    # Test data
    epochs = [
        {"id": "e1", "timelineId": "tl1", "timestamp": 0.0, "label": "timeline:created", "data": {"x": 0}, "hash": "abc123"},
        {"id": "e2", "timelineId": "tl1", "timestamp": 1.5, "label": "timeline:resumed", "data": {"x": 50}, "hash": "def456"},
        {"id": "e3", "timelineId": "tl1", "timestamp": 3.0, "label": "timeline:paused", "data": {"x": 100}, "hash": "ghi789"},
        {"id": "e4", "timelineId": "tl1", "timestamp": 4.2, "label": "timeline:resumed", "data": {"x": 75}, "hash": "jkl012"},
        {"id": "e5", "timelineId": "tl1", "timestamp": 6.0, "label": "timeline:complete", "data": {"x": 200}, "hash": "mno345"},
    ]

    print("--- Timeline Bar ---")
    print(viz.render_timeline(epochs, width=60))
    print()

    branches = [
        {"branchId": "alpha", "probability": 0.7, "collapsed": False, "collapsedAt": None, "registeredAt": 0.0, "depth": 0},
        {"branchId": "beta", "probability": 0.3, "collapsed": True, "collapsedAt": 3.0, "registeredAt": 0.0, "depth": 0, "observedState": {"x": 42}},
        {"branchId": "gamma", "probability": 0.5, "collapsed": False, "collapsedAt": None, "registeredAt": 1.5, "depth": 1},
    ]

    print("--- Superposition Tree ---")
    print(viz.render_superposition_tree(branches))
    print()

    print("--- Epoch Detail ---")
    print(viz.render_epoch_detail(epochs[2]))
    print()

    print("--- Heatmap ---")
    print(viz.render_heatmap(epochs, bins=30))
    print()

    print("--- State Transition ---")
    print(viz.render_state_transition(epochs))
    print()

    print("=== All self-tests passed ===")


if __name__ == "__main__":
    _self_test()
