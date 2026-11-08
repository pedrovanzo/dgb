/**
 * Cartridge header parsing and memory bank controllers.
 * Phase 2 supports ROM-only and MBC1; Phase 5 adds MBC3/MBC5 and RTC.
 */

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
}

export function createCartridge(rom: Uint8Array): Cartridge {
  const header = parseHeader(rom)
  switch (header.type) {
    case 0x00:
    case 0x08:
    case 0x09:
      return new RomOnly(rom, header)
    case 0x01:
    case 0x02:
    case 0x03:
      return new Mbc1(rom, header)
    default:
      throw new Error(
        `Unsupported cartridge type 0x${header.type.toString(16).padStart(2, '0')}`,
      )
  }
}

/** Pads the ROM to a power-of-two bank count so bank masks never overrun. */
function bankCount(rom: Uint8Array): number {
  let banks = 2
  while (banks * 0x4000 < rom.length) banks *= 2
  return banks
}

class RomOnly implements Cartridge {
  readonly ram: Uint8Array
  private readonly rom: Uint8Array
  readonly header: CartridgeHeader

  constructor(rom: Uint8Array, header: CartridgeHeader) {
    this.rom = rom
    this.header = header
    this.ram = new Uint8Array(
      header.type === 0x00 ? 0 : Math.max(header.ramSize, 0x2000),
    )
  }

  readRom(addr: number): number {
    return this.rom[addr] ?? 0xff
  }
  writeRom(): void {}
  readRam(addr: number): number {
    return this.ram.length ? this.ram[(addr - 0xa000) % this.ram.length] : 0xff
  }
  writeRam(addr: number, value: number): void {
    if (this.ram.length) this.ram[(addr - 0xa000) % this.ram.length] = value
  }
}

class Mbc1 implements Cartridge {
  readonly ram: Uint8Array
  readonly header: CartridgeHeader
  private readonly rom: Uint8Array
  private readonly romMask: number
  private ramEnabled = false
  private bankLow = 1
  private bankHigh = 0
  private mode = 0

  constructor(rom: Uint8Array, header: CartridgeHeader) {
    this.rom = rom
    this.header = header
    this.romMask = bankCount(rom) - 1
    this.ram = new Uint8Array(header.ramSize)
  }

  readRom(addr: number): number {
    const bank =
      addr < 0x4000
        ? this.mode === 1
          ? this.bankHigh << 5
          : 0
        : (this.bankHigh << 5) | this.bankLow
    return this.rom[((bank & this.romMask) << 14) | (addr & 0x3fff)] ?? 0xff
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
    this.ram[this.ramOffset(addr)] = value
  }
}
