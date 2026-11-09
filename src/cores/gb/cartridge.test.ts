import { describe, expect, it } from 'vitest'
import { createCartridge } from './cartridge.ts'
import { GameBoy } from './gameboy.ts'
import { RTC_FOOTER_BYTES, type RtcClock } from './rtc.ts'

const CLOCK_HZ = 4_194_304

/** Synthetic ROM: byte 0 of every bank holds the bank number. */
function makeRom(type: number, romCode: number, ramCode: number): Uint8Array {
  const banks = 2 << romCode
  const rom = new Uint8Array(banks * 0x4000)
  for (let b = 0; b < banks; b++) {
    rom[b * 0x4000] = b & 0xff
    rom[b * 0x4000 + 1] = b >> 8
  }
  rom[0x147] = type
  rom[0x148] = romCode
  rom[0x149] = ramCode
  rom[0x100] = 0x18 // JR -2: spin forever at the entry point
  rom[0x101] = 0xfe
  return rom
}

function fakeClock(start = 1_700_000_000_000): RtcClock & {
  cyclesNow: number
  ms: number
} {
  const clock = {
    cyclesNow: 0,
    ms: start,
    cycles: () => clock.cyclesNow,
    now: () => clock.ms,
  }
  return clock
}

function bankAt(cart: ReturnType<typeof createCartridge>): number {
  return cart.readRom(0x4000) | (cart.readRom(0x4001) << 8)
}

function readRtc(cart: ReturnType<typeof createCartridge>): number[] {
  cart.writeRom(0x6000, 0)
  cart.writeRom(0x6000, 1)
  return [0x08, 0x09, 0x0a, 0x0b, 0x0c].map((reg) => {
    cart.writeRom(0x4000, reg)
    return cart.readRam(0xa000)
  })
}

function writeRtc(
  cart: ReturnType<typeof createCartridge>,
  reg: number,
  value: number,
): void {
  cart.writeRom(0x4000, reg)
  cart.writeRam(0xa000, value)
}

describe('MBC5', () => {
  it('selects 9-bit ROM banks, including bank 0', () => {
    const cart = createCartridge(makeRom(0x19, 8, 0)) // 8 MiB, 512 banks
    cart.writeRom(0x2000, 0x34)
    cart.writeRom(0x3000, 1)
    expect(bankAt(cart)).toBe(0x134)
    cart.writeRom(0x3000, 0)
    cart.writeRom(0x2000, 0)
    expect(bankAt(cart)).toBe(0)
  })

  it('banks RAM and gates it behind the enable register', () => {
    const cart = createCartridge(makeRom(0x1b, 1, 3)) // 32 KiB RAM
    cart.writeRam(0xa000, 0x11)
    expect(cart.readRam(0xa000)).toBe(0xff)
    cart.writeRom(0x0000, 0x0a)
    cart.writeRom(0x4000, 2)
    cart.writeRam(0xa000, 0x22)
    cart.writeRom(0x4000, 0)
    expect(cart.readRam(0xa000)).toBe(0)
    cart.writeRom(0x4000, 2)
    expect(cart.readRam(0xa000)).toBe(0x22)
    expect(cart.consumeDirty()).toBe(true)
    expect(cart.consumeDirty()).toBe(false)
  })
})

describe('MBC3', () => {
  it('maps bank 0 to 1 and uses 7-bit banks', () => {
    const cart = createCartridge(makeRom(0x11, 6, 0)) // 2 MiB, 128 banks
    cart.writeRom(0x2000, 0)
    expect(bankAt(cart)).toBe(1)
    cart.writeRom(0x2000, 0x7f)
    expect(bankAt(cart)).toBe(0x7f)
  })

  it('saves RAM without a footer when there is no RTC', () => {
    const cart = createCartridge(makeRom(0x13, 1, 3))
    expect(cart.saveData()?.length).toBe(0x8000)
  })
})

