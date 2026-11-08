/**
 * Contract shared by every emulation core (GB/GBC, GBA, maybe DS).
 *
 * Cores are pure: no React, no DOM. They run inside a Web Worker in the app
 * and directly inside Vitest for headless conformance tests.
 */

export type SystemId = 'dmg' | 'cgb' | 'agb' | 'nds'

export type Button =
  | 'up'
  | 'down'
  | 'left'
  | 'right'
  | 'a'
  | 'b'
  | 'start'
  | 'select'
  | 'l'
  | 'r'
  | 'x'
  | 'y'

/** One physical screen. GB/GBA expose one; DS would expose two. */
export interface Screen {
  readonly width: number
  readonly height: number
  /** RGBA8888, row-major, length = width * height * 4. */
  readonly pixels: Uint8ClampedArray
}

export interface PointerState {
  /** Index into `getFramebuffers()` of the touched screen. */
  readonly screen: number
  readonly x: number
  readonly y: number
  readonly down: boolean
}

export interface InputState {
  readonly buttons: ReadonlySet<Button>
  readonly pointer?: PointerState
}

export interface AudioChunk {
  readonly sampleRate: number
  /** Interleaved stereo samples in [-1, 1], produced since the last call. */
  readonly samples: Float32Array
}

export interface Core {
  readonly system: SystemId
  /** Bumped whenever the `serialize` format changes; old states are rejected. */
  readonly stateVersion: number
  /** Nominal frames per second (~59.73 for GB). */
  readonly frameRate: number

  loadRom(rom: Uint8Array): void
  reset(): void
  /** Emulate exactly one video frame. */
  runFrame(): void

  getFramebuffers(): readonly Screen[]
  drainAudio(): AudioChunk
  setInput(input: InputState): void

  /** Battery-backed cartridge RAM, or `null` if the cartridge has none. */
  getSaveRam(): Uint8Array | null
  setSaveRam(data: Uint8Array): void

  serialize(): Uint8Array
  deserialize(state: Uint8Array): void
}

/**
 * Optional debug surface. Blargg test ROMs report results over the
 * link/serial port, so headless tests need to read it.
 */
export interface SerialDebug {
  /** Bytes written to the serial port since the last call. */
  drainSerial(): Uint8Array
}

/**
 * Optional debug surface for software breakpoints. Mooneye ROMs execute
 * `LD B,B` when done and leave the result in B, C, D, E, H, L.
 */
export interface BreakpointDebug {
  /** Register snapshots (GB: [B, C, D, E, H, L]) per breakpoint since the last call. */
  drainBreakpoints(): Uint8Array[]
}

export function hasSerialDebug(core: Core): core is Core & SerialDebug {
  return typeof (core as Partial<SerialDebug>).drainSerial === 'function'
}
