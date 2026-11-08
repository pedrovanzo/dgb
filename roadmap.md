# dgb Roadmap

Ordering principle: infrastructure first, then headless core, then browser, then PWA and cloud. Each phase ends in an objective check. Decisions behind this live in [CONTEXT.md](CONTEXT.md).

Status legend: `[ ]` todo, `[~]` in progress, `[x]` done.

## Phase 0 — Scaffold `[x]`

- Vite + React + TypeScript, Vitest, oxlint (Vite template default, replaces ESLint), Prettier, `.gitattributes` (LF line endings), Node 22 (`.nvmrc`).
- GitHub Actions: CI (lint, typecheck, test) on every push; deploy to GitHub Pages from `main`.
- **Why first:** deploy pipeline is easiest to debug while the app is trivial. Every later step is tested and shipped automatically.
- **Done when:** hello page live at `https://pedrovanzo.github.io/dgb/`, CI green.
- **Manual:** none (Pages enabled with source "GitHub Actions" via API).

## Phase 1 — Core contract and test harness `[ ]`

- `Core` interface (see CONTEXT.md).
- Commit public test ROMs to `test-roms/`.
- Headless runner: load ROM, run N frames, read serial output or framebuffer hash.
- **Why:** tests before code. Every following step has an objective pass/fail.

## Phase 2 — DMG CPU, bus, timers, interrupts `[ ]`

- All LR35902 opcodes including the CB prefix; ROM-only cartridge.
- **Done when:** Blargg `cpu_instrs` and `instr_timing` pass in Vitest.
- **Why before PPU:** everything runs on the CPU. Blargg reports over serial, so no screen is needed.

## Phase 3 — DMG PPU `[ ]`

- Background, window, sprites, LY/STAT, OAM DMA.
- **Done when:** `dmg-acid2` framebuffer hash matches reference, headless.

## Phase 4 — Browser runner (first milestone) `[ ]`

- Web Worker + `OffscreenCanvas`, ROM file picker, keyboard input, ~59.7 fps pacing.
- **Done when:** `dmg-acid2` renders correctly in the browser on PC.

## Phase 5 — Cartridges and battery saves `[ ]`

- MBC1, MBC3 (+ RTC), MBC5. Battery RAM persisted to IndexedDB. Relevant Mooneye tests.
- **Why here:** real games boot and save. Sync later depends on this.

## Phase 6 — APU (audio) `[ ]`

- 4 channels, `AudioWorklet` fed by a ring buffer.
- **Why late:** audio exposes timing bugs; easier once CPU and PPU are solid.

## Phase 7 — GBC `[ ]`

- Double speed, CGB palettes, VRAM/WRAM banking, HDMA.
- **Done when:** `cgb-acid2` passes.

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
