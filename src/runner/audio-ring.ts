/** Largest playback-rate nudge used to hold the buffer at its target fill. */
export const MAX_RATE_ADJUST = 0.005

/**
 * Stereo ring buffer read by the AudioWorklet. The emulator is paced by the
 * display clock and the audio device by its own clock, so the reader nudges
 * its rate (at most ±0.5%, inaudible) to keep the fill near `target` instead
 * of drifting into underruns or growing latency. Reads interpolate linearly,
 * which also converts between source and output sample rates.
 */
export class AudioRing {
  private readonly buf: Float32Array
  private readonly capacity: number
  private readonly target: number
  /** Source frames consumed per output frame before rate control. */
  private readonly baseRatio: number
  private readPos = 0
  private writePos = 0
  /** Whole frames available from `readPos`. */
  private size = 0
  private frac = 0
  private primed = false

  constructor(capacityFrames: number, targetFrames: number, baseRatio = 1) {
    this.capacity = capacityFrames
    this.target = targetFrames
    this.baseRatio = baseRatio
    this.buf = new Float32Array(capacityFrames * 2)
  }

  get fill(): number {
    return this.size
  }

  /** Appends interleaved stereo samples; drops the oldest on overflow. */
  push(samples: Float32Array): void {
    const buf = this.buf
    for (let i = 0; i + 1 < samples.length; i += 2) {
      if (this.size === this.capacity) {
        this.readPos = (this.readPos + 1) % this.capacity
        this.size--
      }
      buf[this.writePos * 2] = samples[i]
      buf[this.writePos * 2 + 1] = samples[i + 1]
      this.writePos = (this.writePos + 1) % this.capacity
      this.size++
    }
  }

  /** Fills both channels. Outputs silence until `target` frames are buffered. */
  pull(left: Float32Array, right: Float32Array): void {
    const n = left.length
    if (!this.primed) {
      if (this.size < this.target) {
        left.fill(0)
        right.fill(0)
        return
      }
      this.primed = true
    }
    const error = (this.size - this.target) / this.target
    const ratio =
      this.baseRatio * (1 + MAX_RATE_ADJUST * Math.max(-1, Math.min(1, error)))
    const buf = this.buf
    for (let i = 0; i < n; i++) {
      if (this.size < 2) {
        // Underrun: go quiet and wait for a full prebuffer again.
        this.primed = false
        left.fill(0, i)
        right.fill(0, i)
        return
      }
      const a = this.readPos * 2
      const b = ((this.readPos + 1) % this.capacity) * 2
      const f = this.frac
      left[i] = buf[a] + (buf[b] - buf[a]) * f
      right[i] = buf[a + 1] + (buf[b + 1] - buf[a + 1]) * f
      this.frac += ratio
      while (this.frac >= 1) {
        this.frac -= 1
        this.readPos = (this.readPos + 1) % this.capacity
        this.size--
      }
    }
  }

  clear(): void {
    this.readPos = this.writePos
    this.size = 0
    this.frac = 0
    this.primed = false
  }
}
