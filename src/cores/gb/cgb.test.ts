import { describe, expect, it } from 'vitest'
import { Bus } from './bus.ts'
import { createCartridge } from './cartridge.ts'
import { Cpu } from './cpu.ts'

function cgbBus(code: number[] = [0x18, 0xfe]): Bus {
  const rom = new Uint8Array(0x8000)
  rom[0x143] = 0xc0
  rom.set(code, 0x100)
  // Recognizable bytes for DMA sources.
  for (let i = 0; i < 0x100; i++) rom[0x4000 + i] = i
  return new Bus(createCartridge(rom), true)
}

describe('CGB banking', () => {
  it('switches WRAM banks at 0xD000 (bank 0 selects 1) and mirrors to echo RAM', () => {
    const bus = cgbBus()
    bus.write(0xff70, 2)
    bus.write(0xd000, 0x22)
    bus.write(0xff70, 0)
    expect(bus.read(0xff70)).toBe(0xf9)
    bus.write(0xd000, 0x11)
    bus.write(0xff70, 2)
    expect(bus.read(0xd000)).toBe(0x22)
    expect(bus.read(0xf000)).toBe(0x22)
    bus.write(0xc000, 0x33)
    bus.write(0xff70, 5)
    expect(bus.read(0xc000)).toBe(0x33)
  })

  it('switches VRAM banks', () => {
    const bus = cgbBus()
    bus.write(0xff40, 0) // LCD off: VRAM always accessible
    bus.write(0xff4f, 1)
    bus.write(0x9800, 0xab)
    bus.write(0xff4f, 0)
    expect(bus.read(0x9800)).toBe(0)
    expect(bus.read(0xff4f)).toBe(0xfe)
    expect(bus.ppu.vram[0x3800]).toBe(0xab)
  })

  it('hides CGB registers on DMG', () => {
    const rom = new Uint8Array(0x8000)
    const bus = new Bus(createCartridge(rom), false)
    for (const addr of [0xff4d, 0xff4f, 0xff55, 0xff68, 0xff69, 0xff70])
      expect(bus.read(addr)).toBe(0xff)
  })
})

describe('CGB palettes', () => {
  it('auto-increments the index and stores RGB555 data', () => {
    const bus = cgbBus()
    bus.write(0xff40, 0)
    bus.write(0xff68, 0x80 | 0x3e)
    bus.write(0xff69, 0x1f)
    bus.write(0xff69, 0x7c)
    bus.write(0xff69, 0x55) // wraps to index 0
    expect(bus.read(0xff68)).toBe(0x80 | 0x40 | 0x01)
    expect(bus.ppu.bgPalette[0x3e]).toBe(0x1f)
    expect(bus.ppu.bgPalette[0x3f]).toBe(0x7c)
    expect(bus.ppu.bgPalette[0]).toBe(0x55)
    bus.write(0xff6a, 0x05)
    bus.write(0xff6b, 0x99)
    expect(bus.read(0xff6a)).toBe(0x45) // no auto-increment
    expect(bus.read(0xff6b)).toBe(0x99)
  })
})

describe('CGB HDMA', () => {
  function setup(bus: Bus, length: number, mode: number): void {
    bus.write(0xff40, 0)
    bus.write(0xff51, 0x40)
    bus.write(0xff52, 0x20)
    bus.write(0xff53, 0x81)
    bus.write(0xff54, 0x00)
    bus.write(0xff55, mode | (length / 16 - 1))
  }

  it('general-purpose DMA copies everything and stalls the CPU', () => {
    const bus = cgbBus()
    setup(bus, 64, 0x00)
    expect(Array.from(bus.ppu.vram.subarray(0x100, 0x140))).toEqual(
      Array.from({ length: 64 }, (_, i) => 0x20 + i),
    )
    expect(bus.read(0xff55)).toBe(0xff)
    expect(bus.stall).toBe(4 * 8)
  })

  it('HBlank DMA copies one block per visible line and can be cancelled', () => {
    const bus = cgbBus()
    setup(bus, 64, 0x80)
    // LCD off counts as HBlank: the first block goes immediately.
    expect(bus.read(0xff55)).toBe(0x02)
    expect(bus.ppu.vram[0x10f]).toBe(0x2f)
    bus.write(0xff40, 0x91) // LCD on
    while (bus.ppu.ly < 1) bus.tick()
    expect(bus.read(0xff55)).toBe(0x01) // second block on line 0
    expect(bus.ppu.vram[0x11f]).toBe(0x3f)
    bus.write(0xff55, 0x00) // cancel
    expect(bus.read(0xff55)).toBe(0x81)
    while (bus.ppu.ly < 5) bus.tick()
    expect(bus.ppu.vram[0x120]).toBe(0)
  })
})

describe('CGB speed switch', () => {
  it('STOP with KEY1 armed toggles double speed and halves PPU time per M-cycle', () => {
    // LD A,1; LDH (4D),A; STOP; JR -2
    const bus = cgbBus([0x3e, 0x01, 0xe0, 0x4d, 0x10, 0x00, 0x18, 0xfe])
    const cpu = new Cpu(bus)
    expect(cpu.a).toBe(0x11)
    expect(bus.read(0xff4d)).toBe(0x7e)
    for (let i = 0; i < 3; i++) cpu.step()
    expect(bus.doubleSpeed).toBe(true)
    expect(bus.read(0xff4d)).toBe(0xfe)
    expect(bus.timer.readDiv()).toBe(0)
    const before = bus.cycles
    for (let i = 0; i < 100; i++) bus.tick()
    expect(bus.cycles - before).toBe(200)
  })

  it('STOP without KEY1 armed keeps normal speed', () => {
    const bus = cgbBus([0x10, 0x00, 0x18, 0xfe])
    const cpu = new Cpu(bus)
    cpu.step()
    expect(bus.doubleSpeed).toBe(false)
    expect(bus.stall).toBe(0)
  })
})
