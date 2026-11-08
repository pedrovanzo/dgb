import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  acid2Cases,
  blarggCases,
  MOONEYE_AUTO_DIRS,
  mooneyeAppliesTo,
  type ConformanceCase,
} from './conformance.ts'
import { listTestRoms, readReferenceScreen, TEST_ROMS_DIR } from './node.ts'

const allCases: ConformanceCase[] = [
  ...blarggCases,
  ...acid2Cases.dmg,
  ...acid2Cases.cgb,
]

describe('conformance catalog', () => {
  it.each(allCases.map((c) => [c.rom, c]))('%s exists on disk', (_, c) => {
    expect(existsSync(join(TEST_ROMS_DIR, c.rom))).toBe(true)
    if (c.kind === 'screen') {
      expect(existsSync(join(TEST_ROMS_DIR, c.reference))).toBe(true)
    }
  })

  it('reference images decode to GB resolution', () => {
    for (const c of [...acid2Cases.dmg, ...acid2Cases.cgb]) {
      if (c.kind !== 'screen') continue
      const ref = readReferenceScreen(c.reference)
      expect([ref.width, ref.height]).toEqual([160, 144])
    }
  })

  it('finds Mooneye ROMs in every automated directory', () => {
    for (const dir of MOONEYE_AUTO_DIRS) {
      expect(listTestRoms(dir).length).toBeGreaterThan(0)
    }
  })
})

describe('mooneyeAppliesTo', () => {
  it.each([
    ['acceptance/add_sp_e_timing.gb', true, true],
    ['acceptance/di_timing-GS.gb', true, false],
    ['acceptance/boot_div-S.gb', false, false],
    ['acceptance/boot_regs-dmgABC.gb', true, false],
    ['acceptance/boot_regs-dmg0.gb', false, false],
    ['acceptance/boot_div-dmgABCmgb.gb', true, false],
    ['acceptance/boot_regs-mgb.gb', false, false],
    ['acceptance/boot_regs-sgb2.gb', false, false],
    ['misc/boot_regs-cgb.gb', false, true],
    ['misc/boot_div-A.gb', false, false],
    ['misc/boot_hwio-C.gb', false, true],
  ])('%s: dmg=%s cgb=%s', (rom, dmg, cgb) => {
    expect(mooneyeAppliesTo(rom, 'dmg')).toBe(dmg)
    expect(mooneyeAppliesTo(rom, 'cgb')).toBe(cgb)
  })
})
