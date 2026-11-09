import { describe, expect, it } from 'vitest'
import { AudioRing, MAX_RATE_ADJUST } from './audio-ring.ts'

function ramp(frames: number, start = 0): Float32Array {
  const s = new Float32Array(frames * 2)
  for (let i = 0; i < frames; i++) {
    s[i * 2] = (start + i) / 1000
    s[i * 2 + 1] = -(start + i) / 1000
  }
  return s
}

function pull(ring: AudioRing, n: number): [Float32Array, Float32Array] {
  const l = new Float32Array(n)
  const r = new Float32Array(n)
  ring.pull(l, r)
  return [l, r]
}

describe('AudioRing', () => {
  it('stays silent until the prebuffer target is reached', () => {
    const ring = new AudioRing(1000, 100)
    ring.push(ramp(50, 1))
    expect(pull(ring, 10)[0].every((v) => v === 0)).toBe(true)
    ring.push(ramp(50, 51))
    const [l, r] = pull(ring, 3)
    expect(l[0]).toBeGreaterThan(0)
    expect(r[0]).toBeLessThan(0)
  })

  it('reads faster when over target and slower when under', () => {
    const over = new AudioRing(10_000, 1000)
    over.push(ramp(2000))
    pull(over, 1000)
    expect(over.fill).toBeLessThan(1000)
    expect(over.fill).toBeGreaterThanOrEqual(
      1000 - Math.ceil(1000 * MAX_RATE_ADJUST) - 1,
    )

    const under = new AudioRing(10_000, 1000)
    under.push(ramp(1000))
    pull(under, 1) // prime
    under.push(ramp(0))
    const before = under.fill
    pull(under, 500)
    expect(before - under.fill).toBeLessThan(500)
  })

  it('converts sample rates with the base ratio', () => {
    const ring = new AudioRing(10_000, 1000, 48_000 / 44_100)
    ring.push(ramp(1000))
    pull(ring, 441)
    expect(1000 - ring.fill).toBeGreaterThanOrEqual(478)
    expect(1000 - ring.fill).toBeLessThanOrEqual(482)
  })

  it('goes silent on underrun and drops the oldest frames on overflow', () => {
    const ring = new AudioRing(100, 10)
    ring.push(ramp(150))
    expect(ring.fill).toBe(100)
    const [l] = pull(ring, 1)
    expect(l[0]).toBeCloseTo(0.05)
    const [rest] = pull(ring, 200)
    expect(rest[199]).toBe(0)
  })

  it('clear empties the buffer', () => {
    const ring = new AudioRing(100, 10)
    ring.push(ramp(50))
    ring.clear()
    expect(ring.fill).toBe(0)
    expect(pull(ring, 5)[0].every((v) => v === 0)).toBe(true)
  })
})
