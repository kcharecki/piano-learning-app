/**
 * Real-usage `Rng` for the sight-reading trainer (roadmap 2.12) — the one
 * place in `src/app/sightreading` allowed to touch `Math.random`/`Date.now`,
 * exactly like `practice/clock.ts`'s `createBrowserClock`. Everywhere else
 * takes an `Rng` port, so the generator it drives stays deterministic under
 * test and reproducible from a seed (`seededRng`, `core/ports/rng.ts`).
 */
import { seededRng } from '@core/ports/rng.ts'
import type { Rng } from '@core/ports/index.ts'

export function createBrowserRng(): Rng {
  return seededRng((Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0)
}
