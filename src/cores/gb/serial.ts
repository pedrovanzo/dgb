import { INT_SERIAL, type Interrupts } from './interrupts.ts'

/** Internal-counter bit whose falling edge clocks one bit (8192 Hz). */
const CLOCK_BIT = 0x100

/**
 * Link port with nothing connected. Bytes sent with the internal clock are
 * captured for tests; the received byte is always 0xFF.
 */
export class Serial {
  sb = 0x00
  sc = 0x7e
  /** Bits left in the current transfer (0 = idle). */
  private bitsLeft = 0
  private sent: number[] = []
  private readonly irq: Interrupts

  constructor(irq: Interrupts) {
    this.irq = irq
  }

  /**
   * Advance one M-cycle. The internal clock is derived from the same 16-bit
   * counter as DIV, so transfers stay aligned with it.
   */
  tick(before: number, after: number): void {
    if (this.bitsLeft === 0) return
    if ((before & CLOCK_BIT) === 0 || (after & CLOCK_BIT) !== 0) return
    this.sb = ((this.sb << 1) | 1) & 0xff // nothing connected: shifts in 1s
    if (--this.bitsLeft > 0) return
    this.sc &= 0x7f
    this.irq.request(INT_SERIAL)
  }

  readSc(): number {
    return this.sc | 0x7e
  }

  writeSc(value: number): void {
    this.sc = value
    if ((value & 0x81) === 0x81) {
      this.sent.push(this.sb)
      this.bitsLeft = 8
    }
  }

  drain(): Uint8Array {
    const out = Uint8Array.from(this.sent)
    this.sent = []
    return out
  }
}
