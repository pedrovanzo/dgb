import { AudioRing } from './audio-ring.ts'
import type { AudioPortMessage } from './protocol.ts'

/**
 * AudioWorklet processor. Receives interleaved stereo chunks from the
 * emulator worker over a MessagePort and plays them through `AudioRing`.
 */

// Minimal AudioWorkletGlobalScope typings (not shipped with TypeScript).
declare const sampleRate: number
declare class AudioWorkletProcessor {
  readonly port: MessagePort
  constructor(options?: unknown)
}
declare function registerProcessor(
  name: string,
  ctor: new (options: ProcessorOptions) => AudioWorkletProcessor,
): void

interface ProcessorOptions {
  processorOptions: { sourceRate: number }
}

/** Prebuffer and latency target: 60 ms. Capacity: 500 ms. */
const TARGET_SECONDS = 0.06
const CAPACITY_SECONDS = 0.5

class DgbAudioProcessor extends AudioWorkletProcessor {
  private readonly ring: AudioRing

  constructor(options: ProcessorOptions) {
    super(options)
    const source = options.processorOptions.sourceRate
    this.ring = new AudioRing(
      Math.round(source * CAPACITY_SECONDS),
      Math.round(source * TARGET_SECONDS),
      source / sampleRate,
    )
    // The first message carries the port connected to the emulator worker.
    this.port.onmessage = (event: MessageEvent<{ port: MessagePort }>) => {
      event.data.port.onmessage = (e: MessageEvent<AudioPortMessage>) => {
        if (e.data === 'clear') this.ring.clear()
        else this.ring.push(e.data)
      }
    }
  }

  process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const out = outputs[0]
    if (out.length >= 2) this.ring.pull(out[0], out[1])
    else if (out.length === 1)
      this.ring.pull(out[0], new Float32Array(out[0].length))
    return true
  }
}

registerProcessor('dgb-audio', DgbAudioProcessor)
