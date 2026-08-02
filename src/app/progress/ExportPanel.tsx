/**
 * Export/import screen (roadmap 4.6a, REQ-3.10.4/4.3) — the only consumer
 * `@core/progress/export.ts` has. "All progress data SHALL be exportable and
 * owned locally by the user" (REQ-3.10.4) is only half met by a Download
 * button: an export nobody can restore is not ownership, so the file picker
 * that reads a file back through `importProgress` is not optional either.
 *
 * A bad file is an ordinary case (hand-edited, from an older version, or just
 * not a progress export) — its readable `Err` is shown as text, never a
 * crash or a console log, matching `ImportPanel.tsx`'s own contract.
 *
 * Restoring REPLACES every store `snapshot.ts` knows how to write into, so a
 * successfully-parsed file is held in `pending` — nothing is applied — until
 * the learner explicitly confirms in the UI. `snapshot.ts` does the actual
 * store reads/writes; this component never touches a store directly.
 */
import { exportCsv, exportJson, importProgress, type CsvBundle, type ProgressSnapshot } from '@core/progress/export.ts'
import type { DateSource } from '@core/ports/index.ts'
import { strToU8, zipSync } from 'fflate'
import { useId, useState } from 'react'
import { applyProgressSnapshot, gatherProgressSnapshot } from './snapshot.ts'

export type ExportPanelProps = {
  /** Epoch-ms source for the export's `exportedAt`. Defaults to the real browser clock. */
  readonly date?: DateSource
}

const defaultDate: DateSource = { epochMillis: () => Date.now() }

const JSON_FILENAME = 'piano-progress.json'
const CSV_ZIP_FILENAME = 'piano-progress-csv.zip'

/**
 * Triggers a browser download of `blob` named `filename` via a Blob + object
 * URL, then revokes the URL — otherwise every click leaks one.
 */
function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

/** One ZIP entry per CSV in the bundle — see `@core/progress/export.ts`'s own
 *  reasoning for why a single flat CSV cannot represent this. */
function csvBundleToZip(bundle: CsvBundle): Uint8Array {
  const files: Record<string, Uint8Array> = {}
  for (const [name, csv] of Object.entries(bundle)) {
    files[`${name}.csv`] = strToU8(csv)
  }
  return zipSync(files)
}

type PendingRestore = {
  readonly snapshot: ProgressSnapshot
  readonly fileName: string
}

export function ExportPanel(props: ExportPanelProps) {
  const date = props.date ?? defaultDate
  const fileInputId = useId()
  const [error, setError] = useState<string | undefined>(undefined)
  const [status, setStatus] = useState<string | undefined>(undefined)
  const [pending, setPending] = useState<PendingRestore | undefined>(undefined)
  const [busy, setBusy] = useState(false)

  function handleDownloadJson(): void {
    setError(undefined)
    try {
      const snapshot = gatherProgressSnapshot(date)
      downloadBlob(new Blob([exportJson(snapshot)], { type: 'application/json' }), JSON_FILENAME)
      setStatus(`Downloaded ${JSON_FILENAME}`)
    } catch (reason) {
      setError(`Could not export: ${reason instanceof Error ? reason.message : String(reason)}`)
    }
  }

  function handleDownloadCsv(): void {
    setError(undefined)
    try {
      const snapshot = gatherProgressSnapshot(date)
      const zipBytes = csvBundleToZip(exportCsv(snapshot))
      // Copied into a fresh ArrayBuffer: fflate types its output as
      // `Uint8Array<ArrayBufferLike>`, which is not a `BlobPart` under the DOM
      // lib (same note as `ImportPanel.test.tsx`'s `.mxl` fixture builder).
      const buffer = new ArrayBuffer(zipBytes.length)
      new Uint8Array(buffer).set(zipBytes)
      downloadBlob(new Blob([buffer], { type: 'application/zip' }), CSV_ZIP_FILENAME)
      setStatus(`Downloaded ${CSV_ZIP_FILENAME}`)
    } catch (reason) {
      setError(`Could not export: ${reason instanceof Error ? reason.message : String(reason)}`)
    }
  }

  async function handleFile(file: File): Promise<void> {
    setBusy(true)
    setError(undefined)
    setStatus(undefined)
    try {
      const text = await file.text()
      const result = importProgress(text)
      if (!result.ok) {
        setError(`Could not read "${file.name}": ${result.error}`)
        setPending(undefined)
        return
      }
      setPending({ snapshot: result.value, fileName: file.name })
    } catch (reason) {
      const detail = reason instanceof Error ? reason.message : String(reason)
      setError(`Could not read "${file.name}": ${detail}`)
      setPending(undefined)
    } finally {
      setBusy(false)
    }
  }

  function confirmRestore(): void {
    if (pending === undefined) return
    applyProgressSnapshot(pending.snapshot)
    setStatus(`Restored progress from "${pending.fileName}". Previous progress was replaced.`)
    setPending(undefined)
  }

  function cancelRestore(): void {
    setPending(undefined)
  }

  return (
    <div className="export-panel">
      <h2>Export &amp; restore progress</h2>

      <section aria-label="Export progress" role="group">
        <p>
          Practice log, flashcards, sight-reading history, and assessments are exportable and
          stay local (REQ-3.10.4).
        </p>
        <button type="button" onClick={handleDownloadJson}>
          Download JSON
        </button>
        <button type="button" onClick={handleDownloadCsv}>
          Download CSV
        </button>
      </section>

      <section aria-label="Restore progress" role="group">
        <label htmlFor={fileInputId}>Restore from a file (replaces current progress)</label>
        <input
          id={fileInputId}
          type="file"
          accept=".json"
          disabled={busy || pending !== undefined}
          onChange={(event) => {
            const file = event.target.files?.[0]
            event.target.value = ''
            if (file !== undefined) void handleFile(file)
          }}
        />

        {error !== undefined && (
          <p role="alert" className="export-panel-error">
            {error}
          </p>
        )}

        {pending !== undefined && (
          <div role="group" aria-label="Confirm restore">
            <p>
              Restoring &quot;{pending.fileName}&quot; will REPLACE all current progress except
              saved recordings. This cannot be undone.
            </p>
            <button type="button" onClick={confirmRestore}>
              Replace my progress
            </button>
            <button type="button" onClick={cancelRestore}>
              Cancel
            </button>
          </div>
        )}

        {status !== undefined && (
          <p role="status" className="export-panel-status">
            {status}
          </p>
        )}
      </section>
    </div>
  )
}
