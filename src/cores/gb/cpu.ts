import type { Bus } from './bus.ts'

const FZ = 0x80
const FN = 0x40
const FH = 0x20
const FC = 0x10

/**
 * Sharp LR35902 (SM83) interpreter. Every memory access and internal delay
 * advances the bus by one M-cycle, so peripherals observe accesses at the
 * right time within an instruction.
 *
 * Register indices follow the opcode encoding:
 * 0 B, 1 C, 2 D, 3 E, 4 H, 5 L, 6 (HL), 7 A.
 */
export class Cpu {
  // Post-boot-ROM state of a DMG.
  a = 0x01
  f = 0xb0
  b = 0x00
  c = 0x13
  d = 0x00
  e = 0xd8
  h = 0x01
  l = 0x4d
  sp = 0xfffe
  pc = 0x0100

  ime = false
  /** Steps left until EI takes effect (EI enables after the next instruction). */
  private eiDelay = 0
  halted = false
  private haltBug = false
  /** Set by an illegal opcode; the CPU stops until reset. */
  locked = false
  /** Called on `LD B,B`, the conventional software breakpoint. */
  onBreakpoint: (() => void) | null = null

  private readonly bus: Bus

  constructor(bus: Bus) {
    this.bus = bus
  }

  /** Execute one instruction, interrupt dispatch, or halted M-cycle. */
  step(): void {
    const bus = this.bus
    if (this.locked) {
      bus.tick()
      return
    }
    if (this.eiDelay > 0 && --this.eiDelay === 0) this.ime = true

    if (this.halted) {
      if (bus.interrupts.pending() === 0) {
        bus.tick()
        return
      }
      // Wake-up costs no extra cycle; IME=1 then dispatches normally.
      this.halted = false
    }

    if (this.ime && bus.interrupts.pending() !== 0) {
      this.dispatchInterrupt()
      return
    }

    const op = this.read(this.pc)
    if (this.haltBug) this.haltBug = false
    else this.pc = (this.pc + 1) & 0xffff
    this.execute(op)
  }

  // --- Bus access (each costs one M-cycle) ---

  private read(addr: number): number {
    const v = this.bus.read(addr)
    this.bus.tick()
    return v
  }

  private write(addr: number, value: number): void {
    this.bus.write(addr, value & 0xff)
    this.bus.tick()
  }

  private idle(): void {
    this.bus.tick()
  }

  private imm8(): number {
    const v = this.read(this.pc)
    this.pc = (this.pc + 1) & 0xffff
    return v
  }

  private imm16(): number {
    const lo = this.imm8()
    return lo | (this.imm8() << 8)
  }

  private push(value: number): void {
    this.sp = (this.sp - 1) & 0xffff
    this.write(this.sp, value >> 8)
    this.sp = (this.sp - 1) & 0xffff
    this.write(this.sp, value & 0xff)
  }

  private pop(): number {
    const lo = this.read(this.sp)
    this.sp = (this.sp + 1) & 0xffff
    const hi = this.read(this.sp)
    this.sp = (this.sp + 1) & 0xffff
    return lo | (hi << 8)
  }

  // --- Interrupts ---

  private dispatchInterrupt(): void {
    const irq = this.bus.interrupts
    this.ime = false
    this.idle()
    this.idle()
    this.sp = (this.sp - 1) & 0xffff
    this.write(this.sp, this.pc >> 8)
    // The vector is chosen after the high byte is pushed; that push can land
    // on IE (0xFFFF) and cancel the interrupt, which jumps to 0x0000.
    const pending = irq.pending()
    this.sp = (this.sp - 1) & 0xffff
    this.write(this.sp, this.pc & 0xff)
    if (pending === 0) {
      this.pc = 0x0000
    } else {
      const bit = pending & -pending
      irq.flags &= ~bit
      this.pc = 0x40 + 8 * (31 - Math.clz32(bit))
    }
    this.idle()
  }

  // --- Register helpers ---

  private get hl(): number {
    return (this.h << 8) | this.l
  }

  private set hl(v: number) {
    this.h = (v >> 8) & 0xff
    this.l = v & 0xff
  }

