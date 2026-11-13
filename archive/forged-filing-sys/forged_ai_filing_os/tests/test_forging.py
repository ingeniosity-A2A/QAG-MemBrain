"""Unit tests for the Forged File Standard (F0 → F3 governance).

Run: python -m unittest discover -s forged_ai_filing_os/tests -v
"""

from __future__ import annotations

import random
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from forged_ai_filing_os.forging import (
    ForgedFileStandard,
    ForgingPipeline,
    GsapF1Visualizer,
    GSAPChunker,
    RocksDBStore,
    DuckDBStore,
    SPEC_VERSION,
    classify_chunk,
    CapabilityCompiler,
    CapabilityError,
    detect,
    skill_key,
    capability_key,
    parse_key,
    render_stack_value,
    NamespaceError,
    vendor_uri,
    VendorRegistry,
    CAPABILITY_SECTIONS,
    VOCABULARY,
)
from forged_ai_filing_os.forging.chunker import TextChunk, reconstruct
from forged_ai_filing_os.forging.pipeline import PrecheckError

SAMPLE = """# Ava007 Vault Boundary

The vault feeds the Manifesto Collection Intelligence Engine.

## Stages

- F0 raw upload is immutable
- F1 chunks are reversible

| store | role |
|-------|------|
| rocksdb | skills |

```python
def forge():
    return "F2"
```

Final paragraph before the end."""


class TestStandard(unittest.TestCase):
    def test_spec_is_valid(self):
        errors = ForgedFileStandard().validate()
        self.assertEqual(errors, [])

    def test_stage_order(self):
        std = ForgedFileStandard()
        self.assertEqual([s.name for s in std.stages], ["F0", "F1", "F2", "F3"])

    def test_palette_lock(self):
        self.assertEqual(tuple(ForgedFileStandard().palette), ("neutral", "orange", "yellow"))

    def test_dev_lock_register_nonempty(self):
        self.assertTrue(len(ForgedFileStandard().dev_locked) >= 1)


class TestChunker(unittest.TestCase):
    def test_structural_kinds(self):
        chunks = GSAPChunker("doc").chunk(SAMPLE)
        kinds = [c.kind for c in chunks]
        self.assertEqual(kinds[0], "heading")
        self.assertIn("code", kinds)
        self.assertIn("table", kinds)
        self.assertIn("list", kinds)

    def test_reversibility_exact(self):
        chunks = GSAPChunker("doc").chunk(SAMPLE)
        self.assertEqual(reconstruct(chunks), SAMPLE)
        self.assertIsNone(GSAPChunker.reversibility_error(chunks, SAMPLE))

    def test_reversibility_with_whitespace_islands(self):
        tricky = "alpha\n\n   \n\nbeta\n\n\n\ngamma   \n\n   \ndelta"
        chunks = GSAPChunker("doc").chunk(tricky)
        self.assertIsNone(GSAPChunker.reversibility_error(chunks, tricky))
        self.assertEqual(reconstruct(chunks), tricky)

    def test_reversibility_trailing_blank_run(self):
        # Regression: documents ending in a blank run lost their trailing bytes
        # (the final chunk's sep_after was dropped from reconstruction).
        for text in ("para one\n\npara two\n\n\n\n", "x\n\n\n", "a\n\n   \n\n"):
            chunks = GSAPChunker("doc").chunk(text)
            self.assertIsNone(GSAPChunker.reversibility_error(chunks, text), repr(text))
            self.assertEqual(reconstruct(chunks), text)

    def test_reversibility_whitespace_only_document(self):
        text = "\n\n  \n\n"
        chunks = GSAPChunker("doc").chunk(text)
        self.assertEqual(reconstruct(chunks), text)

    def test_reversibility_fuzz_seeded(self):
        rng = random.Random(20260916)
        for _ in range(2000):
            text = "".join(rng.choice("\n \tabc#|`*-1.\n\t") for _ in range(rng.randrange(0, 300)))
            chunks = GSAPChunker("doc").chunk(text)
            self.assertEqual(reconstruct(chunks), text)

    def test_offsets_in_bounds(self):
        chunks = GSAPChunker("doc").chunk(SAMPLE)
        self.assertIsNone(GSAPChunker.offsets_within(chunks, len(SAMPLE)))

    def test_visualizer_palette_only(self):
        viz = GsapF1Visualizer()
        GSAPChunker("doc", viz).chunk(SAMPLE)
        self.assertTrue(set(viz.palette_used()) <= {"neutral", "orange", "yellow"})


