#!/usr/bin/env python3
"""
Forged-AI-Filing-OS — Ava007 Entry Point
========================================
Forged File Standard v1.0.0 lifecycle CLI (F0 → F3) + DEV-locked cognitive commands.

Governance commands (operational):
  init | status | spec | forge | manifest | verify | validate | vendor

Cognitive commands (DEV-locked — specified, not yet operational):
  recall | process | benchmark | 3d
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from forged_ai_filing_os import dev_lock_modules
from forged_ai_filing_os.config.defaults import VAULT_DIR
from forged_ai_filing_os.forging import (
    CapabilityCompiler,
    ForgedFileStandard,
    ForgingPipeline,
    SPEC_VERSION,
    detect,
)
from forged_ai_filing_os.forging.stores import DuckDBStore, RocksDBStore
from forged_ai_filing_os.forging.hub import MODEL_CARD_NAME, HubError, fetch_artifact, vendor_repo
from forged_ai_filing_os.forging.vendor import VendorError

VENDOR_ISOLATION_NOTE = (
    "Hugging Face is the vendor/input boundary (whole-model vendoring OUTSIDE F0→F3); "
    "vendored models are registered here but never enter the forging lifecycle."
)


def banner() -> None:
    print("=" * 70)
    print("  FORGED-AI-FILING-OS  ·  Ava007  ·  Forged File Standard v" + SPEC_VERSION)
    print("=" * 70)


def _pipeline(args: argparse.Namespace) -> ForgingPipeline:
    return ForgingPipeline(Path(args.vault))


def cmd_init(args: argparse.Namespace) -> None:
    banner()
    p = _pipeline(args)
    p.forged_dir.mkdir(parents=True, exist_ok=True)
    print(f"[OK] Vault: {p.vault}")
    print(f"[OK] RocksDB Skills backend: {p.skills_store.backend}"
          + ("  (DEV-locked)" if p.skills_store.dev_locked else ""))
    print(f"[OK] DuckDB Intelligence backend: {p.intelligence_store.backend}"
          + ("  (DEV-locked)" if p.intelligence_store.dev_locked else ""))
    locked = dev_lock_modules()
    if locked:
        print(f"[DEV-LOCKED] modules: {', '.join(sorted(locked))}")
    print("Initialization complete.")


def cmd_status(args: argparse.Namespace) -> None:
    banner()
    p = _pipeline(args)
    locked = dev_lock_modules()
    print(json.dumps({
        "vault": str(p.vault),
        "spec_version": SPEC_VERSION,
        "stores": {
            "skills": {"backend": p.skills_store.backend,
                       "dev_locked": p.skills_store.dev_locked},
            "intelligence": {"backend": p.intelligence_store.backend,
                             "dev_locked": p.intelligence_store.dev_locked},
        },
        "manifest": p.manifest.summary(),
        "dev_locked_modules": locked,
    }, indent=2))


def cmd_spec(args: argparse.Namespace) -> None:
    banner()
    std = ForgedFileStandard()
    errors = std.validate()
    print(f"Forged File Standard v{std.spec_version} — {'valid' if not errors else 'INVALID'}")
    if errors:
        for e in errors:
            print(f"  [!] {e}")
        sys.exit(1)
    print("Vocabulary (§1.1 — non-negotiable):")
    for forbidden, canonical in std.vocabulary.items():
        print(f"  {forbidden} → {canonical}")
    print("Capability equation: Capability = Tools + Harness (§6; no harness layer)")
    print("Stages:", " → ".join(s.name for s in std.stages))
    for s in std.stages:
        print(f"  {s.name}: {s.description}")
    for s in std.stores:
        print(f"  store {s.kind}: {s.backend} — {s.role}")
    print("Palette (three colors only):", ", ".join(std.palette))
    print("DEV-lock register:")
    for item in std.dev_locked:
        print(f"  • {item}")
    print("Vendor boundary:", VENDOR_ISOLATION_NOTE)


def cmd_forge(args: argparse.Namespace) -> None:
    banner()
    p = _pipeline(args)
    path = Path(args.file)
    if not path.exists():
        sys.exit(f"no such file: {path}")
    data = path.read_bytes()
    source = args.source or str(path)
    sha = p.upload_raw(data, source=source, mime=args.mime)
    print(f"[F0] raw upload  sha256={sha}  size={len(data)}  source={source}")
    artifact = p.forge(sha, domain=args.domain, source=source, mime=args.mime)
    print(f"[F1] chunks: {artifact.chunk_count}")
    print(f"[F2] forged file_id={artifact.file_id} "
          f"(skills={len(artifact.skills_keys)}, intelligence={len(artifact.intelligence_keys)})")
    print(f"[F3] registered in manifest: {p.manifest.path}")
    print(json.dumps({
        "file_id": artifact.file_id,
        "sha256": artifact.sha256,
        "chunk_count": artifact.chunk_count,
        "skills_keys": list(artifact.skills_keys),
        "intelligence_keys": list(artifact.intelligence_keys),
        "forged_at": artifact.forged_at,
    }, indent=2))


def cmd_manifest(args: argparse.Namespace) -> None:
    banner()
    p = _pipeline(args)
    print(json.dumps(p.manifest.summary(), indent=2))
    for e in p.manifest.all():
        print(f"  {e.file_id}  src={e.source}  domain={e.domain}  "
              f"chunks={e.chunk_count} (skills={e.skills_count}, intel={e.intelligence_count})")


def cmd_verify(args: argparse.Namespace) -> None:
    banner()
    p = _pipeline(args)
    ok, msg = p.verify_file(args.file_id)
    print(f"{args.file_id}: {'OK' if ok else 'FAIL'} — {msg}")
    sys.exit(0 if ok else 1)


def _validate_vault(p: ForgingPipeline) -> list[str]:
    errors: list[str] = []
    for e in p.manifest.all():
        ok, msg = p.verify_file(e.file_id)
        if not ok:
            errors.append(f"{e.file_id}: {msg}")
        bl = e.backlinks
        if not bl.get("source") or not (bl.get("skills_keys") or bl.get("intelligence_keys")):
            errors.append(f"{e.file_id}: incomplete backlinks (F3 requires source + store placement)")
    if p.forged_dir.exists():
        expected = {f"{e.file_id.replace(':', '#')}.forged.json" for e in p.manifest.all()}
        actual = {q.name for q in p.forged_dir.glob("*.forged.json")}
        for orphan in sorted(actual - expected):
            errors.append(f"orphan forged file not in manifest: {orphan}")
    return errors


def cmd_validate(args: argparse.Namespace) -> None:
    banner()
    errors = ForgedFileStandard().validate()
    p = _pipeline(args)
    errors += _validate_vault(p)
    if errors:
        print(f"VALIDATION FAILED ({len(errors)} error(s)):")
        for e in errors:
            print(f"  [!] {e}")
        sys.exit(1)
    print("OK — spec, lifecycle, stores, manifest and backlinks all valid.")


def cmd_vendor(args: argparse.Namespace) -> None:
    banner()
    print("[VENDOR] Hugging Face vendor boundary — OUTSIDE F0→F3")
    print(f"  vendored model: {args.repo_id}")
    print(f"  note: {VENDOR_ISOLATION_NOTE}")


def cmd_vendor_hub(args: argparse.Namespace) -> None:
    banner()
    p = _pipeline(args)
    print(f"[HUB] {args.repo_id} — vendor boundary, outside F0→F3")
    try:
        result = vendor_repo(args.repo_id, p.vendor, revision=args.revision)
    except HubError as exc:
        sys.exit(f"[HUB] {exc}")
    # Stage the model card as a curation document (F0 → F3 route, NOT vendor store).
    card_path = p.vault / "curation" / args.repo_id.replace("/", "__") / MODEL_CARD_NAME
    card_path.parent.mkdir(parents=True, exist_ok=True)
    try:
        card_bytes, _ = fetch_artifact(args.repo_id, MODEL_CARD_NAME, result["revision"] or "main")
        card_path.write_bytes(card_bytes)
        result["model_card_staged_at"] = str(card_path)
    except HubError as exc:
        result["model_card_error"] = str(exc)
    print(json.dumps(result, indent=2))
    if result.get("model_card_staged_at"):
        print("[HUB] model card staged as a curation document — forge it with:")
        print(f"  python -m forged_ai_filing_os.main --vault {p.vault} forge \\")
        print(f"      --file \"{result['model_card_staged_at']}\" --domain curation \\")
        print(f"      --source hf://{args.repo_id}/README.md")
    s = result["summary"]
    print(f"[HUB] imported={s['imported_count']} remote_refs={s['remote_ref_count']} "
          f"refused={s['refused_count']} weight_bytes_stayed_remote={s['weight_bytes_stayed_remote']}")


def cmd_vendor_scan(args: argparse.Namespace) -> None:
    banner()
    path = Path(args.file)
    if not path.exists():
        sys.exit(f"no such file: {path}")
    data = path.read_bytes()
    verdict = detect(data)
    print(json.dumps({
        "file": str(path),
        "size": len(data),
        "verdict": verdict.to_dict(),
        "note": "no blind truncation — declared header structure parsed",
    }, indent=2))


def cmd_vendor_import(args: argparse.Namespace) -> None:
    banner()
    p = _pipeline(args)
    path = Path(args.file)
    if not path.exists():
        sys.exit(f"no such file: {path}")
    try:
        imp = p.vendor.import_artifact(path.read_bytes(), args.repo_id, path.name)
    except VendorError as exc:
        sys.exit(f"[QUARANTINE] {exc}")
    print("[VENDOR] imported — outside the lifecycle, weights stay vendor-side")
    print(json.dumps(imp.to_dict(), indent=2))


def cmd_capability(args: argparse.Namespace) -> None:
    banner()
    p = _pipeline(args)
    compiler = CapabilityCompiler(args.vault, skills_store=p.skills_store)
    cap = compiler.compile_capability(
        capability_id=args.capability_id,
        skill_id=args.skill_id,
        forged_id=args.forged_id,
        harness={"entrypoint": args.entrypoint},
        tools=parse_dependency(args.tool),
        dependencies=parse_dependency(args.dependency),
        permissions={"execute": False},
    )
    print(f"[CAPABILITY] compiled {cap.capability_id} (loadable compile product, spec §6)")
    print(json.dumps(cap.to_dict(), indent=2, default=str))


def cmd_capability_list(args: argparse.Namespace) -> None:
    banner()
    compiler = CapabilityCompiler(args.vault, skills_store=None)
    caps = compiler.list_capabilities()
    print(json.dumps({"count": len(caps), "capabilities": caps}, indent=2))


def cmd_reforge(args: argparse.Namespace) -> None:
    banner()
    p = _pipeline(args)
    path = Path(args.file)
    if not path.exists():
        sys.exit(f"no such file: {path}")
    sha = p.upload_raw(path.read_bytes(), source=str(path), mime=args.mime)
    artifact = p.reforge(sha, domain=args.domain, source=str(path), mime=args.mime,
                         lineage=args.lineage)
    print(f"[F2] reforged file_id={artifact.file_id} (version {artifact.version})")
    print(f"[F3] registered; historical artifact untouched (immutability matrix)")


def cmd_trace(args: argparse.Namespace) -> None:
    banner()
    p = _pipeline(args)
    print(json.dumps(p.trace(args.file_id), indent=2))


def parse_dependency(deps: list[str]) -> dict[str, str]:
    """Parse --dependency name=reference pairs (vendor:// URIs or paths)."""
    out: dict[str, str] = {}
    for dep in deps or []:
        if "=" not in dep:
            raise SystemExit(f"--dependency expects name=reference, got {dep!r}")
        name, ref = dep.split("=", 1)
        out[name] = ref
    return out


def _dev_locked_exit(name: str) -> None:
    locked = dev_lock_modules()
    print(f"[DEV-LOCKED] '{name}' is specified but not yet operational.")
    print("  Missing modules: " + (", ".join(sorted(locked)) or "(unknown)"))
    sys.exit(3)


def cmd_recall(a: argparse.Namespace) -> None: _dev_locked_exit("recall")
def cmd_process(a: argparse.Namespace) -> None: _dev_locked_exit("process")
def cmd_benchmark(a: argparse.Namespace) -> None: _dev_locked_exit("benchmark")
def cmd_3d(a: argparse.Namespace) -> None: _dev_locked_exit("3d")


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Forged-AI-Filing-OS · Ava007 · Forged File Standard governance"
    )
    parser.add_argument("--vault", default=os.environ.get("AVA007_VAULT", str(VAULT_DIR)),
                        help="forge vault directory (F0/F2/F3 storage)")
    sub = parser.add_subparsers(dest="command", required=True)

    sub.add_parser("init", help="Initialize forge vault").set_defaults(func=cmd_init)
    sub.add_parser("status", help="Vault + store + manifest status").set_defaults(func=cmd_status)
    sub.add_parser("spec", help="Print Forged File Standard").set_defaults(func=cmd_spec)

    p_forge = sub.add_parser("forge", help="F0→F3: upload + forge a UTF-8 text file")
    p_forge.add_argument("file", type=str)
    p_forge.add_argument("--domain", default="general")
    p_forge.add_argument("--mime", default="text/plain")
    p_forge.add_argument("--source", default=None, help="canonical provenance source (e.g. hf://repo/file) overrides the path")
    p_forge.set_defaults(func=cmd_forge)

    sub.add_parser("manifest", help="F3 manifest summary").set_defaults(func=cmd_manifest)

    p_ver = sub.add_parser("verify", help="Verify reversibility + store placement for one file_id")
    p_ver.add_argument("file_id", type=str)
    p_ver.set_defaults(func=cmd_verify)

    sub.add_parser("validate", help="Run all governance invariants").set_defaults(func=cmd_validate)

    p_scan = sub.add_parser("vendor-scan", help="Detect artifact format (no blind truncation)")
    p_scan.add_argument("file", type=str)
    p_scan.set_defaults(func=cmd_vendor_scan)

    p_vimp = sub.add_parser("vendor-import", help="Import a vendor artifact (outside the lifecycle)")
    p_vimp.add_argument("file", type=str)
    p_vimp.add_argument("--repo-id", required=True)
    p_vimp.set_defaults(func=cmd_vendor_import)

    p_cap = sub.add_parser("capability", help="Compile a Capability = Tools + Harness (spec §6)")
    p_cap.add_argument("capability_id", type=str)
    p_cap.add_argument("--skill-id", required=True)
    p_cap.add_argument("--forged-id", required=True)
    p_cap.add_argument("--entrypoint", default="skill_chunk")
    p_cap.add_argument("--tool", action="append", default=[],
                       help="tool as name=reference (what the capability can use/do)")
    p_cap.add_argument("--dependency", action="append", default=[],
                       help="dependency as name=vendor://sha/file or name=path")
    p_cap.set_defaults(func=cmd_capability)

    sub.add_parser("capabilities", help="List compiled capabilities").set_defaults(func=cmd_capability_list)

    p_trace = sub.add_parser("trace", help="Print the provenance chain for a forged_id")
    p_trace.add_argument("file_id", type=str)
    p_trace.set_defaults(func=cmd_trace)

    p_rf = sub.add_parser("reforge", help="Forge changed content as forged_id:vN (spec §3)")
    p_rf.add_argument("file", type=str)
    p_rf.add_argument("--lineage", required=True, help="previous forged_id in the F3 manifest")
    p_rf.add_argument("--domain", default="general")
    p_rf.add_argument("--mime", default="text/plain")
    p_rf.set_defaults(func=cmd_reforge)

    p_vhub = sub.add_parser("vendor-hub", help="Vendor a Hugging Face model repo (outside F0→F3): governable artifacts locally, weight shards as verified remote refs")
    p_vhub.add_argument("repo_id", type=str)
    p_vhub.add_argument("--revision", default=None, help="pin to a revision (default: current HEAD sha)")
    p_vhub.set_defaults(func=cmd_vendor_hub)

    p_ven = sub.add_parser("vendor", help="Register a Hugging Face vendored model (outside lifecycle)")
    p_ven.add_argument("repo_id", type=str)
    p_ven.set_defaults(func=cmd_vendor)

    sub.add_parser("recall", help="[DEV-locked] real-time L1 skill recall").set_defaults(func=cmd_recall)
    p_proc = sub.add_parser("process", help="[DEV-locked] route an intelligence entry through the Lens")
    p_proc.add_argument("--text", type=str, default=None)
    p_proc.add_argument("--modality", default="text")
    p_proc.add_argument("--role", default="general")
    p_proc.add_argument("--hardware", default="cpu")
    p_proc.add_argument("--vision", action="store_true")
    p_proc.add_argument("--spatial3d", action="store_true")
    p_proc.set_defaults(func=cmd_process)
    p_bench = sub.add_parser("benchmark", help="[DEV-locked] zero-copy streaming benchmark")
    p_bench.add_argument("--records", type=int, default=5000)
    p_bench.set_defaults(func=cmd_benchmark)
    p_3d = sub.add_parser("3d", help="[DEV-locked] 3D spatial cognitive timeline request")
    p_3d.add_argument("--description", type=str, default=None)
    p_3d.set_defaults(func=cmd_3d)

    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
