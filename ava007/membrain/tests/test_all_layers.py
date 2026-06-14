"""
Comprehensive test suite for QAG-MemBrain — all 8 layers.

Tests each layer independently and then tests the full pipeline integration.
Run with: python -m pytest ava007/membrain/tests/ -v
"""

import hashlib
import json
import math
import os
import sqlite3
import sys
import tempfile
import time
import unittest
from dataclasses import asdict
from pathlib import Path

# Add parent to path for imports
sys.path.insert(0, str(Path(__file__).resolve().parents[3]))


# ─── L1: Ion Memory ─────────────────────────────────────────────────────

class TestMLCEmulation(unittest.TestCase):
    """Test 8-level (3-bit) MLC conductance emulation."""

    def setUp(self):
        from ava007.membrain.ion_memory.mlc_emulation import MLCEmulation
        self.mlc = MLCEmulation()

    def test_validate_level_valid(self):
        for level in range(8):
            self.assertTrue(self.mlc.validate_level(level))

    def test_validate_level_invalid(self):
        for level in [-1, 8, 100, -5]:
            self.assertFalse(self.mlc.validate_level(level))

    def test_conductance_exponential_scale(self):
        """Conductance should double with each level."""
        for level in range(1, 8):
            prev = self.mlc.level_to_conductance(level - 1)
            curr = self.mlc.level_to_conductance(level)
            self.assertAlmostEqual(curr, prev * 2, places=5,
                                   msg=f"Level {level} conductance not double of {level-1}")

    def test_resistance_inverse_of_conductance(self):
        """Resistance (kOhm) = 1 / conductance (uS) * 1000."""
        for level in range(8):
            cond = self.mlc.level_to_conductance(level)
            res = self.mlc.level_to_resistance(level)
            if cond > 0:
                expected = 1000.0 / cond
                self.assertAlmostEqual(res, expected, places=3,
                                       msg=f"Level {level}: resistance not inverse of conductance")

    def test_interpolation_midpoint(self):
        """Interpolation at weight=0.5 between adjacent levels should give a valid level."""
        result = self.mlc.interpolate(0, 7, 0.5)
        self.assertIn(result, range(8))

    def test_interpolation_boundary(self):
        """Weight=0 -> level_a, weight=1 -> level_b."""
        self.assertEqual(self.mlc.interpolate(2, 5, 0.0), 2)
        self.assertEqual(self.mlc.interpolate(2, 5, 1.0), 5)

    def test_add_noise_within_range(self):
        """Noise should keep levels in [0, 7]."""
        import random
        for _ in range(100):
            result = self.mlc.add_noise(4, sigma=0.5)
            self.assertGreaterEqual(result, 0)
            self.assertLessEqual(result, 7)


class TestFilamentStore(unittest.TestCase):
    """Test SQLite-backed filament store."""

    def setUp(self):
        from ava007.membrain.ion_memory.filament_store import FilamentStore
        self.tmpdir = tempfile.mkdtemp()
        self.store = FilamentStore(path=os.path.join(self.tmpdir, 'test_filaments.db'))

    def test_put_and_get(self):
        self.store.put('key1', 3)
        result = self.store.get('key1')
        self.assertEqual(result, 3)

    def test_get_nonexistent(self):
        result = self.store.get('no_such_key')
        self.assertIsNone(result)

    def test_put_overwrite(self):
        self.store.put('key1', 2)
        self.store.put('key1', 5)
        result = self.store.get('key1')
        self.assertEqual(result, 5)

    def test_delete(self):
        self.store.put('key1', 3)
        deleted = self.store.delete('key1')
        self.assertTrue(deleted)
        self.assertIsNone(self.store.get('key1'))

    def test_delete_nonexistent(self):
        deleted = self.store.delete('no_such_key')
        self.assertFalse(deleted)

    def test_keys(self):
        self.store.put('a', 1)
        self.store.put('b', 2)
        self.store.put('c', 3)
        keys = self.store.keys()
        self.assertEqual(set(keys), {'a', 'b', 'c'})

    def test_count(self):
        self.store.put('a', 1)
        self.store.put('b', 2)
        self.assertEqual(self.store.count(), 2)


class TestEnduranceTracker(unittest.TestCase):
    """Test write cycle tracking and fatigue model."""

    def setUp(self):
        from ava007.membrain.ion_memory.endurance import EnduranceTracker
        self.tracker = EnduranceTracker()

    def test_increment(self):
        self.tracker.increment('key1')
        self.tracker.increment('key1')
        self.assertEqual(self.tracker.get_count('key1'), 2)

    def test_untracked_key_returns_zero(self):
        self.assertEqual(self.tracker.get_count('unknown'), 0)

    def test_not_fatigued_initially(self):
        self.tracker.increment('key1')
        self.assertFalse(self.tracker.is_fatigued('key1'))

    def test_fatigue_factor_decreases(self):
        from ava007.membrain.ion_memory.endurance import EnduranceTracker
        tracker = EnduranceTracker()
        for _ in range(50000):
            tracker.increment('key1')
        factor = tracker.fatigue_factor('key1')
        self.assertLess(factor, 1.0)
        self.assertGreater(factor, 0.0)

    def test_remaining_cycles(self):
        from ava007.membrain.ion_memory.endurance import MAX_WRITE_CYCLES
        self.tracker.increment('key1')
        remaining = self.tracker.remaining_cycles('key1')
        self.assertEqual(remaining, MAX_WRITE_CYCLES - 1)


