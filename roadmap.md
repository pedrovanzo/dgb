# dgb Roadmap

Ordering principle: infrastructure first, then headless core, then browser, then PWA and cloud. Each phase ends in an objective check. Decisions behind this live in [CONTEXT.md](CONTEXT.md).

Status legend: `[ ]` todo, `[~]` in progress, `[x]` done.

## Phase 0 — Scaffold `[x]`

- Vite + React + TypeScript, Vitest, oxlint (Vite template default, replaces ESLint), Prettier, `.gitattributes` (LF line endings), Node 22 (`.nvmrc`).
- GitHub Actions: CI (lint, typecheck, test) on every push; deploy to GitHub Pages from `main`.
- **Why first:** deploy pipeline is easiest to debug while the app is trivial. Every later step is tested and shipped automatically.
- **Done when:** hello page live at `https://pedrovanzo.github.io/dgb/`, CI green.
- **Manual:** none (Pages enabled with source "GitHub Actions" via API).

## Phase 1 — Core contract and test harness `[x]`

- `Core` interface (see CONTEXT.md).
- Commit public test ROMs to `test-roms/`.
- Headless runner: load ROM, run N frames, read serial output or framebuffer hash.
- **Why:** tests before code. Every following step has an objective pass/fail.
- **Delivered:** `src/cores/types.ts` (`Core`, `SerialDebug`), `src/cores/testing/` (harness, conformance catalog, Node helpers), Blargg/acid2/Mooneye ROMs in `test-roms/`.

## Phase 2 — DMG CPU, bus, timers, interrupts `[x]`

- All LR35902 opcodes including the CB prefix; ROM-only cartridge.
- **Done when:** Blargg `cpu_instrs` and `instr_timing` pass in Vitest.
- **Why before PPU:** everything runs on the CPU. Blargg reports over serial, so no screen is needed.
- **Delivered:** `src/cores/gb/` (CPU, bus, timer, serial, joypad, interrupts, timing-only PPU, ROM-only + MBC1 cartridges, `GameBoy` core). All 13 Blargg ROMs pass; 33 of 66 applicable Mooneye acceptance tests pass.
- **Notes:** MBC1 pulled forward because every Blargg ROM uses it. Each M-cycle performs the bus access first, then advances peripherals (needed by `timer/rapid_toggle`). Mooneye results are read at the `LD B,B` breakpoint, because on DMG its serial timeout is shorter than a real transfer. Remaining Mooneye failures are tracked in `MOONEYE_KNOWN_FAILURES` in `src/cores/gb/gameboy.test.ts`, tagged by phase (OAM DMA and PPU timing: Phase 3; APU register masks: Phase 6).

## Phase 3 — DMG PPU `[x]`

- Background, window, sprites, LY/STAT, OAM DMA.
- **Done when:** `dmg-acid2` framebuffer matches reference, headless.
- **Delivered:** scanline renderer (BG, window with line counter, 10-sprite limit, DMG sprite priority, 8x16), double-buffered screen, variable mode 3 length (SCX, window, Pan Docs sprite penalty), VRAM/OAM access blocking, LY early increment and line-153 quirk, OAM DMA with bus conflicts. `dmg-acid2` matches pixel-for-pixel; 60 of 66 applicable Mooneye acceptance tests pass.
- **Notes:** HALT wake-up adds no extra M-cycle. Deferred: `lcdon_timing-GS`, `lcdon_write_timing-GS`, `stat_lyc_onoff` (LCD-on edge cases, rarely relied on by games). `oam_dma/sources-GS` needs MBC5 (Phase 5).

## Phase 4 — Browser runner (first milestone) `[x]`

- Web Worker + `OffscreenCanvas`, ROM file picker, keyboard input, ~59.7 fps pacing.
- **Done when:** `dmg-acid2` renders correctly in the browser on PC.
- **Delivered:** `src/runner/`. The worker owns the core and the canvas. `FramePacer` holds 59.73 fps on 60/75/120/144 Hz displays. Keyboard is bound by physical key. Open ROM button or drag-and-drop, pause/reset, FPS readout, auto-pause on hidden tab. Verified in headless Chrome: `dmg-acid2` renders correctly at ~59 fps.

## Phase 5 — Cartridges and battery saves `[x]`

