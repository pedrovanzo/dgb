import type { Screen } from '../types.ts'
import { INT_STAT, INT_VBLANK, type Interrupts } from './interrupts.ts'

export const SCREEN_WIDTH = 160
export const SCREEN_HEIGHT = 144
const DOTS_PER_LINE = 456
const LINES_PER_FRAME = 154
const MODE2_DOTS = 80
const MODE3_DOTS = 172

/**
 * Phase 2: timing-only PPU. Drives LY, STAT modes, LYC coincidence and the
 * VBlank/STAT interrupts, and stores VRAM/OAM/registers. Rendering arrives in
 * Phase 3; the screen stays white until then.
 */
export class Ppu {
  readonly vram = new Uint8Array(0x2000)
  readonly oam = new Uint8Array(0xa0)
  readonly screen: Screen = {
    width: SCREEN_WIDTH,
    height: SCREEN_HEIGHT,
    pixels: new Uint8ClampedArray(SCREEN_WIDTH * SCREEN_HEIGHT * 4).fill(0xff),
  }

  lcdc = 0x91
  /** Writable STAT bits (3-6). */
  statEnable = 0x00
  scy = 0
  scx = 0
  ly = 0
  lyc = 0
  bgp = 0xfc
  obp0 = 0xff
  obp1 = 0xff
  wy = 0
  wx = 0
  dma = 0xff

  private dot = 0
  private statLine = false
  private readonly irq: Interrupts

  constructor(irq: Interrupts) {
    this.irq = irq
  }

  private get enabled(): boolean {
    return (this.lcdc & 0x80) !== 0
  }

  mode(): number {
    if (!this.enabled) return 0
    if (this.ly >= SCREEN_HEIGHT) return 1
    if (this.dot < MODE2_DOTS) return 2
    if (this.dot < MODE2_DOTS + MODE3_DOTS) return 3
    return 0
  }

  /** Advance one M-cycle (4 dots). */
  tick(): void {
    if (!this.enabled) return
    this.dot += 4
    if (this.dot >= DOTS_PER_LINE) {
      this.dot -= DOTS_PER_LINE
      this.ly = (this.ly + 1) % LINES_PER_FRAME
      if (this.ly === SCREEN_HEIGHT) this.irq.request(INT_VBLANK)
    }
    this.updateStatLine()
  }

  readStat(): number {
    const coincidence = this.enabled && this.ly === this.lyc ? 0x04 : 0
    return 0x80 | this.statEnable | coincidence | this.mode()
  }

  writeStat(value: number): void {
    this.statEnable = value & 0x78
    this.updateStatLine()
  }

  writeLcdc(value: number): void {
    const wasEnabled = this.enabled
    this.lcdc = value
    if (wasEnabled && !this.enabled) {
      this.ly = 0
      this.dot = 0
    } else if (!wasEnabled && this.enabled) {
      this.dot = 0
      this.updateStatLine()
    }
  }

  writeLyc(value: number): void {
    this.lyc = value
    this.updateStatLine()
  }

  private updateStatLine(): void {
    if (!this.enabled) {
      this.statLine = false
      return
    }
    const mode = this.mode()
    const s = this.statEnable
    const line =
      ((s & 0x08) !== 0 && mode === 0) ||
      ((s & 0x10) !== 0 && mode === 1) ||
      ((s & 0x20) !== 0 && mode === 2) ||
      ((s & 0x40) !== 0 && this.ly === this.lyc)
    if (line && !this.statLine) this.irq.request(INT_STAT)
    this.statLine = line
  }
}