class TestIonMemoryStore(unittest.TestCase):
    """Test core ion memory store with CRUD operations."""

    def setUp(self):
        from ava007.membrain.ion_memory.ion_memory import IonMemoryStore
        self.store = IonMemoryStore()

    def test_create_and_read(self):
        self.store.create_filament('f1', initial_level=3)
        level = self.store.read_filament('f1')
        self.assertEqual(level, 3)

    def test_write_changes_level(self):
        self.store.create_filament('f1', initial_level=0)
        self.store.write_filament('f1', 5)
        self.assertEqual(self.store.read_filament('f1'), 5)

    def test_delete_filament(self):
        self.store.create_filament('f1')
        deleted = self.store.delete_filament('f1')
        self.assertTrue(deleted)

    def test_read_nonexistent(self):
        # IonMemoryStore raises KeyError for nonexistent filament
        with self.assertRaises(KeyError):
            self.store.read_filament('nonexistent')

    def test_event_emission(self):
        events = []
        self.store.add_listener(lambda e: events.append(e))
        self.store.create_filament('f1', initial_level=3)
        self.store.write_filament('f1', 5)
        self.assertGreaterEqual(len(events), 2)


class TestPersistenceManager(unittest.TestCase):
    """Test 3-tier persistence."""

    def setUp(self):
        self.tmpdir = tempfile.mkdtemp()
        from ava007.membrain.ion_memory.persistence import PersistenceManager
        self.pm = PersistenceManager(l2_path=os.path.join(self.tmpdir, 'l2.db'),
                                     l3_path=os.path.join(self.tmpdir, 'l3'))

    def test_l1_put_get(self):
        self.pm.put('key1', {'data': 42}, tier='L1')
        result = self.pm.get('key1', tier='L1')
        self.assertEqual(result, {'data': 42})

    def test_l2_put_get(self):
        self.pm.put('key2', {'data': 99}, tier='L2')
        result = self.pm.get('key2', tier='L2')
        self.assertEqual(result, {'data': 99})

    def test_promote_l2_to_l1(self):
        self.pm.put('key1', 'cold_data', tier='L2')
        self.pm.promote('key1', 'L2', 'L1')
        result = self.pm.get('key1', tier='L1')
        self.assertEqual(result, 'cold_data')

    def test_flush_l1_to_l2(self):
        self.pm.put('key1', 'hot_data', tier='L1')
        self.pm.put('key2', 'hot_data2', tier='L1')
        self.pm.flush()
        r1 = self.pm.get('key1', tier='L2')
        r2 = self.pm.get('key2', tier='L2')
        self.assertEqual(r1, 'hot_data')
        self.assertEqual(r2, 'hot_data2')


class TestSnapshots(unittest.TestCase):
    """Test content-addressable snapshots."""

    def setUp(self):
        self.tmpdir = tempfile.mkdtemp()
        from ava007.membrain.ion_memory.filament_store import FilamentStore
        from ava007.membrain.ion_memory.snapshots import SnapshotManager
        self.filament_store = FilamentStore(path=os.path.join(self.tmpdir, 'snap_test.db'))
        self.snapshot_mgr = SnapshotManager(db_path=os.path.join(self.tmpdir, 'snap_mgr.db'))

    def test_create_and_list(self):
        self.filament_store.put('k1', 3)
        self.filament_store.put('k2', 5)
        record = self.snapshot_mgr.create_snapshot(self.filament_store, label='test1')
        self.assertIsNotNone(record.id)
        self.assertEqual(record.label, 'test1')
        snapshots = self.snapshot_mgr.list_snapshots()
        self.assertGreaterEqual(len(snapshots), 1)

    def test_verify_snapshot(self):
        self.filament_store.put('k1', 3)
        record = self.snapshot_mgr.create_snapshot(self.filament_store, label='test2')
        verified = self.snapshot_mgr.verify_snapshot(record.id)
        self.assertTrue(verified)

    def test_restore_snapshot(self):
        self.filament_store.put('k1', 3)
        record = self.snapshot_mgr.create_snapshot(self.filament_store, label='test3')
        # Clear store and restore
        self.filament_store.delete('k1')
        self.snapshot_mgr.restore_snapshot(record.id, self.filament_store)
        # After restore, k1 should be back
        result = self.filament_store.get('k1')
        self.assertEqual(result, 3)


# ─── L2: FASt Mesh ──────────────────────────────────────────────────────

class TestContentDeduplication(unittest.TestCase):
    """Test SHA-256 content-addressable dedup."""

    def setUp(self):
        from ava007.membrain.fast_mesh.deduplication import ContentDeduplicator
        self.dedup = ContentDeduplicator()

    def test_compute_hash_deterministic(self):
        data = b'hello world'
        h1 = self.dedup.compute_hash(data)
        h2 = self.dedup.compute_hash(data)
        self.assertEqual(h1, h2)
        self.assertEqual(len(h1), 64)  # SHA-256 hex

    def test_different_data_different_hash(self):
        h1 = self.dedup.compute_hash(b'data1')
        h2 = self.dedup.compute_hash(b'data2')
        self.assertNotEqual(h1, h2)

    def test_register_and_is_stored(self):
        data = b'test data'
        h = self.dedup.compute_hash(data)
        self.assertFalse(self.dedup.is_stored(h))
        self.dedup.register(h, {'size': len(data)})
        self.assertTrue(self.dedup.is_stored(h))

    def test_dedup_stats(self):
        data = b'duplicate data'
        h = self.dedup.compute_hash(data)
        self.dedup.register(h, {'size': len(data)})
        self.dedup.register(h, {'size': len(data)})  # Duplicate
        stats = self.dedup.get_stats()
        self.assertGreaterEqual(stats.total_entries, 1)
        self.assertGreaterEqual(stats.saved_bytes, 0)