class TestStores(unittest.TestCase):
    def test_classification(self):
        code = TextChunk("d", 0, 0, 3, "code", "x=1")
        para = TextChunk("d", 1, 4, 10, "paragraph", "hello")
        self.assertEqual(classify_chunk(code), "code")
        self.assertEqual(classify_chunk(para), "intelligence")

    def test_rocksdb_insert_and_iterate(self):
        store = RocksDBStore()  # memory fallback when rocksdict absent
        k1 = store.insert({"text": "a"})
        k2 = store.insert({"text": "b"})
        pairs = list(store.iterate_prefix([k2, k1]))
        self.assertEqual([k for k, _ in pairs], [k1, k2])
        self.assertEqual(pairs[0][1]["text"], "a")
        store.close()

    def test_duckdb_filters(self):
        store = DuckDBStore()
        store.insert({"text": "t1", "domain": "legal"})
        store.insert({"text": "t2", "domain": "coding"})
        self.assertEqual(store.count(domain="legal"), 1)
        self.assertEqual(len(store.fetch(domain="coding")), 1)
        self.assertIn("legal", store.domains())
        store.close()


class TestDetector(unittest.TestCase):
    def test_safetensors_header_parse(self):
        import json as _json

        header = _json.dumps({"w": {"dtype": "F32", "shape": [2, 2]}}).encode()
        data = len(header).to_bytes(8, "little") + header + b"\x00" * 16
        v = detect(data)
        self.assertEqual(v.kind, "safetensors")
        self.assertTrue(v.parse_ok)
        self.assertIn("w", v.declared["tensors"])
        self.assertFalse(v.quarantine)

    def test_safetensors_truncated_refuses_to_guess(self):
        v = detect(b"\xff\x00" + b"{broken")
        self.assertFalse(v.parse_ok)

    def test_gguf_magic_and_counts(self):
        data = b"GGUF" + (3).to_bytes(4, "little") + (7).to_bytes(8, "little") + (11).to_bytes(8, "little")
        v = detect(data)
        self.assertEqual(v.kind, "gguf")
        self.assertTrue(v.parse_ok)
        self.assertEqual(v.declared["tensor_count"], 7)
        self.assertEqual(v.declared["kv_count"], 11)

    def test_tokenizer_config_json(self):
        import json as _json

        v = detect(_json.dumps({"model_type": "bert", "vocab_size": 30522}).encode())
        self.assertEqual(v.kind, "tokenizer_config")
        self.assertTrue(v.parse_ok)

    def test_python_source_needs_filename_and_parses(self):
        v = detect(b"def x():\n    return 1\n")  # no filename: no magic, no guess
        self.assertEqual(v.kind, "unknown")
        self.assertTrue(v.quarantine)
        v = detect(b"def x():\n    return 1\n", filename="checkpoint_folder_full/modeling_nemotron_h.py")
        self.assertEqual(v.kind, "python")
        self.assertTrue(v.parse_ok)
        self.assertEqual(v.declared["top_level_nodes"], 1)
        v = detect(b"def broken(:\n", filename="modeling.py")
        self.assertEqual(v.kind, "python")
        self.assertFalse(v.parse_ok)
        self.assertTrue(v.quarantine)

    def test_text_document_and_license(self):
        v = detect("# Notes\n\nSome curation text.\n".encode(), filename="docs/NOTES.md")
        self.assertEqual(v.kind, "text_document")
        self.assertTrue(v.parse_ok)
        v = detect(b"Apache License\nVersion 2.0, January 2004\n", filename="LICENSE")
        self.assertEqual(v.kind, "text_document")
        self.assertTrue(v.parse_ok)
        v = detect(b"\x00\x01binary\x00", filename="doc.md")  # NUL in text: refuse
        self.assertFalse(v.parse_ok)

    def test_text_config_and_shell_suffixes(self):
        v = detect(b"[tool]\nname = 'm'\n", filename="pyproject.toml")
        self.assertEqual(v.kind, "text_config")
        v = detect(b"#!/bin/sh\nset -e\n", filename="scripts/run.sh")
        self.assertEqual(v.kind, "shell_script")

    def test_unparsed_binary_suffixes_refuse(self):
        v = detect(b"\x89PNG\r\n\x1a\n" + b"\x00" * 32, filename="assets/architecture.png")
        self.assertEqual(v.kind, "unknown")
        self.assertTrue(v.quarantine)
        self.assertIn("no parser", v.reasons[0])

    def test_unknown_quarantines(self):
        v = detect(b"MZIPDATA\x01\x02\x03" + b"\x00" * 64)
        self.assertEqual(v.kind, "unknown")
        self.assertTrue(v.quarantine)

    def test_merges_bpe_table(self):
        lines = ["#version: 4.5"] + [f"t{i} e{i}" for i in range(50)]
        v = detect("\n".join(lines).encode())
        self.assertEqual(v.kind, "merges")
        self.assertTrue(v.parse_ok)
        self.assertEqual(v.declared["merge_count"], 50)
        self.assertEqual(v.declared["version"], "4.5")
        self.assertFalse(v.quarantine)

    def test_merges_gpt2_style_headerless(self):
        # Real HF merges.txt (e.g. Salience-27B-R5): no #version header —
        # uniform two-column byte-pair lines ARE the declared structure.
        pairs = ["\u0120 \u0120", "\u0120\u0120 \u0120\u0120", "i n", "\u0120 t", "e r", "\u0120 a", "r e", "a t", "s t", "e n", "o r", "\u0120th e"]
        v = detect("\n".join(pairs).encode())
        self.assertEqual(v.kind, "merges")
        self.assertTrue(v.parse_ok)
        self.assertEqual(v.declared["merge_count"], 12)
        self.assertNotIn("version", v.declared)

    def test_merges_malformed_pairs_refuse(self):
        from forged_ai_filing_os.forging.detector import _merges

        lines = ["#version: 4.5"] + [f"tok{i} e{i} junk" for i in range(50)]
        v = _merges("\n".join(lines).encode())
        self.assertEqual(v.kind, "merges")
        self.assertFalse(v.parse_ok)
        self.assertTrue(v.quarantine)

    def test_merges_headerless_below_min_lines_refuse(self):
        # Headerless GPT-2 style is legitimate, but a tiny table is not a merge table.
        pairs = ["i n", "e r", "a t", "s t", "o r"]
        v = detect("\n".join(pairs).encode())
        self.assertFalse(v.parse_ok)
        self.assertTrue(v.quarantine)

    def test_chat_template_jinja(self):
        body = (
            "{% for message in messages %}"
            "<|im_start|>{{ message['role'] }}\n{{ message['content'] }}<|im_end|>\n"
            "{% endfor %}"
            "{% if add_generation_prompt %}<|im_start|>assistant\n{% endif %}"
        )
        v = detect(body.encode())
        self.assertEqual(v.kind, "chat_template")
        self.assertTrue(v.parse_ok)
        self.assertEqual(v.declared["control_pairs"], 2)  # for + if
        self.assertFalse(v.quarantine)

    def test_chat_template_unbalanced_refuses(self):
        from forged_ai_filing_os.forging.detector import _chat_template

        body = "{% for m in messages %}{{ m }}{% if x %}y"  # endfor missing
        v = _chat_template(body.encode())
        self.assertFalse(v.parse_ok)
        self.assertTrue(v.quarantine)
        # detect()-level contract: any failed format parse quarantines.
        self.assertTrue(detect(body.encode()).quarantine)

    def test_never_reads_whole_stream(self):
        self.assertLessEqual(detect.__globals__["DETECT_LIMIT"], 64 * 1024 * 1024)


