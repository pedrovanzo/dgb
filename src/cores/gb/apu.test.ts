import { describe, expect, it } from 'vitest'
import { Apu, SAMPLE_RATE } from './apu.ts'

const CLOCK_HZ = 4_194_304

/** Runs `seconds` of M-cycles with a free-running DIV counter. */
function run(apu: Apu, seconds: number): Float32Array {
  let counter = 0
  const ticks = Math.round((CLOCK_HZ * seconds) / 4)
  for (let i = 0; i < ticks; i++) {
    const before = counter
    counter = (counter + 4) & 0xffff
    apu.tick(before, counter)
  }
  return apu.drain()
}

function left(samples: Float32Array): number[] {
  return Array.from(samples.filter((_, i) => i % 2 === 0))
}

describe('Apu output', () => {
  it('produces SAMPLE_RATE stereo frames per emulated second', () => {
    const samples = run(new Apu(), 1)
    expect(Math.abs(samples.length / 2 - SAMPLE_RATE)).toBeLessThanOrEqual(1)
  })

  it('plays a 440 Hz square wave on channel 2', () => {
    const apu = new Apu()
    apu.write(0xff24, 0x77)
    apu.write(0xff25, 0x22) // channel 2 to both sides
    apu.write(0xff16, 0x80) // 50% duty
    apu.write(0xff17, 0xf0) // volume 15, no envelope
    const x = 2048 - Math.round(131_072 / 440)
    apu.write(0xff18, x & 0xff)
    apu.write(0xff19, 0x80 | (x >> 8))
    run(apu, 0.1) // let the high-pass filter settle
    const l = left(run(apu, 1))
    let crossings = 0
    for (let i = 1; i < l.length; i++)
      if (l[i - 1] < 0 && l[i] >= 0) crossings++
    expect(crossings).toBeGreaterThanOrEqual(438)
    expect(crossings).toBeLessThanOrEqual(442)
    expect(Math.max(...l)).toBeGreaterThan(0.05)
    expect(Math.max(...l.map(Math.abs))).toBeLessThanOrEqual(1)
  })

  it('is silent after power-off', () => {
    const apu = new Apu()
    apu.write(0xff26, 0x00)
    run(apu, 0.2)
    const l = left(run(apu, 0.1))
    expect(Math.max(...l.map(Math.abs))).toBeLessThan(1e-3)
  })
})
