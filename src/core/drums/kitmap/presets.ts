/**
 * Shipped kit-map presets (DR-02). Every number below is sourced from
 * `docs/drums/research-2026-08-15.md` §3 ("MIDI — GM percussion map and real
 * e-kit behavior"), cited inline per group. Where that doc has no number for
 * a preset/pad combination, the preset falls back to the GM-compatible base
 * and says so in a comment — never a guessed note number standing in as if
 * it were researched.
 *
 * Every table is a flat, literal `Record` (not built by spreading and
 * patching another preset) so every note->pad assignment — base and
 * vendor-specific override alike — is visible and auditable in one place,
 * the same discipline `model/pad.ts` uses for its own lookup tables.
 */
import { DEFAULT_HI_HAT_CONFIG, pad, type KitMap } from './kitMap.ts'

/**
 * General MIDI percussion map, core kit (research §3 lines 95-102). GM names
 * more tom/ride notes than DR-04 has pads for — three tom notes as
 * "floor/low" and three as "mid/hi-mid/high" (the doc's own row grouping),
 * against DR-04's three tom pads — so the extra notes in each research row
 * cluster onto the one matching pad rather than inventing a fourth tom or
 * splitting hairs the app's vocabulary doesn't support. Same for the ride:
 * GM's "Ride 1/2" (51/59) both read as the bow pad; DR-04 has no separate
 * "ride 2" concept. `snareRim`/`rideEdge` have no GM patch at all (pad.ts's
 * own comment on `snareRim` says as much) and are absent from this table —
 * hits on those voices arrive as unmapped until a vendor preset or the
 * wizard supplies a real note for them.
 */
export const GM_KIT_MAP: KitMap = {
  name: 'General MIDI',
  notes: {
    35: pad('kick'),
    36: pad('kick'),
    37: pad('crossStick'), // "Side stick" — GM's only rimshot-adjacent voice
    38: pad('snare'),
    40: pad('snare'),
    41: pad('tomFloor'), // "41/43/45 Floor/low toms" -> one pad
    43: pad('tomFloor'),
    45: pad('tomFloor'),
    47: pad('tomMid'), // "47/48/50 Mid/hi-mid/high tom" -> mid/mid/high
    48: pad('tomMid'),
    50: pad('tomHigh'),
    42: pad('hhClosed'),
    44: pad('hhPedal'),
    46: pad('hhOpen'),
    49: pad('crash1'),
    57: pad('crash2'),
    51: pad('rideBow'), // "Ride 1/2" -> both the bow pad
    59: pad('rideBow'),
    53: pad('rideBell'),
    55: pad('splash'),
  },
  hiHat: DEFAULT_HI_HAT_CONFIG,
}

/**
 * Roland TD family (research §3: "extended zone map... medium confidence
 * (community-transcribed; spot-check against Roland's TD-17 note-map
 * page)"). The bow/primary zone is GM-compatible (same block as
 * `GM_KIT_MAP`); the extension block below is Roland's own numbers, two of
 * which deliberately override the GM base for THIS preset because Roland's
 * real meaning for that note differs from GM's:
 *  - `40` is GM's "Electric Snare" but Roland's own doc line calls it
 *    "snare rim" — the rim reading wins here, since it is what real Roland
 *    hardware sends and it is a voice DR-04 can name (`snareRim`) that GM
 *    itself has no note for at all.
 *  - `59` is GM's fallback second ride-bow note, but Roland's own doc line
 *    calls it "ride edge" — a real, distinct DR-04 pad (`rideEdge`), so it
 *    wins over the GM fallback.
 * Not modelled: `27`/`28` ("aux") name no fixed instrument — an aux trigger
 * is exactly the case the future wizard's custom map exists for, so these
 * fall through to the unmapped bucket rather than guessing a pad. `50`/`47`/
 * `58` ("tom rims") are skipped too: those numbers already name the BOW
 * zones in the base block above (a real collision), and DR-04 has no
 * distinct tom-rim pad to route a non-colliding number to even if the
 * research doc had given one.
 */
