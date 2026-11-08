/**
 * Catalog of conformance test ROMs and their pass criteria. Core test suites
 * (Phase 2+) iterate over these. Paths are relative to `test-roms/`.
 */
import type { SystemId } from '../types.ts'

export type ConformanceCase =
  | {
      kind: 'blargg-serial' | 'mooneye-breakpoint'
      rom: string
      /** Upper bound before the run counts as a timeout. */
      maxFrames: number
    }
  | {
      kind: 'screen'
      rom: string
      reference: string
      /** Frames to run before capturing the screen. */
      frames: number
    }

const BLARGG_CPU_INSTRS = [
  '01-special',
  '02-interrupts',
  '03-op sp,hl',
  '04-op r,imm',
  '05-op rp',
  '06-ld r,r',
  '07-jr,jp,call,ret,rst',
  '08-misc instrs',
  '09-op r,r',
  '10-bit ops',
  '11-op a,(hl)',
]

export const blarggCases: ConformanceCase[] = [
  ...BLARGG_CPU_INSTRS.map((name): ConformanceCase => ({
    kind: 'blargg-serial',
    rom: `blargg/cpu_instrs/${name}.gb`,
    maxFrames: 3_000,
  })),
  { kind: 'blargg-serial', rom: 'blargg/cpu_instrs.gb', maxFrames: 4_000 },
  { kind: 'blargg-serial', rom: 'blargg/instr_timing.gb', maxFrames: 600 },
]

export const acid2Cases: Record<'dmg' | 'cgb', ConformanceCase[]> = {
  dmg: [
    {
      kind: 'screen',
      rom: 'acid2/dmg-acid2.gb',
      reference: 'acid2/dmg-acid2.reference.png',
      frames: 10,
    },
  ],
  cgb: [
    {
      kind: 'screen',
      rom: 'acid2/cgb-acid2.gbc',
      reference: 'acid2/cgb-acid2.reference.png',
      frames: 10,
    },
    {
      kind: 'screen',
      rom: 'acid2/dmg-acid2.gb',
      reference: 'acid2/dmg-acid2.cgb-reference.png',
      frames: 10,
    },
  ],
}

/** Concrete hardware the cores emulate, used to pick Mooneye tests. */
const TARGETS: Partial<
  Record<SystemId, { model: string; revision: string; group: string }>
> = {
  dmg: { model: 'dmg', revision: 'B', group: 'G' },
  cgb: { model: 'cgb', revision: 'E', group: 'C' },
}

const MODEL_TOKEN = /(dmg|mgb|sgb2|sgb|cgb|agb|ags)([0A-E]*)/g

/**
 * Whether a Mooneye ROM is expected to pass on `system`, based on its name
 * suffix (e.g. `-GS`, `-dmgABCmgb`, `-cgb0`). No suffix means all models.
 * See https://github.com/Gekkio/mooneye-test-suite#test-naming
 */
export function mooneyeAppliesTo(rom: string, system: SystemId): boolean {
  const target = TARGETS[system]
  if (!target) return false
  const base = rom
    .split('/')
    .pop()!
    .replace(/\.gbc?$/, '')
  const dash = base.lastIndexOf('-')
  if (dash < 0) return true
  const suffix = base.slice(dash + 1)
  if (/^[GSCA]+$/.test(suffix)) return suffix.includes(target.group)
  if (suffix.replace(MODEL_TOKEN, '') !== '') return true // not a model suffix
  for (const [, model, revs] of suffix.matchAll(MODEL_TOKEN)) {
    if (
      model === target.model &&
      (revs === '' || revs.includes(target.revision))
    )
      return true
  }
  return false
}

/** Mooneye subdirectories whose ROMs report via the LD B,B breakpoint. */
export const MOONEYE_AUTO_DIRS = [
  'mooneye/acceptance',
  'mooneye/emulator-only',
  'mooneye/misc',
]

export function mooneyeCase(rom: string): ConformanceCase {
  return { kind: 'mooneye-breakpoint', rom, maxFrames: 1_200 }
}
