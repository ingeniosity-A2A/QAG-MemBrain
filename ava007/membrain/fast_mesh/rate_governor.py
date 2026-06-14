"""
Token-bucket rate governor for the QAG-MemBrain fast_mesh layer.

Provides per-provider rate limiting using the token-bucket algorithm.  Each
provider (e.g. 'r2', 'ipfs', 'local') has its own bucket with configurable
refill rate and burst capacity.  All state mutations are protected by a
threading.Lock for thread safety.
"""

import threading
import time
from dataclasses import dataclass, field
from typing import Dict, Optional


@dataclass
class BucketState:
    """Mutable state of a single token bucket."""
    tokens: float
    max_tokens: float
    refill_rate: float  # tokens per second
    last_refill: float  # monotonic timestamp


# Default provider configurations: (refill_rate per second, burst capacity)
_DEFAULT_PROVIDERS: Dict[str, Dict[str, float]] = {
    "r2":    {"rate": 1000.0 / 60.0, "burst": 100},   # 1000 req/min
    "ipfs":  {"rate": 100.0 / 60.0,  "burst": 20},    # 100 req/min
    "local": {"rate": float("inf"),   "burst": float("inf")},  # unlimited
}


class RateGovernor:
    """
    Token-bucket rate limiter, one bucket per provider.

    Usage::

        gov = RateGovernor()
        if gov.acquire("r2"):
            # proceed with R2 request
            ...
        else:
            # rate-limited, back off
            ...

    The governor is thread-safe: concurrent ``acquire`` calls will not
    corrupt bucket state.
    """

    def __init__(
        self,
        providers: Optional[Dict[str, Dict[str, float]]] = None,
    ) -> None:
        """
        Initialise the governor.

        Parameters
        ----------
        providers:
            Optional dict mapping provider names to ``{"rate": float, "burst": int}``
            configurations.  Merged with the built-in defaults for 'r2', 'ipfs',
            and 'local'.  Pass an entry for a built-in key to override its
            defaults.
        """
        self._lock = threading.Lock()
        self._buckets: Dict[str, BucketState] = {}

        # Start with defaults
        configs: Dict[str, Dict[str, float]] = dict(_DEFAULT_PROVIDERS)

        # Merge user-supplied overrides / additions
        if providers:
            for name, cfg in providers.items():
                configs[name] = cfg

        # Pre-create buckets
        now = time.monotonic()
        for name, cfg in configs.items():
            burst = cfg.get("burst", float("inf"))
            rate = cfg.get("rate", float("inf"))
            self._buckets[name] = BucketState(
                tokens=float(burst),
                max_tokens=float(burst),
                refill_rate=float(rate),
                last_refill=now,
            )

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _refill(self, bucket: BucketState) -> None:
        """Top up *bucket* according to elapsed time since last refill."""
        now = time.monotonic()
        elapsed = now - bucket.last_refill
        if elapsed <= 0:
            return
        added = elapsed * bucket.refill_rate
        bucket.tokens = min(bucket.max_tokens, bucket.tokens + added)
        bucket.last_refill = now

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def acquire(self, provider: str, tokens: int = 1) -> bool:
        """
        Attempt to consume *tokens* from the bucket for *provider*.

        Returns ``True`` if the request is allowed (enough tokens were
        available and consumed), ``False`` if the bucket is exhausted.
        For the ``local`` provider (unlimited rate) this always returns
        ``True``.
        """
        with self._lock:
            bucket = self._buckets.get(provider)
            if bucket is None:
                raise KeyError(f"Unknown provider {provider!r}; configure it first via configure()")

            # Unlimited providers always succeed
            if bucket.max_tokens == float("inf"):
                return True

            self._refill(bucket)

            if bucket.tokens >= tokens:
                bucket.tokens -= tokens
                return True
            return False

    def get_remaining(self, provider: str) -> float:
        """Return the current number of available tokens for *provider*."""
        with self._lock:
            bucket = self._buckets.get(provider)
            if bucket is None:
                raise KeyError(f"Unknown provider {provider!r}")
            self._refill(bucket)
            return bucket.tokens

    def reset(self, provider: str) -> None:
        """Reset the bucket for *provider* to its maximum capacity."""
        with self._lock:
            bucket = self._buckets.get(provider)
            if bucket is None:
                raise KeyError(f"Unknown provider {provider!r}")
            bucket.tokens = bucket.max_tokens
            bucket.last_refill = time.monotonic()

    def configure(self, provider: str, rate: float, burst: int) -> None:
        """
        Configure (or reconfigure) a provider bucket.

        Parameters
        ----------
        provider:
            Bucket name (e.g. ``"r2"``).
        rate:
            Refill rate in **tokens per second**.
        burst:
            Maximum burst capacity (also the initial token count).
        """
        with self._lock:
            now = time.monotonic()
            self._buckets[provider] = BucketState(
                tokens=float(burst),
                max_tokens=float(burst),
                refill_rate=float(rate),
                last_refill=now,
            )

    def get_providers(self) -> list:
        """Return a sorted list of configured provider names."""
        with self._lock:
            return sorted(self._buckets.keys())

    def get_bucket_info(self, provider: str) -> Dict[str, float]:
        """Return a snapshot of the bucket state for *provider*."""
        with self._lock:
            bucket = self._buckets.get(provider)
            if bucket is None:
                raise KeyError(f"Unknown provider {provider!r}")
            self._refill(bucket)
            return {
                "tokens": bucket.tokens,
                "max_tokens": bucket.max_tokens,
                "refill_rate": bucket.refill_rate,
                "last_refill": bucket.last_refill,
            }
