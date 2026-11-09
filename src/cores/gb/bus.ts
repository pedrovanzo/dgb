import { Apu } from './apu.ts'
import type { Cartridge } from './cartridge.ts'
import { Interrupts } from './interrupts.ts'
import { Joypad } from './joypad.ts'
import { Ppu } from './ppu.ts'
import { Serial } from './serial.ts'
import { Timer } from './timer.ts'

/**
 * DMG memory map and I/O dispatch. `tick()` advances every component by one
 * M-cycle; the CPU calls it once per memory access or internal delay.
 */
export class Bus {
  readonly interrupts = new Interrupts()
  readonly timer = new Timer(this.interrupts)
  readonly serial = new Serial(this.interrupts)
  readonly joypad = new Joypad(this.interrupts)
  readonly ppu = new Ppu(this.interrupts)
  readonly wram = new Uint8Array(0x2000)
  readonly hram = new Uint8Array(0x7f)
  readonly apu = new Apu()
  readonly cart: Cartridge
  /** Total T-cycles elapsed since power-on. */
  cycles = 0

  constructor(cart: Cartridge) {
    this.cart = cart
  }

  // --- OAM DMA ---
  /** Next byte index to copy, or -1 when idle. */
  private dmaIndex = -1
  private dmaSource = 0
  /** M-cycles until a requested transfer starts (0 = none pending). */
  private dmaStartDelay = 0
  private dmaPendingSource = 0
  /** Byte currently on the bus the DMA is reading from. */
  private dmaByte = 0xff

  private get dmaActive(): boolean {
    return this.dmaIndex >= 0
  }

  tick(): void {
    this.cycles += 4
    const counter = this.timer.counter
    this.timer.tick()
    this.serial.tick(counter, this.timer.counter)
    this.apu.tick(counter, this.timer.counter)
    this.tickDma()
    this.ppu.tick()
  }

  private tickDma(): void {
    if (this.dmaActive) {
      this.dmaByte = this.dmaRead(this.dmaSource + this.dmaIndex)
      this.ppu.oam[this.dmaIndex] = this.dmaByte
      if (++this.dmaIndex === 0xa0) this.dmaIndex = -1
    }
    if (this.dmaStartDelay > 0 && --this.dmaStartDelay === 0) {
      this.dmaSource = this.dmaPendingSource
      this.dmaIndex = 0
    }
  }

  private startDma(value: number): void {
    this.ppu.dma = value
    this.dmaPendingSource = value << 8
    this.dmaStartDelay = 2
  }

  /** DMA source read: sees memory regardless of PPU mode; 0xE000+ maps to WRAM. */
  private dmaRead(addr: number): number {
    if (addr < 0x8000) return this.cart.readRom(addr)
    if (addr < 0xa000) return this.ppu.vram[addr - 0x8000]
    if (addr < 0xc000) return this.cart.readRam(addr)
    return this.wram[addr & 0x1fff]
  }

  /**
   * During DMA the CPU cannot use the bus the DMA reads from (VRAM bus or
   * external bus); it sees the byte being transferred instead.
   */
  private dmaConflict(addr: number): boolean {
    if (!this.dmaActive || addr >= 0xfe00) return false
    const dmaOnVram = this.dmaSource >= 0x8000 && this.dmaSource < 0xa000
    const cpuOnVram = addr >= 0x8000 && addr < 0xa000
    return dmaOnVram === cpuOnVram
  }

  read(addr: number): number {
    if (this.dmaConflict(addr)) return this.dmaByte
    if (addr < 0x8000) return this.cart.readRom(addr)
    if (addr < 0xa000)
      return this.ppu.vramAccessible() ? this.ppu.vram[addr - 0x8000] : 0xff
    if (addr < 0xc000) return this.cart.readRam(addr)
    if (addr < 0xe000) return this.wram[addr - 0xc000]
    if (addr < 0xfe00) return this.wram[addr - 0xe000]
    if (addr < 0xfea0)
      return this.oamAccessible() ? this.ppu.oam[addr - 0xfe00] : 0xff
    if (addr < 0xff00) return 0x00
    if (addr < 0xff80) return this.readIo(addr)
    if (addr < 0xffff) return this.hram[addr - 0xff80]
    return this.interrupts.enable
  }

