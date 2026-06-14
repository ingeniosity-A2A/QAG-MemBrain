"""
orchestration.py — Query Orchestration for QAG-MemBrain Pipeline (Layer 7).

Manages the end-to-end query flow with stage tracking, cancellation,
and retry-from-failure support.  Each query proceeds through a configurable
sequence of stages, with per-stage timing, status, and output tracking.

Default stages:
    ingest → route → retrieve → augment → generate → writeback → respond

If a stage fails, the orchestrator records the error and stops.  The
``retry()`` method re-runs from the failed stage onward using cached
outputs from previously completed stages.
"""

from __future__ import annotations

import threading
import time
import uuid
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List, Optional


# ---------------------------------------------------------------------------
# Data structures
# ---------------------------------------------------------------------------

class StageStatus:
    """Stage execution status constants."""
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"


@dataclass
class StageResult:
    """Result of a single orchestration stage.

    Attributes:
        name:        Stage name (e.g. 'ingest', 'route').
        status:      One of 'pending', 'running', 'completed', 'failed'.
        duration_ms: Wall-clock duration in milliseconds (0 if not yet run).
        output:      Stage output data (None if pending/failed).
        error:       Error message if the stage failed (None otherwise).
    """
    name: str
    status: str = StageStatus.PENDING
    duration_ms: float = 0.0
    output: Optional[Any] = None
    error: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        return {
            "name": self.name,
            "status": self.status,
            "duration_ms": self.duration_ms,
            "output": self.output,
            "error": self.error,
        }


@dataclass
class OrchestrationResult:
    """Result of an orchestrated query execution.

    Attributes:
        query_id:          Unique identifier for the query.
        stages:            List of StageResult for each stage executed.
        final_result:      The final output of the pipeline (if successful).
        total_duration_ms: Total wall-clock duration in milliseconds.
        success:           Whether all stages completed successfully.
    """
    query_id: str
    stages: List[StageResult] = field(default_factory=list)
    final_result: Optional[Any] = None
    total_duration_ms: float = 0.0
    success: bool = False

    def to_dict(self) -> Dict[str, Any]:
        return {
            "query_id": self.query_id,
            "stages": [s.to_dict() for s in self.stages],
            "final_result": self.final_result,
            "total_duration_ms": self.total_duration_ms,
            "success": self.success,
        }


# ---------------------------------------------------------------------------
# Default stages
# ---------------------------------------------------------------------------

DEFAULT_STAGES = [
    "ingest",
    "route",
    "retrieve",
    "augment",
    "generate",
    "writeback",
    "respond",
]


# ---------------------------------------------------------------------------
# QueryOrchestrator
# ---------------------------------------------------------------------------

