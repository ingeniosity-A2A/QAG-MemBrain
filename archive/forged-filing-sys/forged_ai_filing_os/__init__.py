"""
Forged-AI-Filing-OS
Ava007 Unified Intelligence Substrate
=====================================
Cybernetic VLM-LENS (Mercury 2.5)
+ Ingeniosity V-class
+ SALMONN-2 MICL / Audio2Face-3D
+ 3GPP Rel-19 ISAC Agent-X
+ 4-tier zero-copy memory
+ Forged File Standard v1.2.0 (F0 → F3 governance, Capability = Tools + Harness)

DEV-lock policy (docs/FORGED_FILE_STANDARD.md §8): modules that are specified but
not yet operational are imported lazily and reported via dev_lock_status(); they
must not break package import.
"""

__version__ = "2.8.0-exoskeleton-substrate"
__codename__ = "FFS v1.2.0 governance + Cybernetic VLM-LENS + V-class + MICL + ISAC"

from .forging import ForgingPipeline, ForgedArtifact, ForgeManifest, ManifestEntry
from .forging.standard import SPEC_VERSION, ForgedFileStandard

# --- DEV-locked cognitive modules (specified, not yet operational) --------------
# agents.ava007, lens.cybernetic_vlm_lens, memory.substrate, engine.rev_ike,
# refactor.super_refactor and their peers are specified in docs but their source
# is not present in this repository yet. Importing them eagerly broke the package
# (ImportError at import time). They are now imported lazily inside
# dev_lock_modules() and reported as DEV-locked until they exist and import.
DEV_LOCKED_MODULES: tuple[tuple[str, str], ...] = (
    ("agents.ava007", "Ava007Supervisor"),
    ("lens.cybernetic_vlm_lens", "CyberneticVLMLens"),
    ("memory.substrate", "ForgedMemorySubstrate"),
    ("engine.rev_ike", "RevIkeZeroCopyPipeline"),
    ("refactor.super_refactor", "SuperRefactorEngine"),
    ("vclass", "ArrowDataFabric/StateManifold/HippocampalPlanner/InternetOfAgents/IntellectSandbox"),
    ("audio", "Salmonn2MICL/BiasingMode/Audio2Face3D"),
    ("sensing", "ISACAgentX/SensingObjective"),
)


def dev_lock_modules() -> dict[str, str]:
    """Return {module: reason} for every module currently DEV-locked."""
    import importlib

    status: dict[str, str] = {}
    for mod_name, _symbol in DEV_LOCKED_MODULES:
        try:
            importlib.import_module(f".{mod_name}", package=__name__)
        except Exception:
            status[mod_name] = "source not present in repository (specified, not operational)"
    return status


__all__ = [
    "__version__",
    "__codename__",
    "SPEC_VERSION",
    "ForgedFileStandard",
    "ForgingPipeline",
    "ForgedArtifact",
    "ForgeManifest",
    "ManifestEntry",
    "DEV_LOCKED_MODULES",
    "dev_lock_modules",
]
