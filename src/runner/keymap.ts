import type { Button } from '../cores/types.ts'

/**
 * Default keyboard bindings, by `KeyboardEvent.code` so they follow physical
 * key positions on any layout (ABNT2, QWERTY, AZERTY...).
 */
export const DEFAULT_KEYMAP: Readonly<Record<string, Button>> = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
  KeyX: 'a',
  KeyZ: 'b',
  Enter: 'start',
  Backspace: 'select',
  ShiftRight: 'select',
}

/** Tracks held keys and reports the resulting button set. */
export class KeyboardInput {
  private readonly held = new Set<string>()
  private readonly keymap: Readonly<Record<string, Button>>

  constructor(keymap: Readonly<Record<string, Button>> = DEFAULT_KEYMAP) {
    this.keymap = keymap
  }

  /** True if `code` is bound (the caller should preventDefault). */
  handles(code: string): boolean {
    return code in this.keymap
  }

  /** Returns true if the button set changed. */
  press(code: string): boolean {
    if (!this.handles(code)) return false
    const before = this.signature()
    this.held.add(code)
    return this.signature() !== before
  }

  /** Returns true if the button set changed. */
  release(code: string): boolean {
    if (!this.held.delete(code)) return false
    return true
  }

  /** Release everything (window lost focus). Returns true if anything was held. */
  clear(): boolean {
    const any = this.held.size > 0
    this.held.clear()
    return any
  }

  buttons(): Button[] {
    const set = new Set<Button>()
    for (const code of this.held) set.add(this.keymap[code])
    return [...set]
  }

  private signature(): string {
    return this.buttons().sort().join()
  }
}