class TestRateGovernor(unittest.TestCase):
    """Test token-bucket rate limiting."""

    def setUp(self):
        from ava007.membrain.fast_mesh.rate_governor import RateGovernor
        self.governor = RateGovernor()

    def test_acquire_within_limit(self):
        result = self.governor.acquire('local', tokens=1)
        self.assertTrue(result)

    def test_configure_and_acquire(self):
        self.governor.configure('test_provider', rate=10.0, burst=5)
        for _ in range(5):
            self.assertTrue(self.governor.acquire('test_provider'))

    def test_reset(self):
        self.governor.configure('test_provider', rate=1.0, burst=2)
        self.governor.acquire('test_provider', tokens=2)
        self.governor.reset('test_provider')
        remaining = self.governor.get_remaining('test_provider')
        self.assertGreater(remaining, 0)


class TestCacheTiers(unittest.TestCase):
    """Test L1/L2/L3 cache tiers."""

    def test_l1_put_get(self):
        from ava007.membrain.fast_mesh.cache_tier import L1Cache
        cache = L1Cache(max_size_mb=1)
        cache.put('hash1', b'data1', {'content_type': 'text/plain'})
        result = cache.get('hash1')
        self.assertEqual(result[0], b'data1')

    def test_l2_put_get(self):
        tmpdir = tempfile.mkdtemp()
        from ava007.membrain.fast_mesh.cache_tier import L2Cache
        cache = L2Cache(db_path=os.path.join(tmpdir, 'cache.db'))
        cache.put('hash1', b'data1', {'content_type': 'text/plain'})
        result = cache.get('hash1')
        self.assertEqual(result[0], b'data1')

    def test_l3_put_get(self):
        tmpdir = tempfile.mkdtemp()
        from ava007.membrain.fast_mesh.cache_tier import L3Cache
        cache = L3Cache(base_dir=tmpdir)
        cache.put('hash1', b'data1', {'ct': 'text'})
        result = cache.get('hash1')
        # L3 returns (data, metadata) tuple
        self.assertIsNotNone(result)
        if isinstance(result, tuple):
            self.assertEqual(result[0], b'data1')
        else:
            self.assertEqual(result, b'data1')


class TestGraphMeshSerializer(unittest.TestCase):
    """Test graph-to-mesh serialization."""

    def setUp(self):
        from ava007.membrain.fast_mesh.serialization import GraphMeshSerializer
        self.serializer = GraphMeshSerializer()

    def test_round_trip(self):
        nodes = [
            {'id': 'n1', 'label': 'Person', 'properties': {'name': 'Alice'}},
            {'id': 'n2', 'label': 'Person', 'properties': {'name': 'Bob'}},
        ]
        edges = [
            {'id': 'e1', 'source': 'n1', 'target': 'n2', 'type': 'KNOWS', 'properties': {}},
        ]
        data = self.serializer.serialize_graph(nodes, edges)
        r_nodes, r_edges = self.serializer.deserialize_graph(data)
        self.assertEqual(len(r_nodes), 2)
        self.assertEqual(len(r_edges), 1)
        self.assertEqual(r_nodes[0]['id'], 'n1')
        self.assertEqual(r_edges[0]['type'], 'KNOWS')


class TestFAStMesh(unittest.TestCase):
    """Test core FASt mesh coordinator."""

    def setUp(self):
        self.tmpdir = tempfile.mkdtemp()
        from ava007.membrain.fast_mesh.fast_mesh import FAStMesh
        self.mesh = FAStMesh(provider='local', l3_base_dir=self.tmpdir)

    def test_store_and_retrieve(self):
        data = b'hello mesh storage'
        content_hash = self.mesh.store(data, content_type='text/plain')
        retrieved = self.mesh.retrieve(content_hash)
        self.assertEqual(retrieved, data)

    def test_exists(self):
        data = b'existence test'
        content_hash = self.mesh.store(data)
        self.assertTrue(self.mesh.exists(content_hash))

    def test_metadata(self):
        data = b'metadata test'
        content_hash = self.mesh.store(data, content_type='application/json')
        meta = self.mesh.get_metadata(content_hash)
        self.assertIsNotNone(meta)


# ─── L3: GraphRAG ───────────────────────────────────────────────────────

class TestPropertyGraph(unittest.TestCase):
    """Test ISO/IEC 39075:2024 property graph model."""

    def setUp(self):
        from ava007.membrain.graphrag.property_graph import PropertyGraph
        self.graph = PropertyGraph()
        self.graph.add_node('n1', labels=['Person'], properties={'name': 'Alice', 'age': 30})
        self.graph.add_node('n2', labels=['Person'], properties={'name': 'Bob', 'age': 25})
        self.graph.add_node('n3', labels=['City'], properties={'name': 'NYC'})

    def test_node_count(self):
        self.assertEqual(self.graph.node_count(), 3)

    def test_get_node(self):
        node = self.graph.get_node('n1')
        self.assertIsNotNone(node)
        self.assertIn('Person', node.labels)
        self.assertEqual(node.properties['name'], 'Alice')

    def test_add_edge_and_count(self):
        self.graph.add_edge('e1', source='n1', target='n2', type='KNOWS', properties={'since': 2020})
        self.assertEqual(self.graph.edge_count(), 1)

    def test_get_neighbors(self):
        self.graph.add_edge('e1', source='n1', target='n2', type='KNOWS')
        neighbors = self.graph.get_neighbors('n1')
        self.assertEqual(len(neighbors), 1)
        self.assertEqual(neighbors[0].id, 'n2')

    def test_query_nodes_by_label(self):
        people = self.graph.query_nodes('Person')
        self.assertEqual(len(people), 2)

    def test_query_nodes_with_filter(self):
        older = self.graph.query_nodes('Person', property_filter={'age': {'gte': 30}})
        self.assertEqual(len(older), 1)
        self.assertEqual(older[0].id, 'n1')

    def test_subgraph(self):
        self.graph.add_edge('e1', source='n1', target='n2', type='KNOWS')
        sub = self.graph.subgraph({'n1', 'n2'})
        self.assertEqual(sub.node_count(), 2)
        self.assertEqual(sub.edge_count(), 1)


