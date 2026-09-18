import { beforeEach, describe, expect, it } from 'vitest'
import { LEARNED_KIT_MAP_NAME } from '@core/drums/kitmap/learn.ts'
import { GM_KIT_MAP, ROLAND_TD_KIT_MAP } from '@core/drums/kitmap/presets.ts'
import { pad, type KitMap } from '@core/drums/kitmap/kitMap.ts'
import { kitMapFor, presetByName, useDrumsKitMapStore } from './drumsKitMapStore.ts'

const LEARNED: KitMap = { name: LEARNED_KIT_MAP_NAME, notes: { 36: pad('kick'), 38: pad('snare') } }

beforeEach(() => {
  useDrumsKitMapStore.setState({ presetName: GM_KIT_MAP.name, learned: undefined })
})

describe('useDrumsKitMapStore', () => {
  it('defaults to General MIDI with no learned map', () => {
    expect(useDrumsKitMapStore.getState().presetName).toBe('General MIDI')
    expect(useDrumsKitMapStore.getState().learned).toBeUndefined()
  })

  it('setPreset stores the chosen name', () => {
    useDrumsKitMapStore.getState().setPreset('Roland TD family')
    expect(useDrumsKitMapStore.getState().presetName).toBe('Roland TD family')
  })

  it('setLearned stores the map and selects it', () => {
    useDrumsKitMapStore.getState().setPreset('Roland TD family')
    useDrumsKitMapStore.getState().setLearned(LEARNED)
    expect(useDrumsKitMapStore.getState().learned).toBe(LEARNED)
    expect(useDrumsKitMapStore.getState().presetName).toBe(LEARNED_KIT_MAP_NAME)
  })

  it('clearLearned falls back to General MIDI when the learned map was selected', () => {
    useDrumsKitMapStore.getState().setLearned(LEARNED)
    useDrumsKitMapStore.getState().clearLearned()
    expect(useDrumsKitMapStore.getState().learned).toBeUndefined()
    expect(useDrumsKitMapStore.getState().presetName).toBe('General MIDI')
  })

  it('clearLearned leaves an unrelated preset selection alone', () => {
    useDrumsKitMapStore.getState().setLearned(LEARNED)
    useDrumsKitMapStore.getState().setPreset('Roland TD family')
    useDrumsKitMapStore.getState().clearLearned()
    expect(useDrumsKitMapStore.getState().learned).toBeUndefined()
    expect(useDrumsKitMapStore.getState().presetName).toBe('Roland TD family')
  })

  it('hydrate replaces the whole state', () => {
    useDrumsKitMapStore.getState().setPreset('Roland TD family')
    useDrumsKitMapStore.getState().hydrate({ presetName: 'Yamaha DTX', learned: LEARNED })
    expect(useDrumsKitMapStore.getState().presetName).toBe('Yamaha DTX')
    expect(useDrumsKitMapStore.getState().learned).toBe(LEARNED)
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

describe('kitMapFor', () => {
  it('resolves the learned map when the preset name names it and one exists', () => {
    expect(kitMapFor(LEARNED_KIT_MAP_NAME, LEARNED)).toBe(LEARNED)
  })

  it('falls back to the preset when the learned name is selected but no map exists', () => {
    expect(kitMapFor(LEARNED_KIT_MAP_NAME, undefined)).toBe(GM_KIT_MAP)
  })

  it('resolves an ordinary preset name via presetByName, ignoring a defined learned map', () => {
    expect(kitMapFor('Roland TD family', LEARNED)).toBe(ROLAND_TD_KIT_MAP)
  })
})
