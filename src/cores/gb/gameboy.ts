import type {
  AudioChunk,
  BreakpointDebug,
  Core,
  MemoryDebug,
  InputState,
  Screen,
  SerialDebug,
} from '../types.ts'
import { SAMPLE_RATE } from './apu.ts'
import { Bus } from './bus.ts'
import { createCartridge } from './cartridge.ts'
import { Cpu } from './cpu.ts'

export const CLOCK_HZ = 4_194_304
export const CYCLES_PER_FRAME = 70_224

export type GameBoyModel = 'dmg' | 'cgb'

export interface GameBoyOptions {
  /** Hardware to emulate (default `dmg`). */
  model?: GameBoyModel
  /** Wall clock in ms since the Unix epoch, for the MBC3 RTC (tests inject one). */
  now?: () => number
}

/**
 * Game Boy (DMG) or Game Boy Color (CGB). Starts in post-boot-ROM state; no
 * boot ROM needed.
 */
export class GameBoy
  implements Core, SerialDebug, BreakpointDebug, MemoryDebug
{
  readonly system: GameBoyModel
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
    this.system = options.model ?? 'dmg'
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
    bus = new Bus(cart, this.system === 'cgb')
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
    return { sampleRate: SAMPLE_RATE, samples: this.machine().bus.apu.drain() }
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

  peek(addr: number): number {
    const { bus } = this.machine()
    // Cartridge RAM directly, so the test's RAM-enable state doesn't matter.
    if (addr >= 0xa000 && addr < 0xc000) {
      const ram = bus.cart.ram
      return ram.length ? ram[(addr - 0xa000) % ram.length] : 0xff
    }
    return bus.read(addr)
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
