/**
 * File import (REQ-3.2.5): MusicXML (plain or compressed `.mxl`) or Standard
 * MIDI File, parsed with the core parsers. A bad file is a normal case — the
 * user downloaded it off the internet — so the parser's (or unpacker's) `Err`
 * is always surfaced, never a console log or a crash.
 *
 * UI-21 (states sweep): the parsers' own `Err` text is a developer-facing
 * parse diagnostic (`"malformed MusicXML: no root element"`, `"<duration> is
 * empty or not a number"`, raw XML tag names) — exactly the internal
 * vocabulary DESIGN.md rule 7 forbids on screen, and the same defect class
 * `webmidi.ts`'s `createWebMidi` and `micErrorMessage.ts` already closed for
 * device permissions: `describeImportError` below keeps that detail in
 * `console.warn` for a developer and shows one calm, learner-language message
 * instead, naming the file so a learner picking among several downloads can
 * tell which one failed. The file input stays live in the same dialog after
 * an error, which is the recovery path — no extra "try again" control needed.
 */
import { parseMidiFile } from '@core/notation/midifile.ts'
import { parseMusicXml } from '@core/notation/musicxml.ts'
import { writeMusicXml } from '@core/notation/musicxmlwriter.ts'
import { unpackMxl } from '@core/notation/mxl.ts'
import { useScoreStore } from '@app/state/scoreStore.ts'
import { useId, useState } from 'react'

const XML_EXTENSIONS = new Set(['.musicxml', '.xml'])
const MXL_EXTENSIONS = new Set(['.mxl'])
const MIDI_EXTENSIONS = new Set(['.mid', '.midi'])

function extensionOf(fileName: string): string {
  const dot = fileName.lastIndexOf('.')
  return dot < 0 ? '' : fileName.slice(dot).toLowerCase()
}

function describeImportError(fileName: string, cause: string): string {
  console.warn(`[ImportPanel] could not read "${fileName}":`, cause)
  return `Could not read "${fileName}" — it doesn't look like a valid score file. Try a different file.`
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
          setImportError(describeImportError(file.name, result.error))
          return
        }
        loadScore({ score: result.value, sourceName: file.name, musicXml: text })
      } else if (MXL_EXTENSIONS.has(extension)) {
        const bytes = new Uint8Array(await file.arrayBuffer())
        const unpacked = unpackMxl(bytes)
        if (!unpacked.ok) {
          setImportError(describeImportError(file.name, unpacked.error))
          return
        }
        const result = parseMusicXml(unpacked.value)
        if (!result.ok) {
          setImportError(describeImportError(file.name, result.error))
          return
        }
        loadScore({ score: result.value, sourceName: file.name, musicXml: unpacked.value })
      } else if (MIDI_EXTENSIONS.has(extension)) {
        const bytes = new Uint8Array(await file.arrayBuffer())
        const result = parseMidiFile(bytes)
        if (!result.ok) {
          setImportError(describeImportError(file.name, result.error))
          return
        }
        // A MIDI file carries no notation, so the engraver is fed MusicXML
        // written back out of the parsed Score (roadmap 2.20). Before this,
        // a MIDI import was playback-only and the score view stayed blank —
        // REQ-3.2.5 was met for playing and not for reading.
        loadScore({
          score: result.value,
          sourceName: file.name,
          musicXml: writeMusicXml(result.value),
        })
      } else {
        setImportError(
          `"${file.name}" is not a file this app can open — use .musicxml, .xml, .mxl, .mid or .midi.`,
        )
      }
    } catch (reason) {
      const detail = reason instanceof Error ? reason.message : String(reason)
      setImportError(describeImportError(file.name, detail))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="import-panel">
      <label htmlFor={inputId}>Import a score (.musicxml, .xml, .mxl, .mid, .midi)</label>
      <input
        id={inputId}
        type="file"
        accept=".musicxml,.xml,.mxl,.mid,.midi"
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