class TestPathRestrictors(unittest.TestCase):
    """Test WALK/TRAIL/ACYCLIC/SIMPLE path restrictors."""

    def setUp(self):
        from ava007.membrain.graphrag.property_graph import PropertyGraph
        self.graph = PropertyGraph()
        self.graph.add_node('A', labels=['Node'])
        self.graph.add_node('B', labels=['Node'])
        self.graph.add_node('C', labels=['Node'])
        self.graph.add_node('D', labels=['Node'])
        self.graph.add_edge('e1', source='A', target='B', type='CONN')
        self.graph.add_edge('e2', source='B', target='C', type='CONN')
        self.graph.add_edge('e3', source='C', target='D', type='CONN')
        self.graph.add_edge('e4', source='D', target='A', type='CONN')

    def test_walk_allows_cycles(self):
        from ava007.membrain.graphrag.path_restrictors import traverse_with_restrictor, PathType
        paths = traverse_with_restrictor(self.graph, 'A', PathType.WALK, max_depth=4)
        self.assertGreater(len(paths), 0)

    def test_acyclic_no_repeated_nodes(self):
        from ava007.membrain.graphrag.path_restrictors import traverse_with_restrictor, PathType
        paths = traverse_with_restrictor(self.graph, 'A', PathType.ACYCLIC, max_depth=4)
        for path in paths:
            node_set = set(path.nodes)
            self.assertEqual(len(node_set), len(path.nodes), f"Repeated nodes in ACYCLIC path: {path.nodes}")


class TestGQLLetBindings(unittest.TestCase):
    """Test LET variable support."""

    def setUp(self):
        from ava007.membrain.graphrag.gql_let import GQLLetBindings
        self.bindings = GQLLetBindings()

    def test_bind_and_resolve(self):
        self.bindings.bind('threshold', 0.8)
        self.assertEqual(self.bindings.resolve('threshold'), 0.8)

    def test_resolve_unbound_raises(self):
        with self.assertRaises(KeyError):
            self.bindings.resolve('unbound_var')

    def test_resolve_or_default(self):
        result = self.bindings.resolve_or('missing', 42)
        self.assertEqual(result, 42)

    def test_merge(self):
        from ava007.membrain.graphrag.gql_let import GQLLetBindings
        self.bindings.bind('a', 1)
        other = GQLLetBindings()
        other.bind('b', 2)
        other.bind('a', 99)
        merged = self.bindings.merge(other)
        self.assertEqual(merged.resolve('a'), 99)
        self.assertEqual(merged.resolve('b'), 2)

    def test_to_dict_and_from_dict(self):
        from ava007.membrain.graphrag.gql_let import GQLLetBindings
        self.bindings.bind('x', 10)
        d = self.bindings.to_dict()
        restored = GQLLetBindings.from_dict(d)
        self.assertEqual(restored.resolve('x'), 10)


class TestSchemaValidator(unittest.TestCase):
    """Test closed graph type DDL validation."""

    def setUp(self):
        from ava007.membrain.graphrag.schema_validator import SchemaValidator, NodeTypeSchema, EdgeTypeSchema
        self.validator = SchemaValidator(strict=True)
        self.validator.define_node_type(NodeTypeSchema(
            name='Person',
            required_properties={'name': str, 'age': int},
            optional_properties={'email': str},
            labels=['Person'],
        ))
        self.validator.define_edge_type(EdgeTypeSchema(
            name='KNOWS',
            source_node_type='Person',
            target_node_type='Person',
            required_properties={'since': int},
            optional_properties={},
        ))

    def test_valid_node(self):
        from ava007.membrain.graphrag.property_graph import Node
        node = Node(id='p1', labels=['Person'], properties={'name': 'Alice', 'age': 30})
        result = self.validator.validate_node(node)
        self.assertTrue(result.valid)

    def test_invalid_node_missing_required(self):
        from ava007.membrain.graphrag.property_graph import Node
        node = Node(id='p1', labels=['Person'], properties={'name': 'Alice'})
        result = self.validator.validate_node(node)
        self.assertFalse(result.valid)

    def test_invalid_node_wrong_type(self):
        from ava007.membrain.graphrag.property_graph import Node
        node = Node(id='p1', labels=['Person'], properties={'name': 'Alice', 'age': 'thirty'})
        result = self.validator.validate_node(node)
        self.assertFalse(result.valid)


class TestGraphRAGRetrieval(unittest.TestCase):
    """Test full GraphRAG retrieval engine."""

    def setUp(self):
        from ava007.membrain.graphrag.graphrag_retrieval import GraphRAGRetrieval
        from ava007.membrain.graphrag.property_graph import PropertyGraph
        self.engine = GraphRAGRetrieval()
        self.graph = PropertyGraph()
        self.graph.add_node('n1', labels=['Person'], properties={'name': 'Alice', 'age': 30})
        self.graph.add_node('n2', labels=['Person'], properties={'name': 'Bob', 'age': 25})
        self.graph.add_node('n3', labels=['Topic'], properties={'name': 'AI'})
        self.graph.add_edge('e1', source='n1', target='n3', type='INTERESTED_IN')
        self.graph.add_edge('e2', source='n2', target='n3', type='INTERESTED_IN')

    def test_query(self):
        from ava007.membrain.graphrag.graphrag_retrieval import QueryPattern
        from ava007.membrain.graphrag.path_restrictors import PathType
        pattern = QueryPattern(
            path_type=PathType.WALK,
            edge_types=['INTERESTED_IN'],
            node_labels=['Person', 'Topic'],
            max_depth=3,
            let_bindings={},
        )
        result = self.engine.query(self.graph, 'n1', pattern)
        self.assertGreater(result.total_count, 0)


