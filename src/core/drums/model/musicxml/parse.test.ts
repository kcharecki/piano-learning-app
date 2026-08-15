import { describe, expect, it } from 'vitest'
import { unwrap } from '@core/shared/result.ts'
import { moneyBeat } from '../referenceGrooves.ts'
import { parseDrumMusicXml } from './parse.ts'
import { writeDrumMusicXml } from './write.ts'

describe('parseDrumMusicXml: error paths', () => {
  it('rejects malformed XML', () => {
    const result = parseDrumMusicXml('<score-partwise><unterminated>')
    expect(result.ok).toBe(false)
  })

  it('rejects a document whose root is not <score-partwise>', () => {
    const result = parseDrumMusicXml('<score-timewise></score-timewise>')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('score-partwise')
  })

  it('rejects a score with no <score-part>', () => {
    const result = parseDrumMusicXml('<score-partwise><part-list></part-list></score-partwise>')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('score-part')
  })

  it('rejects a score with no <part>', () => {
    const xml =
      '<score-partwise><part-list><score-part id="P1"><part-name>Drums</part-name></score-part></part-list></score-partwise>'
    const result = parseDrumMusicXml(xml)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('<part>')
  })

  it('rejects a note referencing an unrecognised <instrument> id', () => {
    const xml =
      '<score-partwise>' +
      '<part-list><score-part id="P1"><part-name>Drums</part-name>' +
      '<score-instrument id="P1-I1"><instrument-name>Kick</instrument-name></score-instrument>' +
      '</score-part></part-list>' +
      '<part id="P1"><measure number="1">' +
      '<attributes><divisions>480</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>' +
      '<note><unpitched><display-step>F</display-step><display-octave>4</display-octave></unpitched>' +
      '<duration>480</duration><instrument id="P1-I9"/><voice>1</voice><type>quarter</type></note>' +
      '</measure></part></score-partwise>'
    const result = parseDrumMusicXml(xml)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('unrecognised instrument')
  })

  it('rejects a note with no <duration>', () => {
    const xml =
      '<score-partwise>' +
      '<part-list><score-part id="P1"><part-name>Drums</part-name>' +
      '<score-instrument id="P1-I1"><instrument-name>Kick</instrument-name></score-instrument>' +
      '</score-part></part-list>' +
      '<part id="P1"><measure number="1">' +
      '<attributes><divisions>480</divisions></attributes>' +
      '<note><unpitched><display-step>F</display-step><display-octave>4</display-octave></unpitched>' +
      '<instrument id="P1-I1"/><voice>1</voice><type>quarter</type></note>' +
      '</measure></part></score-partwise>'
    const result = parseDrumMusicXml(xml)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('<duration>')
  })

  it('rejects a <backup> that moves before the start of the measure', () => {
    const xml =
      '<score-partwise>' +
      '<part-list><score-part id="P1"><part-name>Drums</part-name>' +
      '<score-instrument id="P1-I1"><instrument-name>Kick</instrument-name></score-instrument>' +
      '</score-part></part-list>' +
      '<part id="P1"><measure number="1">' +
      '<attributes><divisions>480</divisions></attributes>' +
      '<backup><duration>10</duration></backup>' +
      '</measure></part></score-partwise>'
    const result = parseDrumMusicXml(xml)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('backup')
  })

  it('a note with neither <unpitched> nor <rest> is rejected', () => {
    const xml =
      '<score-partwise>' +
      '<part-list><score-part id="P1"><part-name>Drums</part-name>' +
      '<score-instrument id="P1-I1"><instrument-name>Kick</instrument-name></score-instrument>' +
      '</score-part></part-list>' +
      '<part id="P1"><measure number="1">' +
      '<attributes><divisions>480</divisions></attributes>' +
      '<note><pitch><step>C</step><octave>4</octave></pitch>' +
      '<duration>480</duration><instrument id="P1-I1"/><voice>1</voice><type>quarter</type></note>' +
      '</measure></part></score-partwise>'
    const result = parseDrumMusicXml(xml)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('neither')
  })
})

describe('parseDrumMusicXml: the foreign-file GM-note fallback', () => {
  it('resolves a pad from <midi-unpitched> when no <instrument-name> matches', () => {
    // No <instrument-name> at all -- forces the padByGmNote fallback (./instrument.ts).
    // GM note 38 (written 1-based as 39) is snare's note.
    const xml =
      '<score-partwise>' +
      '<part-list><score-part id="P1"><part-name>Drums</part-name>' +
      '<score-instrument id="P1-I1"></score-instrument>' +
      '<midi-instrument id="P1-I1"><midi-channel>10</midi-channel><midi-unpitched>39</midi-unpitched></midi-instrument>' +
      '</score-part></part-list>' +
      '<part id="P1"><measure number="1">' +
      '<attributes><divisions>480</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>' +
      '<note><unpitched><display-step>C</display-step><display-octave>5</display-octave></unpitched>' +
      '<duration>480</duration><instrument id="P1-I1"/><voice>1</voice><type>quarter</type></note>' +
      '</measure></part></score-partwise>'
    const result = parseDrumMusicXml(xml, { id: 'foreign' })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value.notes[0]?.pad).toBe('snare')
  })
})

describe('parseDrumMusicXml: title extraction', () => {
  it('prefers <work><work-title> over <movement-title>', () => {
    const score = moneyBeat()
    const xml = writeDrumMusicXml(score)
    const parsed = unwrap(parseDrumMusicXml(xml, { id: score.id }))
    expect(parsed.title).toBe('Money Beat')
  })

  it('falls back to <movement-title> when there is no <work>', () => {
    const xml =
      '<score-partwise><movement-title>Fallback Title</movement-title>' +
      '<part-list><score-part id="P1"><part-name>Drums</part-name>' +
      '<score-instrument id="P1-I1"><instrument-name>Kick</instrument-name></score-instrument>' +
      '</score-part></part-list>' +
      '<part id="P1"><measure number="1">' +
      '<attributes><divisions>480</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>' +
      '</measure></part></score-partwise>'
    const result = parseDrumMusicXml(xml, { id: 'g' })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value.title).toBe('Fallback Title')
  })

  it('defaults the title to empty when neither is present', () => {
    const xml =
      '<score-partwise>' +
      '<part-list><score-part id="P1"><part-name>Drums</part-name>' +
      '<score-instrument id="P1-I1"><instrument-name>Kick</instrument-name></score-instrument>' +
      '</score-part></part-list>' +
      '<part id="P1"><measure number="1">' +
      '<attributes><divisions>480</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>' +
      '</measure></part></score-partwise>'
    const result = parseDrumMusicXml(xml, { id: 'g' })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value.title).toBe('')
  })
})
