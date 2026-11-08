/**
 * Headless conformance harness. Pure TypeScript: no Node or DOM APIs, so it
 * could also run in a worker. File access lives in `node.ts`.
 */
import type { BreakpointDebug, Core, Screen, SerialDebug } from '../types.ts'

export type Verdict = 'pass' | 'fail' | 'running'

/** Inspects all serial output so far and decides whether the test is over. */
export type SerialDetector = (output: Uint8Array) => Verdict

const decoder = new TextDecoder('latin1')

/** Blargg ROMs print "Passed" / "Failed" as text. */
export const blarggDetector: SerialDetector = (output) => {
  const text = decoder.decode(output)
  if (text.includes('Failed')) return 'fail'
  if (text.includes('Passed')) return 'pass'
  return 'running'
}

const MOONEYE_PASS = [3, 5, 8, 13, 21, 34]
const MOONEYE_FAIL = [0x42, 0x42, 0x42, 0x42, 0x42, 0x42]

/**
 * Mooneye ROMs leave Fibonacci numbers in B, C, D, E, H, L on pass and 0x42 in
 * all six on fail. Works on serial bytes or a breakpoint register snapshot.
 */
export const mooneyeDetector: SerialDetector = (output) => {
  if (output.length < 6) return 'running'
  const tail = Array.from(output.subarray(output.length - 6))
  if (tail.every((b, i) => b === MOONEYE_PASS[i])) return 'pass'
  if (tail.every((b, i) => b === MOONEYE_FAIL[i])) return 'fail'
  return 'running'
}

export interface SerialRunResult {
  verdict: Verdict
  frames: number
  output: Uint8Array
  /** Serial output as latin1 text, handy for Blargg failure messages. */
  text: string
}

export function runFrames(core: Core, frames: number): void {
  for (let i = 0; i < frames; i++) core.runFrame()
}

/**
 * Runs frame by frame until the detector returns a verdict or `maxFrames`
 * elapse. A timeout is reported as verdict `running`.
 */
export function runUntilSerialVerdict(
  core: Core & SerialDebug,
  detect: SerialDetector,
  maxFrames: number,
): SerialRunResult {
  const chunks: number[] = []
  let verdict: Verdict = 'running'
  let frames = 0
  while (frames < maxFrames) {
    core.runFrame()
    frames++
    const bytes = core.drainSerial()
    if (bytes.length === 0) continue
    chunks.push(...bytes)
    verdict = detect(Uint8Array.from(chunks))
    if (verdict !== 'running') break
  }
  const output = Uint8Array.from(chunks)
  return { verdict, frames, output, text: decoder.decode(output) }
}

export interface BreakpointRunResult {
  verdict: Verdict
  frames: number
  /** Registers at the breakpoint that produced the verdict, if any. */
  registers: Uint8Array | null
}

/**
 * Runs until a software breakpoint yields a verdict or `maxFrames` elapse.
 * Breakpoints the detector reports as `running` are ignored.
 */
export function runUntilBreakpointVerdict(
  core: Core & BreakpointDebug,
  detect: SerialDetector,
  maxFrames: number,
): BreakpointRunResult {
  let frames = 0
  while (frames < maxFrames) {
    core.runFrame()
    frames++
    for (const registers of core.drainBreakpoints()) {
      const verdict = detect(registers)
      if (verdict !== 'running') return { verdict, frames, registers }
    }
  }
  return { verdict: 'running', frames, registers: null }
}

export interface ScreenDiff {
  /** Number of pixels whose RGB differs. Alpha is ignored. */
  mismatches: number
  first?: { x: number; y: number; actual: number[]; expected: number[] }
}

export function compareScreens(actual: Screen, expected: Screen): ScreenDiff {
  if (actual.width !== expected.width || actual.height !== expected.height) {
    throw new Error(
      `Screen size mismatch: actual ${actual.width}x${actual.height}, ` +
        `expected ${expected.width}x${expected.height}`,
    )
  }
  const a = actual.pixels
  const e = expected.pixels
  const diff: ScreenDiff = { mismatches: 0 }
  for (let i = 0; i < a.length; i += 4) {
    if (a[i] === e[i] && a[i + 1] === e[i + 1] && a[i + 2] === e[i + 2]) {
      continue
    }
    if (diff.mismatches === 0) {
      const p = i / 4
      diff.first = {
        x: p % actual.width,
        y: Math.floor(p / actual.width),
        actual: [a[i], a[i + 1], a[i + 2]],
        expected: [e[i], e[i + 1], e[i + 2]],
      }
    }
    diff.mismatches++
  }
  return diff
}
