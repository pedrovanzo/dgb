import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import { KeyboardInput } from './keymap.ts'
import type { FromWorker, ToWorker } from './protocol.ts'

export type EmulatorStatus =
  | { kind: 'idle' }
  | { kind: 'running'; title: string; warning?: string }
  | { kind: 'paused'; title: string; warning?: string }
  | { kind: 'error'; message: string }

export interface Emulator {
  status: EmulatorStatus
  fps: number
  load(file: Blob): Promise<void>
  togglePause(): void
  reset(): void
}

/**
 * Spawns the emulator worker, hands it a canvas created inside `host`, and
 * forwards keyboard input. The canvas is created here (not in JSX) because
 * `transferControlToOffscreen` works only once per element and StrictMode
 * mounts effects twice in development.
 */
export function useEmulator(host: RefObject<HTMLElement | null>): Emulator {
  const workerRef = useRef<Worker | null>(null)
  const [status, setStatus] = useState<EmulatorStatus>({ kind: 'idle' })
  const [fps, setFps] = useState(0)
  const userPaused = useRef(false)

  const send = useCallback((msg: ToWorker, transfer: Transferable[] = []) => {
    workerRef.current?.postMessage(msg, transfer)
  }, [])

  useEffect(() => {
    const el = host.current
    if (!el) return
    const canvas = document.createElement('canvas')
    canvas.width = 160
    canvas.height = 144
    canvas.className = 'screen'
    el.appendChild(canvas)

    const worker = new Worker(new URL('./worker.ts', import.meta.url), {
      type: 'module',
    })
    workerRef.current = worker
    worker.onmessage = (event: MessageEvent<FromWorker>) => {
      const msg = event.data
      if (msg.type === 'loaded') {
        userPaused.current = false
        setStatus({ kind: 'running', title: msg.title, warning: msg.warning })
      } else if (msg.type === 'error') {
        setStatus({ kind: 'error', message: msg.message })
        setFps(0)
      } else setFps(msg.fps)
    }
    const offscreen = canvas.transferControlToOffscreen()
    worker.postMessage({ type: 'init', canvas: offscreen } satisfies ToWorker, [
      offscreen,
    ])

    const keyboard = new KeyboardInput()
    const sendButtons = () =>
      worker.postMessage({
        type: 'input',
        buttons: keyboard.buttons(),
      } satisfies ToWorker)
    const onKeyDown = (e: KeyboardEvent) => {
      if (!keyboard.handles(e.code) || e.ctrlKey || e.metaKey || e.altKey)
        return
      if (e.target instanceof HTMLInputElement) return
      e.preventDefault()
      if (keyboard.press(e.code)) sendButtons()
    }
    const onKeyUp = (e: KeyboardEvent) => {
      if (keyboard.release(e.code)) sendButtons()
    }
    const onBlur = () => {
      if (keyboard.clear()) sendButtons()
    }
    const onVisibility = () => {
      if (userPaused.current) return
      worker.postMessage({
        type: document.hidden ? 'pause' : 'resume',
      } satisfies ToWorker)
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', onBlur)
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onBlur)
      document.removeEventListener('visibilitychange', onVisibility)
      worker.terminate()
      workerRef.current = null
      canvas.remove()
    }
  }, [host])

  const load = useCallback(
    async (file: Blob) => {
      const rom = await file.arrayBuffer()
      send({ type: 'load', rom }, [rom])
    },
    [send],
  )

  const togglePause = useCallback(() => {
    // Side effects stay outside the state updater (StrictMode runs it twice).
    if (status.kind === 'running') {
      userPaused.current = true
      send({ type: 'pause' })
      setStatus({ ...status, kind: 'paused' })
    } else if (status.kind === 'paused') {
      userPaused.current = false
      send({ type: 'resume' })
      setStatus({ ...status, kind: 'running' })
    }
  }, [send, status])

  const reset = useCallback(() => send({ type: 'reset' }), [send])

  return { status, fps, load, togglePause, reset }
}
