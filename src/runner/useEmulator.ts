import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import { AudioOutput } from './audio-output.ts'
import { KeyboardInput } from './keymap.ts'
import type { FromWorker, ToWorker } from './protocol.ts'

export interface GameInfo {
  title: string
  /** Cartridge has battery-backed saves. */
  battery: boolean
  /** A stored save was restored on load. */
  restored: boolean
  warning?: string
}

export type EmulatorStatus =
  | { kind: 'idle' }
  | ({ kind: 'running' } & GameInfo)
  | ({ kind: 'paused' } & GameInfo)
  | { kind: 'error'; message: string }

export interface Emulator {
  status: EmulatorStatus
  fps: number
  /** Time of the last save written to the browser, if any this session. */
  savedAt: number | null
  /** 0-1. */
  volume: number
  setVolume(volume: number): void
  load(file: Blob): Promise<void>
  importSave(file: Blob): Promise<void>
  exportSave(): void
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
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const userPaused = useRef(false)
  const audioRef = useRef<AudioOutput | null>(null)
  const [volume, setVolumeState] = useState(loadVolume)
  const volumeRef = useRef(volume)

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
      switch (msg.type) {
        case 'loaded':
          userPaused.current = false
          setSavedAt(null)
          setStatus({
            kind: 'running',
            title: msg.title,
            battery: msg.battery,
            restored: msg.restored,
            warning: msg.warning,
          })
          return
        case 'error':
          setStatus({ kind: 'error', message: msg.message })
          setFps(0)
          return
        case 'stats':
          setFps(msg.fps)
          return
        case 'saved':
          setSavedAt(msg.at)
          return
        case 'save-data':
          download(new Blob([msg.data]), `${msg.title || 'save'}.sav`)
          return
      }
    }
    const offscreen = canvas.transferControlToOffscreen()
    worker.postMessage({ type: 'init', canvas: offscreen } satisfies ToWorker, [
      offscreen,
    ])

    const audio = new AudioOutput()
    audioRef.current = audio
    audio.setVolume(volumeRef.current)
    void audio
      .port()
      .then((port) =>
        worker.postMessage({ type: 'audio-port', port } satisfies ToWorker, [
          port,
        ]),
      )
      .catch((err: unknown) => {
        // A StrictMode remount closes the context mid-load; that is expected.
        if (audioRef.current !== audio) return
        console.warn(
          'Audio unavailable:',
          err instanceof Error ? err.message : err,
        )
      })
    // Audio may only start after a user gesture.
    const unlockAudio = () => audio.resume()
    window.addEventListener('pointerdown', unlockAudio)
    window.addEventListener('keydown', unlockAudio)

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
    // Hidden tabs pause, which also flushes the save to IndexedDB.
    const onVisibility = () => {
      if (document.hidden)
        worker.postMessage({ type: 'pause' } satisfies ToWorker)
      else if (!userPaused.current)
        worker.postMessage({ type: 'resume' } satisfies ToWorker)
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
      window.removeEventListener('pointerdown', unlockAudio)
      window.removeEventListener('keydown', unlockAudio)
      audio.close()
      audioRef.current = null
      worker.terminate()
      workerRef.current = null
      canvas.remove()
    }
  }, [host])

  const load = useCallback(
    async (file: Blob) => {
      // Ask the browser not to evict saves under storage pressure.
      void navigator.storage?.persist?.()
      audioRef.current?.resume()
      const rom = await file.arrayBuffer()
      send({ type: 'load', rom }, [rom])
    },
    [send],
  )

  const importSave = useCallback(
    async (file: Blob) => {
      const data = await file.arrayBuffer()
      send({ type: 'import-save', data }, [data])
    },
    [send],
  )

  const exportSave = useCallback(() => send({ type: 'export-save' }), [send])

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

  const setVolume = useCallback((v: number) => {
    volumeRef.current = v
    setVolumeState(v)
    audioRef.current?.setVolume(v)
    try {
      localStorage.setItem(VOLUME_KEY, String(v))
    } catch {
      // Storage unavailable (private mode): keep the in-memory value.
    }
  }, [])

  return {
    status,
    fps,
    savedAt,
    volume,
    setVolume,
    load,
    importSave,
    exportSave,
    togglePause,
    reset,
  }
}

const VOLUME_KEY = 'dgb.volume'

function loadVolume(): number {
  try {
    const v = Number(localStorage.getItem(VOLUME_KEY) ?? '0.5')
    return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0.5
  } catch {
    return 0.5
  }
}

function download(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
