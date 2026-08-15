/**
 * Settings destination (roadmap UI-05, 2026-08-12 UI audit): a real settings
 * screen — Appearance, Practice plan, Input and Audio — replacing the old
 * page that was nothing but the onboarding questionnaire re-rendered under a
 * "Set up your practice" heading.
 *
 * Four `.card` sections:
 *  1. **Appearance** — theme as a 3-option `.seg-control` (System/Dark/Light).
 *     Applies instantly via `useThemeStore.setTheme` (which writes
 *     `data-theme` on the root element — see `themeStore.ts`) and persists
 *     through the same versioned-shape mechanism as every other slice
 *     (`persistence.ts`'s `THEME_COLLECTION`/`THEME_KEY`).
 *  2. **Practice plan** — the onboarding questionnaire (`OnboardingFlow`),
 *     collapsed by default to a one-line summary with an Edit button that
 *     expands it inline (`embedded` mode — see that component's own doc).
 *     Finishing still writes exactly what it always has (levels + a session
 *     snapshot); the only addition here is `onFinish`, an informational
 *     callback so this screen can update its own summary line.
 *  3. **Input** — `MidiDeviceStatus` (unchanged, unforked — the same
 *     component the topbar's input-status popover renders) plus a pointer to
 *     the microphone fallback on Practice.
 *  4. **Audio** — a route the learner can actually change, as of roadmap U.2:
 *     Built-in piano sound (Web Audio, works with no hardware) or My
 *     instrument (MIDI-out to a connected digital piano, REQ-4.7's preferred
 *     route — zero synthesis latency, the instrument's own sound). See
 *     `handleSelectAudioRoute` and `@adapters/audio/audioRoute.ts` for the
 *     mechanics; `describeAudioRouteStatus` for the status line's states.
 *
 * Re-running the questionnaire from here still marks the onboarding gate
 * completed (`useOnboardingGate`'s `markCompleted`), exactly like the old
 * screen did — a learner who sets up their plan from Settings (never having
 * seen Today's first-run banner) should not be nagged by it afterwards.
 */
import { useEffect, useState } from 'react'
import type { MidiInput, Store } from '@core/ports/index.ts'
import {
  connectMidiOutputRoute,
  getAudioOutputRoute,
  setAudioOutputRoute,
  type AudioOutputRoute,
  type ConnectMidiOutput,
} from '@adapters/audio/audioRoute.ts'
import { MidiDeviceStatus } from '@app/practice/MidiDeviceStatus.tsx'
import { useMidiConnection, type ConnectMidi } from '@app/practice/useMidiConnection.ts'
import { useLevelStore } from '@app/state/levelStore.ts'
import { useThemeStore, type ThemePreference } from '@app/state/themeStore.ts'
import { OnboardingFlow } from './OnboardingFlow.tsx'
import {
  describeLevel,
  EXPERIENCE_LABEL,
  GOAL_LABEL,
  type OnboardingAnswers,
} from './onboardingPlan.ts'
import { useOnboardingGate } from './useOnboardingGate.ts'

export type SettingsScreenProps = {
  /** Shell's own navigation, so "Back to Today" is a real nav action, not a dead link. */
  readonly onGoToToday: () => void
  /** Injection seams for the Input section's live MIDI connection; default to the real Web MIDI adapter, mirroring `InputCapabilityBanner`. */
  readonly midiInput?: MidiInput
  readonly connectMidi?: ConnectMidi
  /** Test seam for the Audio section's MIDI-out connection attempt; defaults to the real Web MIDI adapter. Independent of `connectMidi` above — see `audioRoute.ts`'s module comment on why Input and Audio each open their own connection. */
  readonly connectMidiOutput?: ConnectMidiOutput
  /** Test seam forwarded to the embedded plan editor's session-run write; defaults to the real IndexedDB store. */
  readonly openStore?: () => Promise<Store>
}

const THEME_OPTIONS: readonly { readonly value: ThemePreference; readonly label: string }[] = [
  { value: 'system', label: 'System' },
  { value: 'dark', label: 'Dark' },
  { value: 'light', label: 'Light' },
]

const AUDIO_ROUTE_OPTIONS: readonly { readonly value: AudioOutputRoute; readonly label: string }[] = [
  { value: 'webaudio', label: 'Built-in piano sound' },
  { value: 'midi', label: 'My instrument' },
]

type MidiRouteStatus = 'idle' | 'connecting' | 'connected' | 'error'

/** The Audio card's status line — the one place "what does the learner actually hear" is stated, so it must always be true of what `createDefaultAudioOutput` really does. */
function describeAudioRouteStatus(
  route: AudioOutputRoute,
  midiStatus: MidiRouteStatus,
  midiError: string | undefined,
): string {
  if (route === 'webaudio') return 'Sound: built-in piano sounds'
  if (midiStatus === 'connecting') return 'Sound: connecting to your instrument…'
  if (midiStatus === 'connected') return 'Sound: routed to your connected instrument'
  if (midiStatus === 'error') return `Sound: built-in piano sounds — couldn't reach your instrument (${midiError ?? 'connection failed'})`
  return 'Sound: built-in piano sounds'
}