  private getR(i: number): number {
    switch (i) {
      case 0:
        return this.b
      case 1:
        return this.c
      case 2:
        return this.d
      case 3:
        return this.e
      case 4:
        return this.h
      case 5:
        return this.l
      case 6:
        return this.read(this.hl)
      default:
        return this.a
    }
  }

  private setR(i: number, v: number): void {
    switch (i) {
      case 0:
        this.b = v
        return
      case 1:
        this.c = v
        return
      case 2:
        this.d = v
        return
      case 3:
        this.e = v
        return
      case 4:
        this.h = v
        return
      case 5:
        this.l = v
        return
      case 6:
        this.write(this.hl, v)
        return
      default:
        this.a = v
    }
  }

  /** 16-bit pairs for LD/INC/DEC/ADD: 0 BC, 1 DE, 2 HL, 3 SP. */
  private getRp(p: number): number {
    switch (p) {
      case 0:
        return (this.b << 8) | this.c
      case 1:
        return (this.d << 8) | this.e
      case 2:
        return this.hl
      default:
        return this.sp
    }
  }

  private setRp(p: number, v: number): void {
    v &= 0xffff
    switch (p) {
      case 0:
        this.b = v >> 8
        this.c = v & 0xff
        return
      case 1:
        this.d = v >> 8
        this.e = v & 0xff
        return
      case 2:
        this.hl = v
        return
      default:
        this.sp = v
    }
  }

  /** 16-bit pairs for PUSH/POP: 0 BC, 1 DE, 2 HL, 3 AF. */
  private getRp2(p: number): number {
    return p === 3 ? (this.a << 8) | this.f : this.getRp(p)
  }

  private setRp2(p: number, v: number): void {
    if (p === 3) {
      this.a = v >> 8
      this.f = v & 0xf0
    } else this.setRp(p, v)
  }

  /** Condition codes: 0 NZ, 1 Z, 2 NC, 3 C. */
  private cond(y: number): boolean {
    switch (y & 3) {
      case 0:
        return (this.f & FZ) === 0
      case 1:
        return (this.f & FZ) !== 0
      case 2:
        return (this.f & FC) === 0
      default:
        return (this.f & FC) !== 0
    }
  }

  // --- ALU ---

  /** 0 ADD, 1 ADC, 2 SUB, 3 SBC, 4 AND, 5 XOR, 6 OR, 7 CP. */
  private alu(op: number, v: number): void {
    const a = this.a
    const carry = (this.f >> 4) & 1
    let r: number
    switch (op) {
      case 0:
      case 1: {
        const cy = op === 1 ? carry : 0
        r = a + v + cy
        this.f =
          ((r & 0xff) === 0 ? FZ : 0) |
          ((a & 0xf) + (v & 0xf) + cy > 0xf ? FH : 0) |
          (r > 0xff ? FC : 0)
        this.a = r & 0xff
        return
      }
      case 2:
      case 3:
      case 7: {
        const cy = op === 3 ? carry : 0
        r = a - v - cy
        this.f =
          FN |
          ((r & 0xff) === 0 ? FZ : 0) |
          ((a & 0xf) - (v & 0xf) - cy < 0 ? FH : 0) |
          (r < 0 ? FC : 0)
        if (op !== 7) this.a = r & 0xff
        return
      }
      case 4:
        this.a = a & v
        this.f = (this.a === 0 ? FZ : 0) | FH
        return
      case 5:
        this.a = a ^ v
        this.f = this.a === 0 ? FZ : 0
        return
      default:
        this.a = a | v
        this.f = this.a === 0 ? FZ : 0
    }
  }

  private inc8(v: number): number {
    const r = (v + 1) & 0xff
    this.f = (this.f & FC) | (r === 0 ? FZ : 0) | ((v & 0xf) === 0xf ? FH : 0)
    return r
  }

  private dec8(v: number): number {
    const r = (v - 1) & 0xff
    this.f =
      (this.f & FC) | FN | (r === 0 ? FZ : 0) | ((v & 0xf) === 0 ? FH : 0)
    return r
  }

  /** SP + signed imm8, with flags from the unsigned low-byte addition. */
  private spPlusImm(): number {
    const e = this.imm8()
    const sp = this.sp
    this.f =
      ((sp & 0xf) + (e & 0xf) > 0xf ? FH : 0) |
      ((sp & 0xff) + e > 0xff ? FC : 0)
    return (sp + ((e << 24) >> 24)) & 0xffff
  }

