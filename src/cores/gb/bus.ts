import { Apu } from './apu.ts'
import type { Cartridge } from './cartridge.ts'
import { Interrupts } from './interrupts.ts'
import { Joypad } from './joypad.ts'
import { Ppu } from './ppu.ts'
import { Serial } from './serial.ts'
import { Timer } from './timer.ts'

/** M-cycles the CPU is held while switching CPU speed. */
const SPEED_SWITCH_STALL = 2050
/** M-cycles (at normal speed) the CPU is held per 16-byte HDMA block. */
const HDMA_BLOCK_STALL = 8

/**
 * DMG/CGB memory map and I/O dispatch. `tick()` advances every component by
 * one M-cycle; the CPU calls it once per memory access or internal delay.
 */
export class Bus {
  readonly cgb: boolean
  readonly interrupts = new Interrupts()
  readonly timer = new Timer(this.interrupts)
  readonly serial = new Serial(this.interrupts)
  readonly joypad = new Joypad(this.interrupts)
  readonly ppu: Ppu
  /** 8 x 4 KiB banks on CGB (bank 0 fixed, 1-7 switchable); 2 on DMG. */
  readonly wram: Uint8Array
  readonly hram = new Uint8Array(0x7f)
  readonly apu: Apu
  readonly cart: Cartridge
  /** Total T-cycles elapsed since power-on, at normal-speed rate. */
  cycles = 0
  /** M-cycles the CPU must idle (HDMA, speed switch) while the rest runs. */
  stall = 0

  // --- CGB state ---
  doubleSpeed = false
  private speedArmed = false
  private vramBank = 0
  private wramBank = 1
  private hdmaSource = 0
  private hdmaDest = 0
  /** Blocks left minus one (0x7F when idle, so FF55 reads 0xFF). */
  private hdmaRemaining = 0x7f
  private hdmaHblank = false

  constructor(cart: Cartridge, cgb = false) {
    this.cart = cart
    this.cgb = cgb
    this.ppu = new Ppu(this.interrupts, cgb)
    this.apu = new Apu(cgb)
    this.wram = new Uint8Array(cgb ? 0x8000 : 0x2000)
    if (cgb) this.ppu.onHblank = () => this.hblankDma()
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
    // In double speed, an M-cycle is 2 T-cycles of PPU/APU time.
    const t = this.doubleSpeed ? 2 : 4
    this.cycles += t
    const counter = this.timer.counter
    this.timer.tick()
    this.serial.tick(counter, this.timer.counter)
    this.apu.tick(counter, this.timer.counter, t)
    this.tickDma()
    this.ppu.tick(t)
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
    if (addr < 0xa000) return this.ppu.vram[this.vramOffset(addr)]
    if (addr < 0xc000) return this.cart.readRam(addr)
    return this.wram[this.wramOffset(addr)]
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

  private vramOffset(addr: number): number {
    return (this.vramBank << 13) | (addr & 0x1fff)
  }

  /** 0xC000-0xFDFF (echo included) to a WRAM offset. */
  private wramOffset(addr: number): number {
    const a = addr & 0x1fff
    return a < 0x1000 ? a : (this.wramBank << 12) | (a & 0x0fff)
  }

  // --- CGB HDMA (VRAM DMA) ---

  private copyHdmaBlock(): void {
    for (let i = 0; i < 16; i++) {
      const v = this.dmaRead((this.hdmaSource + i) & 0xffff)
      this.ppu.vram[(this.vramBank << 13) | ((this.hdmaDest + i) & 0x1fff)] = v
    }
    this.hdmaSource = (this.hdmaSource + 16) & 0xffff
    this.hdmaDest = (this.hdmaDest + 16) & 0x1fff
    this.hdmaRemaining = (this.hdmaRemaining - 1) & 0x7f
    this.stall += HDMA_BLOCK_STALL * (this.doubleSpeed ? 2 : 1)
  }

  private hblankDma(): void {
    if (!this.hdmaHblank) return
    this.copyHdmaBlock()
    if (this.hdmaRemaining === 0x7f) this.hdmaHblank = false
  }

  private writeHdma5(value: number): void {
    if (this.hdmaHblank && !(value & 0x80)) {
      // Writing bit 7 = 0 cancels an HBlank transfer.
      this.hdmaHblank = false
      return
    }
    this.hdmaRemaining = value & 0x7f
    if (value & 0x80) {
      this.hdmaHblank = true
      // Starting during HBlank (or with the LCD off) copies a block at once.
      if (this.ppu.mode === 0 && this.ppu.ly < 144) this.hblankDma()
      return
    }
    // General-purpose DMA: everything now, CPU halted meanwhile.
    do this.copyHdmaBlock()
    while (this.hdmaRemaining !== 0x7f)
  }

  private readHdma5(): number {
    return (this.hdmaHblank ? 0x00 : 0x80) | this.hdmaRemaining
  }

  /**
   * STOP instruction. On CGB with KEY1 armed it switches CPU speed and resets
   * DIV; returns true if it did.
   */
  stop(): boolean {
    if (!this.cgb || !this.speedArmed) return false
    this.speedArmed = false
    this.doubleSpeed = !this.doubleSpeed
    this.apu.setDoubleSpeed(this.doubleSpeed)
    this.timer.writeDiv()
    this.stall += SPEED_SWITCH_STALL
    return true
  }

  // --- CPU access ---

  read(addr: number): number {
    if (this.dmaConflict(addr)) return this.dmaByte
    if (addr < 0x8000) return this.cart.readRom(addr)
    if (addr < 0xa000)
      return this.ppu.vramAccessible()
        ? this.ppu.vram[this.vramOffset(addr)]
        : 0xff
    if (addr < 0xc000) return this.cart.readRam(addr)
    if (addr < 0xfe00) return this.wram[this.wramOffset(addr)]
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
      if (this.ppu.vramAccessible())
        this.ppu.vram[this.vramOffset(addr)] = value
    } else if (addr < 0xc000) this.cart.writeRam(addr, value)
    else if (addr < 0xfe00) this.wram[this.wramOffset(addr)] = value
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
    if (this.cgb) return this.readCgbIo(addr)
    return 0xff
  }

