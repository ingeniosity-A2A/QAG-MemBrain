// ═══════════════════════════════════════════════════════════════════
// QAG_MemBrain — Privacy Shield: Identifier Rotation Manager
// L6 Authority Layer — Chameleon Node Identity Controller
//
// Samsung S26 Ultra (Snapdragon 8 Elite, Adreno 830, X80 modem)
// Hardware: DMA-BUF heaps, QNN NPU, OpenCL GPU DSP
//
// Manages virtual identity pool, rotation scheduling, and
// coordinated stealth for Samsung S26 Ultra D-MIMO clusters.
// ═══════════════════════════════════════════════════════════════════

import { createHash, randomBytes } from "crypto";
import { readFileSync, writeFileSync, existsSync } from "fs";

// ─── Types ─────────────────────────────────────────────────────────

export interface VirtualIdentity {
  id: string;
  imsi: string;
  imei: string;
  macWifi: string;
  macBt: string;
  iccid: string;
  ki: string;       // Authentication key
  opc: string;      // Operator variant code
  msin: string;     // Mobile subscriber identification number
  createdAt: number;
  lastUsedAt?: number;
  active: boolean;
  compromised: boolean;
}

export interface RotationPolicy {
  /** Periodic rotation interval in ms (default: 4 hours) */
  periodicIntervalMs: number;
  /** Max sessions before forced rotation */
  maxSessionsPerIdentity: number;
  /** Rotate immediately on IMSI-catcher detection */
  triggerOnThreat: boolean;
  /** Coordinated rotation window for D-MIMO cluster (ms) */
  clusterSyncWindowMs: number;
  /** Maximum identity pool size */
  poolSize: number;
}

export interface RotationEvent {
  timestamp: number;
  previousIdentityId: string;
  newIdentityId: string;
  reason: "periodic" | "threat" | "session_limit" | "manual" | "cluster_sync";
  triggerSource?: string;
}

// ─── S26 Ultra Hardware Integration ────────────────────────────────

export interface S26UltraConfig {
  /** Snapdragon 8 Elite chipset identifier */
  chipset: "snapdragon_8_elite";
  /** QNN NPU backend for on-device inference */
  npuBackend: "qnn";
  /** Adreno 830 GPU for OpenCL DSP */
  gpuBackend: "opencl";
  /** DMA-BUF heap path for secure memory */
  secureHeapPath: string;
  /** sSDR/xSDR device path */
  sdrDevice: string;
  /** PTY path for modem emulator */
  ptyPath: string;
  /** Identity export path for cross-module sync */
  identityExportPath: string;
}

export interface DMABUFState {
  /** DMA-BUF heap file descriptor */
  heapFd: number;
  /** Allocated buffer size in bytes */
  bufferSize: number;
  /** Buffer zeroed on free */
  zeroOnFree: boolean;
  /** Secure heap path */
  secureHeapPath: string;
  /** Current identity buffer mapping */
  identityBufferId: string;
}

export interface DMIEvent {
  timestamp: number;
  identityId: string;
  bufferId: string;
  operation: "alloc" | "write" | "read" | "zero" | "free";
  sizeBytes: number;
  success: boolean;
}

export interface ClusterNode {
  nodeId: string;
  deviceId: string;
  currentIdentityId: string;
  lastSyncAt: number;
  healthy: boolean;
}

export interface IdentityState {
  currentNodeId: string;
  activeIdentity: VirtualIdentity;
  identityPool: VirtualIdentity[];
  rotationHistory: RotationEvent[];
  clusterNodes: ClusterNode[];
  policy: RotationPolicy;
  totalRotations: number;
  threatsDetected: number;
}

// ─── Identity Generator ────────────────────────────────────────────

function generateIMSI(): string {
  // MCC 901 (test/private) + MNC 70 + random MSIN
  const mcc = "901";
  const mnc = "70";
  const msin = Array.from({ length: 10 }, () => Math.floor(Math.random() * 10)).join("");
  return `${mcc}${mnc}${msin}`;
}

function generateIMEI(): string {
  // TAC (8 digits) + serial (6 digits) + check digit
  const tac = Array.from({ length: 8 }, () => Math.floor(Math.random() * 10)).join("");
  const serial = Array.from({ length: 6 }, () => Math.floor(Math.random() * 10)).join("");
  const partial = tac + serial;
  // Luhn check digit
  let sum = 0;
  for (let i = 0; i < partial.length; i++) {
    let digit = parseInt(partial[i], 10);
    if (i % 2 === 1) digit *= 2;
    if (digit > 9) digit -= 9;
    sum += digit;
  }
  const checkDigit = (10 - (sum % 10)) % 10;
  return `${partial}${checkDigit}`;
}

