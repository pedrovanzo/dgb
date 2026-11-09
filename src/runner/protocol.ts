import type { Button, SystemId } from '../cores/types.ts'

/** Messages from the UI thread to the emulator worker. */
export type ToWorker =
  | { type: 'init'; canvas: OffscreenCanvas }
  | { type: 'load'; rom: ArrayBuffer }
  | { type: 'input'; buttons: Button[] }
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'reset' }
  /** Replace battery data (imported `.sav`) and reset the game. */
  | { type: 'import-save'; data: ArrayBuffer }
  | { type: 'export-save' }

/** Messages from the emulator worker to the UI thread. */
export type FromWorker =
  | {
      type: 'loaded'
      title: string
      system: SystemId
      /** Cartridge has battery-backed data. */
      battery: boolean
      /** A stored save was restored. */
      restored: boolean
      warning?: string
    }
  | { type: 'error'; message: string }
  | { type: 'stats'; fps: number }
  /** Battery data written to IndexedDB. */
  | { type: 'saved'; at: number }
  | { type: 'save-data'; title: string; data: ArrayBuffer }
