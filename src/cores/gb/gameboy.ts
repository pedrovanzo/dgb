import type {
  AudioChunk,
  BreakpointDebug,
  Core,
  InputState,
  Screen,
  SerialDebug,
} from '../types.ts'
import { Bus } from './bus.ts'
import { createCartridge } from './cartridge.ts'
import { Cpu } from './cpu.ts'

export const CLOCK_HZ = 4_194_304
export const CYCLES_PER_FRAME = 70_224

export interface GameBoyOptions {
  /** Wall clock in ms since the Unix epoch, for the MBC3 RTC (tests inject one). */
  now?: () => number
}

/** Original Game Boy (DMG). Starts in post-boot-ROM state; no boot ROM needed. */
export class GameBoy implements Core, SerialDebug, BreakpointDebug {
  readonly system = 'dmg' as const
  readonly stateVersion = 1
  readonly frameRate = CLOCK_HZ / CYCLES_PER_FRAME

  private rom: Uint8Array | null = null
  private bus: Bus | null = null
  private cpu: Cpu | null = null
  private frameEnd = 0
  private breakpoints: Uint8Array[] = []
  private readonly now: () => number

  constructor(options: GameBoyOptions = {}) {
    this.now = options.now ?? (() => Date.now())
  }

  loadRom(rom: Uint8Array): void {
    this.rom = rom
    this.reset()
  }

  reset(): void {
    if (!this.rom) throw new Error('No ROM loaded')
    // Battery-backed data survives a reset, like on a real cartridge.
    const save = this.bus?.cart.saveData() ?? null
    let bus: Bus | null = null
    const cart = createCartridge(this.rom, {
      clock: { cycles: () => bus?.cycles ?? 0, now: this.now },
    })
    bus = new Bus(cart)
    if (save) cart.loadSaveData(save)
    bus.timer.counter = 0xabcc // DIV state at 0x0100 on DMG A/B/C
    this.bus = bus
    const cpu = new Cpu(bus)
    cpu.onBreakpoint = () =>
      this.breakpoints.push(
        Uint8Array.of(cpu.b, cpu.c, cpu.d, cpu.e, cpu.h, cpu.l),
      )
    this.cpu = cpu
    this.breakpoints = []
    this.frameEnd = 0
  }

  runFrame(): void {
    const { bus, cpu } = this.machine()
    this.frameEnd += CYCLES_PER_FRAME
    while (bus.cycles < this.frameEnd) cpu.step()
  }

  getFramebuffers(): readonly Screen[] {
    return [this.machine().bus.ppu.screen]
  }

  drainAudio(): AudioChunk {
    return { sampleRate: 48_000, samples: new Float32Array(0) }
  }

  setInput(input: InputState): void {
    this.machine().bus.joypad.setButtons(input.buttons)
  }

  getSaveRam(): Uint8Array | null {
    return this.machine().bus.cart.saveData()
  }

  setSaveRam(data: Uint8Array): void {
    this.machine().bus.cart.loadSaveData(data)
  }

  consumeSaveDirty(): boolean {
    return this.machine().bus.cart.consumeDirty()
  }

  serialize(): Uint8Array {
    throw new Error('Save states arrive in Phase 10')
  }

  deserialize(): void {
    throw new Error('Save states arrive in Phase 10')
  }

  drainSerial(): Uint8Array {
    return this.machine().bus.serial.drain()
  }

  drainBreakpoints(): Uint8Array[] {
    const out = this.breakpoints
    this.breakpoints = []
    return out
  }

  private machine(): { bus: Bus; cpu: Cpu } {
    if (!this.bus || !this.cpu) throw new Error('No ROM loaded')
    return { bus: this.bus, cpu: this.cpu }
  }
}
