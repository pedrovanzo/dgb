/** Interrupt request bits, shared by IF (0xFF0F) and IE (0xFFFF). */
export const INT_VBLANK = 0x01
export const INT_STAT = 0x02
export const INT_TIMER = 0x04
export const INT_SERIAL = 0x08
export const INT_JOYPAD = 0x10

export class Interrupts {
  /** IE register (0xFFFF), all 8 bits are readable/writable. */
  enable = 0x00
  /** IF register (0xFF0F), only the low 5 bits exist. */
  flags = 0x01

  request(mask: number): void {
    this.flags |= mask
  }

  /** Requested and enabled interrupts. */
  pending(): number {
    return this.enable & this.flags & 0x1f
  }

  readFlags(): number {
    return this.flags | 0xe0
  }

  writeFlags(value: number): void {
    this.flags = value & 0x1f
  }
}