class QueryOrchestrator:
    """Manages end-to-end query flow with stage tracking.

    Parameters
    ----------
    stages : list of str or None
        Custom stage names. If None, uses DEFAULT_STAGES.
    stage_handlers : dict or None
        Mapping from stage name to callable handler.
        Each handler receives (query, context, prev_output) and returns
        a result dict.  If a stage has no handler, a no-op passthrough
        is used.

    The orchestrator is thread-safe: concurrent orchestrate/cancel/retry
    calls are serialized per query_id via a lock map.
    """

    def __init__(
        self,
        stages: Optional[List[str]] = None,
        stage_handlers: Optional[Dict[str, Callable]] = None,
    ) -> None:
        self._stages = stages if stages is not None else list(DEFAULT_STAGES)
        self._handlers: Dict[str, Callable] = dict(stage_handlers or {})

        # Per-query state: {query_id: _QueryState}
        self._queries: Dict[str, _QueryState] = {}
        self._queries_lock = threading.Lock()

        # Per-query execution locks to prevent concurrent stage runs
        self._exec_locks: Dict[str, threading.Lock] = {}
        self._exec_locks_lock = threading.Lock()

    # ------------------------------------------------------------------
    # Core orchestration
    # ------------------------------------------------------------------

    def orchestrate(
        self,
        query: str,
        stages: Optional[List[str]] = None,
    ) -> OrchestrationResult:
        """Execute a query through the orchestration stages.

        Parameters
        ----------
        query : str
            The query string to process.
        stages : list of str or None
            Override stages for this call. If None, uses the default stages
            configured at construction.

        Returns
        -------
        OrchestrationResult
        """
        query_id = str(uuid.uuid4())
        stage_names = stages if stages is not None else list(self._stages)

        # Create execution lock
        with self._exec_locks_lock:
            self._exec_locks[query_id] = threading.Lock()

        # Create query state
        state = _QueryState(
            query_id=query_id,
            query=query,
            stages=[StageResult(name=s) for s in stage_names],
        )

        with self._queries_lock:
            self._queries[query_id] = state

        # Execute stages
        return self._run_stages(query_id, state, start_from=0)

    # ------------------------------------------------------------------
    # Stage status
    # ------------------------------------------------------------------

    def get_stage_status(self, query_id: str) -> Optional[Dict[str, Any]]:
        """Get the status of all stages for a query.

        Parameters
        ----------
        query_id : str
            The query identifier.

        Returns
        -------
        dict or None
            Dict with 'query_id', 'stages', 'current_stage', 'success',
            or None if query_id not found.
        """
        with self._queries_lock:
            state = self._queries.get(query_id)

        if state is None:
            return None

        stages_info = []
        current_stage = None
        for sr in state.stages:
            stages_info.append({
                "name": sr.name,
                "status": sr.status,
                "duration_ms": sr.duration_ms,
                "error": sr.error,
            })
            if sr.status == StageStatus.RUNNING:
                current_stage = sr.name

        return {
            "query_id": query_id,
            "stages": stages_info,
            "current_stage": current_stage,
            "success": state.success,
        }

    # ------------------------------------------------------------------
    # Cancellation
    # ------------------------------------------------------------------

    def cancel(self, query_id: str) -> bool:
        """Cancel a running query.

        Marks any remaining pending stages as failed with a cancellation
        error.  Returns True if the query was found and cancelled,
        False if not found or already completed.

        Parameters
        ----------
        query_id : str
            The query identifier.

        Returns
        -------
        bool
        """
        with self._queries_lock:
            state = self._queries.get(query_id)

        if state is None:
            return False

        # Acquire per-query lock
        with self._exec_locks_lock:
            lock = self._exec_locks.get(query_id)

        if lock is not None:
            with lock:
                if state.success:
                    return False

                state.cancelled = True
                # Mark all pending stages as failed
                for sr in state.stages:
                    if sr.status in (StageStatus.PENDING, StageStatus.RUNNING):
                        sr.status = StageStatus.FAILED
                        sr.error = "Cancelled by user"
                return True
        else:
            # No lock found — query already finished
            return False

    # ------------------------------------------------------------------
    # Retry
    # ------------------------------------------------------------------

    def retry(self, query_id: str) -> OrchestrationResult:
        """Retry a failed query from the failed stage.

        Re-runs from the first failed stage using cached outputs from
        previously completed stages.

        Parameters
        ----------
        query_id : str
            The query identifier to retry.

        Returns
        -------
        OrchestrationResult

        Raises
        ------
        KeyError
            If query_id is not found.
        ValueError
            If the query has not failed (no stage to retry from).
        """
        with self._queries_lock:
            state = self._queries.get(query_id)

        if state is None:
            raise KeyError(f"Query {query_id!r} not found.")

        # Find the first failed stage
        failed_idx = None
        for i, sr in enumerate(state.stages):
            if sr.status == StageStatus.FAILED:
                failed_idx = i
                break

        if failed_idx is None:
            if state.success:
                raise ValueError(
                    f"Query {query_id!r} has already completed successfully; "
                    "nothing to retry."
                )
            else:
                raise ValueError(
                    f"Query {query_id!r} has no failed stage to retry from."
                )

        # Reset failed and pending stages
        for i in range(failed_idx, len(state.stages)):
            state.stages[i].status = StageStatus.PENDING
            state.stages[i].duration_ms = 0.0
            state.stages[i].output = None
            state.stages[i].error = None

        state.cancelled = False
        state.success = False

        # Re-run from the failed stage
        return self._run_stages(query_id, state, start_from=failed_idx)

    # ------------------------------------------------------------------
    # Properties
    # ------------------------------------------------------------------

    @property
    def stages(self) -> List[str]:
        """Return the configured stage names."""
        return list(self._stages)

    @property
    def active_query_count(self) -> int:
        """Return the number of queries currently tracked."""
        with self._queries_lock:
            return len(self._queries)

    # ------------------------------------------------------------------
    # Private helpers
    # ------------------------------------------------------------------

    def _run_stages(
        self,
        query_id: str,
        state: _QueryState,
        start_from: int = 0,
    ) -> OrchestrationResult:
        """Execute stages starting from start_from using cached context."""
        t0 = time.monotonic()

        with self._exec_locks_lock:
            lock = self._exec_locks.get(query_id)
        if lock is None:
            lock = threading.Lock()
            with self._exec_locks_lock:
                self._exec_locks[query_id] = lock

        with lock:
            # Build context from already-completed stages
            context: Dict[str, Any] = {"query": state.query}
            for i in range(start_from):
                sr = state.stages[i]
                if sr.status == StageStatus.COMPLETED and sr.output is not None:
                    context[sr.name] = sr.output

            prev_output: Optional[Any] = None
            if start_from > 0 and state.stages[start_from - 1].status == StageStatus.COMPLETED:
                prev_output = state.stages[start_from - 1].output

            # Execute stages
            for i in range(start_from, len(state.stages)):
                if state.cancelled:
                    break

                sr = state.stages[i]
                sr.status = StageStatus.RUNNING

                stage_t0 = time.monotonic()
                try:
                    handler = self._handlers.get(sr.name)
                    if handler is not None:
                        output = handler(state.query, context, prev_output)
                    else:
                        # No handler — passthrough
                        output = prev_output if prev_output is not None else {"query": state.query}

                    sr.output = output
                    sr.status = StageStatus.COMPLETED
                    sr.duration_ms = (time.monotonic() - stage_t0) * 1000.0

                    # Update context and prev_output for next stage
                    context[sr.name] = output
                    prev_output = output

                except Exception as exc:
                    sr.status = StageStatus.FAILED
                    sr.error = str(exc)
                    sr.duration_ms = (time.monotonic() - stage_t0) * 1000.0
                    # Stop on failure — no automatic partial retry
                    break

            # Determine success
            all_completed = all(
                sr.status == StageStatus.COMPLETED for sr in state.stages
            )
            state.success = all_completed

            total_duration_ms = (time.monotonic() - t0) * 1000.0

            # Final result is the output of the last completed stage
            final_result = None
            for sr in reversed(state.stages):
                if sr.status == StageStatus.COMPLETED and sr.output is not None:
                    final_result = sr.output
                    break

            return OrchestrationResult(
                query_id=query_id,
                stages=list(state.stages),
                final_result=final_result,
                total_duration_ms=total_duration_ms,
                success=state.success,
            )


# ---------------------------------------------------------------------------
# Internal query state
# ---------------------------------------------------------------------------

class _QueryState:
    """Internal mutable state for a tracked query."""

    def __init__(
        self,
        query_id: str,
        query: str,
        stages: List[StageResult],
    ) -> None:
        self.query_id = query_id
        self.query = query
        self.stages = stages
        self.success = False
        self.cancelled = False
