import workletUrl from './audio-worklet.ts?worker&url'

/** Rate the GB core produces; the worklet resamples if the device differs. */
const SOURCE_RATE = 48_000

/**
 * Page-side audio graph: AudioWorkletNode -> GainNode -> speakers. The
 * emulator worker talks to the worklet directly over a MessageChannel, so
 * samples never pass through the main thread.
 */
export class AudioOutput {
  private readonly ctx: AudioContext
  private readonly gain: GainNode
  private readonly ready: Promise<MessagePort>

  constructor() {
    let ctx: AudioContext
    try {
      ctx = new AudioContext({
        sampleRate: SOURCE_RATE,
        latencyHint: 'interactive',
      })
    } catch {
      ctx = new AudioContext({ latencyHint: 'interactive' })
    }
    this.ctx = ctx
    this.gain = ctx.createGain()
    this.gain.connect(ctx.destination)
    this.ready = this.init()
  }

  private async init(): Promise<MessagePort> {
    await this.ctx.audioWorklet.addModule(workletUrl)
    const node = new AudioWorkletNode(this.ctx, 'dgb-audio', {
      numberOfInputs: 0,
      outputChannelCount: [2],
      processorOptions: { sourceRate: SOURCE_RATE },
    })
    node.connect(this.gain)
    const channel = new MessageChannel()
    node.port.postMessage({ port: channel.port1 }, [channel.port1])
    return channel.port2
  }

  /** Port for the emulator worker to send samples to. */
  port(): Promise<MessagePort> {
    return this.ready
  }

  /** Browsers start audio suspended until a user gesture. */
  resume(): void {
    if (this.ctx.state === 'suspended') void this.ctx.resume()
  }

  setVolume(volume: number): void {
    this.gain.gain.setTargetAtTime(volume, this.ctx.currentTime, 0.01)
  }

  close(): void {
    void this.ctx.close()
  }
}