export const ROLAND_TD_KIT_MAP: KitMap = {
  name: 'Roland TD family',
  notes: {
    // Base zone — GM-compatible (research §3 core table, same block as GM_KIT_MAP).
    35: pad('kick'),
    36: pad('kick'),
    37: pad('crossStick'),
    38: pad('snare'),
    41: pad('tomFloor'),
    43: pad('tomFloor'),
    45: pad('tomFloor'),
    47: pad('tomMid'),
    48: pad('tomMid'),
    50: pad('tomHigh'),
    42: pad('hhClosed'),
    44: pad('hhPedal'),
    46: pad('hhOpen'),
    49: pad('crash1'),
    57: pad('crash2'),
    51: pad('rideBow'),
    53: pad('rideBell'),
    55: pad('splash'),

    // Roland's own extended zone map (research §3, medium confidence).
    40: pad('snareRim'), // "40 (snare rim)" — overrides the GM base's use of 40 for electric snare
    22: pad('hhClosed'), // "22/26 (hi-hat edge closed/open)" — order assumed from the doc's own pairing; flagged, not verified against a primary source
    26: pad('hhOpen'),
    59: pad('rideEdge'), // "59 (ride edge)" — overrides the GM base's fallback use of 59 as a second ride bow
    52: pad('crash2'), // "55/52/57/49 (crash zones)" — 55/57/49 already covered above; 52 (GM's unused Chinese Cymbal) is the genuinely new number, folded into the second crash pad (no crash3 in DR-04's vocabulary)
  },
  hiHat: DEFAULT_HI_HAT_CONFIG,
}

/**
 * Alesis Nitro/Crimson, GM-mode ON (research §3: "explicit GM Mode toggle —
 * GM map when on, proprietary when off"). The research doc has no data for
 * the proprietary (GM-mode-off) map, and that mode is out of scope for this
 * preset per the DR-02 task brief — a kit running proprietary mode falls
 * through to the unmapped bucket until the wizard maps it. In GM mode the
 * kit's own map IS the standard GM map, so this preset is `GM_KIT_MAP`'s
 * table under Alesis's own name, not a re-typed copy that could drift from it.
 */
export const ALESIS_GM_KIT_MAP: KitMap = {
  name: 'Alesis (GM mode)',
  notes: GM_KIT_MAP.notes,
  hiHat: DEFAULT_HI_HAT_CONFIG,
}

/**
 * Yamaha DTX400K (research §3: "ride = 83 (outside GM range), toms 43/51/49,
 * splash 47. Not GM by default."). Everything the doc does not name for this
 * vendor falls back to the GM-compatible base per the DR-02 task brief's
 * fallback rule — EXCEPT where Yamaha's own documented numbers reuse a note
 * the GM base already claimed for something else, in which case Yamaha's
 * real data wins and the GM fallback for that number is dropped:
 *  - `51` is GM's ride bow fallback; Yamaha uses it for a tom.
 *  - `49` is GM's crash1; Yamaha uses it for a tom.
 *  - `47` is GM's tom-mid fallback; Yamaha uses it for splash.
 * That leaves `crash1`/`crash2`/`rideEdge`/`snareRim` with no honest
 * fallback slot left for this vendor (their GM numbers were just
 * reassigned, or never existed in GM at all) — they are intentionally
 * absent rather than guessed; hits on those voices land in the unmapped
 * bucket until the wizard captures the kit's real notes.
 */
export const YAMAHA_DTX_KIT_MAP: KitMap = {
  name: 'Yamaha DTX',
  notes: {
    // Not in the research doc for this vendor — GM-compatible fallback.
    35: pad('kick'),
    36: pad('kick'),
    37: pad('crossStick'),
    38: pad('snare'),
    40: pad('snare'),
    42: pad('hhClosed'),
    44: pad('hhPedal'),
    46: pad('hhOpen'),
    53: pad('rideBell'),

    // Yamaha DTX400K's own documented numbers (research §3).
    83: pad('rideBow'), // "ride = 83 (outside GM range)"
    43: pad('tomFloor'), // "toms 43/51/49" — 43 also happens to be GM's own High Floor Tom note
    51: pad('tomMid'), // overrides the GM fallback's use of 51 as ride bow
    49: pad('tomHigh'), // overrides the GM fallback's use of 49 as crash1
    47: pad('splash'), // "splash 47" — overrides the GM fallback's use of 47 as tom-mid
  },
  hiHat: DEFAULT_HI_HAT_CONFIG,
}

export const KIT_MAP_PRESETS: readonly KitMap[] = [
  GM_KIT_MAP,
  ROLAND_TD_KIT_MAP,
  ALESIS_GM_KIT_MAP,
  YAMAHA_DTX_KIT_MAP,
]
