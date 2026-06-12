/**
 * Cavern Spatial Audio Bridge
 * Maps velocity to MPEG-H profile parameters.
 * Connects to GSAP global ticker for frame-level updates.
 */
import EventEmitter from 'events';

export interface MPEGHProfile {
  dynamicRange: number;     // 0-1 (0 = narrow, 1 = full)
  spatialWidth: number;     // 0-1 (0 = mono, 1 = wide)
  bassCompensation: number; // -1 to +1
  elevation: number;        // -1 to +1 (below/above listener)
}

export interface RoomCorrection {
  filterBank: number[];     // 16-band EQ gains (dB)
  reverbTime_ms: number;
  enabled: boolean;
}

export class CavernBridge extends EventEmitter {
  private currentProfile: MPEGHProfile = {
    dynamicRange: 0.5,
    spatialWidth: 0.5,
    bassCompensation: 0,
    elevation: 0,
  };
  private roomCorrection: RoomCorrection = {
    filterBank: Array(16).fill(0),
    reverbTime_ms: 300,
    enabled: false,
  };
  private velocity = 0;
  private gsapTicker: ((cb: (time: number) => void) => void) | null = null;

  /**
   * Connect to the GSAP global ticker.
   * @param onTick Registers a callback for every animation frame.
   */
  connectToTicker(onTick: (cb: (time: number) => void) => void): void {
    this.gsapTicker = onTick;
    onTick((time) => this.updateFromVelocity(time));
  }

  /**
   * Set velocity input (from motion sensors or GSAP velocity calculation).
   */
  setVelocity(v: number): void {
    this.velocity = Math.min(2, Math.max(0, v));
    this.updateMPEGHProfile();
  }

  private updateFromVelocity(_time: number): void {
    // In real integration, read velocity from GSAP ticker derivative.
    // External setVelocity drives profile updates for now.
  }

  private updateMPEGHProfile(): void {
    const t = this.velocity / 2;
    this.currentProfile = {
      dynamicRange: 0.2 + t * 0.8,
      spatialWidth: 0.3 + t * 0.6,
      bassCompensation: -0.5 + t * 1.0,
      elevation: Math.sin(Date.now() * 0.001 * this.velocity) * 0.3 * t,
    };
    this.emit('profileUpdate', this.currentProfile);
  }

  /**
   * Apply room correction measured from a calibration signal.
   */
  setRoomCorrection(correction: Partial<RoomCorrection>): void {
    this.roomCorrection = { ...this.roomCorrection, ...correction };
    this.emit('roomCorrectionUpdate', this.roomCorrection);
  }

  getCurrentProfile(): MPEGHProfile {
    return { ...this.currentProfile };
  }

  getRoomCorrection(): RoomCorrection {
    return { ...this.roomCorrection };
  }
}
