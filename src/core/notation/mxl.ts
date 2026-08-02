/**
 * Compressed MusicXML (`.mxl`) unpacking (REQ-3.2.5).
 *
 * An `.mxl` file is a ZIP archive. Per the MusicXML spec, `META-INF/container.xml`
 * names the "rootfile" entry inside the archive that holds the actual MusicXML.
 * This module gets from raw archive bytes to that entry's text, ready for
 * `parseMusicXml` (see `./musicxml.ts`) — it never parses music itself.
 *
 * Real files from MuseScore, Sibelius, Finale and random websites do not always
 * follow the spec to the letter, so this is deliberately tolerant: a missing,
 * malformed or dangling container.xml falls back to the first plausible
 * MusicXML-looking entry rather than failing outright. Never throws — a corrupt
 * or unexpected archive is an ordinary `err`.
 */
import { unzipSync, type Unzipped } from 'fflate'
import { err, ok, type Result } from '@core/shared/result.ts'
import { parseXml } from './musicxml.ts'

const BOM = '﻿'

/** Strip a leading `./`, then leading slashes, for tolerant path comparison. */
function normalizePath(path: string): string {
  let p = path.trim().replace(/\\/g, '/')
  while (p.startsWith('./')) p = p.slice(2)
  while (p.startsWith('/')) p = p.slice(1)
  return p
}

const isUnderMetaInf = (normalizedName: string): boolean =>
  normalizedName.toUpperCase().startsWith('META-INF/')

/** First entry (by insertion order) that looks like a MusicXML file, outside META-INF. */
function firstMusicXmlEntry(entries: Unzipped): string | undefined {
  for (const name of Object.keys(entries)) {
    const normalized = normalizePath(name)
    if (isUnderMetaInf(normalized)) continue
    const lower = normalized.toLowerCase()
    if (lower.endsWith('.musicxml') || lower.endsWith('.xml')) return name
  }
  return undefined
}

/** Look up an entry by name, tolerant of a leading `./` or extra leading slashes. */
function findEntry(entries: Unzipped, rootfilePath: string): string | undefined {
  const target = normalizePath(rootfilePath)
  for (const name of Object.keys(entries)) {
    if (normalizePath(name) === target) return name
  }
  return undefined
}

/**
 * The `full-path` of the first `<rootfile>` in a `META-INF/container.xml`, or
 * `undefined` if the entry is absent, malformed, or has no usable rootfile.
 */
function rootfilePathFrom(entries: Unzipped): string | undefined {
  const containerKey = findEntry(entries, 'META-INF/container.xml')
  if (containerKey === undefined) return undefined
  const bytes = entries[containerKey]
  if (bytes === undefined) return undefined
  let text: string
  try {
    text = new TextDecoder('utf-8', { fatal: false }).decode(bytes)
  } catch {
    return undefined
  }
  const parsed = parseXml(text)
  if (!parsed.ok) return undefined
  const rootfiles = parsed.value.children.find((c) => c.tag === 'rootfiles')
  const rootfile = rootfiles?.children.find((c) => c.tag === 'rootfile')
  const fullPath = rootfile?.attrs['full-path']
  return fullPath !== undefined && fullPath.length > 0 ? fullPath : undefined
}

function decodeText(bytes: Uint8Array): string {
  const decoded = new TextDecoder('utf-8', { fatal: false }).decode(bytes)
  return decoded.startsWith(BOM) ? decoded.slice(BOM.length) : decoded
}

/**
 * Unpack a compressed MusicXML (`.mxl`) archive and return the MusicXML text
 * of its rootfile, ready for `parseMusicXml`. Never throws: a corrupt or
 * unexpected archive is an ordinary `err`.
 */
export function unpackMxl(bytes: Uint8Array): Result<string, string> {
  if (bytes.length === 0) return err('the .mxl file is empty')

  let entries: Unzipped
  try {
    entries = unzipSync(bytes)
  } catch (cause) {
    return err(`could not read .mxl as a ZIP archive: ${cause instanceof Error ? cause.message : String(cause)}`)
  }

  const rootfilePath = rootfilePathFrom(entries)
  const chosenKey =
    (rootfilePath === undefined ? undefined : findEntry(entries, rootfilePath)) ??
    firstMusicXmlEntry(entries)

  if (chosenKey === undefined) {
    return err('the .mxl archive has no usable MusicXML entry')
  }

  const fileBytes = entries[chosenKey]
  if (fileBytes === undefined) {
    return err('the .mxl archive has no usable MusicXML entry')
  }
  if (fileBytes.length === 0) {
    return err(`the .mxl entry "${chosenKey}" is empty`)
  }

  return ok(decodeText(fileBytes))
}
