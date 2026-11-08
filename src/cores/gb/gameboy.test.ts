import { describe, expect, it } from 'vitest'
import {
  blarggCases,
  mooneyeAppliesTo,
  mooneyeCase,
} from '../testing/conformance.ts'
import {
  blarggDetector,
  mooneyeDetector,
  runUntilBreakpointVerdict,
  runUntilSerialVerdict,
} from '../testing/harness.ts'
import { listTestRoms, readTestRom } from '../testing/node.ts'
import { GameBoy } from './gameboy.ts'

function boot(rom: string): GameBoy {
  const gb = new GameBoy()
  gb.loadRom(readTestRom(rom))
  return gb
}

describe('Blargg (DMG)', () => {
  it.each(blarggCases.map((c) => [c.rom, c]))(
    '%s',
    (_, c) => {
      if (c.kind !== 'blargg-serial') throw new Error('unexpected case kind')
      const r = runUntilSerialVerdict(boot(c.rom), blarggDetector, c.maxFrames)
      expect(r.verdict, r.text).toBe('pass')
    },
    120_000,
  )
})

/**
 * Mooneye acceptance tests not expected to pass yet. Each entry names the
 * phase that should fix it. `it.fails` turns an unexpected pass into a test
 * failure, so remove entries as features land.
 */
const MOONEYE_KNOWN_FAILURES = new Map<string, string>([
  // Instruction timing is measured with OAM DMA.
  ['mooneye/acceptance/add_sp_e_timing.gb', 'Phase 3: OAM DMA'],
  ['mooneye/acceptance/call_cc_timing.gb', 'Phase 3: OAM DMA'],
  ['mooneye/acceptance/call_cc_timing2.gb', 'Phase 3: OAM DMA'],
  ['mooneye/acceptance/call_timing.gb', 'Phase 3: OAM DMA'],
  ['mooneye/acceptance/call_timing2.gb', 'Phase 3: OAM DMA'],
  ['mooneye/acceptance/jp_cc_timing.gb', 'Phase 3: OAM DMA'],
  ['mooneye/acceptance/jp_timing.gb', 'Phase 3: OAM DMA'],
  ['mooneye/acceptance/ld_hl_sp_e_timing.gb', 'Phase 3: OAM DMA'],
  ['mooneye/acceptance/push_timing.gb', 'Phase 3: OAM DMA'],
  ['mooneye/acceptance/ret_cc_timing.gb', 'Phase 3: OAM DMA'],
  ['mooneye/acceptance/ret_timing.gb', 'Phase 3: OAM DMA'],
  ['mooneye/acceptance/reti_timing.gb', 'Phase 3: OAM DMA'],
  ['mooneye/acceptance/rst_timing.gb', 'Phase 3: OAM DMA'],
  ['mooneye/acceptance/oam_dma/basic.gb', 'Phase 3: OAM DMA'],
  ['mooneye/acceptance/oam_dma/sources-GS.gb', 'Phase 3: OAM DMA'],
  ['mooneye/acceptance/oam_dma_restart.gb', 'Phase 3: OAM DMA'],
  ['mooneye/acceptance/oam_dma_start.gb', 'Phase 3: OAM DMA'],
  ['mooneye/acceptance/oam_dma_timing.gb', 'Phase 3: OAM DMA'],
  ['mooneye/acceptance/ppu/hblank_ly_scx_timing-GS.gb', 'Phase 3: PPU timing'],
  ['mooneye/acceptance/ppu/intr_1_2_timing-GS.gb', 'Phase 3: PPU timing'],
  ['mooneye/acceptance/ppu/intr_2_0_timing.gb', 'Phase 3: PPU timing'],
  ['mooneye/acceptance/ppu/intr_2_mode0_timing.gb', 'Phase 3: PPU timing'],
  [
    'mooneye/acceptance/ppu/intr_2_mode0_timing_sprites.gb',
    'Phase 3: PPU timing',
  ],
  ['mooneye/acceptance/ppu/intr_2_mode3_timing.gb', 'Phase 3: PPU timing'],
  ['mooneye/acceptance/ppu/intr_2_oam_ok_timing.gb', 'Phase 3: PPU timing'],
  ['mooneye/acceptance/ppu/lcdon_timing-GS.gb', 'Phase 3: PPU timing'],
  ['mooneye/acceptance/ppu/lcdon_write_timing-GS.gb', 'Phase 3: PPU timing'],
  ['mooneye/acceptance/ppu/stat_lyc_onoff.gb', 'Phase 3: PPU timing'],
  ['mooneye/acceptance/ppu/vblank_stat_intr-GS.gb', 'Phase 3: PPU timing'],
  ['mooneye/acceptance/di_timing-GS.gb', 'Phase 3: PPU timing'],
  ['mooneye/acceptance/halt_ime1_timing2-GS.gb', 'Phase 3: PPU timing'],
  [
    'mooneye/acceptance/bits/unused_hwio-GS.gb',
    'Phase 6: APU register masks/defaults',
  ],
  [
    'mooneye/acceptance/boot_hwio-dmgABCmgb.gb',
    'Phase 6: APU register masks/defaults',
  ],
])

const mooneyeRoms = listTestRoms('mooneye/acceptance').filter((rom) =>
  mooneyeAppliesTo(rom, 'dmg'),
)

describe('Mooneye acceptance (DMG)', () => {
  for (const rom of mooneyeRoms) {
    const reason = MOONEYE_KNOWN_FAILURES.get(rom)
    const test = reason ? it.fails : it
    test(
      reason ? `${rom} (known failure: ${reason})` : rom,
      () => {
        const c = mooneyeCase(rom)
        if (c.kind !== 'mooneye-breakpoint')
          throw new Error('unexpected case kind')
        const r = runUntilBreakpointVerdict(
          boot(rom),
          mooneyeDetector,
          c.maxFrames,
        )
        expect(r.verdict).toBe('pass')
      },
      60_000,
    )
  }
})
