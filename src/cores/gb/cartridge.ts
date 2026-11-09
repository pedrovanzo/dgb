/**
 * Cartridge header parsing and memory bank controllers: ROM-only, MBC1
 * (including MBC1M multicarts), MBC2, MBC3 (+ RTC) and MBC5.
 */
import { RTC_FOOTER_BYTES, Rtc, type RtcClock } from './rtc.ts'

export interface CartridgeHeader {
  title: string
  type: number
  romBanks: number
  ramSize: number
  battery: boolean
  cgbFlag: number
}

const RAM_SIZES = [0, 0x800, 0x2000, 0x8000, 0x20000, 0x10000]
const BATTERY_TYPES = new Set([
  0x03, 0x06, 0x09, 0x0d, 0x0f, 0x10, 0x13, 0x1b, 0x1e, 0x22, 0xff,
])
const CART_NAMES: Record<number, string> = {
  0x0b: 'MMM01',
  0x0c: 'MMM01',
  0x0d: 'MMM01',
  0x20: 'MBC6',
  0x22: 'MBC7',
  0xfc: 'Pocket Camera',
  0xfd: 'TAMA5',
  0xfe: 'HuC3',
  0xff: 'HuC1',
}

export function parseHeader(rom: Uint8Array): CartridgeHeader {
  if (rom.length < 0x150)
    throw new Error('ROM too small for a cartridge header')
  let title = ''
  for (let i = 0x134; i < 0x144 && rom[i] !== 0; i++)
    title += String.fromCharCode(rom[i])
  return {
    title,
    type: rom[0x147],
    romBanks: 2 << rom[0x148],
    ramSize: RAM_SIZES[rom[0x149]] ?? 0,
    battery: BATTERY_TYPES.has(rom[0x147]),
    cgbFlag: rom[0x143],
  }
}

export interface Cartridge {
  readonly header: CartridgeHeader
  /** External RAM (empty if none). */
  readonly ram: Uint8Array
  readRom(addr: number): number
  writeRom(addr: number, value: number): void
  readRam(addr: number): number
  writeRam(addr: number, value: number): void
  /**
   * Battery-backed data in `.sav` format (RAM, plus the RTC footer on MBC3
   * timer carts), or `null` without a battery.
   */
  saveData(): Uint8Array | null
  /** Restores data produced by `saveData` (or another emulator's `.sav`). */
  loadSaveData(data: Uint8Array): void
  /** True once after battery-backed state changed; clears on read. */
  consumeDirty(): boolean
}

export interface CartridgeOptions {
  /** Time source for the MBC3 RTC. */
  clock?: RtcClock
}

const SYSTEM_CLOCK: RtcClock = { cycles: () => 0, now: () => Date.now() }

export function createCartridge(
  rom: Uint8Array,
  options: CartridgeOptions = {},
): Cartridge {
  const header = parseHeader(rom)
  switch (header.type) {
    case 0x00:
    case 0x08:
    case 0x09:
      return new RomOnly(rom, header)
    case 0x01:
    case 0x02:
    case 0x03:
      return new Mbc1(rom, header, isMbc1Multicart(rom))
    case 0x05:
    case 0x06:
      return new Mbc2(rom, header)
    case 0x0f:
    case 0x10:
    case 0x11:
    case 0x12:
    case 0x13:
      return new Mbc3(rom, header, options.clock ?? SYSTEM_CLOCK)
    case 0x19:
    case 0x1a:
    case 0x1b:
    case 0x1c:
    case 0x1d:
    case 0x1e:
      return new Mbc5(rom, header)
    default: {
      const hex = header.type.toString(16).padStart(2, '0')
      const name = CART_NAMES[header.type]
      throw new Error(
        `Unsupported cartridge type 0x${hex}${name ? ` (${name})` : ''}`,
      )
    }
  }
}

/** Pads the ROM to a power-of-two bank count so bank masks never overrun. */
function bankCount(rom: Uint8Array): number {
  let banks = 2
  while (banks * 0x4000 < rom.length) banks *= 2
  return banks
}

/**
 * MBC1M multicarts are 1 MiB MBC1 boards wired with 4-bit low banks. They are
 * detected by a second Nintendo logo at the start of game 1 (bank 0x10).
 */
function isMbc1Multicart(rom: Uint8Array): boolean {
  if (rom.length !== 0x100000) return false
  for (let i = 0x104; i < 0x134; i++)
    if (rom[0x40000 + i] !== rom[i]) return false
  return true
}