- MBC1, MBC3 (+ RTC), MBC5. Battery RAM persisted to IndexedDB. Relevant Mooneye tests.
- **Why here:** real games boot and save. Sync later depends on this.
- **Delivered:** MBC1 (+ MBC1M multicart), MBC2, MBC3 (+ RTC, MBC30 banks), MBC5 (+ rumble carts, no motor). Saves use the BGB/VBA-M `.sav` format: raw RAM, plus a 48-byte RTC footer on timer carts, so saves move to and from other emulators. The RTC follows emulated time while running and catches up with real time on load. `src/storage/saves.ts` stores saves in IndexedDB keyed by ROM SHA-1. The worker writes changed RAM every second and on pause or hidden tab. Each play session checkpoints the previous save into a 5-version history. The UI adds Import/Export `.sav` and a "saved" indicator. All 28 Mooneye MBC1/MBC2/MBC5 tests pass, plus `oam_dma/sources-GS`. MBC3/RTC is covered by unit tests (no Mooneye suite exists for it). A browser smoke test confirmed that a save survives a page reload.
- **Not supported:** MMM01, HuC1, HuC3, MBC6, MBC7, TAMA5, Pocket Camera. Each shows a named error.

## Phase 6 — APU (audio) `[x]`

- 4 channels, `AudioWorklet` fed by a ring buffer.
- **Why late:** audio exposes timing bugs; easier once CPU and PPU are solid.
- **Delivered:** `src/cores/gb/apu.ts` has 2 squares (one with sweep), wave and noise, a DIV-clocked frame sequencer (including the DIV-write edge), DMG power-off rules, wave RAM access while playing, retrigger corruption and post-boot register state. The mixer averages at 262 kHz, outputs 48 kHz stereo and applies a DC-blocking high-pass. All 12 Blargg `dmg_sound` tests pass. Mooneye `unused_hwio-GS` and `boot_hwio-dmgABCmgb` now pass too. The worker sends samples straight to an `AudioWorklet` over a `MessageChannel`, so `SharedArrayBuffer` is not needed (GitHub Pages can't send COOP/COEP headers). `AudioRing` prebuffers 60 ms and nudges the playback rate by up to ±0.5% to follow the clock drift between display and audio device. Volume slider, saved in `localStorage`. A headless Chrome smoke test measured a 440 Hz test tone at 439.5 Hz.
- **Notes:** the APU costs ~35% of emulation time (~1,100 fps headless on PC, ~19x realtime). Revisit in the performance pass if phones struggle. Blargg dmg_sound ROMs report through cartridge RAM at `0xA000`, read by `runUntilMemoryVerdict`.

## Phase 7 — GBC `[x]`

- Double speed, CGB palettes, VRAM/WRAM banking, HDMA.
- **Done when:** `cgb-acid2` passes.
- **Delivered:** `GameBoy({ model: 'cgb' })`. It adds VRAM (2) and WRAM (8) banking, BG attributes (bank, palette, flips, priority), 8+8 RGB555 palettes with auto-increment and the mode-3 lockout, CGB sprite priority (OAM order, LCDC.0 as master priority), and general-purpose plus HBlank HDMA with CPU stall. KEY1/STOP speed switching drives the PPU and APU at 2 T-cycles per M-cycle, with the frame sequencer on DIV bit 13. CGB boot registers are set (A = 0x11). APU: CGB wave RAM access and power-off rules. `createCore` runs color-capable ROMs (header 0x143 bit 7) on CGB and the rest on DMG.
- **Results:** `cgb-acid2` matches pixel-for-pixel (it needs 60 frames because it clears every bank with the LCD off first) and renders in Chrome. Blargg `cpu_instrs` and `instr_timing` pass on CGB. All 12 `cgb_sound` tests pass. Mooneye on CGB passes everything applicable except `stat_lyc_onoff` (the same deferred LCD-on case as DMG).
- **Deferred:** DMG compatibility mode, i.e. DMG games colorized by the CGB boot ROM (`dmg-acid2.cgb-reference.png`). DMG-only games stay on the DMG model. No color correction (raw RGB555 to RGB888); a display option can come later. The CGB post-boot DIV value is not calibrated (no Mooneye test covers it).

## Phase 8 — PWA and mobile `[ ]`

- Manifest, service worker, ROM library UI (SHA-1 keyed), touch overlay, Gamepad API, fullscreen.
- **Done when:** installed on Android, plays offline.

## Phase 9 — Supabase sync `[ ]`

- GitHub OAuth, RLS restricted to owner ID, saves table with last 5 versions, private ROM bucket, sync engine.
- **Done when:** save on PC, continue on phone.
- **Manual:** create Supabase project and GitHub OAuth app; redirect URL `https://pedrovanzo.github.io/dgb/`.

## Phase 10 — Save states `[ ]`

- Versioned `serialize`, then state sync.

## Phase 11 — GBA `[ ]`

- Spike first: minimal ARM7TDMI in TS, benchmark on the Android phone, then decide TS vs Rust/Wasm.
- Then BIOS replacement (HLE or open-source), PPU modes 0–5 including affine, DMA, timers, audio.

## Phase 12 — Maybe DS `[ ]`

## Optional reorder

To play cross-device sooner, move Phases 8–9 directly after Phase 5. Sync only needs battery saves. Cost: core work is split.
