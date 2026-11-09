/**
 * DMG audio processing unit: two square channels (the first with sweep), a
 * wave channel and a noise channel, a frame sequencer clocked by DIV, and a
 * mixer that downsamples to `SAMPLE_RATE` by averaging every M-cycle.
 *
 * Register-level quirks follow Pan Docs and the "Game Boy Sound Hardware"
 * notes (length-counter extra clocks, sweep negate lockout, DMG power-off
 * behaviour, wave RAM access while playing).
 */

export const SAMPLE_RATE = 48_000
const CLOCK_HZ = 4_194_304

/**
 * Bit of the timer's internal counter that clocks the frame sequencer (512
 * Hz). In CGB double speed the counter runs twice as fast, so bit 13 is used.
 */
const FRAME_SEQUENCER_BIT = 1 << 12

/** OR masks applied when reading 0xFF10-0xFF2F (write-only / unused bits). */
const READ_MASKS = [
  0x80, 0x3f, 0x00, 0xff, 0xbf, 0xff, 0x3f, 0x00, 0xff, 0xbf, 0x7f, 0xff, 0x9f,
  0xff, 0xbf, 0xff, 0xff, 0x00, 0x00, 0xbf, 0x00, 0x00, 0x70, 0xff, 0xff, 0xff,
  0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
]

const DUTY = [
  [0, 0, 0, 0, 0, 0, 0, 1],
  [1, 0, 0, 0, 0, 0, 0, 1],
  [1, 0, 0, 0, 0, 1, 1, 1],
  [0, 1, 1, 1, 1, 1, 1, 0],
]

const NOISE_DIVISORS = [8, 16, 32, 48, 64, 80, 96, 112]
const WAVE_SHIFT = [4, 0, 1, 2]

/** High-pass "capacitor" charge factor per output sample (removes DC). */
const HPF_FACTOR = Math.pow(0.999958, CLOCK_HZ / SAMPLE_RATE)

class Length {
  value = 0
  enabled = false
  readonly max: number

  constructor(max: number) {
    this.max = max
  }

  load(n: number): void {
    this.value = this.max - n
  }

  /** Returns true when the counter just expired (channel turns off). */
  clock(): boolean {
    if (!this.enabled || this.value === 0) return false
    return --this.value === 0
  }
}

class Envelope {
  initial = 0
  add = false
  period = 0
  volume = 0
  private timer = 0

  write(v: number): void {
    this.initial = v >> 4
    this.add = (v & 0x08) !== 0
    this.period = v & 0x07
  }

  trigger(): void {
    this.volume = this.initial
    this.timer = this.period || 8
  }

  clock(): void {
    if (this.period === 0) return
    if (--this.timer > 0) return
    this.timer = this.period
    if (this.add && this.volume < 15) this.volume++
    else if (!this.add && this.volume > 0) this.volume--
  }
}

/** State shared by every channel. */
abstract class Channel {
  enabled = false
  dacOn = false
  freq = 0
  protected timer = 0
  readonly length: Length

  constructor(lengthMax: number) {
    this.length = new Length(lengthMax)
  }

  abstract output(): number
  abstract trigger(): void

  /**
   * NRx4 write. `lengthStepNext` is true when the next frame-sequencer step
   * clocks length, which disables the extra-clock quirk.
   */
  writeControl(value: number, lengthStepNext: boolean): void {
    this.freq = (this.freq & 0xff) | ((value & 0x07) << 8)
    const len = this.length
    const wasEnabled = len.enabled
    len.enabled = (value & 0x40) !== 0
    const trigger = (value & 0x80) !== 0
    if (!lengthStepNext && !wasEnabled && len.enabled && len.value > 0) {
      if (--len.value === 0 && !trigger) this.enabled = false
    }
    if (!trigger) return
    if (len.value === 0) {
      len.value = len.max
      if (len.enabled && !lengthStepNext) len.value--
    }
    this.enabled = this.dacOn
    this.trigger()
  }