/** Shared battery and dirty tracking. */
abstract class BaseCartridge implements Cartridge {
  readonly header: CartridgeHeader
  readonly ram: Uint8Array
  protected readonly rom: Uint8Array
  protected readonly romMask: number
  protected dirty = false

  constructor(rom: Uint8Array, header: CartridgeHeader, ramBytes: number) {
    this.rom = rom
    this.header = header
    this.romMask = bankCount(rom) - 1
    this.ram = new Uint8Array(ramBytes)
  }

  abstract readRom(addr: number): number
  abstract writeRom(addr: number, value: number): void
  abstract readRam(addr: number): number
  abstract writeRam(addr: number, value: number): void

  protected romAt(bank: number, addr: number): number {
    return this.rom[((bank & this.romMask) << 14) | (addr & 0x3fff)] ?? 0xff
  }

  protected setRam(offset: number, value: number): void {
    if (this.ram[offset] === value) return
    this.ram[offset] = value
    if (this.header.battery) this.dirty = true
  }

  saveData(): Uint8Array | null {
    return this.header.battery && this.ram.length ? this.ram.slice() : null
  }

  loadSaveData(data: Uint8Array): void {
    this.ram.set(data.subarray(0, this.ram.length))
  }

  consumeDirty(): boolean {
    const d = this.dirty
    this.dirty = false
    return d
  }
}

class RomOnly extends BaseCartridge {
  constructor(rom: Uint8Array, header: CartridgeHeader) {
    super(rom, header, header.type === 0x00 ? 0 : header.ramSize)
  }

  readRom(addr: number): number {
    return this.rom[addr] ?? 0xff
  }
  writeRom(): void {}
  readRam(addr: number): number {
    return this.ram.length ? this.ram[(addr - 0xa000) % this.ram.length] : 0xff
  }
  writeRam(addr: number, value: number): void {
    if (this.ram.length) this.setRam((addr - 0xa000) % this.ram.length, value)
  }
}

class Mbc1 extends BaseCartridge {
  private ramEnabled = false
  private bankLow = 1
  private bankHigh = 0
  private mode = 0
  /** Bits of the low bank register that reach the ROM address (4 on MBC1M). */
  private readonly lowBits: number

  constructor(rom: Uint8Array, header: CartridgeHeader, multicart: boolean) {
    super(rom, header, header.ramSize)
    this.lowBits = multicart ? 4 : 5
  }

  private highBank(): number {
    return this.bankHigh << this.lowBits
  }

  readRom(addr: number): number {
    if (addr < 0x4000)
      return this.romAt(this.mode === 1 ? this.highBank() : 0, addr)
    const low = this.bankLow & ((1 << this.lowBits) - 1)
    return this.romAt(this.highBank() | low, addr)
  }

  writeRom(addr: number, value: number): void {
    if (addr < 0x2000) this.ramEnabled = (value & 0x0f) === 0x0a
    else if (addr < 0x4000) this.bankLow = value & 0x1f || 1
    else if (addr < 0x6000) this.bankHigh = value & 0x03
    else this.mode = value & 0x01
  }

  private ramOffset(addr: number): number {
    const bank = this.mode === 1 ? this.bankHigh : 0
    return ((bank << 13) | (addr & 0x1fff)) % this.ram.length
  }

  readRam(addr: number): number {
    if (!this.ramEnabled || this.ram.length === 0) return 0xff
    return this.ram[this.ramOffset(addr)]
  }

  writeRam(addr: number, value: number): void {
    if (!this.ramEnabled || this.ram.length === 0) return
    this.setRam(this.ramOffset(addr), value)
  }
}

/** MBC2: 16 ROM banks and 512 x 4-bit built-in RAM. */
class Mbc2 extends BaseCartridge {
  private ramEnabled = false
  private bank = 1

  constructor(rom: Uint8Array, header: CartridgeHeader) {
    super(rom, header, 0x200)
  }

  readRom(addr: number): number {
    return this.romAt(addr < 0x4000 ? 0 : this.bank, addr)
  }

  writeRom(addr: number, value: number): void {
    if (addr >= 0x4000) return
    // Address bit 8 selects the register.
    if (addr & 0x100) this.bank = value & 0x0f || 1
    else this.ramEnabled = (value & 0x0f) === 0x0a
  }

