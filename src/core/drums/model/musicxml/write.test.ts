import { describe, expect, it } from 'vitest'
import { makeGrooveScore } from '../groove.ts'
import { moneyBeat, moneyBeatOpenHat } from '../referenceGrooves.ts'
import { writeDrumMusicXml } from './write.ts'

describe('writeDrumMusicXml', () => {
  it('declares a percussion clef and the requested time signature', () => {
    const xml = writeDrumMusicXml(moneyBeat())
    expect(xml).toContain('<clef><sign>percussion</sign></clef>')
    expect(xml).toContain('<time><beats>4</beats><beat-type>4</beat-type></time>')
    expect(xml).toContain('<divisions>480</divisions>')
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