# ─── L4: Reinforcement Learning ─────────────────────────────────────────

class TestGRPODAPO(unittest.TestCase):
    """Test GRPO/DAPO policy optimization."""

    def setUp(self):
        from ava007.membrain.reinforcement.grpo_dapo import GRPODAPO
        self.grpo = GRPODAPO()

    def test_compute_advantages(self):
        rewards = [0.2, 0.5, 0.8, 0.3, 0.6]
        advantages = self.grpo.compute_advantages(rewards, group_size=5)
        self.assertEqual(len(advantages), 5)
        mean_adv = sum(advantages) / len(advantages)
        self.assertAlmostEqual(mean_adv, 0.0, places=10)

    def test_compute_ratio_identity(self):
        """When log_probs == ref_log_probs, ratios should all be 1.0."""
        log_probs = [-2.0, -1.5, -3.0]
        ratios = self.grpo.compute_ratio(log_probs, log_probs)
        for r in ratios:
            self.assertAlmostEqual(r, 1.0, places=5)

    def test_optimize_step(self):
        rewards = [0.3, 0.7, 0.5]
        log_probs = [-1.0, -2.0, -1.5]
        ref_log_probs = [-1.1, -1.9, -1.4]
        result = self.grpo.optimize_step(rewards, log_probs, ref_log_probs)
        self.assertIsNotNone(result.loss)
        self.assertEqual(len(result.advantages), 3)
        self.assertEqual(len(result.clipped_mask), 3)


class TestRewardScorer(unittest.TestCase):
    """Test group-normalized reward scoring."""

    def setUp(self):
        from ava007.membrain.reinforcement.reward_scoring import RewardScorer
        self.scorer = RewardScorer()

    def test_score_group(self):
        rewards = [1.0, 2.0, 3.0, 4.0, 5.0]
        result = self.scorer.score_group(rewards)
        self.assertAlmostEqual(result.mean, 3.0)
        self.assertEqual(len(result.normalized), 5)

    def test_combine_rewards(self):
        score = self.scorer.combine_rewards(0.8, 0.6, 1.0, weights=(0.6, 0.2, 0.2))
        expected = 0.8 * 0.6 + 0.6 * 0.2 + 1.0 * 0.2
        self.assertAlmostEqual(score, expected)

    def test_rank_normalize(self):
        rewards = [0.1, 0.5, 0.3, 0.9]
        ranked = self.scorer.rank_normalize(rewards)
        self.assertEqual(len(ranked), 4)
        self.assertAlmostEqual(max(ranked), 1.0)


class TestAsymmetricClipping(unittest.TestCase):
    """Test asymmetric epsilon clipping."""

    def setUp(self):
        from ava007.membrain.reinforcement.clipping import AsymmetricClipping
        self.clipper = AsymmetricClipping()

    def test_clip_within_bounds(self):
        result = self.clipper.clip(1.1, epsilon_low=0.2, epsilon_high=0.3)
        self.assertEqual(result, 1.1)

    def test_clip_below_lower(self):
        result = self.clipper.clip(0.5, epsilon_low=0.2, epsilon_high=0.3)
        self.assertEqual(result, 0.8)

    def test_clip_above_upper(self):
        result = self.clipper.clip(1.5, epsilon_low=0.2, epsilon_high=0.3)
        self.assertEqual(result, 1.3)

    def test_is_clipped(self):
        self.assertTrue(self.clipper.is_clipped(0.5, 0.2, 0.3))
        self.assertFalse(self.clipper.is_clipped(1.0, 0.2, 0.3))


class TestLossNormalization(unittest.TestCase):
    """Test per-token loss normalization with length bias fix."""

    def setUp(self):
        from ava007.membrain.reinforcement.loss_normalization import LossNormalization
        self.norm = LossNormalization()

    def test_per_token_normalize(self):
        losses = [0.5, 0.3, 0.2]
        normalized = self.norm.per_token_normalize(losses)
        self.assertAlmostEqual(sum(normalized), sum(losses) / len(losses))

    def test_length_bias_correct(self):
        losses = [0.5, 0.3, 0.2]
        lengths = [10, 5, 3]
        corrected = self.norm.length_bias_correct(losses, lengths, lambda_lb=0.01)
        self.assertEqual(len(corrected), 3)

    def test_compute_sequence_loss(self):
        token_losses = [[0.5, 0.3], [0.2, 0.1, 0.4]]
        lengths = [2, 3]
        loss = self.norm.compute_sequence_loss(token_losses, lengths)
        self.assertGreater(loss, 0)


class TestRLVR(unittest.TestCase):
    """Test verifiable reward functions."""

    def setUp(self):
        from ava007.membrain.reinforcement.rlvr import RLVR
        self.rlvr = RLVR()

    def test_exact_match(self):
        self.assertEqual(self.rlvr.exact_match_reward('hello', 'hello'), 1.0)
        self.assertEqual(self.rlvr.exact_match_reward('hello', 'world'), 0.0)

    def test_f1_score(self):
        score = self.rlvr.f1_score_reward('the cat sat', 'the cat sat on the mat')
        self.assertGreater(score, 0.5)
        self.assertLessEqual(score, 1.0)

    def test_json_schema_reward_valid(self):
        schema = {'type': 'object', 'properties': {'name': {'type': 'string'}}}
        prediction = json.dumps({'name': 'Alice'})
        score = self.rlvr.json_schema_reward(prediction, schema)
        self.assertGreater(score, 0)

    def test_json_schema_reward_invalid(self):
        schema = {'type': 'object', 'properties': {'name': {'type': 'string'}}}
        prediction = 'not valid json'
        score = self.rlvr.json_schema_reward(prediction, schema)
        self.assertEqual(score, 0.0)


