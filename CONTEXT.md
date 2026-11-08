# dgb — Project Context

Baseline decisions from the initial design session (2026-11-08). Expect refinement during build; update this file when a decision changes.

## Audience and access

- **Personal use only.** Single user (the repo owner). The repo is public; the hosted app is not meant for others.
- The emulator itself runs fully client-side on user-loaded ROMs, so the app shell is not locked.
- **Cloud sync is locked** via GitHub OAuth (Supabase Auth). Sign-ups disabled; Row Level Security allows only the owner's user ID. One login per device, long-lived session. Passkeys may be added later.

## Sync

| Data                            | When  | Rules                                                                                |
| ------------------------------- | ----- | ------------------------------------------------------------------------------------ |
| Battery saves (`.sav`, ≤128 KB) | v1    | Newest timestamp wins; keep last 5 versions for rollback                             |
| Save states                     | Later | Tagged with core version; incompatible versions ignored                              |
| ROMs                            | v1    | Private Supabase Storage bucket, owner-only; deduped by SHA-1; never publicly served |

Local first: ROMs and saves live in IndexedDB; the app works offline and syncs when online.

## Architecture

- **App shell:** Vite + React + TypeScript, `vite-plugin-pwa` (installable, offline).
- **Cores:** run in a Web Worker; render to `<canvas>` via `OffscreenCanvas` (React stays out of the frame loop).
- **Core interface** (shared by every system):
  - `loadRom`, `runFrame`, `getFramebuffers()` (array of screens; 1 for GB/GBA, ready for 2 on DS), `getAudio`, `setInput` (buttons + pointer/touch), `getSaveRam` / `setSaveRam`, `serialize`.
- **Languages:** GB/GBC core in TypeScript. GBA core language (TS vs Rust → Wasm) decided later from measured performance on the owner's Android phone.
- **Layout:** single Vite package. `src/cores/` must never import React or DOM APIs, so cores test headless in Node.

## Systems roadmap

1. **DMG** (original Game Boy): LR35902 CPU, memory bus, PPU, timers, interrupts.
2. **GBC** additions: double speed, color palettes, VRAM/WRAM banking. Then APU (audio).
3. **PWA + sync** (Supabase).
4. **GBA**: ARM7TDMI (ARM + Thumb), affine modes, etc.
5. **Maybe DS**: needs multi-screen + touch (already in interface); likely a Rust/Wasm core or a melonDS (GPL) port.

No Chip-8 detour.

## Testing

- Public test ROMs committed under `test-roms/`: Blargg `cpu_instrs`, `instr_timing`; `dmg-acid2`, `cgb-acid2`; Mooneye suite.
- Vitest, headless: run N frames, compare serial output or framebuffer hash against expected.
- CI on every push (GitHub Actions).
- **First milestone:** `cpu_instrs` passes and `dmg-acid2` renders correctly in the browser.

## Hosting

- GitHub Pages via GitHub Actions, base path `/dgb/`, `HashRouter`.
- OAuth redirect: `https://pedrovanzo.github.io/dgb/`.

## Legal guardrails

- License: **GPL-3.0** (keeps melonDS port path open).
- Never commit, host, or link ROMs or BIOS files. Only the private bucket holds the owner's own dumps.
- GBA BIOS: high-level emulation (HLE) or an open-source replacement BIOS; never ship Nintendo's.
- No Nintendo logos or trademarks in product branding. "GBC/GBA compatible" wording only.
