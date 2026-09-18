import { beforeEach, describe, expect, it } from 'vitest'
import { GM_KIT_MAP, ROLAND_TD_KIT_MAP } from '@core/drums/kitmap/presets.ts'
import { presetByName, useDrumsKitMapStore } from './drumsKitMapStore.ts'

beforeEach(() => {
  useDrumsKitMapStore.setState({ presetName: GM_KIT_MAP.name })
})

describe('useDrumsKitMapStore', () => {
  it('defaults to General MIDI', () => {
    expect(useDrumsKitMapStore.getState().presetName).toBe('General MIDI')
  })

  it('setPreset stores the chosen name', () => {
    useDrumsKitMapStore.getState().setPreset('Roland TD family')
    expect(useDrumsKitMapStore.getState().presetName).toBe('Roland TD family')
  })

  it('hydrate replaces the whole state', () => {
    useDrumsKitMapStore.getState().setPreset('Roland TD family')
    useDrumsKitMapStore.getState().hydrate({ presetName: 'Yamaha DTX' })
    expect(useDrumsKitMapStore.getState().presetName).toBe('Yamaha DTX')
  })
})

describe('presetByName', () => {
  it('returns the preset with a matching name', () => {
    expect(presetByName('Roland TD family')).toBe(ROLAND_TD_KIT_MAP)
  })

  it('falls back to GM_KIT_MAP for an unknown name', () => {
    expect(presetByName('nonexistent-vendor')).toBe(GM_KIT_MAP)
  })

  it('falls back to GM_KIT_MAP for General MIDI itself', () => {
    expect(presetByName('General MIDI')).toBe(GM_KIT_MAP)
  })
})