  readRam(addr: number): number {
    if (!this.ramEnabled) return 0xff
    return 0xf0 | this.ram[addr & 0x1ff]
  }

  writeRam(addr: number, value: number): void {
    if (this.ramEnabled) this.setRam(addr & 0x1ff, value & 0x0f)
  }
}

/** MBC3 (and MBC30): 7/8-bit ROM bank, 4/8 RAM banks, optional RTC. */
class Mbc3 extends BaseCartridge {
  private ramEnabled = false
  private romBank = 1
  /** 0x00-0x07 RAM bank, 0x08-0x0C RTC register. */
  private select = 0
  private latchArmed = false
  private readonly rtc: Rtc | null

  constructor(rom: Uint8Array, header: CartridgeHeader, clock: RtcClock) {
    super(rom, header, header.ramSize)
    this.rtc =
      header.type === 0x0f || header.type === 0x10 ? new Rtc(clock) : null
  }

  readRom(addr: number): number {
    return this.romAt(addr < 0x4000 ? 0 : this.romBank, addr)
  }

  writeRom(addr: number, value: number): void {
    if (addr < 0x2000) this.ramEnabled = (value & 0x0f) === 0x0a
    else if (addr < 0x4000) this.romBank = value || 1
    else if (addr < 0x6000) this.select = value & 0x0f
    else {
      if (this.latchArmed && value === 1) this.rtc?.latch()
      this.latchArmed = value === 0
    }
  }

  readRam(addr: number): number {
    if (!this.ramEnabled) return 0xff
    if (this.select >= 0x08) {
      return this.rtc && this.select <= 0x0c ? this.rtc.read(this.select) : 0xff
    }
    if (this.ram.length === 0) return 0xff
    return this.ram[this.ramOffset(addr)]
  }

  writeRam(addr: number, value: number): void {
    if (!this.ramEnabled) return
    if (this.select >= 0x08) {
      if (this.rtc && this.select <= 0x0c) {
        this.rtc.write(this.select, value)
        this.dirty = true
      }
      return
    }
    if (this.ram.length) this.setRam(this.ramOffset(addr), value)
  }

  private ramOffset(addr: number): number {
    return ((this.select << 13) | (addr & 0x1fff)) % this.ram.length
  }

  override saveData(): Uint8Array | null {
    if (!this.header.battery) return null
    if (!this.rtc) return this.ram.length ? this.ram.slice() : null
    const out = new Uint8Array(this.ram.length + RTC_FOOTER_BYTES)
    out.set(this.ram)
    out.set(this.rtc.toFooter(), this.ram.length)
    return out
  }

  override loadSaveData(data: Uint8Array): void {
    super.loadSaveData(data)
    const footer = data.subarray(this.ram.length)
    if (this.rtc && Rtc.isFooterSize(footer.length)) this.rtc.fromFooter(footer)
  }
}

/** MBC5: 9-bit ROM bank (bank 0 selectable), 16 RAM banks. */
class Mbc5 extends BaseCartridge {
  private ramEnabled = false
  private romBank = 1
  private ramBank = 0
  private readonly rumble: boolean

  constructor(rom: Uint8Array, header: CartridgeHeader) {
    super(rom, header, header.ramSize)
    this.rumble = header.type >= 0x1c
  }

  readRom(addr: number): number {
    return this.romAt(addr < 0x4000 ? 0 : this.romBank, addr)
  }

  writeRom(addr: number, value: number): void {
    if (addr < 0x2000) this.ramEnabled = (value & 0x0f) === 0x0a
    else if (addr < 0x3000) this.romBank = (this.romBank & 0x100) | value
    else if (addr < 0x4000)
      this.romBank = (this.romBank & 0xff) | ((value & 1) << 8)
    // Bit 3 drives the rumble motor on rumble carts.
    else if (addr < 0x6000) this.ramBank = value & (this.rumble ? 0x07 : 0x0f)
  }

  private ramOffset(addr: number): number {
    return ((this.ramBank << 13) | (addr & 0x1fff)) % this.ram.length
  }

  readRam(addr: number): number {
    if (!this.ramEnabled || this.ram.length === 0) return 0xff
    return this.ram[this.ramOffset(addr)]
  }

  writeRam(addr: number, value: number): void {
    if (!this.ramEnabled || this.ram.length === 0) return
    this.setRam(this.ramOffset(addr), value)
  }
}