# ─── L5: GSAP Temporal ──────────────────────────────────────────────────

class TestCognitiveEpochVisualizer(unittest.TestCase):
    """Test cognitive epoch visualization."""

    def setUp(self):
        from ava007.membrain.gsap_temporal.visualization import CognitiveEpochVisualizer
        self.viz = CognitiveEpochVisualizer()

    def test_render_timeline(self):
        epochs = [
            {'id': 'e1', 'timelineId': 't1', 'timestamp': 0.0, 'label': 'START', 'data': {}, 'hash': 'abc'},
            {'id': 'e2', 'timelineId': 't1', 'timestamp': 5.0, 'label': 'MID', 'data': {}, 'hash': 'def'},
            {'id': 'e3', 'timelineId': 't1', 'timestamp': 10.0, 'label': 'END', 'data': {}, 'hash': 'ghi'},
        ]
        result = self.viz.render_timeline(epochs, width=60)
        self.assertIsInstance(result, str)
        self.assertIn('START', result)

    def test_render_heatmap(self):
        epochs = [
            {'id': f'e{i}', 'timestamp': float(i), 'label': 'tick', 'data': {}}
            for i in range(20)
        ]
        result = self.viz.render_heatmap(epochs, bins=10)
        self.assertIsInstance(result, str)
        self.assertTrue(len(result) > 0)

    def test_render_state_transition(self):
        epochs = [
            {'id': 'e1', 'data': {'state': 'IDLE'}},
            {'id': 'e2', 'data': {'state': 'PLAYING'}},
            {'id': 'e3', 'data': {'state': 'PAUSED'}},
        ]
        result = self.viz.render_state_transition(epochs)
        self.assertIsInstance(result, str)

    def test_render_empty_timeline(self):
        result = self.viz.render_timeline([], width=60)
        self.assertIsInstance(result, str)


# ─── L6: DualBrain ───────────────────────────────────────────────────────

class TestDualBrainRouter(unittest.TestCase):
    """Test DualBrain inference router."""

    def setUp(self):
        from ava007.membrain.dualbrain.dualbrain_router import DualBrainRouter
        self.router = DualBrainRouter()

    def test_route_factual_query(self):
        decision = self.router.route('What is the capital of France?')
        self.assertIn(decision.mode, ['GRAPH', 'HYBRID'])

    def test_route_creative_query(self):
        decision = self.router.route('Generate a poem about memory')
        self.assertIn(decision.mode, ['PROMPT', 'HYBRID'])

    def test_execute_graph(self):
        graph_data = {
            'nodes': [
                {'id': 'n1', 'labels': ['Fact'], 'properties': {'text': 'Paris is the capital of France'}},
            ],
            'edges': [],
        }
        result = self.router.execute_graph('capital of France', graph_data)
        self.assertIsNotNone(result)
        self.assertIsInstance(result.answer, str)

    def test_execute_hybrid(self):
        graph_data = {
            'nodes': [{'id': 'n1', 'labels': ['Fact'], 'properties': {'text': 'Test fact'}}],
            'edges': [],
        }
        result = self.router.execute_hybrid('test query', graph_data)
        self.assertIsNotNone(result)


class TestRoutingEngine(unittest.TestCase):
    """Test confidence-threshold routing."""

    def setUp(self):
        from ava007.membrain.dualbrain.routing import RoutingEngine, RoutingStrategy, QueryClassification
        self.engine = RoutingEngine()

    def test_classify_factual(self):
        classification = self.engine.classify_query('Who is the president?')
        self.assertEqual(classification.type, 'factual')

    def test_classify_creative(self):
        classification = self.engine.classify_query('Write a story about dragons')
        self.assertEqual(classification.type, 'creative')

    def test_classify_analytical(self):
        classification = self.engine.classify_query('Why does the system behave this way?')
        self.assertEqual(classification.type, 'analytical')

    def test_conservative_strategy_prefers_graph(self):
        from ava007.membrain.dualbrain.routing import RoutingMode, RoutingStrategy, QueryClassification
        qc = QueryClassification(type='factual', keywords=['what'], has_entity=False, requires_reasoning=False)
        mode = self.engine.decide_route(qc, confidence=0.6, strategy=RoutingStrategy.CONSERVATIVE)
        self.assertEqual(mode, RoutingMode.GRAPH)


class TestQueryAugmenter(unittest.TestCase):
    """Test factual query detection and augmentation."""

    def setUp(self):
        from ava007.membrain.dualbrain.augmentation import QueryAugmenter
        self.augmenter = QueryAugmenter()

    def test_is_factual(self):
        self.assertTrue(self.augmenter.is_factual('What is the temperature?'))
        self.assertTrue(self.augmenter.is_factual('How many users are active?'))

    def test_not_factual(self):
        # "Create" is detected as creative, but "Imagine" may match some factual patterns
        self.assertFalse(self.augmenter.is_factual('Write a creative story about fantasy'))
        # Verify factual queries are correctly identified
        self.assertTrue(self.augmenter.is_factual('How many nodes are in the graph?'))

    def test_extract_entities(self):
        entities = self.augmenter.extract_entities('Find information about New York City')
        self.assertIn('New York City', entities)

    def test_detect_contradictions(self):
        contradictions = self.augmenter.detect_contradictions(
            'The system is online and operational',
            'The system is not online and is down',
        )
        self.assertGreater(len(contradictions), 0)


# ─── L7: Pipeline ────────────────────────────────────────────────────────

