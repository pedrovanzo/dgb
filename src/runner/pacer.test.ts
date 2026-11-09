import { describe, expect, it } from 'vitest'
import { FramePacer } from './pacer.ts'

const GB_FPS = 4_194_304 / 70_224

function simulate(pacer: FramePacer, hz: number, seconds: number): number {
  let frames = 0
  const step = 1000 / hz
  for (let t = 0; t <= seconds * 1000; t += step) frames += pacer.due(t)
  return frames
}

describe('FramePacer', () => {
  it('runs one frame immediately on start', () => {
    expect(new FramePacer(GB_FPS).due(1234)).toBe(1)
  })

  it.each([60, 75, 120, 144])('holds ~59.73 fps on a %i Hz display', (hz) => {
    const frames = simulate(new FramePacer(GB_FPS), hz, 10)
    expect(frames).toBeGreaterThanOrEqual(596)
    expect(frames).toBeLessThanOrEqual(599)
  })

  it('caps catch-up after a long stall and drops the backlog', () => {
    const pacer = new FramePacer(GB_FPS, 4)
    pacer.due(0)
    expect(pacer.due(5000)).toBe(4)
    expect(pacer.due(5001)).toBe(0)
  })

  it('restarts the clock after reset', () => {
    const pacer = new FramePacer(GB_FPS)
    pacer.due(0)
    pacer.reset()
    expect(pacer.due(10_000)).toBe(1)
    expect(pacer.due(10_010)).toBe(0)
  })

  it('ignores time going backwards', () => {
    const pacer = new FramePacer(GB_FPS)
    pacer.due(100)
    expect(pacer.due(50)).toBe(0)
  })
})
