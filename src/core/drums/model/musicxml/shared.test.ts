import { describe, expect, it } from 'vitest'
import { dotFactor, escapeXml, isDynamicsClass, MIDI_PERCUSSION_CHANNEL, typeAndDots } from './shared.ts'

describe('escapeXml', () => {
  it('escapes the five XML-special characters', () => {
    expect(escapeXml(`&<>"'`)).toBe('&amp;&lt;&gt;&quot;&apos;')
  })

  it('leaves ordinary text untouched', () => {
    expect(escapeXml('Money Beat')).toBe('Money Beat')
  })
})

describe('dotFactor', () => {
  it('0 dots is x1, 1 dot is x1.5, 2 dots is x1.75', () => {
    expect(dotFactor(0)).toBe(1)
    expect(dotFactor(1)).toBe(1.5)
    expect(dotFactor(2)).toBe(1.75)
  })
})

describe('typeAndDots', () => {
  it('maps common drum durations to their MusicXML <type>', () => {
    expect(typeAndDots(480, 480)).toEqual({ type: 'quarter', dots: 0 })
    expect(typeAndDots(240, 480)).toEqual({ type: 'eighth', dots: 0 })
    expect(typeAndDots(120, 480)).toEqual({ type: '16th', dots: 0 })
    expect(typeAndDots(1920, 480)).toEqual({ type: 'whole', dots: 0 })
  })

  it('prefers a dotted type over the next-smaller undotted one', () => {
    expect(typeAndDots(720, 480)).toEqual({ type: 'quarter', dots: 1 }) // dotted quarter = 720
    expect(typeAndDots(360, 480)).toEqual({ type: 'eighth', dots: 1 }) // dotted eighth = 360
  })
})

describe('isDynamicsClass', () => {
  it('accepts exactly accent/normal/ghost', () => {
    expect(isDynamicsClass('accent')).toBe(true)
    expect(isDynamicsClass('normal')).toBe(true)
    expect(isDynamicsClass('ghost')).toBe(true)
    expect(isDynamicsClass('forte')).toBe(false)
  })
})

describe('MIDI_PERCUSSION_CHANNEL', () => {
  it('is GM channel 10', () => {
    expect(MIDI_PERCUSSION_CHANNEL).toBe(10)
  })
})