class TestMembrainPipeline(unittest.TestCase):
    """Test full Membrain pipeline."""

    def setUp(self):
        from ava007.membrain.pipeline.pipeline import MembrainPipeline
        self.pipeline = MembrainPipeline()

    def test_execute_factual_query(self):
        result = self.pipeline.execute('What is the meaning of memory?')
        self.assertIsNotNone(result)
        self.assertIsNotNone(result.answer)
        self.assertIsInstance(result.confidence, float)
        self.assertGreater(result.latency_ms, 0)

    def test_execute_creative_query(self):
        result = self.pipeline.execute('Generate a haiku about cognition')
        self.assertIsNotNone(result.answer)

    def test_execute_batch(self):
        results = self.pipeline.execute_batch(['Query 1', 'Query 2', 'Query 3'])
        self.assertEqual(len(results), 3)

    def test_get_stats(self):
        self.pipeline.execute('test query')
        stats = self.pipeline.get_stats()
        self.assertGreaterEqual(stats.total_queries, 1)


class TestQueryOrchestrator(unittest.TestCase):
    """Test end-to-end query orchestration."""

    def setUp(self):
        from ava007.membrain.pipeline.orchestration import QueryOrchestrator
        self.orchestrator = QueryOrchestrator()

    def test_orchestrate_default_stages(self):
        result = self.orchestrator.orchestrate('test query')
        self.assertIsNotNone(result)
        self.assertTrue(result.success)
        self.assertGreater(len(result.stages), 0)

    def test_cancel(self):
        result = self.orchestrator.orchestrate('test query')
        query_id = result.query_id
        cancelled = self.orchestrator.cancel(query_id)
        self.assertIsNotNone(cancelled)


class TestMemoryWriteback(unittest.TestCase):
    """Test memory writeback to ion store."""

    def setUp(self):
        from ava007.membrain.pipeline.writeback import MemoryWriteback
        self.writeback = MemoryWriteback()

    def test_writeback_creates_record(self):
        result = {'answer': 'test answer', 'confidence': 0.9}
        record = self.writeback.writeback(result)
        self.assertIsNotNone(record.id)
        # Tier is selected based on confidence
        self.assertIn(record.tier, ['L1', 'L2', 'L3'])

    def test_writeback_tier_selection(self):
        hot_result = {'answer': 'hot', 'confidence': 0.95}
        warm_result = {'answer': 'warm', 'confidence': 0.6}
        cold_result = {'answer': 'cold', 'confidence': 0.3}

        hot_record = self.writeback.writeback(hot_result)
        warm_record = self.writeback.writeback(warm_result)
        cold_record = self.writeback.writeback(cold_result)

        self.assertEqual(hot_record.tier, 'L1')
        self.assertEqual(warm_record.tier, 'L2')
        self.assertEqual(cold_record.tier, 'L3')

    def test_writeback_history(self):
        self.writeback.writeback({'answer': 'test', 'confidence': 0.5})
        history = self.writeback.get_writeback_history(limit=10)
        self.assertGreaterEqual(len(history), 1)


class TestResponseGenerator(unittest.TestCase):
    """Test response generation."""

    def setUp(self):
        from ava007.membrain.pipeline.response_generator import ResponseGenerator
        self.generator = ResponseGenerator()

    def test_generate_from_graph(self):
        retrieval = {'answer': 'Graph answer', 'paths': [], 'confidence': 0.9}
        response = self.generator.generate(retrieval_result=retrieval, mode='graph')
        self.assertIsNotNone(response.answer)
        self.assertGreater(response.confidence, 0)

    def test_merge_graph_priority_includes_graph_answer(self):
        merged = self.generator.merge_results(
            'Graph says A', 'Prompt says B', strategy='graph_priority'
        )
        self.assertIn('Graph says A', merged)

    def test_merge_prompt_priority_includes_prompt_answer(self):
        merged = self.generator.merge_results(
            'Graph says A', 'Prompt says B', strategy='prompt_priority'
        )
        self.assertIn('Prompt says B', merged)


# ─── L8: Hardware ────────────────────────────────────────────────────────

class TestIonmemdProtocol(unittest.TestCase):
    """Test ionmemd IPC protocol."""

    def setUp(self):
        from ava007.membrain.hardware.ionmemd.protocol import IonmemdProtocol
        self.protocol = IonmemdProtocol()

    def test_build_and_parse_request(self):
        request = self.protocol.build_request('ALLOCATE', {'size': 1024})
        parsed = self.protocol.parse_request(request)
        self.assertEqual(parsed['command'], 'ALLOCATE')
        self.assertEqual(parsed['params']['size'], 1024)

    def test_build_and_parse_response(self):
        response = self.protocol.build_response('ok', {'region_id': 'r1'}, 'req-1')
        parsed = self.protocol.parse_response(response)
        self.assertEqual(parsed['status'], 'ok')
        self.assertEqual(parsed['data']['region_id'], 'r1')

    def test_validate_request_with_protocol_version(self):
        valid_request = {
            'command': 'PING',
            'params': {},
            'request_id': '1',
            'protocol_version': self.protocol.PROTOCOL_VERSION,
        }
        self.assertTrue(self.protocol.validate_request(valid_request))

    def test_validate_invalid_request(self):
        self.assertFalse(self.protocol.validate_request({}))
        self.assertFalse(self.protocol.validate_request({'command': 'UNKNOWN', 'params': {}, 'request_id': '1', 'protocol_version': '99'}))


