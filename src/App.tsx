import { useRef, useState, type DragEvent } from 'react'
import { useEmulator } from './runner/useEmulator.ts'

const CONTROLS = [
  ['D-pad', 'Arrow keys'],
  ['A', 'X'],
  ['B', 'Z'],
  ['Start', 'Enter'],
  ['Select', 'Backspace / Right Shift'],
]

function App() {
  const screenHost = useRef<HTMLDivElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const saveInput = useRef<HTMLInputElement>(null)
  const {
    status,
    fps,
    savedAt,
    load,
    importSave,
    exportSave,
    togglePause,
    reset,
  } = useEmulator(screenHost)
  const [dragging, setDragging] = useState(false)

  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) void load(file)
  }

  const active = status.kind === 'running' || status.kind === 'paused'
  const battery = active && status.battery

  const saveNote = !battery
    ? ''
    : savedAt
      ? ` · saved ${new Date(savedAt).toLocaleTimeString()}`
      : status.restored
        ? ' · save restored'
        : ' · new save'

  return (
    <main
      className={dragging ? 'app dragging' : 'app'}
      onDragOver={(e) => {
        e.preventDefault()
        setDragging(true)
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
    >
      <header className="bar">
        <h1>dgb</h1>
        <button type="button" onClick={() => fileInput.current?.click()}>
          Open ROM
        </button>
        <input
          ref={fileInput}
          type="file"
          accept=".gb,.gbc"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) void load(file)
            e.target.value = ''
          }}
        />
        <button type="button" onClick={togglePause} disabled={!active}>
          {status.kind === 'paused' ? 'Resume' : 'Pause'}
        </button>
        <button type="button" onClick={reset} disabled={!active}>
          Reset
        </button>
        <button type="button" onClick={exportSave} disabled={!battery}>
          Export .sav
        </button>
        <button
          type="button"
          onClick={() => saveInput.current?.click()}
          disabled={!battery}
        >
          Import .sav
        </button>
        <input
          ref={saveInput}
          type="file"
          accept=".sav"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (
              file &&
              confirm(
                'Replace the current save with this file? The game resets.',
              )
            )
              void importSave(file)
            e.target.value = ''
          }}
        />
      </header>

      <div className="screen-host" ref={screenHost} />

      <p className="status" role="status">
        {status.kind === 'idle' && 'Open a .gb file or drop it here.'}
        {active &&
          `${status.title}${status.kind === 'paused' ? ' (paused)' : ''} · ${fps.toFixed(1)} fps${saveNote}`}
        {status.kind === 'error' && `Error: ${status.message}`}
      </p>
      {active && status.warning && <p className="warning">{status.warning}</p>}

      <table className="controls">
        <tbody>
          {CONTROLS.map(([button, key]) => (
            <tr key={button}>
              <th>{button}</th>
              <td>{key}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  )
}

export default App
