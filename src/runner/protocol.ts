import type { Button, SystemId } from '../cores/types.ts'

/** Messages from the UI thread to the emulator worker. */
export type ToWorker =
  | { type: 'init'; canvas: OffscreenCanvas }
  | { type: 'load'; rom: ArrayBuffer }
  | { type: 'input'; buttons: Button[] }
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'reset' }

/** Messages from the emulator worker to the UI thread. */
export type FromWorker =
  | { type: 'loaded'; title: string; system: SystemId; warning?: string }
  | { type: 'error'; message: string }
  | { type: 'stats'; fps: number }
