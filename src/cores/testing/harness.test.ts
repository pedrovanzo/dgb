import { describe, expect, it } from 'vitest'
import {
  hasSerialDebug,
  type BreakpointDebug,
  type AudioChunk,
  type Core,
  type Screen,
  type SerialDebug,
} from '../types.ts'
import {
  blarggDetector,
  compareScreens,
  mooneyeDetector,
  runUntilBreakpointVerdict,
  runUntilSerialVerdict,
} from './harness.ts'

/** Minimal core that emits scripted serial bytes at given frames. */
class FakeCore implements Core, SerialDebug {
  readonly system = 'dmg'
  readonly stateVersion = 1
  readonly frameRate = 60
  private frame = 0
  private pending: number[] = []
  private readonly script: Record<number, number[]>

  constructor(script: Record<number, number[]>) {
    this.script = script
  }

  loadRom(): void {}
  reset(): void {
    this.frame = 0
  }
  runFrame(): void {
    this.frame++
    this.pending.push(...(this.script[this.frame] ?? []))
  }
  getFramebuffers(): readonly Screen[] {
    return [screen(2, 2, [0, 0, 0])]
  }
  drainAudio(): AudioChunk {
    return { sampleRate: 48_000, samples: new Float32Array() }
  }
  setInput(): void {}
  getSaveRam(): Uint8Array | null {
    return null
  }
  setSaveRam(): void {}
  consumeSaveDirty(): boolean {
    return false
  }
  serialize(): Uint8Array {
    return new Uint8Array()
  }
  deserialize(): void {}
  drainSerial(): Uint8Array {
    const out = Uint8Array.from(this.pending)
    this.pending = []
    return out
  }
}

const ascii = (s: string) => Array.from(s, (c) => c.charCodeAt(0))

function screen(w: number, h: number, rgb: number[]): Screen {
  const pixels = new Uint8ClampedArray(w * h * 4)
  for (let i = 0; i < pixels.length; i += 4) pixels.set([...rgb, 255], i)
  return { width: w, height: h, pixels }
}

describe('runUntilSerialVerdict', () => {
  it('detects a Blargg pass split across frames', () => {
    const core = new FakeCore({
      3: ascii('01-special\n\nPas'),
      5: ascii('sed\n'),
    })
    const r = runUntilSerialVerdict(core, blarggDetector, 100)
    expect(r.verdict).toBe('pass')
    expect(r.frames).toBe(5)
    expect(r.text).toContain('01-special')
  })

  it('detects a Blargg failure', () => {
    const core = new FakeCore({ 2: ascii('Failed #3\n') })
    expect(runUntilSerialVerdict(core, blarggDetector, 100).verdict).toBe(
      'fail',
    )
  })

  it('reports a timeout as running', () => {
    const core = new FakeCore({})
    const r = runUntilSerialVerdict(core, blarggDetector, 50)
    expect(r.verdict).toBe('running')
    expect(r.frames).toBe(50)
  })

  it('detects Mooneye pass and fail sequences', () => {
    const pass = new FakeCore({ 1: [3, 5, 8], 2: [13, 21, 34] })
    expect(runUntilSerialVerdict(pass, mooneyeDetector, 10).verdict).toBe(
      'pass',
    )
    const fail = new FakeCore({ 1: Array(6).fill(0x42) })
    expect(runUntilSerialVerdict(fail, mooneyeDetector, 10).verdict).toBe(
      'fail',
    )
  })

  it('recognises cores exposing serial debug', () => {
    expect(hasSerialDebug(new FakeCore({}))).toBe(true)
  })
})

describe('compareScreens', () => {
  it('counts RGB mismatches and reports the first, ignoring alpha', () => {
    const expected = screen(2, 2, [255, 255, 255])
    const actual = screen(2, 2, [255, 255, 255])
    actual.pixels.set([0, 0, 0, 0], 4) // pixel (1,0)
    actual.pixels[3] = 0 // alpha only, not a mismatch
    const diff = compareScreens(actual, expected)
    expect(diff.mismatches).toBe(1)
    expect(diff.first).toEqual({
      x: 1,
      y: 0,
      actual: [0, 0, 0],
      expected: [255, 255, 255],
    })
  })

  it('throws on size mismatch', () => {
    expect(() =>
      compareScreens(screen(1, 1, [0, 0, 0]), screen(2, 1, [0, 0, 0])),
    ).toThrow(/size mismatch/)
  })
})

describe('runUntilBreakpointVerdict', () => {
  const core = (snapshots: Record<number, number[][]>) => {
    let frame = 0
    let pending: Uint8Array[] = []
    return {
      runFrame() {
        frame++
        pending.push(...(snapshots[frame] ?? []).map((r) => Uint8Array.from(r)))
      },
      drainBreakpoints() {
        const out = pending
        pending = []
        return out
      },
    } as unknown as Core & BreakpointDebug
  }

  it('ignores inconclusive breakpoints and stops on a verdict', () => {
    const r = runUntilBreakpointVerdict(
      core({ 2: [[0, 0, 0, 0, 0, 0]], 4: [[3, 5, 8, 13, 21, 34]] }),
      mooneyeDetector,
      10,
    )
    expect(r.verdict).toBe('pass')
    expect(r.frames).toBe(4)
  })

  it('reports a timeout as running', () => {
    const r = runUntilBreakpointVerdict(core({}), mooneyeDetector, 5)
    expect(r).toEqual({ verdict: 'running', frames: 5, registers: null })
  })
})