  clockLength(): void {
    if (this.length.clock()) this.enabled = false
  }
}

class Square extends Channel {
  duty = 0
  dutyPos = 0
  readonly env = new Envelope()
  // Sweep (channel 1 only)
  sweepPeriod = 0
  sweepNegate = false
  sweepShift = 0
  private sweepTimer = 0
  private sweepEnabled = false
  private shadow = 0
  private negateUsed = false

  constructor() {
    super(64)
  }

  writeSweep(v: number): void {
    this.sweepPeriod = (v >> 4) & 0x07
    this.sweepNegate = (v & 0x08) !== 0
    this.sweepShift = v & 0x07
    // Leaving negate mode after a negate calculation disables the channel.
    if (!this.sweepNegate && this.negateUsed) this.enabled = false
  }

  writeEnvelope(v: number): void {
    this.env.write(v)
    this.dacOn = (v & 0xf8) !== 0
    if (!this.dacOn) this.enabled = false
  }

  trigger(): void {
    this.timer = (2048 - this.freq) * 4
    this.env.trigger()
    this.shadow = this.freq
    this.sweepTimer = this.sweepPeriod || 8
    this.sweepEnabled = this.sweepPeriod !== 0 || this.sweepShift !== 0
    this.negateUsed = false
    if (this.sweepShift !== 0) this.sweepCalc()
  }

  private sweepCalc(): number {
    const delta = this.shadow >> this.sweepShift
    let next: number
    if (this.sweepNegate) {
      next = this.shadow - delta
      this.negateUsed = true
    } else next = this.shadow + delta
    if (next > 2047) this.enabled = false
    return next
  }

  clockSweep(): void {
    if (--this.sweepTimer > 0) return
    this.sweepTimer = this.sweepPeriod || 8
    if (!this.sweepEnabled || this.sweepPeriod === 0) return
    const next = this.sweepCalc()
    if (next <= 2047 && this.sweepShift !== 0) {
      this.shadow = next
      this.freq = next
      this.sweepCalc()
    }
  }

  tick(cycles: number): void {
    this.timer -= cycles
    while (this.timer <= 0) {
      this.timer += (2048 - this.freq) * 4
      this.dutyPos = (this.dutyPos + 1) & 7
    }
  }

  output(): number {
    return DUTY[this.duty][this.dutyPos] * this.env.volume
  }
}

class Wave extends Channel {
  /** True if the next wave RAM fetch happens within `t` T-cycles. */
  fetchDueWithin(t: number): boolean {
    return this.timer <= t
  }

  readonly ram = new Uint8Array(16)
  volumeCode = 0
  pos = 0
  sample = 0
  /** T-cycle (absolute) when the channel last fetched from wave RAM. */
  lastFetch = -1

  constructor() {
    super(256)
  }

  trigger(): void {
    this.pos = 0
    // The first sample is fetched after a short startup delay.
    this.timer = (2048 - this.freq) * 2 + 6
  }

  /** Advances `cycles` T-cycles that start at absolute T-cycle `start`. */
  tick(start: number, cycles: number): void {
    if (!this.enabled) return
    this.timer -= cycles
    while (this.timer <= 0) {
      const at = start + cycles + this.timer
      this.timer += (2048 - this.freq) * 2
      this.pos = (this.pos + 1) & 31
      this.sample = this.ram[this.pos >> 1]
      this.lastFetch = at
    }
  }

  output(): number {
    const nibble = this.pos & 1 ? this.sample & 0x0f : this.sample >> 4
    return nibble >> WAVE_SHIFT[this.volumeCode]
  }
}

class Noise extends Channel {
  readonly env = new Envelope()
  shift = 0
  narrow = false
  divisor = 0
  lfsr = 0x7fff

  constructor() {
    super(64)
  }

  writeEnvelope(v: number): void {
    this.env.write(v)
    this.dacOn = (v & 0xf8) !== 0
    if (!this.dacOn) this.enabled = false
  }

