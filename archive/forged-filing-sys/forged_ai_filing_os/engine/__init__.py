"""Engine surface — zero-copy stream lives on a2a-exoskeleton; optional local mirror."""

try:
    from a2a_exoskeleton.engine.rev_ike import RevIkeZeroCopyPipeline  # type: ignore
except Exception:
    try:
        from .rev_ike import RevIkeZeroCopyPipeline
    except Exception:
        RevIkeZeroCopyPipeline = None  # type: ignore

__all__ = ["RevIkeZeroCopyPipeline"]
