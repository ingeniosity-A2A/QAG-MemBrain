"""
Ephemeral Log Policy — 24-hour semantic data minimization.

White paper DLI §2: "Ava007 implements a 24-hour ephemeral log policy,
extracting only goal-oriented semantic features while purging raw IQ
metadata to prevent behavioral fingerprinting."

Deploys to:
  - gsap_temporal (purge old timeline entries)
  - neo4j_graphrag (extract semantic features before purging)
"""

import time
import logging
from typing import List, Dict, Any, Optional

logger = logging.getLogger(__name__)

# 24 hours in nanoseconds
TWENTY_FOUR_HOURS_NS = 24 * 60 * 60 * 1_000_000_000


class EphemeralLogPolicy:
    """
    Enforces the 24-hour ephemeral log policy.

    Steps:
      1. Extract goal-oriented semantic features from raw logs
      2. Purge raw IQ metadata, signaling traces, RF samples
      3. Keep only the semantic features (compact, non-fingerprintable)
    """

    def __init__(self, retention_ns: int = TWENTY_FOUR_HOURS_NS):
        self.retention_ns = retention_ns
        self.purge_count = 0
        self.features_extracted = 0

    def should_purge(self, entry_timestamp_ns: int) -> bool:
        """Check if a log entry is older than the retention window."""
        now_ns = time.time_ns()
        age_ns = now_ns - entry_timestamp_ns
        return age_ns > self.retention_ns

    def extract_semantic_features(self, raw_entry: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """
        Extract goal-oriented semantic features from a raw log entry.

        Strips:
          - Raw IQ samples
          - Signaling message payloads
          - RF waveform data
          - Exact timestamps (coarsened to 1-minute buckets)
          - Location data beyond city-level

        Keeps:
          - Event type (e.g., "call", "sms", "data_session")
          - Duration (coarsened)
          - Outcome (success/failure)
          - Semantic category (e.g., "work", "personal")
        """
        if not raw_entry:
            return None

        # Extract only semantic features
        features = {
            'event_type': raw_entry.get('event_type', 'unknown'),
            'duration_bucket': self._coarse_duration(raw_entry.get('duration_s', 0)),
            'outcome': raw_entry.get('outcome', 'unknown'),
            'semantic_category': raw_entry.get('semantic_category', 'unclassified'),
            'timestamp_bucket': self._coarse_timestamp(raw_entry.get('timestamp_ns', 0)),
        }

        self.features_extracted += 1
        return features

    def purge_raw_entry(self, entry_id: str) -> bool:
        """
        Purge a raw log entry. In production, this calls gsap_temporal
        to remove the entry from the timeline + Context Ocean.
        """
        logger.info(f"Purging raw log entry: {entry_id}")
        self.purge_count += 1
        # In production: gsap_temporal.purge(entry_id)
        return True

    def enforce_policy(self, entries: List[Dict[str, Any]]) -> Dict[str, int]:
        """
        Enforce the ephemeral log policy on a batch of entries.
        Returns stats: {purged, features_extracted, kept}
        """
        stats = {'purged': 0, 'features_extracted': 0, 'kept': 0}

        for entry in entries:
            ts = entry.get('timestamp_ns', 0)
            if self.should_purge(ts):
                # Extract features BEFORE purging
                features = self.extract_semantic_features(entry)
                if features:
                    stats['features_extracted'] += 1
                    # In production: deposit features as a new Receipt
                # Purge the raw entry
                self.purge_raw_entry(entry.get('id', 'unknown'))
                stats['purged'] += 1
            else:
                stats['kept'] += 1

        logger.info(f"Ephemeral log policy enforced: {stats}")
        return stats

    @staticmethod
    def _coarse_duration(duration_s: float) -> str:
        """Coarsen duration to buckets to prevent fingerprinting."""
        if duration_s < 5:
            return "brief"
        elif duration_s < 60:
            return "short"
        elif duration_s < 300:
            return "medium"
        elif duration_s < 1800:
            return "long"
        else:
            return "extended"

    @staticmethod
    def _coarse_timestamp(ts_ns: int) -> int:
        """Coarsen timestamp to 1-minute buckets."""
        ns_per_minute = 60 * 1_000_000_000
        return (ts_ns // ns_per_minute) * ns_per_minute

    def status(self) -> dict:
        return {
            'retention_hours': self.retention_ns / (60 * 60 * 1e9),
            'purge_count': self.purge_count,
            'features_extracted': self.features_extracted,
        }