describe('MBC3 RTC', () => {
  function rtcCart(clock = fakeClock()) {
    const cart = createCartridge(makeRom(0x10, 1, 3), { clock })
    cart.writeRom(0x0000, 0x0a)
    return { cart, clock }
  }

  it('counts emulated seconds and only exposes latched values', () => {
    const { cart, clock } = rtcCart()
    clock.cyclesNow = CLOCK_HZ * (2 * 86_400 + 3 * 3_600 + 4 * 60 + 5)
    cart.writeRom(0x4000, 0x08)
    expect(cart.readRam(0xa000)).toBe(0) // not latched yet
    expect(readRtc(cart)).toEqual([5, 4, 3, 2, 0x3e])
  })

  it('stops while halted and resets the sub-second counter on S writes', () => {
    const { cart, clock } = rtcCart()
    writeRtc(cart, 0x0c, 0x40)
    clock.cyclesNow = CLOCK_HZ * 100
    expect(readRtc(cart)[0]).toBe(0)
    writeRtc(cart, 0x0c, 0x00)
    clock.cyclesNow += CLOCK_HZ / 2
    writeRtc(cart, 0x08, 10)
    clock.cyclesNow += CLOCK_HZ * 0.75
    expect(readRtc(cart)[0]).toBe(10)
    clock.cyclesNow += CLOCK_HZ * 0.25
    expect(readRtc(cart)[0]).toBe(11)
  })

  it('sets the day carry when the 9-bit day counter overflows', () => {
    const { cart, clock } = rtcCart()
    writeRtc(cart, 0x0b, 0xff)
    writeRtc(cart, 0x0c, 0x01) // day 511
    writeRtc(cart, 0x0a, 23)
    writeRtc(cart, 0x09, 59)
    writeRtc(cart, 0x08, 59)
    clock.cyclesNow = CLOCK_HZ
    expect(readRtc(cart)).toEqual([0, 0, 0, 0, 0x80 | 0x3e])
  })

  it('wraps out-of-range seconds at 64 without carrying', () => {
    const { cart, clock } = rtcCart()
    writeRtc(cart, 0x08, 62)
    clock.cyclesNow = CLOCK_HZ * 3
    expect(readRtc(cart).slice(0, 2)).toEqual([1, 0])
  })

  it('writes a BGB-compatible footer and catches up on load', () => {
    const { cart, clock } = rtcCart()
    writeRtc(cart, 0x09, 30)
    cart.writeRom(0x4000, 0)
    cart.writeRam(0xa123, 0x5a)
    const save = cart.saveData()!
    expect(save.length).toBe(0x8000 + RTC_FOOTER_BYTES)
    const view = new DataView(save.buffer)
    expect(view.getUint32(0x8000 + 4, true)).toBe(30) // live minutes
    expect(view.getUint32(0x8000 + 40, true)).toBe(1_700_000_000)

    // Reopen 1 day, 1 hour and 15 minutes later.
    const later = fakeClock(clock.ms + (86_400 + 3_600 + 15 * 60) * 1000)
    const { cart: reopened } = rtcCart(later)
    reopened.loadSaveData(save)
    expect(readRtc(reopened)).toEqual([0, 45, 1, 1, 0x3e])
    reopened.writeRom(0x4000, 0)
    expect(reopened.readRam(0xa123)).toBe(0x5a)
  })

  it('accepts the older 44-byte footer', () => {
    const { cart } = rtcCart()
    const save = cart.saveData()!.slice(0, 0x8000 + 44)
    expect(() => rtcCart().cart.loadSaveData(save)).not.toThrow()
  })
})

describe('MBC2', () => {
  it('stores 4-bit RAM, mirrored, with the upper nibble reading 1s', () => {
    const cart = createCartridge(makeRom(0x06, 2, 0))
    cart.writeRom(0x0000, 0x0a)
    cart.writeRam(0xa005, 0xab)
    expect(cart.readRam(0xa205)).toBe(0xfb)
    expect(cart.saveData()?.length).toBe(0x200)
  })
})

describe('Unsupported carts', () => {
  it('names the mapper in the error', () => {
    expect(() => createCartridge(makeRom(0xfc, 1, 0))).toThrow(
      'Unsupported cartridge type 0xfc (Pocket Camera)',
    )
  })
})

describe('GameBoy saves', () => {
  it('keeps battery RAM across reset and reports changes once', () => {
    const gb = new GameBoy()
    gb.loadRom(makeRom(0x1b, 1, 2))
    const data = new Uint8Array(0x2000).fill(7)
    gb.setSaveRam(data)
    gb.reset()
    expect(gb.getSaveRam()).toEqual(data)
    expect(gb.consumeSaveDirty()).toBe(false)
  })

  it('returns null without a battery', () => {
    const gb = new GameBoy()
    gb.loadRom(makeRom(0x1a, 1, 2))
    expect(gb.getSaveRam()).toBeNull()
  })
})
