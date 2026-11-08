/**
 * Node-only helpers for headless tests: loading ROMs and reference images
 * from `test-roms/`, and dumping actual screens to `test-output/` on failure.
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PNG } from 'pngjs'
import type { Screen } from '../types.ts'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')

export const TEST_ROMS_DIR = join(repoRoot, 'test-roms')
export const TEST_OUTPUT_DIR = join(repoRoot, 'test-output')

/** Reads a file under `test-roms/` (path uses forward slashes). */
export function readTestRom(path: string): Uint8Array {
  return new Uint8Array(readFileSync(join(TEST_ROMS_DIR, path)))
}

/** Decodes a PNG under `test-roms/` into an RGBA screen. */
export function readReferenceScreen(path: string): Screen {
  const png = PNG.sync.read(readFileSync(join(TEST_ROMS_DIR, path)))
  return {
    width: png.width,
    height: png.height,
    pixels: new Uint8ClampedArray(png.data),
  }
}

/** Writes a screen as PNG under `test-output/` and returns the full path. */
export function writeScreenPng(name: string, screen: Screen): string {
  const png = new PNG({ width: screen.width, height: screen.height })
  png.data.set(screen.pixels)
  const path = join(TEST_OUTPUT_DIR, `${name}.png`)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, PNG.sync.write(png))
  return path
}

/** Lists `.gb`/`.gbc` files under a `test-roms/` subdirectory, recursively. */
export function listTestRoms(dir: string): string[] {
  const root = join(TEST_ROMS_DIR, dir)
  return readdirSync(root, { recursive: true, encoding: 'utf8' })
    .filter((f) => /\.gbc?$/.test(f))
    .map((f) => relative(TEST_ROMS_DIR, join(root, f)).replaceAll('\\', '/'))
    .sort()
}
