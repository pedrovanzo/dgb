import type { Screen } from '../types.ts'
import { INT_STAT, INT_VBLANK, type Interrupts } from './interrupts.ts'

export const SCREEN_WIDTH = 160
export const SCREEN_HEIGHT = 144
const DOTS_PER_LINE = 456
const LINES_PER_FRAME = 154
const MODE2_DOTS = 80
const MODE3_BASE_DOTS = 172
const MAX_SPRITES_PER_LINE = 10

/** DMG shades for color ids 0-3 (matches dmg-acid2 reference greys). */
const SHADES = [0xff, 0xaa, 0x55, 0x00]

interface LineSprite {
  /** OAM X (screen x + 8). */
  x: number
  /** Row within the sprite, already flipped. */
  row: number
  tile: number
  flags: number
  /** OAM index; lower wins ties on DMG. */
  index: number
}

/**
 * DMG pixel processing unit: scanline renderer with dot-based mode timing.
 *
 * Each line renders at the end of mode 3 using register values at that moment.
 * Mode 3 length varies with SCX, the window and sprites (Pan Docs penalty
 * algorithm), which shifts HBlank and STAT timing like real hardware.
 */
export class Ppu {
  readonly vram = new Uint8Array(0x2000)
  readonly oam = new Uint8Array(0xa0)
  /** Last completed frame (presented). */
  readonly screen: Screen = {
    width: SCREEN_WIDTH,
    height: SCREEN_HEIGHT,
    pixels: new Uint8ClampedArray(SCREEN_WIDTH * SCREEN_HEIGHT * 4).fill(0xff),
  }
  /** Frame being drawn. */
  private readonly back = new Uint8ClampedArray(
    SCREEN_WIDTH * SCREEN_HEIGHT * 4,
  ).fill(0xff)

  lcdc = 0x91
  /** Writable STAT bits (3-6). */
  statEnable = 0x00
  scy = 0
  scx = 0
  /** LY register as seen by the CPU. */
  ly = 0
  lyc = 0
  bgp = 0xfc
  obp0 = 0xff
  obp1 = 0xff
  wy = 0
  wx = 0
  dma = 0xff

  /** Current mode (0 HBlank, 1 VBlank, 2 OAM scan, 3 drawing). */
  mode = 1
  /** Internal line counter 0-153 (LY differs on line 153). */
  private line = 0
  private dot = 0
  private mode3End = MODE2_DOTS + MODE3_BASE_DOTS
  /** First line after LCD on: no OAM scan, mode reads 0. */
  private firstLine = false
  private statLine = false
  private windowLine = 0
  private windowYTriggered = false
  private windowOnLine = false
  private sprites: LineSprite[] = []
  private readonly bgIds = new Uint8Array(SCREEN_WIDTH)
  private readonly irq: Interrupts

  constructor(irq: Interrupts) {
    this.irq = irq
    // Post-boot: the boot ROM hands over late in VBlank, on line 153.
    this.line = LINES_PER_FRAME - 1
    this.dot = 400
    this.ly = 0
    this.mode = 1
  }

  private get enabled(): boolean {
    return (this.lcdc & 0x80) !== 0
  }

  /** CPU can access VRAM. */
  vramAccessible(): boolean {
    return this.mode !== 3
  }

  /** CPU can access OAM. */
  oamAccessible(): boolean {
    return this.mode < 2
  }

  /** Advance one M-cycle (4 dots). */
  tick(): void {
    if (!this.enabled) return
    this.dot += 4

    if (this.line < SCREEN_HEIGHT) {
      if (
        this.mode === 2 ||
        (this.firstLine && this.mode === 0 && this.dot < this.mode3End)
      ) {
        if (this.dot >= MODE2_DOTS) this.startMode3()
      }
      if (this.mode === 3 && this.dot >= this.mode3End) {
        this.renderLine()
        this.mode = 0
      }
    } else if (this.line === LINES_PER_FRAME - 1 && this.dot >= 4) {
      this.ly = 0 // LY reads 0 for most of line 153
    }
    // LY advances one M-cycle before the line ends.
    if (this.dot === DOTS_PER_LINE - 4 && this.line < LINES_PER_FRAME - 1) {
      this.ly = this.line + 1
    }

    if (this.dot >= DOTS_PER_LINE) {
      this.dot -= DOTS_PER_LINE
      this.nextLine()
    }
    this.updateStatLine()
  }

