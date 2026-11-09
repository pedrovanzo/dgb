import { parseHeader } from './gb/cartridge.ts'
import { GameBoy } from './gb/gameboy.ts'
import type { Core } from './types.ts'

export interface CreatedCore {
  core: Core
  title: string
  /** Shown to the user when the ROM may not run correctly yet. */
  warning?: string
}

/** Picks a core for the ROM and loads it. Throws on unsupported ROMs. */
export function createCore(rom: Uint8Array): CreatedCore {
  const header = parseHeader(rom)
  const core = new GameBoy()
  core.loadRom(rom)
  const warning =
    header.cgbFlag === 0xc0
      ? 'Game Boy Color-only game: color support arrives in Phase 7.'
      : undefined
  return { core, title: header.title || 'Untitled', warning }
}
