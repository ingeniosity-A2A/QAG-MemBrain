/**
 * Chameleon Identity Controller
 * Manages virtual IMSI/IMEI rotation for operational sovereignty.
 * 
 * Part of the L6 Authority Layer in the SIF architecture.
 * License: MIT
 */

import * as crypto from 'crypto';
import { execSync } from 'child_process';

interface VirtualIdentity {
  imsi: string;
  imei: string;
  msisdn: string;
  ki: string;
  opc: string;
  rotationTtl: number;
}

interface RotationResult {
  status: string;
  imsi: string;
  trigger: string;
  timestamp: number;
}

export class ChameleonController {
  private identityPool: VirtualIdentity[];
  private activeIdentity: VirtualIdentity | null = null;
  private rotationTimer: NodeJS.Timeout | null = null;
  private readonly MODEM_API = "http://localhost:9042";
  private meshNodes: string[] = [];
  private rotationCount: number = 0;
  private emergencyRotations: number = 0;

  constructor(modemEmulatorPath: string = "/tmp/vmodem") {
    console.log(`[Chameleon] Initializing on modem: ${modemEmulatorPath}`);
    this.identityPool = this.loadVirtualProfiles();
    this.meshNodes = this.loadMeshNodes();
    console.log(`[Chameleon] Loaded ${this.identityPool.length} identities, ${this.meshNodes.length} mesh nodes`);
  }

  /**
   * Load virtual identity profiles from secure storage.
   */
  private loadVirtualProfiles(): VirtualIdentity[] {
    try {
      const poolJson = process.env.SIF_IDENTITY_POOL;
      if (poolJson) {
        const pool = JSON.parse(poolJson);
        if (Array.isArray(pool) && pool.length > 0) {
          return pool;
        }
      }
    } catch (error) {
      console.warn("[Chameleon] Failed to parse SIF_IDENTITY_POOL, generating defaults");
    }

    // Try loading from file
    try {
      const fs = require('fs');
      const path = require('path');
      const poolPath = path.join(process.env.HOME || '/root', 'ava007-runtime/secure/sif_identity_pool.json');
      if (fs.existsSync(poolPath)) {
        return JSON.parse(fs.readFileSync(poolPath, 'utf-8'));
      }
    } catch (error) {
      console.warn("[Chameleon] No identity pool file found");
    }

    return this.generateDefaultPool(10);
  }

  /**
   * Load mesh node URLs from environment or config.
   */
  private loadMeshNodes(): string[] {
    const nodesJson = process.env.SIF_MESH_NODES;
    if (nodesJson) {
      try {
        return JSON.parse(nodesJson);
      } catch (error) {
        console.warn("[Chameleon] Failed to parse mesh nodes");
      }
    }
    // Default: S26 Ultra as secondary node
    return ["https://s26.local:9043"];
  }

  /**
   * Generate default identity pool for development/testing.
   * Production pools should come from hardware security module.
   */
  private generateDefaultPool(count: number): VirtualIdentity[] {
    console.log(`[Chameleon] Generating ${count} default identities`);
    const pool: VirtualIdentity[] = [];
    const prefixes = ["310260", "310410", "310150", "310170", "310030"];
    
    for (let i = 0; i < count; i++) {
      const prefix = prefixes[i % prefixes.length];
      const suffix = String(i).padStart(9, '0');
      pool.push({
        imsi: `${prefix}${suffix}`,
        imei: `49015420${String(i).padStart(7, '0')}`,
        msisdn: `1555${String(i).padStart(6, '0')}`,
        ki: crypto.randomBytes(16).toString('hex'),
        opc: crypto.randomBytes(16).toString('hex'),
        rotationTtl: 300000 + Math.floor(Math.random() * 900000), // 5-20 min
      });
    }
    return pool;
  }