  private period(): number {
    return NOISE_DIVISORS[this.divisor] << this.shift
  }

  trigger(): void {
    this.timer = this.period()
    this.env.trigger()
    this.lfsr = 0x7fff
  }

  tick(cycles: number): void {
    this.timer -= cycles
    while (this.timer <= 0) {
      this.timer += this.period()
      if (this.shift >= 14) continue
      const bit = (this.lfsr ^ (this.lfsr >> 1)) & 1
      this.lfsr = (this.lfsr >> 1) | (bit << 14)
      if (this.narrow) this.lfsr = (this.lfsr & ~0x40) | (bit << 6)
    }
  }

  output(): number {
    return (~this.lfsr & 1) * this.env.volume
  }
}

export class Apu {
  private readonly sq1 = new Square()
  private readonly sq2 = new Square()
  private readonly wave = new Wave()
  private readonly noise = new Noise()
  private readonly channels: readonly Channel[] = [
    this.sq1,
    this.sq2,
    this.wave,
    this.noise,
  ]
  /** Raw register values for read-back (0xFF10-0xFF2F). */
  private readonly regs = new Uint8Array(0x20)
  private power = true
  /** Next frame-sequencer step (0-7). */
  private step = 0
  /** Absolute T-cycle at the start of the next tick. */
  private now = 0

  // Mixer / resampler
  private phase = 0
  private sumL = 0
  private sumR = 0
  private count = 0
  private capL = 0
  private capR = 0
  private out = new Float32Array(4096)
  private outLen = 0

  /** CGB model: different wave RAM and power-off rules. */
  private readonly cgb: boolean
  /** Counter bit for the frame sequencer (bit 13 in CGB double speed). */
  private frameBit = FRAME_SEQUENCER_BIT

  constructor(cgb = false) {
    this.cgb = cgb
    this.initPostBoot()
  }

  /** CGB speed switch. */
  setDoubleSpeed(on: boolean): void {
    this.frameBit = on ? FRAME_SEQUENCER_BIT << 1 : FRAME_SEQUENCER_BIT
  }

  /** Register state left by the DMG boot ROM (after its startup chime). */
  private initPostBoot(): void {
    const boot: [number, number][] = [
      [0xff10, 0x80],
      [0xff11, 0xbf],
      [0xff12, 0xf3],
      [0xff13, 0xc1],
      [0xff14, 0x07],
      [0xff16, 0x3f],
      [0xff17, 0x00],
      [0xff19, 0xb8],
      [0xff1a, 0x7f],
      [0xff1b, 0xff],
      [0xff1c, 0x9f],
      [0xff1e, 0xb8],
      [0xff20, 0xff],
      [0xff21, 0x00],
      [0xff22, 0x00],
      [0xff23, 0xb8],
      [0xff24, 0x77],
      [0xff25, 0xf3],
    ]
    for (const [addr, v] of boot) this.write(addr, v)
    // Channel 1 is still on with its envelope faded out.
    this.sq1.enabled = true
    this.sq1.env.volume = 0
    for (let i = 0; i < 16; i++) this.wave.ram[i] = i & 1 ? 0xff : 0x00
  }

  /**
   * Advances one M-cycle of `cycles` T-cycles (4, or 2 in CGB double speed).
   * `before`/`after` are the timer's internal counter around this tick; a
   * falling edge of the frame-sequencer bit steps the sequencer.
   */
  tick(before: number, after: number, cycles = 4): void {
    if (this.power) {
      if (before & this.frameBit && !(after & this.frameBit))
        this.stepFrameSequencer()
      this.sq1.tick(cycles)
      this.sq2.tick(cycles)
      this.wave.tick(this.now, cycles)
      this.noise.tick(cycles)
    }
    this.now += cycles
    // Averaging every 8 T-cycles (~524 kHz) is ample for a 48 kHz output.
    if ((this.now & 7) === 0) this.accumulate()
    this.phase += SAMPLE_RATE * cycles
    if (this.phase >= CLOCK_HZ) {
      this.phase -= CLOCK_HZ
      this.emit()
    }
  }