class TestIonmemdDaemon(unittest.TestCase):
    """Test ionmemd daemon in-process."""

    def setUp(self):
        from ava007.membrain.hardware.ionmemd.daemon import IonmemdDaemon
        self.daemon = IonmemdDaemon(socket_path='', storage_path=tempfile.mkdtemp())

    def test_allocate_region(self):
        region = self.daemon.allocate_region(1024)
        self.assertIsNotNone(region.id)
        self.assertEqual(region.size, 1024)

    def test_write_and_read(self):
        region = self.daemon.allocate_region(256)
        written = self.daemon.write_region(region.id, 0, b'Hello ionmemd!')
        self.assertEqual(written, 14)
        data = self.daemon.read_region(region.id, 0, 14)
        self.assertEqual(data, b'Hello ionmemd!')

    def test_free_region(self):
        region = self.daemon.allocate_region(128)
        freed = self.daemon.free_region(region.id)
        self.assertTrue(freed)

    def test_list_regions(self):
        self.daemon.allocate_region(64)
        self.daemon.allocate_region(128)
        regions = self.daemon.list_regions()
        self.assertGreaterEqual(len(regions), 2)


class TestS25UltraNPU(unittest.TestCase):
    """Test Tier 1 hardware access."""

    def setUp(self):
        from ava007.membrain.hardware.s25ultra_npu import S25UltraNPU
        self.npu = S25UltraNPU()

    def test_get_tier(self):
        self.assertEqual(self.npu.get_tier(), 1)

    def test_detect_hardware(self):
        info = self.npu.detect_hardware()
        self.assertIsNotNone(info)

    def test_inference_qnn(self):
        result = self.npu.inference_qnn([1.0, 2.0, 3.0])
        self.assertIsNotNone(result)
        self.assertGreater(result.latency_ms, 0)


class TestS25UltraADB(unittest.TestCase):
    """Test Tier 2 hardware access."""

    def setUp(self):
        from ava007.membrain.hardware.s25ultra_adb import S25UltraADB
        self.adb = S25UltraADB()

    def test_get_tier(self):
        self.assertEqual(self.adb.get_tier(), 2)

    def test_get_cpu_info(self):
        info = self.adb.get_cpu_info()
        self.assertIsNotNone(info)
        self.assertGreater(info.total_cores, 0)


class TestS25UltraRoot(unittest.TestCase):
    """Test Tier 3 hardware access."""

    def setUp(self):
        from ava007.membrain.hardware.s25ultra_root import S25UltraRoot
        self.root = S25UltraRoot()

    def test_get_tier(self):
        self.assertEqual(self.root.get_tier(), 3)

    def test_get_capabilities(self):
        caps = self.root.get_capabilities()
        self.assertIsInstance(caps, list)
        self.assertGreater(len(caps), 0)


class TestGetHardwareTier(unittest.TestCase):
    """Test auto-detection of hardware tier."""

    def test_returns_valid_tier(self):
        from ava007.membrain.hardware import get_hardware_tier
        tier = get_hardware_tier()
        self.assertIn(tier, [1, 2, 3])


# ─── Cross-Layer Integration ────────────────────────────────────────────

class TestFullPipelineIntegration(unittest.TestCase):
    """Integration test: query flows through L1-L7."""

    def test_end_to_end_query(self):
        """Test a complete query through the full MemBrain stack."""
        from ava007.membrain.pipeline.pipeline import MembrainPipeline
        pipeline = MembrainPipeline()

        result1 = pipeline.execute('What is the configuration of the system?')
        self.assertIsNotNone(result1.answer)
        self.assertGreater(result1.confidence, 0)

        result2 = pipeline.execute('Design a new memory architecture')
        self.assertIsNotNone(result2.answer)

        stats = pipeline.get_stats()
        self.assertGreaterEqual(stats.total_queries, 2)

    def test_writeback_to_ion_store(self):
        """Test that results are written back to ion memory."""
        from ava007.membrain.pipeline.writeback import MemoryWriteback
        wb = MemoryWriteback()

        result = {'answer': 'Integration test', 'confidence': 0.88}
        record = wb.writeback(result)
        self.assertEqual(record.tier, 'L1')
        self.assertIsNotNone(record.id)

        history = wb.get_writeback_history(limit=10)
        self.assertGreaterEqual(len(history), 1)

    def test_ion_memory_to_fast_mesh_flow(self):
        """Test data flows from ion memory to FASt mesh for persistence."""
        from ava007.membrain.ion_memory.ion_memory import IonMemoryStore
        from ava007.membrain.fast_mesh.fast_mesh import FAStMesh

        tmpdir = tempfile.mkdtemp()
        store = IonMemoryStore()
        mesh = FAStMesh(provider='local', l3_base_dir=os.path.join(tmpdir, 'mesh'))

        # Write data to ion store
        store.create_filament('config_1', initial_level=5)

        # Serialize and store in mesh
        data = json.dumps({'filament': 'config_1', 'level': 5}).encode()
        content_hash = mesh.store(data, content_type='application/json')

        # Retrieve from mesh
        retrieved = mesh.retrieve(content_hash)
        self.assertEqual(retrieved, data)

    def test_graphrag_with_ion_memory(self):
        """Test GraphRAG retrieval backed by ion memory storage."""
        from ava007.membrain.graphrag.graphrag_retrieval import GraphRAGRetrieval
        from ava007.membrain.graphrag.property_graph import PropertyGraph

        engine = GraphRAGRetrieval()
        graph = PropertyGraph()

        graph.add_node('q1', labels=['Query'], properties={'text': 'memory architecture'})
        graph.add_node('a1', labels=['Answer'], properties={'text': 'Ion memory with MLC emulation'})
        graph.add_edge('e1', source='q1', target='a1', type='ANSWERS')

        from ava007.membrain.graphrag.graphrag_retrieval import QueryPattern
        from ava007.membrain.graphrag.path_restrictors import PathType
        pattern = QueryPattern(
            path_type=PathType.WALK,
            edge_types=['ANSWERS'],
            node_labels=['Query', 'Answer'],
            max_depth=2,
            let_bindings={},
        )
        result = engine.query(graph, 'q1', pattern)
        self.assertGreater(result.total_count, 0)


if __name__ == '__main__':
    unittest.main()
