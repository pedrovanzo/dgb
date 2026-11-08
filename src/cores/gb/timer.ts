import { INT_TIMER, type Interrupts } from './interrupts.ts'

/** Bit of the internal counter that clocks TIMA, indexed by TAC & 3. */
const TAC_BIT = [9, 3, 5, 7]

/**
 * DIV/TIMA/TMA/TAC, modelled on the 16-bit internal counter. TIMA increments
 * on a falling edge of (selected counter bit AND timer enable), which also
 * reproduces the DIV-write and TAC-write glitches.
 */
export class Timer {
  /** 16-bit internal counter; DIV is its upper byte. */
  counter = 0
  tima = 0
  tma = 0
  tac = 0
  /** TIMA overflowed last M-cycle; reload with TMA this M-cycle. */
  private overflow = false
  /** TMA was copied into TIMA during the current M-cycle. */
  private reloading = false
  private readonly irq: Interrupts

  constructor(irq: Interrupts) {
    this.irq = irq
  }

  /** Advance one M-cycle (4 T-cycles). */
  tick(): void {
    this.reloading = false
    if (this.overflow) {
      this.overflow = false
      this.tima = this.tma
      this.irq.request(INT_TIMER)
      this.reloading = true
    }
    const before = this.signal()
    this.counter = (this.counter + 4) & 0xffff
    if (before && !this.signal()) this.increment()
  }

  readDiv(): number {
    return this.counter >> 8
  }

  writeDiv(): void {
    const before = this.signal()
    this.counter = 0
    if (before) this.increment()
  }

  writeTima(value: number): void {
    if (this.reloading) return // write ignored during the reload cycle
    this.overflow = false // write during the delay cycle cancels the reload
    this.tima = value
  }

  writeTma(value: number): void {
    this.tma = value
    if (this.reloading) this.tima = value
  }

  readTac(): number {
    return this.tac | 0xf8
  }

  writeTac(value: number): void {
    const before = this.signal()
    this.tac = value & 0x07
    if (before && !this.signal()) this.increment()
  }

  private signal(): boolean {
    return (
      (this.tac & 4) !== 0 &&
      ((this.counter >> TAC_BIT[this.tac & 3]) & 1) === 1
    )
  }

  private increment(): void {
    this.tima = (this.tima + 1) & 0xff
    if (this.tima === 0) this.overflow = true
  }
}
