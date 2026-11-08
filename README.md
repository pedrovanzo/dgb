# dgb

A custom, web-first Game Boy Color / Game Boy Advance emulator — built to play on both PC and Android, with save games that sync between devices.

## Intent

- **Play anywhere:** one codebase that runs in the browser on desktop and Android, installable as a PWA (fullscreen, offline-capable).
- **Seamless save sync:** pick up a game on the phone right where it was left on the PC, and vice versa.
- **Learn by building:** understand emulation from the ground up (CPU, memory bus, PPU, timers, interrupts), developed iteratively with AI assistance.

## Planned stack

| Area | Choice |
| --- | --- |
| Core emulation | TypeScript (Rust + WebAssembly as a later option for GBA performance) |
| Graphics | HTML5 Canvas 2D / WebGL (160×144 GBC, 240×160 GBA) |
| Audio | Web Audio API (`AudioWorklet`) |
| Input | Gamepad API + touch overlay for mobile |
| Packaging | Progressive Web App |
| Local storage | IndexedDB (ROMs and save RAM) |
| Cloud sync | Lightweight backend (e.g. Supabase) storing save blobs keyed by user + game hash, newest timestamp wins |

## Roadmap

1. **Chip-8** — proof of concept to nail the fetch → decode → execute loop.
2. **Game Boy / Game Boy Color** — LR35902 CPU, memory map, PPU, timers, interrupts, audio.
3. **PWA + save sync** — installable app, IndexedDB persistence, cloud sync of `.sav` data.
4. **Game Boy Advance** — ARM7TDMI (ARM + Thumb), affine background modes, and the rest.

## Note

No ROMs or BIOS files are included or distributed. Use only game dumps you legally own.
