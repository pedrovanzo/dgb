/**
 * MBC3 real-time clock. Advances with emulated time while running (so tests
 * are deterministic) and catches up with wall-clock time when a save is
 * loaded, using the timestamp stored in the save footer.
 */

/** Bytes appended to battery RAM in the common BGB/VBA-M `.sav` format. */
export const RTC_FOOTER_BYTES = 48
/** Older variant with a 32-bit timestamp. */
const RTC_FOOTER_BYTES_SHORT = 44

const CLOCK_HZ = 4_194_304
const DAYS = 512

export interface RtcClock {
  /** Emulated T-cycles since power-on. */
  cycles(): number
  /** Wall-clock time in milliseconds since the Unix epoch. */
  now(): number
}

export class Rtc {
  private s = 0
  private m = 0
  private h = 0
  private days = 0
  private halt = false
  private carry = false
  private readonly latched = new Uint8Array(5)
  /** T-cycles accumulated toward the next second. */
  private sub = 0
  private lastCycles: number
  private readonly clock: RtcClock

  constructor(clock: RtcClock) {
    this.clock = clock
    this.lastCycles = clock.cycles()
  }

  /** Reads a latched register (0x08-0x0C). */
  read(reg: number): number {
    const v = this.latched[reg - 0x08]
    return reg === 0x0c ? v | 0x3e : v
  }

  write(reg: number, value: number): void {
    this.sync()
    switch (reg) {
      case 0x08:
        this.s = value & 0x3f
        this.sub = 0
        break
      case 0x09:
        this.m = value & 0x3f
        break
      case 0x0a:
        this.h = value & 0x1f
        break
      case 0x0b:
        this.days = (this.days & 0x100) | value
        break
      case 0x0c:
        this.days = (this.days & 0xff) | ((value & 1) << 8)
        this.halt = (value & 0x40) !== 0
        this.carry = (value & 0x80) !== 0
        break
    }
  }

  /** Copies the live counters into the readable registers. */
  latch(): void {
    this.sync()
    this.latched.set(this.live())
  }

  /** Applies elapsed emulated time. */
  sync(): void {
    const now = this.clock.cycles()
    const delta = now - this.lastCycles
    this.lastCycles = now
    if (this.halt || delta <= 0) return
    this.sub += delta
    if (this.sub >= CLOCK_HZ) {
      const seconds = Math.floor(this.sub / CLOCK_HZ)
      this.sub -= seconds * CLOCK_HZ
      this.advance(seconds)
    }
  }

  advance(seconds: number): void {
    // Out-of-range values tick up to the 6/5-bit wrap without carrying.
    while (seconds > 0 && (this.s >= 60 || this.m >= 60 || this.h >= 24)) {
      this.step()
      seconds--
    }
    if (seconds <= 0) return
    let total =
      this.days * 86_400 + this.h * 3_600 + this.m * 60 + this.s + seconds
    let days = Math.floor(total / 86_400)
    total -= days * 86_400
    if (days >= DAYS) {
      this.carry = true
      days %= DAYS
    }
    this.days = days
    this.h = Math.floor(total / 3_600)
    this.m = Math.floor((total % 3_600) / 60)
    this.s = total % 60
  }

  private step(): void {
    this.s = (this.s + 1) & 0x3f
    if (this.s !== 60) return
    this.s = 0
    this.m = (this.m + 1) & 0x3f
    if (this.m !== 60) return
    this.m = 0
    this.h = (this.h + 1) & 0x1f
    if (this.h !== 24) return
    this.h = 0
    if (++this.days === DAYS) {
      this.days = 0
      this.carry = true
    }
  }

  private live(): number[] {
    return [
      this.s,
      this.m,
      this.h,
      this.days & 0xff,
      ((this.days >> 8) & 1) | (this.halt ? 0x40 : 0) | (this.carry ? 0x80 : 0),
    ]
  }

  /** Serializes to the 48-byte footer, stamped with the current wall clock. */
  toFooter(): Uint8Array {
    this.sync()
    const out = new Uint8Array(RTC_FOOTER_BYTES)
    const view = new DataView(out.buffer)
    this.live().forEach((v, i) => view.setUint32(i * 4, v, true))
    this.latched.forEach((v, i) => view.setUint32(20 + i * 4, v, true))
    const seconds = Math.floor(this.clock.now() / 1000)
    view.setUint32(40, seconds % 0x1_0000_0000, true)
    view.setUint32(44, Math.floor(seconds / 0x1_0000_0000), true)
    return out
  }

  /** Restores from a footer and catches up with the time spent closed. */
  fromFooter(footer: Uint8Array): void {
    const view = new DataView(
      footer.buffer,
      footer.byteOffset,
      footer.byteLength,
    )
    const reg = (i: number) => view.getUint32(i * 4, true) & 0xff
    this.s = reg(0) & 0x3f
    this.m = reg(1) & 0x3f
    this.h = reg(2) & 0x1f
    this.days = reg(3) | ((reg(4) & 1) << 8)
    this.halt = (reg(4) & 0x40) !== 0
    this.carry = (reg(4) & 0x80) !== 0
    for (let i = 0; i < 5; i++) this.latched[i] = reg(5 + i)
    let saved = view.getUint32(40, true)
    if (footer.byteLength >= RTC_FOOTER_BYTES)
      saved += view.getUint32(44, true) * 0x1_0000_0000
    this.sub = 0
    this.lastCycles = this.clock.cycles()
    const elapsed = Math.floor(this.clock.now() / 1000) - saved
    if (!this.halt && elapsed > 0) this.advance(elapsed)
  }

  static isFooterSize(bytes: number): boolean {
    return bytes === RTC_FOOTER_BYTES || bytes === RTC_FOOTER_BYTES_SHORT
  }
}