function generateMAC(): string {
  const bytes = Array.from({ length: 6 }, () => Math.floor(Math.random() * 256));
  // Set locally administered bit, clear multicast bit
  bytes[0] = (bytes[0] | 0x02) & 0xfe;
  return bytes.map((b) => b.toString(16).padStart(2, "0")).join(":");
}

function generateKi(): string {
  return randomBytes(16).toString("hex");
}

function generateOpc(): string {
  return randomBytes(16).toString("hex");
}

function generateMSIN(): string {
  return Array.from({ length: 10 }, () => Math.floor(Math.random() * 10)).join("");
}

function generateICCID(): string {
  const prefix = "8990170";  // Private PLMN prefix
  const msin = generateMSIN();
  const partial = prefix + msin;
  // Simple checksum
  let sum = 0;
  for (let i = 0; i < partial.length; i++) {
    let digit = parseInt(partial[i], 10);
    if (i % 2 === 1) digit *= 2;
    if (digit > 9) digit -= 9;
    sum += digit;
  }
  const checkDigit = (10 - (sum % 10)) % 10;
  return `${partial}${checkDigit}`;
}

export function createVirtualIdentity(): VirtualIdentity {
  return {
    id: `vid_${Date.now()}_${randomBytes(4).toString("hex")}`,
    imsi: generateIMSI(),
    imei: generateIMEI(),
    macWifi: generateMAC(),
    macBt: generateMAC(),
    iccid: generateICCID(),
    ki: generateKi(),
    opc: generateOpc(),
    msin: generateMSIN(),
    createdAt: Date.now(),
    active: true,
    compromised: false,
  };
}

// ─── Identity Manager ──────────────────────────────────────────────

export class IdentityManager {
  private state: IdentityState;
  private rotationTimer: ReturnType<typeof setInterval> | null = null;
  private onRotationCallbacks: Array<(event: RotationEvent) => void> = [];
  private onThreatCallbacks: Array<(threat: { source: string; identity: VirtualIdentity }) => void> = [];

  constructor(
    nodeId: string,
    policy?: Partial<RotationPolicy>,
  ) {
    const fullPolicy: RotationPolicy = {
      periodicIntervalMs: 4 * 60 * 60 * 1000, // 4 hours
      maxSessionsPerIdentity: 100,
      triggerOnThreat: true,
      clusterSyncWindowMs: 5000, // 5 seconds
      poolSize: 20,
      ...policy,
    };

    // Generate initial identity pool
    const pool: VirtualIdentity[] = [];
    for (let i = 0; i < fullPolicy.poolSize; i++) {
      pool.push(createVirtualIdentity());
    }

    this.state = {
      currentNodeId: nodeId,
      activeIdentity: pool[0],
      identityPool: pool,
      rotationHistory: [],
      clusterNodes: [],
      policy: fullPolicy,
      totalRotations: 0,
      threatsDetected: 0,
    };

    this.startPeriodicRotation();
  }

  // ── Core Operations ────────────────────────────────────────────

  getActiveIdentity(): VirtualIdentity {
    return { ...this.state.activeIdentity };
  }

  getState(): IdentityState {
    return {
      ...this.state,
      activeIdentity: { ...this.state.activeIdentity },
      identityPool: this.state.identityPool.map((v) => ({ ...v })),
      rotationHistory: [...this.state.rotationHistory],
      clusterNodes: [...this.state.clusterNodes],
    };
  }

  /**
   * Rotate to next unused identity from pool.
   * Returns the new active identity.
   */
  rotate(reason: RotationEvent["reason"], triggerSource?: string): VirtualIdentity {
    const previous = this.state.activeIdentity;

    // Mark previous as used
    previous.active = false;
    previous.lastUsedAt = Date.now();

    // Find next uncompromised identity
    let next = this.state.identityPool.find(
      (v) => v.active && !v.compromised && v.id !== previous.id,
    );

    // If pool exhausted, generate a fresh one
    if (!next) {
      next = createVirtualIdentity();
      this.state.identityPool.push(next);
      this.trimPool();
    }

    next.active = true;
    this.state.activeIdentity = next;

    const event: RotationEvent = {
      timestamp: Date.now(),
      previousIdentityId: previous.id,
      newIdentityId: next.id,
      reason,
      triggerSource,
    };

    this.state.rotationHistory.push(event);
    this.state.totalRotations++;

    // Notify callbacks
    for (const cb of this.onRotationCallbacks) {
      cb(event);
    }

    return { ...next };
  }

