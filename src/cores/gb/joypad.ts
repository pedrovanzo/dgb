import type { Button } from '../types.ts'
import { INT_JOYPAD, type Interrupts } from './interrupts.ts'

/** Bit positions in the low nibble (active low). */
const DPAD: Partial<Record<Button, number>> = {
  right: 0,
  left: 1,
  up: 2,
  down: 3,
}
const ACTION: Partial<Record<Button, number>> = {
  a: 0,
  b: 1,
  select: 2,
  start: 3,
}

export class Joypad {
  /** P1 select bits (4 = d-pad, 5 = buttons), active low. */
  private select = 0x30
  private dpad = 0x0f
  private action = 0x0f
  private readonly irq: Interrupts

  constructor(irq: Interrupts) {
    this.irq = irq
  }

  read(): number {
    let low = 0x0f
    if ((this.select & 0x10) === 0) low &= this.dpad
    if ((this.select & 0x20) === 0) low &= this.action
    return 0xc0 | this.select | low
  }

  write(value: number): void {
    this.select = value & 0x30
  }

  setButtons(buttons: ReadonlySet<Button>): void {
    const before = this.read() & 0x0f
    this.dpad = mask(buttons, DPAD)
    this.action = mask(buttons, ACTION)
    // Interrupt on any selected line going from high to low.
    if (before & ~this.read() & 0x0f) this.irq.request(INT_JOYPAD)
  }
}

function mask(
  buttons: ReadonlySet<Button>,
  bits: Partial<Record<Button, number>>,
): number {
  let m = 0x0f
  for (const b of buttons) {
    const bit = bits[b]
    if (bit !== undefined) m &= ~(1 << bit)
  }
  return m
}