  private nextLine(): void {
    this.firstLine = false
    this.line++
    if (this.line === SCREEN_HEIGHT) {
      this.mode = 1
      this.irq.request(INT_VBLANK)
      this.screen.pixels.set(this.back)
    } else if (this.line === LINES_PER_FRAME) {
      this.line = 0
      this.windowLine = 0
      this.windowYTriggered = false
    }
    this.ly = this.line
    if (this.line < SCREEN_HEIGHT) this.startMode2()
  }

  private startMode2(): void {
    this.mode = 2
    if (this.ly === this.wy) this.windowYTriggered = true
  }

  private startMode3(): void {
    this.mode = 3
    this.scanOam()
    this.windowOnLine =
      (this.lcdc & 0x21) === 0x21 && this.windowYTriggered && this.wx <= 166
    this.mode3End = MODE2_DOTS + MODE3_BASE_DOTS + this.mode3Penalty()
  }

  /** Selects up to 10 sprites overlapping this line, in OAM order. */
  private scanOam(): void {
    const height = this.lcdc & 0x04 ? 16 : 8
    const sprites: LineSprite[] = []
    for (let i = 0; i < 40 && sprites.length < MAX_SPRITES_PER_LINE; i++) {
      const y = this.oam[i * 4] - 16
      const row = this.line - y
      if (row < 0 || row >= height) continue
      const flags = this.oam[i * 4 + 3]
      let tile = this.oam[i * 4 + 2]
      if (height === 16) tile &= 0xfe
      sprites.push({
        x: this.oam[i * 4 + 1],
        row: flags & 0x40 ? height - 1 - row : row,
        tile,
        flags,
        index: i,
      })
    }
    this.sprites = sprites
  }

  /** Extra mode 3 dots: SCX fine scroll, window start, sprite fetches. */
  private mode3Penalty(): number {
    let penalty = this.scx & 7
    if (this.windowOnLine) penalty += 6
    if ((this.lcdc & 0x02) === 0) return penalty
    return penalty + this.spritePenalty()
  }

  /**
   * Pan Docs OBJ penalty, rounded down to whole M-cycles (matches
   * mooneye intr_2_mode0_timing_sprites measurements).
   */
  private spritePenalty(): number {
    let penalty = 0
    const winStart = this.wx - 7
    const considered = new Set<number>()
    for (const s of this.sprites) {
      if (s.x >= 168) continue
      const px = s.x - 8
      let tile: number
      let offset: number
      if (this.windowOnLine && px >= winStart) {
        tile = 1000 + ((px - winStart) >> 3)
        offset = (px - winStart) & 7
      } else {
        tile = (px + this.scx) >> 3
        offset = (px + this.scx) & 7
      }
      if (!considered.has(tile)) {
        considered.add(tile)
        penalty += Math.max(0, 5 - offset)
      }
      penalty += 6
    }
    return penalty & ~3
  }

  // --- Rendering ---

  private tileRow(tileAddr: number, row: number, x: number): number {
    const lo = this.vram[tileAddr + row * 2]
    const hi = this.vram[tileAddr + row * 2 + 1]
    const bit = 7 - x
    return (((hi >> bit) & 1) << 1) | ((lo >> bit) & 1)
  }

  private bgTileAddr(mapBase: number, col: number, row: number): number {
    const index = this.vram[mapBase + row * 32 + col]
    if (this.lcdc & 0x10) return index * 16
    return 0x1000 + ((index << 24) >> 24) * 16
  }

