# dgb

A custom, web-first Game Boy Color / Game Boy Advance emulator — built to play on both PC and Android, with save games that sync between devices.

## Intent

- **Play anywhere:** one codebase that runs in the browser on desktop and Android, installable as a PWA (fullscreen, offline-capable).
- **Seamless save sync:** pick up a game on the phone right where it was left on the PC, and vice versa.
- **Learn by building:** understand emulation from the ground up (CPU, memory bus, PPU, timers, interrupts), developed iteratively with AI assistance.

## Planned stack

| Area           | Choice                                                                                                  |
| -------------- | ------------------------------------------------------------------------------------------------------- |
| Core emulation | TypeScript (Rust + WebAssembly as a later option for GBA performance)                                   |
| Graphics       | HTML5 Canvas 2D / WebGL (160×144 GBC, 240×160 GBA)                                                      |
| Audio          | Web Audio API (`AudioWorklet`)                                                                          |
| Input          | Gamepad API + touch overlay for mobile                                                                  |
| Packaging      | Progressive Web App                                                                                     |
| Local storage  | IndexedDB (ROMs and save RAM)                                                                           |
| Cloud sync     | Lightweight backend (e.g. Supabase) storing save blobs keyed by user + game hash, newest timestamp wins |

## Roadmap

1. **Game Boy (DMG)** — LR35902 CPU, memory map, PPU, timers, interrupts. First milestone: Blargg `cpu_instrs` passes and `dmg-acid2` renders correctly.
2. **Game Boy Color** — double speed, color palettes, banking, then audio.
3. **PWA + save sync** — installable app, IndexedDB persistence, GitHub-login-protected cloud sync via Supabase.
4. **Game Boy Advance** — ARM7TDMI (ARM + Thumb), affine background modes, and the rest.
5. **Maybe Nintendo DS** — the core interface is kept multi-screen and touch-ready for it.

See [CONTEXT.md](CONTEXT.md) for the full set of design decisions.

## Disclaimer

- dgb is a **personal, non-commercial hobby project**, built for the author's own use. It is not a product or service, and no support is offered.
- **No ROMs, BIOS files, or other copyrighted game content** are included, hosted, or linked. Use only game dumps you legally own from cartridges you own.
- dgb is not affiliated with, endorsed by, or sponsored by Nintendo. "Game Boy", "Game Boy Color", "Game Boy Advance", and "Nintendo DS" are trademarks of Nintendo, used here only to describe compatibility.
- The software is provided "as is", without warranty of any kind. See [LICENSE](LICENSE).

## License

[GPL-3.0](LICENSE)
