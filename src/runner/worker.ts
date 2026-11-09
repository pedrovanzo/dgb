import { createCore } from '../cores/index.ts'
import type { Core } from '../cores/types.ts'
import { SaveStore, sha1Hex } from '../storage/saves.ts'
import { FramePacer } from './pacer.ts'
import type { FromWorker, ToWorker } from './protocol.ts'

/**
 * Emulator worker: owns the core and the OffscreenCanvas, paces frames, draws
 * and persists battery saves. The UI thread only sends input and control
 * messages.
 */
const scope = self as unknown as DedicatedWorkerGlobalScope

/** How often changed battery RAM is written to IndexedDB. */
const AUTOSAVE_MS = 1000

interface Game {
  core: Core
  title: string
  sha1: string
}

let ctx: OffscreenCanvasRenderingContext2D | null = null
let image: ImageData | null = null
let game: Game | null = null
let pacer: FramePacer | null = null
let paused = false
let loopScheduled = false
let framesThisSecond = 0
let statsStart = 0

let store: Promise<SaveStore | null> | null = null
/** Serializes IndexedDB writes so an older save never lands last. */
let writes: Promise<void> = Promise.resolve()

function post(msg: FromWorker, transfer: Transferable[] = []): void {
  scope.postMessage(msg, transfer)
}

function saveStore(): Promise<SaveStore | null> {
  store ??= SaveStore.open().catch((err: unknown) => {
    post({
      type: 'error',
      message: `Save storage unavailable: ${errorMessage(err)}`,
    })
    return null
  })
  return store
}

/** Writes battery data if it changed (or always, with `force`). */
function persist(force = false): Promise<void> {
  const g = game
  if (!g) return writes
  if (!g.core.consumeSaveDirty() && !force) return writes
  const data = g.core.getSaveRam()
  if (!data) return writes
  writes = writes.then(async () => {
    const s = await saveStore()
    if (!s) return
    try {
      const at = Date.now()
      await s.put(g.sha1, g.title, data, at)
      post({ type: 'saved', at })
    } catch (err) {
      post({ type: 'error', message: `Save failed: ${errorMessage(err)}` })
    }
  })
  return writes
}

setInterval(() => void persist(), AUTOSAVE_MS)

const schedule: (cb: (now: number) => void) => void =
  typeof scope.requestAnimationFrame === 'function'
    ? (cb) => scope.requestAnimationFrame(cb)
    : (cb) => setTimeout(() => cb(performance.now()), 4)

function requestLoop(): void {
  if (loopScheduled || paused || !game) return
  loopScheduled = true
  schedule(loop)
}

function loop(now: number): void {
  loopScheduled = false
  if (paused || !game || !pacer) return
  const frames = pacer.due(now)
  try {
    for (let i = 0; i < frames; i++) game.core.runFrame()
  } catch (err) {
    void persist()
    game = null
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
  if (!ctx || !game) return
  const screen = game.core.getFramebuffers()[0]
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

async function load(buffer: ArrayBuffer): Promise<void> {
  await persist()
  game = null
  const rom = new Uint8Array(buffer)
  const sha1 = await sha1Hex(rom)
  const created = createCore(rom)
  const { core } = created
  let restored = false
  const battery = core.getSaveRam() !== null
  if (battery) {
    const s = await saveStore()
    const rec = await s?.checkpoint(sha1)
    if (rec) {
      core.setSaveRam(rec.data)
      core.consumeSaveDirty()
      restored = true
    }
  }
  game = { core, title: created.title, sha1 }
  pacer = new FramePacer(core.frameRate)
  restartClock()
  post({
    type: 'loaded',
    title: created.title,
    system: core.system,
    battery,
    restored,
    warning: created.warning,
  })
  requestLoop()
}

scope.onmessage = async (event: MessageEvent<ToWorker>) => {
  const msg = event.data
  try {
    switch (msg.type) {
      case 'init':
        ctx = msg.canvas.getContext('2d', { alpha: false })
        return
      case 'load':
        return await load(msg.rom)
      case 'input':
        game?.core.setInput({ buttons: new Set(msg.buttons) })
        return
      case 'pause':
        paused = true
        return await persist()
      case 'resume':
        paused = false
        restartClock()
        requestLoop()
        return
      case 'reset':
        game?.core.reset()
        restartClock()
        requestLoop()
        return
      case 'import-save':
        if (!game) return
        game.core.setSaveRam(new Uint8Array(msg.data))
        game.core.reset()
        restartClock()
        requestLoop()
        return await persist(true)
      case 'export-save': {
        const data = game?.core.getSaveRam()
        if (!game || !data) return
        const buffer = data.slice().buffer
        post({ type: 'save-data', title: game.title, data: buffer }, [buffer])
        return
      }
    }
  } catch (err) {
    post({ type: 'error', message: errorMessage(err) })
  }
}