  private renderLine(): void {
    const ly = this.line
    const out = this.back
    const ids = this.bgIds
    const lcdc = this.lcdc
    const rowBase = ly * SCREEN_WIDTH * 4

    // Background and window
    if (lcdc & 0x01) {
      const bgMap = lcdc & 0x08 ? 0x1c00 : 0x1800
      const winMap = lcdc & 0x40 ? 0x1c00 : 0x1800
      const winStart = this.wx - 7
      const y = (ly + this.scy) & 0xff
      const winY = this.windowLine
      for (let x = 0; x < SCREEN_WIDTH; x++) {
        let id: number
        if (this.windowOnLine && x >= winStart) {
          const wxp = x - winStart
          const addr = this.bgTileAddr(winMap, wxp >> 3, winY >> 3)
          id = this.tileRow(addr, winY & 7, wxp & 7)
        } else {
          const xp = (x + this.scx) & 0xff
          const addr = this.bgTileAddr(bgMap, xp >> 3, y >> 3)
          id = this.tileRow(addr, y & 7, xp & 7)
        }
        ids[x] = id
        const shade = SHADES[(this.bgp >> (id * 2)) & 3]
        out[rowBase + x * 4] = shade
        out[rowBase + x * 4 + 1] = shade
        out[rowBase + x * 4 + 2] = shade
        out[rowBase + x * 4 + 3] = 0xff
      }
      if (this.windowOnLine) this.windowLine++
    } else {
      ids.fill(0)
      out.fill(0xff, rowBase, rowBase + SCREEN_WIDTH * 4)
    }

    // Sprites: DMG priority is lowest X, then lowest OAM index.
    if (lcdc & 0x02 && this.sprites.length) {
      const sorted = [...this.sprites].sort(
        (a, b) => a.x - b.x || a.index - b.index,
      )
      for (let x = 0; x < SCREEN_WIDTH; x++) {
        for (const s of sorted) {
          const col = x - (s.x - 8)
          if (col < 0 || col > 7) continue
          const id = this.tileRow(
            s.tile * 16,
            s.row,
            s.flags & 0x20 ? 7 - col : col,
          )
          if (id === 0) continue
          if ((s.flags & 0x80) === 0 || ids[x] === 0) {
            const pal = s.flags & 0x10 ? this.obp1 : this.obp0
            const shade = SHADES[(pal >> (id * 2)) & 3]
            const i = rowBase + x * 4
            out[i] = shade
            out[i + 1] = shade
            out[i + 2] = shade
          }
          break
        }
      }
    }
  }

  // --- Registers ---

  readStat(): number {
    const coincidence = this.enabled && this.ly === this.lyc ? 0x04 : 0
    return 0x80 | this.statEnable | coincidence | (this.enabled ? this.mode : 0)
  }

  writeStat(value: number): void {
    this.statEnable = value & 0x78
    this.updateStatLine()
  }

  writeLcdc(value: number): void {
    const wasEnabled = this.enabled
    this.lcdc = value
    if (wasEnabled && !this.enabled) {
      this.ly = this.line = 0
      this.dot = 0
      this.mode = 0
      this.statLine = false
      this.screen.pixels.fill(0xff)
    } else if (!wasEnabled && this.enabled) {
      this.ly = this.line = 0
      this.dot = 0
      this.mode = 0
      this.firstLine = true
      this.windowLine = 0
      this.windowYTriggered = this.wy === 0
      this.mode3End = MODE2_DOTS + MODE3_BASE_DOTS
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
    const s = this.statEnable
    const mode = this.mode
    // Line 144 also raises the mode-2 source as VBlank begins.
    const oamSource =
      mode === 2 || (this.line === SCREEN_HEIGHT && this.dot < 4)
    const line =
      ((s & 0x08) !== 0 && mode === 0) ||
      ((s & 0x10) !== 0 && mode === 1) ||
      ((s & 0x20) !== 0 && oamSource) ||
      ((s & 0x40) !== 0 && this.ly === this.lyc)
    if (line && !this.statLine) this.irq.request(INT_STAT)
    this.statLine = line
  }
}