  /** DIV write: resetting the counter can produce a falling edge. */
  divReset(before: number): void {
    if (this.power && before & this.frameBit) this.stepFrameSequencer()
  }

  private stepFrameSequencer(): void {
    const s = this.step
    if ((s & 1) === 0) {
      this.sq1.clockLength()
      this.sq2.clockLength()
      this.wave.clockLength()
      this.noise.clockLength()
    }
    if (s === 2 || s === 6) this.sq1.clockSweep()
    if (s === 7) {
      this.sq1.env.clock()
      this.sq2.env.clock()
      this.noise.env.clock()
    }
    this.step = (s + 1) & 7
  }

  private accumulate(): void {
    // DAC output scaled by 7.5: digital level 0-15 maps to -7.5..7.5.
    const pan = this.regs[0x15]
    let l = 0
    let r = 0
    const channels = this.channels
    for (let i = 0; i < 4; i++) {
      const ch = channels[i]
      if (!ch.dacOn) continue
      const v = (ch.enabled ? ch.output() : 0) - 7.5
      if (pan & (0x10 << i)) l += v
      if (pan & (1 << i)) r += v
    }
    const nr50 = this.regs[0x14]
    this.sumL += l * (((nr50 >> 4) & 7) + 1)
    this.sumR += r * ((nr50 & 7) + 1)
    this.count++
  }

  private emit(): void {
    if (this.count === 0) this.accumulate()
    // Average, scale 4 channels x 7.5 x volume 8 into [-1, 1], then high-pass.
    const inL = this.sumL / (this.count * 240)
    const inR = this.sumR / (this.count * 240)
    this.sumL = this.sumR = this.count = 0
    const outL = inL - this.capL
    const outR = inR - this.capR
    this.capL = inL - outL * HPF_FACTOR
    this.capR = inR - outR * HPF_FACTOR
    if (this.outLen + 2 > this.out.length) {
      const grown = new Float32Array(this.out.length * 2)
      grown.set(this.out)
      this.out = grown
    }
    this.out[this.outLen++] = outL
    this.out[this.outLen++] = outR
  }

  /** Interleaved stereo samples produced since the last call. */
  drain(): Float32Array {
    const samples = this.out.slice(0, this.outLen)
    this.outLen = 0
    return samples
  }

  read(addr: number): number {
    if (addr >= 0xff30) return this.readWave(addr)
    const i = addr - 0xff10
    if (addr === 0xff26) {
      return (
        0x70 |
        (this.power ? 0x80 : 0) |
        (this.sq1.enabled ? 1 : 0) |
        (this.sq2.enabled ? 2 : 0) |
        (this.wave.enabled ? 4 : 0) |
        (this.noise.enabled ? 8 : 0)
      )
    }
    return this.regs[i] | READ_MASKS[i]
  }

  /**
   * While the wave channel plays, the CPU can only reach the byte the channel
   * is fetching, and on DMG only in the same cycle as that fetch.
   */
  private readWave(addr: number): number {
    const w = this.wave
    if (!w.enabled) return w.ram[addr - 0xff30]
    if (this.cgb) return w.ram[w.pos >> 1]
    return this.waveAccessible() ? w.ram[w.pos >> 1] : 0xff
  }

  private writeWave(addr: number, value: number): void {
    const w = this.wave
    if (!w.enabled) w.ram[addr - 0xff30] = value
    else if (this.cgb || this.waveAccessible()) w.ram[w.pos >> 1] = value
  }

  private waveAccessible(): boolean {
    // CPU accesses land at the start of the M-cycle being ticked next.
    return this.now - this.wave.lastFetch <= 1
  }