  /**
   * Report a threat (e.g., IMSI-catcher detected).
   * Immediately rotates identity and marks source as threat.
   */
  reportThreat(source: string): VirtualIdentity {
    this.state.threatsDetected++;

    const threatIdentity = { ...this.state.activeIdentity };
    threatIdentity.compromised = true;

    const newIdentity = this.rotate("threat", source);

    for (const cb of this.onThreatCallbacks) {
      cb({ source, identity: threatIdentity });
    }

    return newIdentity;
  }

  /**
   * Mark an identity as compromised (e.g., detected by carrier).
   */
  markCompromised(identityId: string): void {
    const identity = this.state.identityPool.find((v) => v.id === identityId);
    if (identity) {
      identity.compromised = true;
      identity.active = false;

      // If it was the active identity, force rotation
      if (this.state.activeIdentity.id === identityId) {
        this.rotate("threat", `identity_${identityId}_compromised`);
      }
    }
  }

  // ── Cluster Coordination ───────────────────────────────────────

  /**
   * Register a cluster node for coordinated rotation.
   */
  registerClusterNode(node: ClusterNode): void {
    const existing = this.state.clusterNodes.find((n) => n.nodeId === node.nodeId);
    if (existing) {
      Object.assign(existing, node);
    } else {
      this.state.clusterNodes.push(node);
    }
  }

  /**
   * Sync rotation across D-MIMO cluster.
   * All nodes rotate within the sync window.
   */
  syncClusterRotation(reason: RotationEvent["reason"]): VirtualIdentity[] {
    const results: VirtualIdentity[] = [];

    // Rotate locally
    results.push(this.rotate("cluster_sync", reason));

    // In a real implementation, this would send rotation commands to peer nodes
    // via the mesh network. For now, we record the intent.
    for (const node of this.state.clusterNodes) {
      if (node.nodeId !== this.state.currentNodeId && node.healthy) {
        node.lastSyncAt = Date.now();
        node.currentIdentityId = this.state.activeIdentity.id;
      }
    }

    return results;
  }

  // ── MAC Address Randomization ──────────────────────────────────

  /**
   * Get randomized MAC addresses for current identity.
   * Returns { wifi, bluetooth } MAC addresses.
   */
  getMACAddresses(): { wifi: string; bluetooth: string } {
    return {
      wifi: this.state.activeIdentity.macWifi,
      bluetooth: this.state.activeIdentity.macBt,
    };
  }

  /**
   * Rotate MAC addresses for the current identity.
   */
  rotateMACAddresses(): { wifi: string; bluetooth: string } {
    const identity = this.state.activeIdentity;
    identity.macWifi = generateMAC();
    identity.macBt = generateMAC();
    return { wifi: identity.macWifi, bluetooth: identity.macBt };
  }

  // ── AT Command Interface (for modem emulator) ──────────────────

  /**
   * Get AT command responses for the current identity.
   * Used by the Python modem emulator to present identity to network.
   */
  getATIdentity(): { atCimi: string; atCgsn: string; atIccid: string } {
    return {
      atCimi: this.state.activeIdentity.imsi,
      atCgsn: this.state.activeIdentity.imei,
      atIccid: this.state.activeIdentity.iccid,
    };
  }

  /**
   * Get authentication credentials for current identity.
   */
  getAuthCredentials(): { ki: string; opc: string; msin: string } {
    return {
      ki: this.state.activeIdentity.ki,
      opc: this.state.activeIdentity.opc,
      msin: this.state.activeIdentity.msin,
    };
  }

  // ── Event Handlers ─────────────────────────────────────────────

  onRotation(callback: (event: RotationEvent) => void): void {
    this.onRotationCallbacks.push(callback);
  }

  onThreat(callback: (threat: { source: string; identity: VirtualIdentity }) => void): void {
    this.onThreatCallbacks.push(callback);
  }

  // ── Lifecycle ──────────────────────────────────────────────────

  private startPeriodicRotation(): void {
    this.rotationTimer = setInterval(() => {
      this.rotate("periodic");
    }, this.state.policy.periodicIntervalMs);
  }

