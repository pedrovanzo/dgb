import { createCore } from '../cores/index.ts'
import type { Core } from '../cores/types.ts'
import { FramePacer } from './pacer.ts'
import type { FromWorker, ToWorker } from './protocol.ts'

/**
 * Emulator worker: owns the core and the OffscreenCanvas, paces frames and
 * draws. The UI thread only sends input and control messages.
 */
const scope = self as unknown as DedicatedWorkerGlobalScope

let ctx: OffscreenCanvasRenderingContext2D | null = null
let image: ImageData | null = null
let core: Core | null = null
let pacer: FramePacer | null = null
let paused = false
let loopScheduled = false
let framesThisSecond = 0
let statsStart = 0

function post(msg: FromWorker): void {
  scope.postMessage(msg)
}

const schedule: (cb: (now: number) => void) => void =
  typeof scope.requestAnimationFrame === 'function'
    ? (cb) => scope.requestAnimationFrame(cb)
    : (cb) => setTimeout(() => cb(performance.now()), 4)

function requestLoop(): void {
  if (loopScheduled || paused || !core) return
  loopScheduled = true
  schedule(loop)
}

function loop(now: number): void {
  loopScheduled = false
  if (paused || !core || !pacer) return
  const frames = pacer.due(now)
  try {
    for (let i = 0; i < frames; i++) core.runFrame()
  } catch (err) {
    core = null
    post({ type: 'error', message: errorMessage(err) })
    return
  }
  if (frames > 0) draw()
  framesThisSecond += frames
  if (now - statsStart >= 1000) {
    post({ type: 'stats', fps: (framesThisSecond * 1000) / (now - statsStart) })
    framesThisSecond = 0
    statsStart = now
  }
  requestLoop()
}

function draw(): void {
  if (!ctx || !core) return
  const screen = core.getFramebuffers()[0]
  if (
    !image ||
    image.width !== screen.width ||
    image.height !== screen.height
  ) {
    ctx.canvas.width = screen.width
    ctx.canvas.height = screen.height
    image = new ImageData(screen.width, screen.height)
  }
  image.data.set(screen.pixels)
  ctx.putImageData(image, 0, 0)
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

function restartClock(): void {
  pacer?.reset()
  framesThisSecond = 0
  statsStart = performance.now()
}

scope.onmessage = (event: MessageEvent<ToWorker>) => {
  const msg = event.data
  switch (msg.type) {
    case 'init':
      ctx = msg.canvas.getContext('2d', { alpha: false })
      return
    case 'load':
      try {
        const created = createCore(new Uint8Array(msg.rom))
        core = created.core
        pacer = new FramePacer(core.frameRate)
        restartClock()
        post({
          type: 'loaded',
          title: created.title,
          system: core.system,
          warning: created.warning,
        })
        requestLoop()
      } catch (err) {
        core = null
        post({ type: 'error', message: errorMessage(err) })
      }
      return
    case 'input':
      core?.setInput({ buttons: new Set(msg.buttons) })
      return
    case 'pause':
      paused = true
      return
    case 'resume':
      paused = false
      restartClock()
      requestLoop()
      return
    case 'reset':
      core?.reset()
      restartClock()
      requestLoop()
      return
  }
}