export function SettingsScreen({
  onGoToToday,
  midiInput,
  connectMidi,
  connectMidiOutput,
  openStore,
}: SettingsScreenProps) {
  const gate = useOnboardingGate()
  const theme = useThemeStore((s) => s.theme)
  const setTheme = useThemeStore((s) => s.setTheme)
  const levels = useLevelStore((s) => s.levelState.levels)

  const [editingPlan, setEditingPlan] = useState(false)
  const [lastAnswers, setLastAnswers] = useState<OnboardingAnswers | undefined>(undefined)

  const midi = useMidiConnection(
    midiInput !== undefined ? { midiInput } : connectMidi !== undefined ? { connect: connectMidi } : {},
  )

  const [audioRoute, setAudioRoute] = useState<AudioOutputRoute>(() => getAudioOutputRoute())
  const [midiRouteStatus, setMidiRouteStatus] = useState<MidiRouteStatus>('idle')
  const [midiRouteError, setMidiRouteError] = useState<string | undefined>(undefined)

  // Reconnects whenever this screen mounts with MIDI already the learner's
  // choice — mirroring how `useMidiConnection` reconnects its input per-mount
  // rather than at app boot (see that file's module comment) — and again
  // whenever the learner flips the toggle to MIDI. Never fires on 'webaudio'.
  useEffect(() => {
    if (audioRoute !== 'midi') {
      setMidiRouteStatus('idle')
      return undefined
    }
    let cancelled = false
    setMidiRouteStatus('connecting')
    connectMidiOutputRoute(connectMidiOutput)
      .then((result) => {
        if (cancelled) return
        setMidiRouteStatus(result.ok ? 'connected' : 'error')
        setMidiRouteError(result.ok ? undefined : result.error)
      })
      .catch((reason: unknown) => {
        if (cancelled) return
        setMidiRouteStatus('error')
        setMidiRouteError(reason instanceof Error ? reason.message : String(reason))
      })
    return () => {
      cancelled = true
    }
  }, [audioRoute, connectMidiOutput])

  function handlePlanDone(): void {
    gate.markCompleted()
    setEditingPlan(false)
  }

  function handleSelectAudioRoute(route: AudioOutputRoute): void {
    setAudioRoute(route)
    setAudioOutputRoute(route)
  }

  return (
    <div className="page page--focus">
      <header className="page-header">
        <h1>Settings</h1>
        <div className="page-header-actions">
          <button type="button" className="btn-ghost" onClick={onGoToToday}>
            Back to Today
          </button>
        </div>
      </header>

      <section className="card" aria-labelledby="settings-appearance-heading">
        <h2 id="settings-appearance-heading">Appearance</h2>
        <div className="field">
          <label id="settings-theme-label">Theme</label>
          <div className="seg-control" role="radiogroup" aria-labelledby="settings-theme-label">
            {THEME_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={theme === option.value}
                onClick={() => setTheme(option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className="card" aria-labelledby="settings-plan-heading">
        <div className="settings-section-header">
          <h2 id="settings-plan-heading">Practice plan</h2>
          {!editingPlan && (
            <button type="button" className="btn-ghost" onClick={() => setEditingPlan(true)}>
              Edit
            </button>
          )}
        </div>
        {editingPlan ? (
          <OnboardingFlow
            embedded
            onFinish={setLastAnswers}
            onDone={handlePlanDone}
            {...(openStore === undefined ? {} : { openStore })}
          />
        ) : (
          <p className="settings-plan-summary">{summarizePlan(lastAnswers, levels)}</p>
        )}
      </section>

      <section className="card" aria-labelledby="settings-input-heading">
        <h2 id="settings-input-heading">Input</h2>
        <MidiDeviceStatus
          connected={midi.input !== undefined}
          devices={midi.devices}
          selectedDeviceId={midi.selectedDeviceId}
          connectionError={midi.connectionError}
        />
        <p className="settings-mic-hint">No keyboard? Try the microphone on Practice.</p>
      </section>

      <section className="card" aria-labelledby="settings-audio-heading">
        <h2 id="settings-audio-heading">Audio</h2>
        <div className="field">
          <label id="settings-audio-route-label">Sound</label>
          <div className="seg-control" role="radiogroup" aria-labelledby="settings-audio-route-label">
            {AUDIO_ROUTE_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={audioRoute === option.value}
                onClick={() => handleSelectAudioRoute(option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
        <p className="settings-audio-status">
          {describeAudioRouteStatus(audioRoute, midiRouteStatus, midiRouteError)}
        </p>
        <p className="settings-audio-note">
          {audioRoute === 'midi'
            ? 'Uses the first connected instrument found. If you plug one in after opening this page, reopen Settings to connect it.'
            : 'Pick "My instrument" above to hear your own connected instrument instead of the built-in piano sound.'}
        </p>
      </section>
    </div>
  )
}

/**
 * Before anything has been edited THIS session, the only honest source is
 * the currently-set track levels — real, persisted data — reverse-mapped to
 * the experience label that would have produced them (`describeLevel`).
 * Neither the goal nor the daily-minutes answer is persisted anywhere (see
 * `OnboardingFlow.tsx`'s own comment: goal never biased anything, and the
 * chosen minutes only ever became a single day's `SessionRunSnapshot`, not a
 * durable "usual minutes" setting) — inventing values for them here would be
 * a value that looks authoritative but isn't backed by what is actually
 * stored, so they are simply omitted until `onFinish` reports the real,
 * just-chosen answers for this screen's own lifetime.
 */
function summarizePlan(
  lastAnswers: OnboardingAnswers | undefined,
  levels: Readonly<Record<string, number>>,
): string {
  if (lastAnswers !== undefined) {
    return [
      EXPERIENCE_LABEL[lastAnswers.experience],
      GOAL_LABEL[lastAnswers.goal],
      `${lastAnswers.minutes} min/day`,
    ].join(' · ')
  }
  const trackLevels = Object.values(levels)
  const [first, ...rest] = trackLevels
  const uniform = first !== undefined && rest.every((level) => level === first)
  const label = uniform ? describeLevel(first) : undefined
  return label ?? 'Set up your practice plan to see it here.'
}
