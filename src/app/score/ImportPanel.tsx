/**
 * File import (REQ-3.2.5): MusicXML or Standard MIDI File, parsed with the
 * core parsers. A bad file is a normal case — the user downloaded it off the
 * internet — so the parser's `Err` is shown as readable text, never a console
 * log or a crash.
 */
import { parseMidiFile } from '@core/notation/midifile.ts'
import { parseMusicXml } from '@core/notation/musicxml.ts'
import { useScoreStore } from '@app/state/scoreStore.ts'
import { useId, useState } from 'react'

const XML_EXTENSIONS = new Set(['.musicxml', '.xml'])
const MIDI_EXTENSIONS = new Set(['.mid', '.midi'])

function extensionOf(fileName: string): string {
  const dot = fileName.lastIndexOf('.')
  return dot < 0 ? '' : fileName.slice(dot).toLowerCase()
}

export function ImportPanel() {
  const importError = useScoreStore((s) => s.importError)
  const loadScore = useScoreStore((s) => s.loadScore)
  const setImportError = useScoreStore((s) => s.setImportError)
  const clearImportError = useScoreStore((s) => s.clearImportError)
  const inputId = useId()
  const [busy, setBusy] = useState(false)

  async function importFile(file: File): Promise<void> {
    setBusy(true)
    clearImportError()
    try {
      const extension = extensionOf(file.name)
      if (XML_EXTENSIONS.has(extension)) {
        const text = await file.text()
        const result = parseMusicXml(text)
        if (!result.ok) {
          setImportError(`Could not read "${file.name}": ${result.error}`)
          return
        }
        loadScore({ score: result.value, sourceName: file.name, musicXml: text })
      } else if (MIDI_EXTENSIONS.has(extension)) {
        const bytes = new Uint8Array(await file.arrayBuffer())
        const result = parseMidiFile(bytes)
        if (!result.ok) {
          setImportError(`Could not read "${file.name}": ${result.error}`)
          return
        }
        loadScore({ score: result.value, sourceName: file.name, musicXml: undefined })
      } else {
        setImportError(
          `"${file.name}" is not a file this app can open — use .musicxml, .xml, .mid or .midi.`,
        )
      }
    } catch (reason) {
      const detail = reason instanceof Error ? reason.message : String(reason)
      setImportError(`Could not read "${file.name}": ${detail}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="import-panel">
      <label htmlFor={inputId}>Import a score (.musicxml, .xml, .mid, .midi)</label>
      <input
        id={inputId}
        type="file"
        accept=".musicxml,.xml,.mid,.midi"
        disabled={busy}
        onChange={(event) => {
          const file = event.target.files?.[0]
          event.target.value = ''
          if (file !== undefined) void importFile(file)
        }}
      />
      {importError !== undefined && (
        <p role="alert" className="import-error">
          {importError}
        </p>
      )}
    </div>
  )
}
