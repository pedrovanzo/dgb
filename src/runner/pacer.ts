/**
 * Converts wall-clock time into a number of emulated frames to run, so the
 * core keeps its native rate (~59.73 fps for GB) on any display refresh rate.
 */
export class FramePacer {
  private last: number | null = null
  private debt = 0
  private readonly frameMs: number
  private readonly maxCatchUp: number

  /**
   * @param frameRate Emulated frames per second.
   * @param maxCatchUp Most frames run in one call; beyond that the backlog is
   *   dropped (tab was hidden, debugger paused, slow device).
   */
  constructor(frameRate: number, maxCatchUp = 4) {
    this.frameMs = 1000 / frameRate
    this.maxCatchUp = maxCatchUp
  }

  /** Frames due at `now` (milliseconds). The first call starts the clock and returns 1. */
  due(now: number): number {
    if (this.last === null) {
      this.last = now
      this.debt = 0
      return 1
    }
    this.debt += Math.max(0, now - this.last)
    this.last = now
    const frames = Math.floor(this.debt / this.frameMs)
    if (frames > this.maxCatchUp) {
      this.debt = 0
      return this.maxCatchUp
    }
    this.debt -= frames * this.frameMs
    return frames
  }

  /** Forget elapsed time (after a pause). */
  reset(): void {
    this.last = null
    this.debt = 0
  }
}
