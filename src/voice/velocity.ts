export type VelocityPoint = {
  value: number
  timestamp: number
}

export type VelocityResult = {
  velocity: number
  deltaValue: number
  deltaTime: number
  previous: VelocityPoint | null
  current: VelocityPoint
}

function nowMs() {
  return typeof performance !== "undefined" ? performance.now() : Date.now()
}

// Immutable two-point tracker: each update overwrites prior state,
// so velocity always reflects only the latest deterministic delta.
export class TwoPointVelocityTracker {
  private previous: VelocityPoint | null = null
  private current: VelocityPoint | null = null

  update(value: number, timestamp = nowMs()): VelocityResult {
    this.previous = this.current
    this.current = { value, timestamp }

    if (!this.previous) {
      return {
        velocity: 0,
        deltaValue: 0,
        deltaTime: 0,
        previous: null,
        current: this.current,
      }
    }

    const deltaValue = this.current.value - this.previous.value
    const deltaTime = this.current.timestamp - this.previous.timestamp
    const velocity = deltaTime > 0 ? deltaValue / deltaTime : 0

    return {
      velocity,
      deltaValue,
      deltaTime,
      previous: this.previous,
      current: this.current,
    }
  }

  reset() {
    this.previous = null
    this.current = null
  }

  snapshot() {
    return {
      previous: this.previous,
      current: this.current,
    }
  }
}
