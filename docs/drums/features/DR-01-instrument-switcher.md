# DR-01 — Instrument switcher: two apps in one shell

**Phase:** D0 · **Effort:** M · **Depends on:** nothing · **Blocks:** every DR screen

## Why

The user's stated shape: Drums and Piano behave like two separate apps in one web page.
Switching instruments swaps the entire menu, not just adds a screen. Everything drum-side
hangs off this.

## What it is

- A persistent instrument control (Piano / Drums) at the top of the nav rail, above
  `NAV_PRIMARY`. Selecting an instrument swaps the nav to that instrument's own groups and
  routes to that instrument's home screen.
- URL carries the instrument: drums screens live under `/drums/...`. Existing piano paths
  (`/practice`, `/lessons`, …) stay valid and canonical for piano — no `/piano/` migration,
  no broken bookmarks. `parseRoute` learns one new leading segment.
- Last-used instrument persists (new tiny Zustand slice, hydrated like the others), so the
  app opens where the learner left off.
- Theme, settings, and the export/import screen stay shared. Streak is shared (one practice
  habit); levels, dashboards, and curricula are per-instrument.

## Design

- New concept above `Route`: `AppRoute = { instrument: 'piano' | 'drums'; route: Route }`,
  with `Route`'s `ScreenId` union split per instrument (piano keeps its 13; drums gets its
  own union that grows per phase). Pure change in `src/app/shell/route.ts` + tests.
- `Shell.tsx`: `NAV_ITEMS`/`NAV_GROUPS`/`renderScreen` become per-instrument tables. The
  switcher is shell chrome, not a nav item.
- Shell.tsx and route.ts are main-thread-only files (existing rule) — this task cannot be
  farmed out in parallel with other shell work.

## Scope

In: switcher UI, URL scheme, per-instrument nav tables, persisted choice, drums home
placeholder ("Drums — start here") so the switch is drivable before any trainer exists.
Out: any drum feature behind the placeholder; migrating piano URLs.

## Experience-gate proof

Switch control visible at both widths/themes; clicking Drums swaps the entire nav and lands
on `/drums/today`; deep-link to a `/drums/...` URL cold-loads into drums with drums nav;
reload restores last instrument; all 13 piano routes still resolve (existing e2e routing
spec untouched and green); console clean.