  private readCgbIo(addr: number): number {
    const ppu = this.ppu
    switch (addr) {
      case 0xff4d:
        return 0x7e | (this.doubleSpeed ? 0x80 : 0) | (this.speedArmed ? 1 : 0)
      case 0xff4f:
        return 0xfe | this.vramBank
      case 0xff55:
        return this.readHdma5()
      case 0xff68:
        return ppu.bcps | 0x40
      case 0xff69:
        return ppu.readPaletteData(false)
      case 0xff6a:
        return ppu.ocps | 0x40
      case 0xff6b:
        return ppu.readPaletteData(true)
      case 0xff70:
        return 0xf8 | this.wramBank
    }
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
    if (addr >= 0xff10 && addr < 0xff40) return this.apu.write(addr, value)
    if (this.cgb) this.writeCgbIo(addr, value)
  }

  private writeCgbIo(addr: number, value: number): void {
    const ppu = this.ppu
    switch (addr) {
      case 0xff4d:
        this.speedArmed = (value & 1) !== 0
        return
      case 0xff4f:
        this.vramBank = value & 1
        return
      case 0xff51:
        this.hdmaSource = (value << 8) | (this.hdmaSource & 0xf0)
        return
      case 0xff52:
        this.hdmaSource = (this.hdmaSource & 0xff00) | (value & 0xf0)
        return
      case 0xff53:
        this.hdmaDest = ((value & 0x1f) << 8) | (this.hdmaDest & 0xf0)
        return
      case 0xff54:
        this.hdmaDest = (this.hdmaDest & 0x1f00) | (value & 0xf0)
        return
      case 0xff55:
        return this.writeHdma5(value)
      case 0xff68:
        ppu.bcps = value & 0xbf
        return
      case 0xff69:
        return ppu.writePaletteData(false, value)
      case 0xff6a:
        ppu.ocps = value & 0xbf
        return
      case 0xff6b:
        return ppu.writePaletteData(true, value)
      case 0xff70:
        this.wramBank = value & 7 || 1
        return
    }
  }
}
