#!/usr/bin/env node
import { Brain } from './brain/index.js';
import { MemBrainWSServer } from './ws/index.js';

const PORT = parseInt(process.env.PORT || '8080', 10);
const DATA_DIR = process.env.DATA_DIR || './data';
const SIGNER_KEY = process.env.AVA007_SIGNER_PRIVATE_KEY_PEM;

if (!SIGNER_KEY) {
  console.warn('WARNING: AVA007_SIGNER_PRIVATE_KEY_PEM not set - using ephemeral dev key.');
}

const brain = new Brain({ dataDir: DATA_DIR, signerKeyPem: SIGNER_KEY });
const server = new MemBrainWSServer({ port: PORT, brain });

console.log(`Quantum Atomic GSAP MemBrain v0.1.0 | Data: ${DATA_DIR} | Seq: ${brain.memory.seq}`);

process.on('SIGINT', () => { console.log('Shutting down...'); server.close(); process.exit(0); });
process.on('SIGTERM', () => { server.close(); process.exit(0); });
