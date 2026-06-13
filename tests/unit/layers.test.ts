import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import * as crypto from 'crypto';

import { MemoryStore } from '../src/memory/jsonl/index.js';
import { TashiSigner } from '../src/consensus/tashi/index.js';
import { TemporalReplay } from '../src/temporal/index.js';
import { GraphStore, enforceMaxDepth, DepthExceededError } from '../src/graph/neo4j/index.js';
import { SubconsciousObserver, WriteDeniedError } from '../src/subconscious/index.js';
import { Ava007 } from '../src/ava007/index.js';
import { Brain } from '../src/brain/index.js';
import { enforceAuthority, isPermitted, AuthorityViolationError } from '../src/contract/enforcement.js';
import { LoRaBridge } from '../src/hal/index.js';

let tmpDir: string;
function makeTmpDir(): string { tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'membrain-test-')); return tmpDir; }
function cleanup(): void { if (tmpDir && fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true }); }

const DEV_KEY_PEM = Ava007.bootstrapKey();

console.group('L1 - Memory Store');
{ const dir = makeTmpDir(); const store = new MemoryStore(dir);
  const e1 = store.append(1, 'test', { value: 'hello' });
  console.assert(e1.seq === 1, 'seq=1'); console.assert(e1.hash.length === 64, 'hash len'); console.assert(e1.prevHash === '0'.repeat(64), 'genesis');
  const e2 = store.append(2, 'test2', { value: 'world' });
  console.assert(e2.prevHash === e1.hash, 'chain'); console.assert(store.readAll().length === 2, 'count'); console.assert(store.verify() === true, 'verify');
  console.log('  OK'); cleanup(); }
console.groupEnd();

console.group('L2 - Tashi Consensus');
{ const signer = new TashiSigner(DEV_KEY_PEM);
  const hash = crypto.createHash('sha256').update('test-data').digest('hex');
  const sig = signer.sign(hash);
  console.assert(signer.verify(hash, sig), 'self verify'); console.assert(new TashiSigner(DEV_KEY_PEM).verify(hash, sig), 'cross verify');
  console.assert(!signer.verify('wrong-hash', sig), 'wrong hash');
  console.log('  OK'); }
console.groupEnd();

console.group('L3 - Temporal Replay');
{ const dir = makeTmpDir(); const store = new MemoryStore(dir);
  store.append(1, 'input', { x: 1 }); store.append(3, 'transform', { x: 2 }); store.append(6, 'decision', { action: 'proceed' });
  const replay = new TemporalReplay(store); const timeline = replay.replay();
  console.assert(timeline.length === 3, '3 entries'); console.assert(timeline[0].event === '1:input', 'first event');
  console.log('  OK'); cleanup(); }
console.groupEnd();

console.group('L4 - Graph / Depth Enforcement');
{ const dir = makeTmpDir(); const store = new MemoryStore(dir); const graph = new GraphStore(store);
  graph.addNode({ id: 'a', label: 'entity', properties: {} }); graph.addNode({ id: 'b', label: 'entity', properties: {} });
  graph.addEdge({ id: 'e1', source: 'a', target: 'b', type: 'links', properties: {} });
  console.assert(graph.traverse('a', 3).nodes.length === 2, '2 nodes');
  enforceMaxDepth(5); let threw = false; try { enforceMaxDepth(6); } catch (e) { threw = e instanceof DepthExceededError; }
  console.assert(threw, 'depth exceeded');
  console.log('  OK'); cleanup(); }
console.groupEnd();

console.group('L5 - Subconscious');
{ const dir = makeTmpDir(); const store = new MemoryStore(dir); const graph = new GraphStore(store);
  const sub = new SubconsciousObserver(store, graph); graph.addNode({ id: 'root', label: 'entity', properties: {} });
  console.assert(Array.isArray(sub.observeMemory()), 'observe'); console.assert(typeof sub.patternDensity('root') === 'number', 'density');
  let t = false; try { sub.write(); } catch (e) { t = e instanceof WriteDeniedError; } console.assert(t, 'write denied');
  console.log('  OK'); cleanup(); }
console.groupEnd();

console.group('L6 - Ava007');
{ const dir = makeTmpDir(); const store = new MemoryStore(dir); const graph = new GraphStore(store);
  const sub = new SubconsciousObserver(store, graph); const ava = new Ava007(store, graph, sub, DEV_KEY_PEM);
  const d = ava.decide({ query: 'test' }, 'rationale', 'respond', 0.85);
  console.assert(d.confidence === 0.85, 'confidence'); console.assert(ava.verifyDecision(d), 'verify');
  graph.addNode({ id: 'root', label: 'entity', properties: {} });
  const s = ava.consult('root'); console.assert(typeof s.density === 'number', 'consult');
  console.log('  OK'); cleanup(); }
console.groupEnd();

console.group('Authority Contract');
{ console.assert(isPermitted({ sourceLayer: 6, targetLayer: 6, action: 'decide' }), 'L6 decide');
  console.assert(!isPermitted({ sourceLayer: 5, targetLayer: 1, action: 'write' }), 'L5 no write');
  let t = false; try { enforceAuthority({ sourceLayer: 5, targetLayer: 1, action: 'write' }); } catch (e) { t = e instanceof AuthorityViolationError; }
  console.assert(t, 'violation'); console.log('  OK'); }
console.groupEnd();

console.group('HAL - LoRa Bridge');
{ const bridge = new LoRaBridge(); await bridge.open(); console.assert(bridge.isMockMode, 'mock');
  let pkt: any = null; bridge.onPacket((p) => { pkt = p; });
  await bridge.send('node-1', 'ping'); await new Promise(r => setTimeout(r, 200));
  console.assert(pkt !== null, 'packet'); bridge.close(); console.log('  OK'); }
console.groupEnd();

console.group('Brain Integration');
{ const dir = makeTmpDir(); const brain = new Brain({ dataDir: dir, signerKeyPem: DEV_KEY_PEM });
  const d = brain.process({ query: 'integration test' });
  console.assert(brain.ava.verifyDecision(d), 'verify'); console.assert(brain.memory.seq >= 2, 'seq');
  console.log('  OK'); fs.rmSync(dir, { recursive: true, force: true }); }
console.groupEnd();

console.log('\nAll tests passed.');