class TestNamespaces(unittest.TestCase):
    def test_key_build_and_parse_roundtrip(self):
        self.assertEqual(parse_key(skill_key("f:0"))[0], "skill")
        self.assertEqual(parse_key(capability_key("cap_x"))[0], "capability")
        ns, parts = parse_key("stack:job1:frame2:3")
        self.assertEqual((ns, parts), ("stack", ("job1", "frame2", "3")))

    def test_unknown_key_rejected(self):
        with self.assertRaises(NamespaceError):
            parse_key("unknownns:abc")

    def test_render_stack_value(self):
        v = render_stack_value("asset_01J", "vendor://abc/model.safetensors")
        self.assertEqual(v["blend_mode"], "normal")
        self.assertTrue(v["enabled"])
        with self.assertRaises(NamespaceError):
            render_stack_value("asset", "not-a-uri")


class TestVendor(unittest.TestCase):
    def test_weights_import_and_meta(self):
        import tempfile

        with tempfile.TemporaryDirectory() as tmp:
            reg = VendorRegistry(Path(tmp))
            header = b'{"w": {"dtype": "F32", "shape": [1]}}'
            data = len(header).to_bytes(8, "little") + header
            imp = reg.import_artifact(data, "acme/model", "model.safetensors")
            self.assertEqual(imp.kind, "model_weights")
            self.assertTrue(imp.uri.startswith("vendor://"))
            meta = reg.get_meta("acme/model")
            self.assertIsNotNone(meta)
            self.assertIn("model.safetensors", meta["artifacts"])
            with self.assertRaises(FileExistsError):
                reg.import_artifact(data, "acme/model", "model.safetensors")

    def test_unknown_refused_to_vendor(self):
        import tempfile

        from forged_ai_filing_os.forging.vendor import VendorError

        with tempfile.TemporaryDirectory() as tmp:
            reg = VendorRegistry(Path(tmp))
            with self.assertRaises(VendorError):
                reg.import_artifact(b"JUNKJUNK" * 16, "acme/model", "mystery.bin")