  /**
   * Execute identity rotation.
   */
  public async rotateIdentity(trigger: "scheduled" | "threat" | "manual"): Promise<RotationResult> {
    const startTime = Date.now();
    console.log(`\n[Chameleon] ═══════ ROTATION INITIATED ═══════`);
    console.log(`[Chameleon] Trigger: ${trigger.toUpperCase()}`);

    if (trigger === "threat") {
      this.emergencyRotations++;
    }

    // 1. Select next identity
    const nextId = this.selectNextIdentity();
    console.log(`[Chameleon] Selected: IMSI ${nextId.imsi.slice(0, 6)}***`);

    // 2. Sanitize memory heaps
    await this.sanitizeMemoryHeaps();

    // 3. Signal modem to rotate
    try {
      const response = await fetch(`${this.MODEM_API}/rotate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          imsi: nextId.imsi,
          imei: nextId.imei,
          msisdn: nextId.msisdn,
          ki: nextId.ki,
          opc: nextId.opc,
        }),
      });

      if (!response.ok) {
        throw new Error(`API returned ${response.status}`);
      }

      const result = await response.json();
      console.log(`[Chameleon] Modem confirmed: ${result.imsi}`);
    } catch (error) {
      console.error(`[Chameleon] Rotation FAILED:`, error);
      throw error;
    }

    // 4. Update state
    const previousImsi = this.activeIdentity?.imsi.slice(0, 6) + "***" || "NONE";
    this.activeIdentity = nextId;
    this.rotationCount++;

    // 5. Cascade to mesh if threat
    if (trigger === "threat") {
      await this.cascadeRotationToMesh();
    }

    // 6. Schedule next
    this.scheduleRotation(nextId.rotationTtl);

    const duration = Date.now() - startTime;
    console.log(`[Chameleon] Rotation complete in ${duration}ms`);
    console.log(`[Chameleon] Total rotations: ${this.rotationCount}, Emergency: ${this.emergencyRotations}`);
    console.log(`[Chameleon] ═══════════════════════════════════\n`);

    return {
      status: "success",
      imsi: nextId.imsi.slice(0, 6) + "***",
      trigger,
      timestamp: Date.now(),
    };
  }

  /**
   * Select next identity using secure random shuffle.
   */
  private selectNextIdentity(): VirtualIdentity {
    const available = this.identityPool.filter(
      id => id.imsi !== this.activeIdentity?.imsi
    );
    
    if (available.length === 0) {
      return this.identityPool[0];
    }

    const index = crypto.randomInt(0, available.length);
    return available[index];
  }

  /**
   * Zeroize secure memory heaps between identities.
   */
  private async sanitizeMemoryHeaps(): Promise<void> {
    console.log("[Chameleon] Sanitizing DMA-BUF secure heaps...");
    
    try {
      // Tashi (L2) kernel zeroization command
      execSync("echo 0 > /sys/kernel/dma_heap/system-secure-sif/zeroize 2>/dev/null || true");
    } catch (error) {
      // Non-critical in development
    }

    // Force garbage collection
    if (global.gc) {
      global.gc();
    }

    console.log("[Chameleon] Memory sanitization complete");
  }

  /**
   * Cascade rotation to all mesh nodes.
   */
  private async cascadeRotationToMesh(): Promise<void> {
    console.log(`[Chameleon] Cascading rotation to ${this.meshNodes.length} mesh nodes...`);

    for (const node of this.meshNodes) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000);

        const response = await fetch(`${node}/rotate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cascade: true }),
          signal: controller.signal,
        });

        clearTimeout(timeout);

        if (response.ok) {
          console.log(`[Chameleon] ✓ Cascaded to ${node}`);
        } else {
          console.warn(`[Chameleon] ✗ ${node} returned ${response.status}`);
        }
      } catch (error) {
        console.warn(`[Chameleon] ✗ Failed to cascade to ${node}`);
      }
    }
  }

  /**
   * Schedule next automatic rotation.
   */
  private scheduleRotation(ttl: number): void {
    if (this.rotationTimer) {
      clearTimeout(this.rotationTimer);
    }

    const jitter = Math.floor(Math.random() * 30000); // ±15s jitter
    const delay = ttl + jitter;

    this.rotationTimer = setTimeout(() => {
      this.rotateIdentity("scheduled");
    }, delay);

    const nextRotation = new Date(Date.now() + delay);
    console.log(`[Chameleon] Next rotation: ${nextRotation.toISOString()} (in ${Math.round(delay/1000)}s)`);
  }

  /**
   * Start the Chameleon Controller.
   */
  public start(): void {
    console.log("[Chameleon] ═══════ STARTING CONTROLLER ═══════");
    
    // Set initial identity
    this.activeIdentity = this.identityPool[0];
    console.log(`[Chameleon] Initial: IMSI ${this.activeIdentity.imsi.slice(0, 6)}***`);

    // Start threat monitoring
    this.startThreatMonitoring();

    // Schedule first rotation
    this.scheduleRotation(this.activeIdentity.rotationTtl);

    console.log("[Chameleon] Controller active. Awaiting rotation events...\n");
  }

  /**
   * Monitor for IMSI-catcher threats.
   */
  private startThreatMonitoring(): void {
    setInterval(async () => {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 2000);

        const response = await fetch(`${this.MODEM_API}/threat/status`, {
          signal: controller.signal,
        });
        clearTimeout(timeout);

        if (response.ok) {
          const status = await response.json();
          if (status.threat_detected) {
            console.warn("[Chameleon] ⚠️ THREAT DETECTED via API!");
            await this.rotateIdentity("threat");
          }
        }
      } catch (error) {
        // API may not be running; that's acceptable
      }
    }, 5000);
  }

  /**
   * Get current controller status.
   */
  public getStatus(): object {
    return {
      activeImsi: this.activeIdentity?.imsi.slice(0, 6) + "***",
      poolSize: this.identityPool.length,
      meshNodes: this.meshNodes.length,
      totalRotations: this.rotationCount,
      emergencyRotations: this.emergencyRotations,
      nextRotation: this.rotationTimer ? "scheduled" : "none",
    };
  }

  /**
   * Stop the controller gracefully.
   */
  public stop(): void {
    console.log("[Chameleon] Stopping controller...");
    if (this.rotationTimer) {
      clearTimeout(this.rotationTimer);
    }
    console.log("[Chameleon] Controller stopped.");
  }
}

// Export singleton
export const chameleonController = new ChameleonController();

// Auto-start if run directly
if (require.main === module) {
  chameleonController.start();

  // Handle shutdown
  process.on('SIGINT', () => {
    chameleonController.stop();
    process.exit(0);
  });
  process.on('SIGTERM', () => {
    chameleonController.stop();
    process.exit(0);
  });
}