  write(addr: number, value: number): void {
    if (addr >= 0xff30) return this.writeWave(addr, value)
    if (addr === 0xff26) return this.writePower(value)
    if (!this.power) {
      if (this.cgb) return
      // DMG: length counters stay writable while powered off.
      if (addr === 0xff11) this.sq1.length.load(value & 0x3f)
      else if (addr === 0xff16) this.sq2.length.load(value & 0x3f)
      else if (addr === 0xff1b) this.wave.length.load(value)
      else if (addr === 0xff20) this.noise.length.load(value & 0x3f)
      return
    }
    if (addr > 0xff26) return
    this.regs[addr - 0xff10] = value
    const lengthStepNext = (this.step & 1) === 0
    switch (addr) {
      case 0xff10:
        return this.sq1.writeSweep(value)
      case 0xff11:
        this.sq1.duty = value >> 6
        return this.sq1.length.load(value & 0x3f)
      case 0xff12:
        return this.sq1.writeEnvelope(value)
      case 0xff13:
        this.sq1.freq = (this.sq1.freq & 0x700) | value
        return
      case 0xff14:
        return this.sq1.writeControl(value, lengthStepNext)
      case 0xff16:
        this.sq2.duty = value >> 6
        return this.sq2.length.load(value & 0x3f)
      case 0xff17:
        return this.sq2.writeEnvelope(value)
      case 0xff18:
        this.sq2.freq = (this.sq2.freq & 0x700) | value
        return
      case 0xff19:
        return this.sq2.writeControl(value, lengthStepNext)
      case 0xff1a:
        this.wave.dacOn = (value & 0x80) !== 0
        if (!this.wave.dacOn) this.wave.enabled = false
        return
      case 0xff1b:
        return this.wave.length.load(value)
      case 0xff1c:
        this.wave.volumeCode = (value >> 5) & 3
        return
      case 0xff1d:
        this.wave.freq = (this.wave.freq & 0x700) | value
        return
      case 0xff1e:
        if (value & 0x80 && this.wave.enabled && !this.cgb)
          this.corruptWaveOnRetrigger()
        return this.wave.writeControl(value, lengthStepNext)
      case 0xff20:
        return this.noise.length.load(value & 0x3f)
      case 0xff21:
        return this.noise.writeEnvelope(value)
      case 0xff22:
        this.noise.shift = value >> 4
        this.noise.narrow = (value & 0x08) !== 0
        this.noise.divisor = value & 0x07
        return
      case 0xff23:
        return this.noise.writeControl(value, lengthStepNext)
    }
  }

  /**
   * DMG bug: retriggering the wave channel just as it fetches a byte
   * overwrites the start of wave RAM with the bytes around that position.
   */
  private corruptWaveOnRetrigger(): void {
    const w = this.wave
    // Only when the fetch is due in the next 2 T-cycles.
    if (!w.fetchDueWithin(2)) return
    const next = ((w.pos + 1) & 31) >> 1
    if (next < 4) w.ram[0] = w.ram[next]
    else w.ram.copyWithin(0, next & ~3, (next & ~3) + 4)
  }

  private writePower(value: number): void {
    const on = (value & 0x80) !== 0
    if (this.power && !on) {
      // Clear every register; DMG keeps length counters.
      for (let addr = 0xff10; addr <= 0xff25; addr++) {
        if (addr === 0xff11 || addr === 0xff16 || addr === 0xff1b) continue
        if (addr === 0xff20) continue
        this.write(addr, 0)
      }
      this.regs[0x01] = this.regs[0x06] = this.regs[0x0b] = this.regs[0x10] = 0
      this.sq1.duty = this.sq2.duty = 0
      this.sq1.enabled = this.sq2.enabled = false
      this.wave.enabled = this.noise.enabled = false
      // CGB clears the length counters too.
      if (this.cgb) for (const ch of this.channels) ch.length.value = 0
      this.power = false
    } else if (!this.power && on) {
      this.power = true
      this.step = 0
      this.sq1.dutyPos = this.sq2.dutyPos = 0
      this.wave.sample = 0
    }
  }
}
