import { describe, expect, it } from 'vitest'
import {
  acid2Cases,
  blarggCases,
  mooneyeAppliesTo,
  mooneyeCase,
} from '../testing/conformance.ts'
import {
  blarggDetector,
  compareScreens,
  mooneyeDetector,
  runFrames,
  runUntilBreakpointVerdict,
  runUntilMemoryVerdict,
  runUntilSerialVerdict,
} from '../testing/harness.ts'
import {
  listTestRoms,
  readReferenceScreen,
  readTestRom,
  writeScreenPng,
} from '../testing/node.ts'
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

describe('Screen tests (DMG)', () => {
  it.each(acid2Cases.dmg.map((c) => [c.rom, c]))('%s', (_, c) => {
    if (c.kind !== 'screen') throw new Error('unexpected case kind')
    const gb = boot(c.rom)
    runFrames(gb, c.frames)
    const actual = gb.getFramebuffers()[0]
    const diff = compareScreens(actual, readReferenceScreen(c.reference))
    if (diff.mismatches > 0) {
      const name = c.rom.replace(/[/.]/g, '_')
      const path = writeScreenPng(name, actual)
      expect.fail(
        `${diff.mismatches} pixels differ, first ${JSON.stringify(diff.first)}; actual saved to ${path}`,
      )
    }
  })
})

/**
 * Mooneye acceptance tests not expected to pass yet. Each entry names the
 * phase that should fix it. `it.fails` turns an unexpected pass into a test
 * failure, so remove entries as features land.
 */
const MOONEYE_KNOWN_FAILURES = new Map<string, string>([
  [
    'mooneye/acceptance/ppu/lcdon_timing-GS.gb',
    'Deferred: PPU LCD-on edge cases',
  ],
  [
    'mooneye/acceptance/ppu/lcdon_write_timing-GS.gb',
    'Deferred: PPU LCD-on edge cases',
  ],
  [
    'mooneye/acceptance/ppu/stat_lyc_onoff.gb',
    'Deferred: PPU LCD-on edge cases',
  ],
])

const mooneyeRoms = ['mooneye/acceptance', 'mooneye/emulator-only']
  .flatMap((dir) => listTestRoms(dir))
  .filter((rom) => mooneyeAppliesTo(rom, 'dmg'))

describe('Mooneye acceptance and MBC tests (DMG)', () => {
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

/** Blargg dmg_sound singles not expected to pass yet, with the reason. */
const DMG_SOUND_KNOWN_FAILURES = new Map<string, string>([])

describe('Blargg dmg_sound (DMG)', () => {
  for (const rom of listTestRoms('blargg/dmg_sound')) {
    const reason = DMG_SOUND_KNOWN_FAILURES.get(rom)
    const test = reason ? it.fails : it
    test(
      reason ? `${rom} (known failure: ${reason})` : rom,
      () => {
        const r = runUntilMemoryVerdict(boot(rom), 3_000)
        expect(r.verdict, r.text).toBe('pass')
      },
      60_000,
    )
  }
})