  private daa(): void {
    let a = this.a
    let carry = (this.f & FC) !== 0
    if ((this.f & FN) === 0) {
      if (carry || a > 0x99) {
        a += 0x60
        carry = true
      }
      if ((this.f & FH) !== 0 || (a & 0xf) > 9) a += 0x06
    } else {
      if (carry) a -= 0x60
      if ((this.f & FH) !== 0) a -= 0x06
    }
    a &= 0xff
    this.a = a
    this.f = (a === 0 ? FZ : 0) | (this.f & FN) | (carry ? FC : 0)
  }

  /** CB-prefixed rotates/shifts: 0 RLC, 1 RRC, 2 RL, 3 RR, 4 SLA, 5 SRA, 6 SWAP, 7 SRL. */
  private rot(op: number, v: number): number {
    let r: number
    let c: number
    switch (op) {
      case 0:
        c = v >> 7
        r = ((v << 1) | c) & 0xff
        break
      case 1:
        c = v & 1
        r = (v >> 1) | (c << 7)
        break
      case 2:
        c = v >> 7
        r = ((v << 1) | ((this.f >> 4) & 1)) & 0xff
        break
      case 3:
        c = v & 1
        r = (v >> 1) | ((this.f & FC) << 3)
        break
      case 4:
        c = v >> 7
        r = (v << 1) & 0xff
        break
      case 5:
        c = v & 1
        r = (v >> 1) | (v & 0x80)
        break
      case 6:
        c = 0
        r = ((v << 4) | (v >> 4)) & 0xff
        break
      default:
        c = v & 1
        r = v >> 1
    }
    this.f = (r === 0 ? FZ : 0) | (c ? FC : 0)
    return r
  }

  private executeCb(): void {
    const op = this.imm8()
    const x = op >> 6
    const y = (op >> 3) & 7
    const z = op & 7
    const v = this.getR(z)
    switch (x) {
      case 0:
        this.setR(z, this.rot(y, v))
        return
      case 1:
        this.f = (this.f & FC) | FH | ((v >> y) & 1 ? 0 : FZ)
        return
      case 2:
        this.setR(z, v & ~(1 << y))
        return
      default:
        this.setR(z, v | (1 << y))
    }
  }

  // --- Decode / execute ---

