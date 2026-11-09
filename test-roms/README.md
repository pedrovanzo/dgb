# test-roms

Freely redistributable homebrew test ROMs used for headless conformance tests. These are **not** commercial games. They were written specifically to test emulators.

| Folder     | Suite                                                                      | Author                     | License                                   | Pass signal                                          |
| ---------- | -------------------------------------------------------------------------- | -------------------------- | ----------------------------------------- | ---------------------------------------------------- |
| `blargg/`  | `cpu_instrs`, `instr_timing`, `dmg_sound`, `cgb_sound` (via [retrio/gb-test-roms](https://github.com/retrio/gb-test-roms)) | Shay Green (blargg) | Freely distributed by the author for emulator testing | Serial text `Passed` / `Failed`; `dmg_sound`/`cgb_sound`: status at `0xA000` after signature `DE B0 61` (0 = pass) |
| `acid2/`   | [dmg-acid2](https://github.com/mattcurrie/dmg-acid2) v1.0, [cgb-acid2](https://github.com/mattcurrie/cgb-acid2) v1.1 | Matt Currie | MIT (`LICENSE-*`)                         | Screen matches `*.reference.png`                     |
| `mooneye/` | [Mooneye Test Suite](https://github.com/Gekkio/mooneye-test-suite) build `mts-20260714-0944-31510e1` | Joonas Javanainen | MIT (`mooneye/LICENSE`)                   | At `LD B,B`: B C D E H L = `3 5 8 13 21 34` (pass), `0x42`×6 (fail) |

## Reference images

- `dmg-acid2.reference.png`: DMG output, greys `$00 $55 $AA $FF`.
- `dmg-acid2.cgb-reference.png`: CGB running dmg-acid2 in DMG mode; 5-bit to 8-bit color via `(c << 3) | (c >> 2)`.
- `cgb-acid2.reference.png`: CGB output.

## Mooneye name suffixes

A suffix names the hardware a test targets (`-GS`, `-dmgABC`, `-cgb`, ...). See `mooneyeAppliesTo` in `src/cores/testing/conformance.ts`. `manual-only/`, `madness/` and `utils/` are kept for completeness but are not run automatically.
