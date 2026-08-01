import type { MidiDevice } from '@core/ports/index.ts'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { MidiDeviceStatus } from './MidiDeviceStatus.tsx'

afterEach(cleanup)

const DEVICE: MidiDevice = { id: 'a', name: 'Keyboard A', manufacturer: 'Test' }

describe('MidiDeviceStatus', () => {
  it('shows the graceful "no MIDI keyboard connected" state when nothing is connected', () => {
    render(
      <MidiDeviceStatus
        connected={false}
        devices={[]}
        selectedDeviceId={null}
        connectionError={undefined}
      />,
    )
    expect(screen.getByRole('status')).toHaveTextContent(/no MIDI keyboard connected/i)
  })

  it('shows the same graceful state when connected but nothing is selected yet', () => {
    render(
      <MidiDeviceStatus
        connected
        devices={[DEVICE]}
        selectedDeviceId={null}
        connectionError={undefined}
      />,
    )
    expect(screen.getByRole('status')).toHaveTextContent(/no MIDI keyboard connected/i)
  })

  it('names the connected device once one is selected', () => {
    render(
      <MidiDeviceStatus
        connected
        devices={[DEVICE]}
        selectedDeviceId="a"
        connectionError={undefined}
      />,
    )
    expect(screen.getByRole('status')).toHaveTextContent('Keyboard A')
  })

  it('surfaces a connection error alongside the graceful state', () => {
    render(
      <MidiDeviceStatus
        connected={false}
        devices={[]}
        selectedDeviceId={null}
        connectionError="Web MIDI API is not available in this browser."
      />,
    )
    expect(screen.getByRole('status')).toHaveTextContent(
      'Web MIDI API is not available in this browser.',
    )
  })
})