  private execute(op: number): void {
    // 0x40-0x7F: LD r, r' (0x76 is HALT)
    if (op >= 0x40 && op < 0x80) {
      if (op === 0x76) this.halt()
      else if (op === 0x40) this.onBreakpoint?.()
      else this.setR((op >> 3) & 7, this.getR(op & 7))
      return
    }
    // 0x80-0xBF: ALU A, r
    if (op >= 0x80 && op < 0xc0) {
      this.alu((op >> 3) & 7, this.getR(op & 7))
      return
    }

    const y = (op >> 3) & 7
    const z = op & 7
    const p = y >> 1
    const q = y & 1

    if (op < 0x40) {
      switch (z) {
        case 0:
          return this.misc0(y)
        case 1:
          if (q === 0) this.setRp(p, this.imm16())
          else {
            const hl = this.hl
            const rp = this.getRp(p)
            const r = hl + rp
            this.f =
              (this.f & FZ) |
              ((hl & 0xfff) + (rp & 0xfff) > 0xfff ? FH : 0) |
              (r > 0xffff ? FC : 0)
            this.hl = r & 0xffff
            this.idle()
          }
          return
        case 2:
          return this.indirectLoad(p, q)
        case 3:
          this.setRp(p, this.getRp(p) + (q === 0 ? 1 : -1))
          this.idle()
          return
        case 4:
          this.setR(y, this.inc8(this.getR(y)))
          return
        case 5:
          this.setR(y, this.dec8(this.getR(y)))
          return
        case 6:
          this.setR(y, this.imm8())
          return
        default:
          return this.accumulatorOp(y)
      }
    }

    // 0xC0-0xFF
    switch (z) {
      case 0:
        switch (y) {
          case 4:
            this.write(0xff00 | this.imm8(), this.a)
            return
          case 5:
            this.sp = this.spPlusImm()
            this.idle()
            this.idle()
            return
          case 6:
            this.a = this.read(0xff00 | this.imm8())
            return
          case 7:
            this.hl = this.spPlusImm()
            this.idle()
            return
          default:
            this.idle()
            if (this.cond(y)) {
              this.pc = this.pop()
              this.idle()
            }
            return
        }
      case 1:
        if (q === 0) {
          this.setRp2(p, this.pop())
          return
        }
        switch (p) {
          case 0:
            this.pc = this.pop()
            this.idle()
            return
          case 1:
            this.pc = this.pop()
            this.idle()
            this.ime = true
            return
          case 2:
            this.pc = this.hl
            return
          default:
            this.sp = this.hl
            this.idle()
            return
        }
      case 2:
        switch (y) {
          case 4:
            this.write(0xff00 | this.c, this.a)
            return
          case 5:
            this.write(this.imm16(), this.a)
            return
          case 6:
            this.a = this.read(0xff00 | this.c)
            return
          case 7:
            this.a = this.read(this.imm16())
            return
          default: {
            const addr = this.imm16()
            if (this.cond(y)) {
              this.idle()
              this.pc = addr
            }
            return
          }
        }
      case 3:
        switch (y) {
          case 0: {
            const addr = this.imm16()
            this.idle()
            this.pc = addr
            return
          }
          case 1:
            return this.executeCb()
          case 6:
            this.ime = false
            this.eiDelay = 0
            return
          case 7:
            if (!this.ime && this.eiDelay === 0) this.eiDelay = 2
            return
          default:
            return this.lock()
        }
      case 4: {
        if (y > 3) return this.lock()
        const addr = this.imm16()
        if (this.cond(y)) this.call(addr)
        return
      }
      case 5:
        if (q === 0) {
          const v = this.getRp2(p)
          this.idle()
          this.push(v)
          return
        }
        if (p !== 0) return this.lock()
        this.call(this.imm16())
        return
      case 6:
        this.alu(y, this.imm8())
        return
      default:
        this.call(y * 8)
    }
  }

  private call(addr: number): void {
    this.idle()
    this.push(this.pc)
    this.pc = addr
  }

  /** 0x00-0x38 step 8: NOP, LD (nn),SP, STOP, JR, JR cc. */
  private misc0(y: number): void {
    switch (y) {
      case 0:
        return
      case 1: {
        const addr = this.imm16()
        this.write(addr, this.sp & 0xff)
        this.write((addr + 1) & 0xffff, this.sp >> 8)
        return
      }
      case 2:
        // STOP: consumes its padding byte. Low-power mode and CGB speed
        // switching arrive with Phase 7.
        this.imm8()
        return
      default: {
        const e = (this.imm8() << 24) >> 24
        if (y === 3 || this.cond(y - 4)) {
          this.idle()
          this.pc = (this.pc + e) & 0xffff
        }
      }
    }
  }

  /** LD (BC/DE/HL+/HL-),A and LD A,(BC/DE/HL+/HL-). */
  private indirectLoad(p: number, q: number): void {
    let addr: number
    if (p === 0) addr = (this.b << 8) | this.c
    else if (p === 1) addr = (this.d << 8) | this.e
    else {
      addr = this.hl
      this.hl = (addr + (p === 2 ? 1 : -1)) & 0xffff
    }
    if (q === 0) this.write(addr, this.a)
    else this.a = this.read(addr)
  }

  /** RLCA, RRCA, RLA, RRA, DAA, CPL, SCF, CCF. */
  private accumulatorOp(y: number): void {
    switch (y) {
      case 0:
      case 1:
      case 2:
      case 3:
        this.a = this.rot(y, this.a)
        this.f &= FC // Z is always cleared
        return
      case 4:
        return this.daa()
      case 5:
        this.a ^= 0xff
        this.f |= FN | FH
        return
      case 6:
        this.f = (this.f & FZ) | FC
        return
      default:
        this.f = (this.f & (FZ | FC)) ^ FC
    }
  }

  private halt(): void {
    if (!this.ime && this.bus.interrupts.pending() !== 0) this.haltBug = true
    else this.halted = true
  }

  private lock(): void {
    this.locked = true
  }
}
