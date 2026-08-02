/**
 * Tests for `.mxl` unpacking (REQ-3.2.5).
 *
 * Every fixture is a ZIP built in-test with `fflate`'s `zipSync`, so every case
 * is explicit and no binary fixture file is needed. `parseMusicXml` is imported
 * here ONLY, to prove the two compose — `mxl.ts` never calls it.
 */
import { zipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { unpackMxl } from './mxl.ts'
import { parseMusicXml } from './musicxml.ts'
import { isErr, isOk, type Result } from '@core/shared/result.ts'

const encoder = new TextEncoder()
const bytes = (s: string): Uint8Array => encoder.encode(s)

// A minimal but complete score-partwise document: one measure, one quarter note.
const VALID_MUSICXML = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <work><work-title>Test Piece</work-title></work>
  <part-list>
    <score-part id="P1"><part-name>Piano</part-name></score-part>
  </part-list>
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>1</divisions>
        <key><fifths>0</fifths></key>
        <time><beats>4</beats><beat-type>4</beat-type></time>
      </attributes>
      <note>
        <pitch><step>C</step><octave>4</octave></pitch>
        <duration>1</duration><type>quarter</type>
      </note>
    </measure>
  </part>
</score-partwise>`

const containerXml = (fullPath: string): string =>
  `<?xml version="1.0" encoding="UTF-8"?>
<container>
  <rootfiles>
    <rootfile full-path="${fullPath}" media-type="application/vnd.recordare.musicxml+xml"/>
  </rootfiles>
</container>`

const value = (r: Result<string, string>): string => {
  if (!r.ok) throw new Error(`expected ok, got err: ${r.error}`)
  return r.value
}

describe('unpackMxl', () => {
  it('reads the rootfile named by META-INF/container.xml', () => {
    const archive = zipSync({
      'META-INF/container.xml': bytes(containerXml('score.musicxml')),
      'score.musicxml': bytes(VALID_MUSICXML),
    })
    const result = unpackMxl(archive)
    // Mutant: returning the container.xml text itself, or the wrong entry.
    expect(value(result)).toBe(VALID_MUSICXML)
    // Mutant: composing wrong with parseMusicXml (e.g. off-by-one slicing of the text).
    const score = parseMusicXml(value(result))
    expect(isOk(score)).toBe(true)
    if (score.ok) expect(score.value.meta.title).toBe('Test Piece')
  })

  it('resolves a rootfile in a subdirectory', () => {
    const archive = zipSync({
      'META-INF/container.xml': bytes(containerXml('MusicXML/score.musicxml')),
      'MusicXML/score.musicxml': bytes(VALID_MUSICXML),
    })
    // Mutant: path matching that ignores the subdirectory prefix and picks a
    // same-named file at the root, or fails to find it at all.
    expect(value(unpackMxl(archive))).toBe(VALID_MUSICXML)
  })

  it('resolves a rootfile path with a leading "./"', () => {
    const archive = zipSync({
      'META-INF/container.xml': bytes(containerXml('./score.musicxml')),
      'score.musicxml': bytes(VALID_MUSICXML),
    })
    // Mutant: comparing paths literally without stripping "./", causing a spurious fallback.
    expect(value(unpackMxl(archive))).toBe(VALID_MUSICXML)
  })

  it('falls back to the first non-META-INF .musicxml/.xml entry when container.xml is missing', () => {
    const archive = zipSync({
      'readme.txt': bytes('not music'),
      'score.musicxml': bytes(VALID_MUSICXML),
    })
    // Mutant: requiring container.xml to exist, or picking readme.txt.
    expect(value(unpackMxl(archive))).toBe(VALID_MUSICXML)
  })

  it('falls back to the first usable entry when container.xml is malformed XML', () => {
    const archive = zipSync({
      'META-INF/container.xml': bytes('<container><rootfiles><rootfile full-path='), // unclosed
      'score.musicxml': bytes(VALID_MUSICXML),
    })
    // Mutant: propagating the container.xml parse error as an err instead of falling back.
    expect(value(unpackMxl(archive))).toBe(VALID_MUSICXML)
  })

  it('falls back to the first usable entry when the named rootfile is not in the archive', () => {
    const archive = zipSync({
      'META-INF/container.xml': bytes(containerXml('missing.musicxml')),
      'score.musicxml': bytes(VALID_MUSICXML),
    })
    // Mutant: returning err instead of falling back on a dangling rootfile reference.
    expect(value(unpackMxl(archive))).toBe(VALID_MUSICXML)
  })

  it('excludes META-INF entries from the fallback scan', () => {
    const archive = zipSync({
      'META-INF/container.xml': bytes(containerXml('missing.musicxml')),
      'META-INF/other.xml': bytes('<not-really-music/>'),
      'score.musicxml': bytes(VALID_MUSICXML),
    })
    // Mutant: fallback scan that does not exclude META-INF, picking other.xml instead.
    expect(value(unpackMxl(archive))).toBe(VALID_MUSICXML)
  })

  it('returns err when container.xml is present but nothing usable exists', () => {
    const archive = zipSync({
      'META-INF/container.xml': bytes(containerXml('score.musicxml')),
      'readme.txt': bytes('not music'),
    })
    const result = unpackMxl(archive)
    // Mutant: returning ok with readme.txt's content, or throwing instead of err.
    expect(isErr(result)).toBe(true)
    expect(() => unpackMxl(archive)).not.toThrow()
  })

  it('strips a leading UTF-8 BOM so parseMusicXml succeeds', () => {
    const archive = zipSync({
      'META-INF/container.xml': bytes(containerXml('score.musicxml')),
      'score.musicxml': bytes('﻿' + VALID_MUSICXML),
    })
    const text = value(unpackMxl(archive))
    // Mutant: leaving the BOM in place, which breaks parseMusicXml's `<?xml` check.
    expect(text.charCodeAt(0)).not.toBe(0xfeff)
    expect(text.startsWith('<?xml')).toBe(true)
    expect(isOk(parseMusicXml(text))).toBe(true)
  })

  it('reads a stored (uncompressed, method 0) entry', () => {
    const archive = zipSync({
      'META-INF/container.xml': [bytes(containerXml('score.musicxml')), { level: 0 }],
      'score.musicxml': [bytes(VALID_MUSICXML), { level: 0 }],
    })
    // Mutant: assuming every entry is deflated and mis-handling stored data.
    expect(value(unpackMxl(archive))).toBe(VALID_MUSICXML)
  })

  it('returns err, and never throws, for an empty Uint8Array', () => {
    expect(() => unpackMxl(new Uint8Array(0))).not.toThrow()
    // Mutant: treating empty input as ok, or not special-casing it before unzipSync.
    expect(isErr(unpackMxl(new Uint8Array(0)))).toBe(true)
  })

  it('returns err, and never throws, for random non-ZIP bytes', () => {
    const garbage = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 255, 254, 0, 128])
    // Mutant: letting fflate's throw on a corrupt archive escape unpackMxl.
    expect(() => unpackMxl(garbage)).not.toThrow()
    expect(isErr(unpackMxl(garbage))).toBe(true)
  })

  it('returns err, and never throws, for a raw (non-zipped) MusicXML file handed in by mistake', () => {
    const raw = bytes(VALID_MUSICXML)
    // Mutant: accidentally treating plain XML bytes as a valid empty/degenerate ZIP and returning ok.
    expect(() => unpackMxl(raw)).not.toThrow()
    expect(isErr(unpackMxl(raw))).toBe(true)
  })
})