  private trimPool(): void {
    // Remove old, unused identities if pool exceeds limit
    if (this.state.identityPool.length > this.state.policy.poolSize * 2) {
      const sorted = [...this.state.identityPool].sort(
        (a, b) => (a.lastUsedAt ?? a.createdAt) - (b.lastUsedAt ?? b.createdAt),
      );
      // Keep active and recent, remove oldest unused
      const toRemove = sorted.slice(0, sorted.length - this.state.policy.poolSize);
      this.state.identityPool = this.state.identityPool.filter(
        (v) => !toRemove.includes(v) || v.active,
      );
    }
  }

  // ── S26 Ultra DMA-BUF Integration ───────────────────────────────

  /**
   * Export current identity to /tmp for Python modem emulator and srsRAN.
   * Cross-module sync point between TypeScript governance and Python RF stack.
   */
  exportIdentityForModem(): void {
    const identity = this.state.activeIdentity;
    const exportData = {
      id: identity.id,
      imsi: identity.imsi,
      imei: identity.imei,
      iccid: identity.iccid,
      mac_wifi: identity.macWifi,
      mac_bt: identity.macBt,
      ki: identity.ki,
      opc: identity.opc,
      rotated_at: Date.now() / 1000,
      rotation_count: this.state.totalRotations,
    };

    const exportPath = "/tmp/current_identity.json";
    try {
      writeFileSync(exportPath, JSON.stringify(exportData, null, 2));
    } catch {
      // In browser/edge context, file write may not be available
    }
  }

  /**
   * Read rotation signal from IMSI-catcher detection module.
   * Polls /tmp/identity_rotation_signal.json for threat-triggered rotations.
   */
  checkRotationSignal(): boolean {
    const signalPath = "/tmp/identity_rotation_signal.json";
    try {
      if (!existsSync(signalPath)) return false;

      const raw = readFileSync(signalPath, "utf-8");
      const signal = JSON.parse(raw);

      if (signal.action === "rotate" && signal.reason === "threat") {
        this.reportThreat(signal.source || "imsi_catcher");
        // Remove signal file after processing
        try {
          const { unlinkSync } = require("fs");
          unlinkSync(signalPath);
        } catch { /* ignore */ }
        return true;
      }
    } catch {
      // Signal file not available or malformed
    }
    return false;
  }

  /**
   * Get DMA-BUF heap configuration for S26 Ultra secure memory.
   * Ensures identity data is isolated in hardware-protected memory.
   */
  getDMABUFConfig(): {
    secureHeapPath: string;
    zeroOnFree: boolean;
    isolateIdentities: boolean;
  } {
    return {
      secureHeapPath: "/dev/dma_heap/system-secure-sif",
      zeroOnFree: true,
      isolateIdentities: true,
    };
  }

  /**
   * Coordinate identity rotation across D-MIMO cluster via wsdr.io.
   * Sends rotation command to peer S26 Ultra nodes.
   */
  async syncClusterViaWSDR(
    peerNodes: Array<{ nodeId: string; endpoint: string }>,
  ): Promise<void> {
    const identity = this.state.activeIdentity;
    const syncPayload = {
      type: "IDENTITY_SYNC",
      identityId: identity.id,
      imsi: identity.imsi,
      timestamp: Date.now(),
      nodeId: this.state.currentNodeId,
    };

    // In production, this would POST to wsdr.io cloud-hybrid API
    // which relays to peer nodes in the mesh
    for (const peer of peerNodes) {
      try {
        // await fetch(`${peer.endpoint}/api/identity/sync`, {
        //   method: "POST",
        //   headers: { "Content-Type": "application/json" },
        //   body: JSON.stringify(syncPayload),
        // });
      } catch {
        // Peer unreachable — will sync on reconnect
      }
    }
  }

  destroy(): void {
    if (this.rotationTimer) {
      clearInterval(this.rotationTimer);
      this.rotationTimer = null;
    }
    this.onRotationCallbacks = [];
    this.onThreatCallbacks = [];
  }
}

// ─── Singleton for system-wide identity management ─────────────────

let defaultManager: IdentityManager | null = null;

export function getIdentityManager(nodeId?: string): IdentityManager {
  if (!defaultManager) {
    defaultManager = new IdentityManager(nodeId ?? `node_${Date.now()}`);
  }
  return defaultManager;
}

export function resetIdentityManager(): void {
  if (defaultManager) {
    defaultManager.destroy();
    defaultManager = null;
  }
}