  write(addr: number, value: number): void {
    if (this.dmaConflict(addr)) return
    if (addr < 0x8000) this.cart.writeRom(addr, value)
    else if (addr < 0xa000) {
      if (this.ppu.vramAccessible()) this.ppu.vram[addr - 0x8000] = value
    } else if (addr < 0xc000) this.cart.writeRam(addr, value)
    else if (addr < 0xe000) this.wram[addr - 0xc000] = value
    else if (addr < 0xfe00) this.wram[addr - 0xe000] = value
    else if (addr < 0xfea0) {
      if (this.oamAccessible()) this.ppu.oam[addr - 0xfe00] = value
    } else if (addr < 0xff00) return
    else if (addr < 0xff80) this.writeIo(addr, value)
    else if (addr < 0xffff) this.hram[addr - 0xff80] = value
    else this.interrupts.enable = value
  }

  private oamAccessible(): boolean {
    return !this.dmaActive && this.ppu.oamAccessible()
  }

  private readIo(addr: number): number {
    const ppu = this.ppu
    switch (addr) {
      case 0xff00:
        return this.joypad.read()
      case 0xff01:
        return this.serial.sb
      case 0xff02:
        return this.serial.readSc()
      case 0xff04:
        return this.timer.readDiv()
      case 0xff05:
        return this.timer.tima
      case 0xff06:
        return this.timer.tma
      case 0xff07:
        return this.timer.readTac()
      case 0xff0f:
        return this.interrupts.readFlags()
      case 0xff40:
        return ppu.lcdc
      case 0xff41:
        return ppu.readStat()
      case 0xff42:
        return ppu.scy
      case 0xff43:
        return ppu.scx
      case 0xff44:
        return ppu.ly
      case 0xff45:
        return ppu.lyc
      case 0xff46:
        return ppu.dma
      case 0xff47:
        return ppu.bgp
      case 0xff48:
        return ppu.obp0
      case 0xff49:
        return ppu.obp1
      case 0xff4a:
        return ppu.wy
      case 0xff4b:
        return ppu.wx
    }
    if (addr >= 0xff10 && addr < 0xff40) return this.apu.read(addr)
    return 0xff
  }

  private writeIo(addr: number, value: number): void {
    const ppu = this.ppu
    switch (addr) {
      case 0xff00:
        return this.joypad.write(value)
      case 0xff01:
        this.serial.sb = value
        return
      case 0xff02:
        return this.serial.writeSc(value)
      case 0xff04: {
        const before = this.timer.counter
        this.timer.writeDiv()
        return this.apu.divReset(before)
      }
      case 0xff05:
        return this.timer.writeTima(value)
      case 0xff06:
        return this.timer.writeTma(value)
      case 0xff07:
        return this.timer.writeTac(value)
      case 0xff0f:
        return this.interrupts.writeFlags(value)
      case 0xff40:
        return ppu.writeLcdc(value)
      case 0xff41:
        return ppu.writeStat(value)
      case 0xff42:
        ppu.scy = value
        return
      case 0xff43:
        ppu.scx = value
        return
      case 0xff44:
        return // LY is read-only
      case 0xff45:
        return ppu.writeLyc(value)
      case 0xff46:
        return this.startDma(value)
      case 0xff47:
        ppu.bgp = value
        return
      case 0xff48:
        ppu.obp0 = value
        return
      case 0xff49:
        ppu.obp1 = value
        return
      case 0xff4a:
        ppu.wy = value
        return
      case 0xff4b:
        ppu.wx = value
        return
    }
    if (addr >= 0xff10 && addr < 0xff40) this.apu.write(addr, value)
  }
}
