/**
 * The Drums half of the shell (roadmap DR-01): what the topbar calls each
 * Drums screen, the Drums nav rail's tables, and the screen renderer. Split
 * out of `Shell.tsx` when the fourth Drums screen pushed it past the
 * 500-line limit; `Shell.tsx` still owns the routing, the topbar and the
 * instrument switch, and is the only importer.
 */
import type { NavGroup, NavItem } from '@app/shell/NavGroups.tsx'
import type { DrumsScreenId } from '@app/shell/route.ts'
import { DrumsTodayScreen } from '@app/drums/DrumsTodayScreen.tsx'
import { NotationDevGallery } from '@app/drums/notation/NotationDevGallery.tsx'
import { GrooveTrainerScreen } from '@app/drums/groove/GrooveTrainerScreen.tsx'
import { ReadingTrainerScreen } from '@app/drums/reading/ReadingTrainerScreen.tsx'
import { RudimentTrainerScreen } from '@app/drums/rudiments/RudimentTrainerScreen.tsx'
import { DrumsMetronomeScreen } from '@app/drums/metronome/DrumsMetronomeScreen.tsx'
import { CoordinationTrainerScreen } from '@app/drums/coordination/CoordinationTrainerScreen.tsx'
import { DrumsProgressScreen } from '@app/drums/DrumsProgressScreen.tsx'

/**
 * What the topbar calls each Drums screen (roadmap DR-01, DR-09). Every screen
 * is here, including `drums-notation-dev`, which is URL-only and has no nav
 * button: the topbar names wherever the learner actually is, and reading that
 * name off the nav table meant a screen with no nav entry was silently
 * labelled "Today" — the wrong page name, not a missing one.
 */
export const DRUMS_SCREEN_LABEL: Record<DrumsScreenId, string> = {
  'drums-today': 'Today',
  'drums-groove': 'Groove',
  'drums-reading': 'Reading',
  'drums-rudiments': 'Rudiments',
  'drums-metronome': 'Metronome',
  'drums-coordination': 'Coordination',
  'drums-progress': 'Progress',
  'drums-notation-dev': 'Notation gallery',
}

/**
 * Drums' own nav table (roadmap DR-01) — Today plus, since DR-09, the groove
 * trainer. The type-level split from `PIANO_NAV_ITEMS`/`PIANO_NAV_GROUPS` (see
 * `route.ts`'s `DrumsScreenId`) means adding a Drums screen can never
 * accidentally collide with a piano one.
 */
export const DRUMS_NAV_PRIMARY: NavItem<DrumsScreenId> = {
  id: 'drums-today',
  label: DRUMS_SCREEN_LABEL['drums-today'],
  icon: 'target',
}

export const DRUMS_NAV_GROUPS: readonly NavGroup<DrumsScreenId>[] = [
  {
    label: 'Practice',
    items: [
      { id: 'drums-groove', label: DRUMS_SCREEN_LABEL['drums-groove'], icon: 'rhythm' },
      { id: 'drums-reading', label: DRUMS_SCREEN_LABEL['drums-reading'], icon: 'book' },
      { id: 'drums-rudiments', label: DRUMS_SCREEN_LABEL['drums-rudiments'], icon: 'hand' },
      { id: 'drums-metronome', label: DRUMS_SCREEN_LABEL['drums-metronome'], icon: 'metronome' },
      {
        id: 'drums-coordination',
        label: DRUMS_SCREEN_LABEL['drums-coordination'],
        icon: 'cards',
      },
    ],
  },
  {
    label: 'Review',
    items: [{ id: 'drums-progress', label: DRUMS_SCREEN_LABEL['drums-progress'], icon: 'chart' }],
  },
]

/**
 * Drums' own screen renderer (roadmap DR-01), grows per phase. `goTo` is the
 * shell's Drums navigation; the Today hub uses it to open any of the four
 * trainers.
 */
export function renderDrumsScreen(screen: DrumsScreenId, goTo: (screen: DrumsScreenId) => void) {
  switch (screen) {
    case 'drums-today':
      return <DrumsTodayScreen onOpen={goTo} />
    case 'drums-groove':
      return <GrooveTrainerScreen />
    case 'drums-reading':
      return <ReadingTrainerScreen />
    case 'drums-rudiments':
      return <RudimentTrainerScreen />
    case 'drums-metronome':
      return <DrumsMetronomeScreen />
    case 'drums-coordination':
      return <CoordinationTrainerScreen />
    case 'drums-progress':
      return <DrumsProgressScreen />
    case 'drums-notation-dev':
      return <NotationDevGallery />
  }
}
