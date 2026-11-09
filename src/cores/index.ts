import { parseHeader } from './gb/cartridge.ts'
import { GameBoy } from './gb/gameboy.ts'
import type { Core } from './types.ts'

export interface CreatedCore {
  core: Core
  title: string
  /** Shown to the user when the ROM may not run correctly yet. */
  warning?: string
}

/**
 * Picks a core for the ROM and loads it. Throws on unsupported ROMs.
 * Color-capable cartridges (header 0x143 bit 7) run on the CGB model; the rest
 * run on the DMG model.
 */
export function createCore(rom: Uint8Array): CreatedCore {
  const header = parseHeader(rom)
  const model = header.cgbFlag & 0x80 ? 'cgb' : 'dmg'
  const core = new GameBoy({ model })
  core.loadRom(rom)
  // CGB titles are 11-15 bytes; the rest of the field is the manufacturer
  // code and flag.
  const title = model === 'cgb' ? header.title.slice(0, 15) : header.title
  return { core, title: title.trim() || 'Untitled' }
}
