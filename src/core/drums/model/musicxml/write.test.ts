import { describe, expect, it } from 'vitest'
import { makeGrooveScore } from '../groove.ts'
import { moneyBeat, moneyBeatOpenHat } from '../referenceGrooves.ts'
import { writeDrumMusicXml } from './write.ts'

/** The `<note>...</note>` block that declares the given `<instrument id>`. */
function noteContaining(xml: string, instrumentId: string): string {
  const marker = `<instrument id="${instrumentId}"/>`
  const at = xml.indexOf(marker)
  expect(at).toBeGreaterThan(-1)
  const start = xml.lastIndexOf('<note>', at)
  const end = xml.indexOf('</note>', at) + '</note>'.length
  return xml.slice(start, end)
}

describe('writeDrumMusicXml', () => {
  it('declares a percussion clef and the requested time signature', () => {
    const xml = writeDrumMusicXml(moneyBeat())
    expect(xml).toContain('<clef><sign>percussion</sign></clef>')
    expect(xml).toContain('<time><beats>4</beats><beat-type>4</beat-type></time>')
    expect(xml).toContain('<divisions>480</divisions>')
  })

  it('writes <attributes> children in xs:sequence order: divisions, then time, then clef (G3)', () => {
    const xml = writeDrumMusicXml(moneyBeat())
    const divisionsAt = xml.indexOf('<divisions>')
    const timeAt = xml.indexOf('<time>')
    const clefAt = xml.indexOf('<clef>')
    expect(divisionsAt).toBeGreaterThan(-1)
    expect(timeAt).toBeGreaterThan(divisionsAt)
    expect(clefAt).toBeGreaterThan(timeAt)
  })

  it('kick (feet) is voice 2 with stem down; snare/hi-hat (hands) are voice 1 with stem up — kills a voice/stem swap mutant', () => {
    // moneyBeat() uses kick, snare, hhClosed only, declared in that
    // MAPPED_PADS order, so instrumentIdFor gives P1-I1/I2/I3 respectively.
    const xml = writeDrumMusicXml(moneyBeat())
    const kickNote = noteContaining(xml, 'P1-I1')
    expect(kickNote).toContain('<voice>2</voice>')
    expect(kickNote).toContain('<stem>down</stem>')
    const snareNote = noteContaining(xml, 'P1-I2')
    expect(snareNote).toContain('<voice>1</voice>')
    expect(snareNote).toContain('<stem>up</stem>')
    const hihatNote = noteContaining(xml, 'P1-I3')
    expect(hihatNote).toContain('<voice>1</voice>')
    expect(hihatNote).toContain('<stem>up</stem>')
  })

  it('writes <sound><straight/></sound> for straight time (swingPercent=50), no first/second', () => {
    const xml = writeDrumMusicXml(moneyBeat())
    expect(xml).toContain('<sound><swing><straight/></swing></sound>')
    expect(xml).not.toContain('<first>')
  })

  it('writes an exact <first>/<second> integer ratio summing to 100 for a swung groove', () => {
    const swung = makeGrooveScore({ id: 'g', measureCount: 1, swingPercent: 63, notes: [] })
    const xml = writeDrumMusicXml(swung)
    expect(xml).toContain('<first>63</first><second>37</second>')
  })

  it('writes <swing-type>eighth</swing-type> for an eighth-swung groove and <swing-type>16th</swing-type> for a sixteenth-swung one (G2)', () => {
    const eighthSwung = makeGrooveScore({ id: 'g', measureCount: 1, swingPercent: 63, swingUnit: 'eighth', notes: [] })
    expect(writeDrumMusicXml(eighthSwung)).toContain('<swing-type>eighth</swing-type>')

    const sixteenthSwung = makeGrooveScore({
      id: 'g',
      measureCount: 1,
      swingPercent: 63,
      swingUnit: 'sixteenth',
      notes: [],
    })
    expect(writeDrumMusicXml(sixteenthSwung)).toContain('<swing-type>16th</swing-type>')
  })

  it('omits <swing-type> for straight time — swingUnit is canonicalised and meaningless there', () => {
    const xml = writeDrumMusicXml(moneyBeat())
    expect(xml).not.toContain('<swing-type>')
  })

  it('marks a ghost note with a parenthesised notehead, and an accent with <accent/>', () => {
    const score = makeGrooveScore({
      id: 'g',
      measureCount: 1,
      notes: [
        { pad: 'snare', tick: 0, durationTicks: 120, dynamics: 'ghost' },
        { pad: 'snare', tick: 480, durationTicks: 480, dynamics: 'accent' },
      ],
    })
    const xml = writeDrumMusicXml(score)
    expect(xml).toContain('parentheses="yes"')
    expect(xml).toContain('<accent/>')
  })

  it('writes the open articulation as <technical><open/></technical>', () => {
    const xml = writeDrumMusicXml(moneyBeatOpenHat())
    expect(xml).toContain('<technical><open/></technical>')
  })

  it('writes the choke articulation as <other-technical>choke</other-technical>, never the schema-illegal <damp/> (G4)', () => {
    const score = makeGrooveScore({
      id: 'g',
      measureCount: 1,
      notes: [{ pad: 'crash1', tick: 0, durationTicks: 240, articulations: ['choke'] }],
    })
    const xml = writeDrumMusicXml(score)
    expect(xml).toContain('<technical><other-technical>choke</other-technical></technical>')
    expect(xml).not.toContain('<damp')
  })

  it('writes choke and sticking together as two <other-technical> children on the same note', () => {
    const score = makeGrooveScore({
      id: 'g',
      measureCount: 1,
      notes: [{ pad: 'crash1', tick: 0, durationTicks: 240, articulations: ['choke'], sticking: 'R' }],
    })
    const xml = writeDrumMusicXml(score)
    expect(xml).toContain(
      '<technical><other-technical>choke</other-technical><other-technical>R</other-technical></technical>',
    )
  })

  it('declares one <score-instrument>/<midi-instrument> pair per pad actually used, not all 16', () => {
    const xml = writeDrumMusicXml(moneyBeat()) // uses kick, snare, hhClosed only
    const scoreInstrumentCount = (xml.match(/<score-instrument /g) ?? []).length
    expect(scoreInstrumentCount).toBe(3)
    expect(xml).toContain('<instrument-name>Kick</instrument-name>')
    expect(xml).toContain('<instrument-name>Snare</instrument-name>')
    expect(xml).toContain('<instrument-name>Hi-Hat (Closed)</instrument-name>')
    expect(xml).not.toContain('Crash')
  })

  it('omits <work> entirely for an empty title', () => {
    const score = makeGrooveScore({ id: 'g', measureCount: 1, notes: [] })
    expect(writeDrumMusicXml(score)).not.toContain('<work>')
  })

  it('escapes special characters in the title', () => {
    const score = makeGrooveScore({ id: 'g', title: 'Rock & "Roll"', measureCount: 1, notes: [] })
    expect(writeDrumMusicXml(score)).toContain('Rock &amp; &quot;Roll&quot;')
  })

  it('a silent measure has no note, rest, or backup elements at all — no voice stream ever opens', () => {
    const score = makeGrooveScore({ id: 'g', measureCount: 1, notes: [] })
    const xml = writeDrumMusicXml(score)
    expect(xml).not.toContain('<note>')
    expect(xml).not.toContain('<rest')
    expect(xml).not.toContain('<backup>')
  })
})