class TestCapabilityCompiler(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.vault = Path(self.tmp.name) / "vault"
        self.pipeline = ForgingPipeline(self.vault)
        self.addCleanup(self.pipeline.close)
        sha = self.pipeline.upload_raw(
            b"```python\ndef extract(pdf): return pdf\n```\n\nIntel paragraph.\n",
            source="cap_src.md",
        )
        self.artifact = self.pipeline.forge(sha, domain="coding", source="cap_src.md")
        self.compiler = CapabilityCompiler(self.vault, skills_store=self.pipeline.skills_store)

    def test_compile_load_roundtrip(self):
        skill_id = self.artifact.skill_ids[0]
        cap = self.compiler.compile_capability(
            capability_id="cap_pdf_semantic_extractor_v1",
            skill_id=skill_id,
            forged_id=self.artifact.file_id,
            harness={"entrypoint": "skill_chunk"},
            tools={"pdf_parser": "infinity-parser"},
        )
        self.assertTrue(cap.capability_id.startswith("cap_"))
        self.assertEqual(cap.provenance["forged_id"], self.artifact.file_id)
        self.assertEqual(cap.permissions, {"execute": False})
        self.assertEqual(cap.tools, {"pdf_parser": "infinity-parser"})
        self.assertEqual(cap.provenance["belongs_to"], "exoskeleton")
        self.assertIn("tools", CAPABILITY_SECTIONS)
        loaded = self.compiler.load_capability("cap_pdf_semantic_extractor_v1")
        self.assertIsNotNone(loaded)
        self.assertEqual(loaded.provenance["skill_id"], skill_id)
        self.assertEqual(loaded.tools, {"pdf_parser": "infinity-parser"})

    def test_compile_requires_real_skill(self):
        with self.assertRaises(CapabilityError):
            self.compiler.compile_capability(
                capability_id="cap_ghost_v1",
                skill_id="never-forged:0",
                forged_id=self.artifact.file_id,
                harness={"entrypoint": "skill_chunk"},
            )

    def test_vocabulary_no_harness_layer(self):
        self.assertEqual(VOCABULARY["Harness (as a layer)"], "Exoskeleton")
        self.assertEqual(VOCABULARY["Capability Harness"], "Exoskeleton substrate")
        self.assertIn("tools", CAPABILITY_SECTIONS)
        self.assertIn("harness", CAPABILITY_SECTIONS)


class TestPipeline(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.vault = Path(self.tmp.name) / "vault"
        self.pipeline = ForgingPipeline(self.vault)
        self.addCleanup(self.pipeline.close)

    def _forge_sample(self):
        sha = self.pipeline.upload_raw(SAMPLE.encode("utf-8"), source="sample.md",
                                       mime="text/markdown")
        return self.pipeline.forge(sha, domain="municipal_council", source="sample.md",
                                   mime="text/markdown")

    def test_full_lifecycle(self):
        artifact = self._forge_sample()
        self.assertEqual(artifact.sha256[:16], artifact.file_id)
        self.assertGreater(artifact.chunk_count, 3)
        self.assertTrue(artifact.skills_keys)      # code chunk went to RocksDB
        self.assertTrue(artifact.intelligence_keys)  # rest went to DuckDB
        entry = self.pipeline.manifest.get(artifact.file_id)
        self.assertIsNotNone(entry)
        self.assertEqual(entry.backlinks["source"], "sample.md")
        self.assertTrue(entry.backlinks["skills_keys"])

    def test_f0_immutability(self):
        # F0 is write-once: re-uploading identical bytes is crash-recovery resume
        # (same content address, bytes never rewritten), not a mutation.
        sha1 = self.pipeline.upload_raw(b"data", source="x")
        sha2 = self.pipeline.upload_raw(b"data", source="x")
        self.assertEqual(sha1, sha2)
        content = (self.pipeline.raw_dir / sha1 / "content.bin").read_bytes()
        self.assertEqual(content, b"data")

    def test_f2_artifact_references_f0(self):
        artifact = self._forge_sample()
        doc = self.pipeline.get_artifact(artifact.file_id)
        self.assertEqual(doc["f0"]["sha256"], artifact.sha256)
        self.assertEqual(doc["stats"]["total"], artifact.chunk_count)

    def test_f3_backlinks(self):
        artifact = self._forge_sample()
        self.assertEqual(self.pipeline.manifest.backlinks_to(artifact.file_id), ["sample.md"])
        frm = self.pipeline.manifest.backlinks_from(artifact.file_id)
        self.assertTrue(any(b.startswith("rocksdb:") for b in frm))
        self.assertTrue(any(b.startswith("duckdb:") for b in frm))

    def test_verify_ok_and_unknown(self):
        artifact = self._forge_sample()
        ok, msg = self.pipeline.verify_file(artifact.file_id)
        self.assertTrue(ok, msg)
        ok, _ = self.pipeline.verify_file("0" * 16)
        self.assertFalse(ok)

    def test_no_stage_skip(self):
        with self.assertRaises(FileNotFoundError):
            self.pipeline.forge("f" * 64)

    def test_precheck_rejects_empty(self):
        with self.assertRaises(PrecheckError):
            self.pipeline.upload_raw(b"", source="x")
        with self.assertRaises(PrecheckError):
            self.pipeline.upload_raw(b"data", source="")

    def test_versioning_on_reforge(self):
        sha1 = self.pipeline.upload_raw(SAMPLE.encode("utf-8"), source="sample.md")
        a1 = self.pipeline.forge(sha1, source="sample.md")
        # Changed content arrives under its own digest (F0 immutability).
        changed = SAMPLE + "\n\nNew appendix section."
        sha2 = self.pipeline.upload_raw(changed.encode("utf-8"), source="sample_v2.md")
        a2 = self.pipeline.reforge(sha2, source="sample_v2.md", lineage=a1.file_id)
        self.assertEqual(a1.file_id, sha1[:16])
        self.assertEqual(a2.file_id, f"{a1.file_id}:v2")
        self.assertEqual(a2.version, 2)
        # Historical v1 artifact untouched (immutability matrix §3).
        self.assertIsNotNone(self.pipeline.get_artifact(a1.file_id))
        ok, msg = self.pipeline.verify_file(a2.file_id)
        self.assertTrue(ok, msg)

    def test_reforge_refuses_silent_mutation(self):
        sha = self.pipeline.upload_raw(SAMPLE.encode("utf-8"), source="sample.md")
        self.pipeline.forge(sha, source="sample.md")
        with self.assertRaises(FileExistsError):
            self.pipeline.reforge(sha, source="sample.md")

    def test_control_plane_registration(self):
        sha = self.pipeline.upload_raw(SAMPLE.encode("utf-8"), source="sample.md")
        artifact = self.pipeline.forge(sha, source="sample.md")
        rec = self.pipeline.skills_store.get_value(skill_key(artifact.skill_ids[0]))
        self.assertIsNotNone(rec)
        self.assertEqual(rec["forged_id"], artifact.file_id)
        idx = self.pipeline.skills_store.get_value(f"idx:hash:{sha}")
        self.assertIsNotNone(idx)
        self.assertEqual(idx["forged_id"], artifact.file_id)

    def test_intake_routes_model_to_quarantine(self):
        header = b'{"t": {"dtype": "F32", "shape": [1]}}'
        data = len(header).to_bytes(8, "little") + header
        result = self.pipeline.intake(data, source="model.safetensors")
        self.assertEqual(result["route"], "quarantine")  # no vendor context given
        qdir = self.vault / "quarantine"
        self.assertTrue(qdir.exists())

    def test_intake_routes_vendor_when_context_given(self):
        header = b'{"t": {"dtype": "F32", "shape": [1]}}'
        data = len(header).to_bytes(8, "little") + header
        result = self.pipeline.intake(data, source="model.safetensors",
                                      vendor_repo_id="acme/model")
        self.assertEqual(result["route"], "vendor")
        self.assertEqual(result["import"]["kind"], "model_weights")

    def test_intake_routes_text_to_forge(self):
        result = self.pipeline.intake(SAMPLE.encode("utf-8"), source="doc.md", mime="text/markdown")
        self.assertEqual(result["route"], "forge")

    def test_trace_chain(self):
        sha = self.pipeline.upload_raw(SAMPLE.encode("utf-8"), source="sample.md")
        artifact = self.pipeline.forge(sha, source="sample.md")
        t = self.pipeline.trace(artifact.file_id)
        self.assertEqual(t["forged_file"], artifact.file_id)
        self.assertEqual(t["upload"]["sha256"], sha)


if __name__ == "__main__":
    unittest.main()
