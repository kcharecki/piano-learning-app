/**
 * Progress export/import (roadmap 4.6, REQ-3.10.4, REQ-4.3).
 *
 * The learner owns their data locally: everything the app persists can be
 * exported as one JSON envelope or as a bundle of CSVs (one per collection —
 * a single flat CSV cannot represent six differently-shaped collections
 * without lying about their structure), and the JSON envelope can be read
 * back exactly.
 *
 * `importProgress` is a parser of untrusted text — a file the learner picked
 * off disk, possibly hand-edited, possibly from an older/newer version of
 * this app. It never throws: every failure path returns a readable `err`
 * naming what was wrong and where. Unknown extra fields are dropped, not
 * fatal — the round trip only has to be exact for data this module itself
 * produced, not for arbitrary supersets.
 *
 * `RepertoirePieceLike` and `StoredAssessmentLike` are structural minimums
 * declared here (not imported from `@core/repertoire` or the app's store
 * types, both being written concurrently by other agents) so this module
 * only depends on the fields it actually serialises. If the real types carry
 * more fields, those are simply unknown-and-dropped by this module today —
 * widening these two types is a follow-up, not a round-trip break, since
 * every field they currently declare is optional except `id`.
 */
import { ACTIVITY_KINDS, toCsv, type ActivityKind, type PracticeEntry } from '@core/progress/log.ts'
import type { Card } from '@core/srs/scheduler.ts'
import type { SightReadingRecord } from '@core/sightreading/session.ts'
import type { TechniqueAttempt } from '@core/technique/evenness.ts'
import type { Score } from '@core/notation/score.ts'
import type { EarItem, EarItemKind } from '@core/eartraining/item.ts'
import { EAR_MAX_LEVEL, EAR_MIN_LEVEL, type EarAttempt, type EarSessionState } from '@core/eartraining/session.ts'
import { err, ok, type Result } from '@core/shared/result.ts'
import { invariant } from '@core/shared/invariant.ts'
import {
  isRecord,
  typeOf,
  requireString,
  optionalString,
  requireFiniteNumber,
  optionalFiniteNumber,
  requireBoolean,
  parseArray,
} from '@core/progress/parseHelpers.ts'

// ------------------------------------------------------------------- types

/**
 * Structural minimum for a repertoire piece. Deliberately NOT imported from
 * `@core/repertoire` (owned by another in-flight agent) — only the fields
 * this module reads and writes back.
 */
export type RepertoirePieceLike = {
  readonly id: string
  readonly title: string
  readonly composer?: string
  /** Free-form status/stage label (e.g. "learning", "polishing", "maintained"); this module never interprets it. */
  readonly status?: string
  /** Epoch ms the piece was added to the learner's repertoire, if known. */
  readonly addedAt?: number
}

/**
 * Structural minimum for a stored assessment record. Deliberately NOT
 * imported from the app's store types (owned by another in-flight agent).
 */
export type StoredAssessmentLike = {
  readonly id: string
  /** Epoch ms the assessment was taken. */
  readonly at: number
  readonly accuracy: number
  /** Free-form kind/label for what was assessed; this module never interprets it. */
  readonly kind?: string
  readonly itemId?: string
}

/** Everything the app persists about a learner, in one envelope. */
export type ProgressSnapshot = {
  /** Bumped whenever the shape changes; `importProgress` refuses a version it cannot read. */
  readonly version: 1
  /** Epoch ms the export was taken. Supplied by the caller — core reads no clock. */
  readonly exportedAt: number
  readonly practiceEntries: readonly PracticeEntry[]
  readonly srsCards: readonly Card[]
  readonly sightReadingHistory: readonly SightReadingRecord[]
  readonly levels: Readonly<Record<string, number>>
  readonly repertoire: readonly RepertoirePieceLike[]
  readonly assessments: readonly StoredAssessmentLike[]
  /**
   * `TechniqueAttempt` is imported directly from `@core/technique/evenness.ts`
   * (unlike `RepertoirePieceLike`/`StoredAssessmentLike`, it is not a
   * structural minimum — that type is owned by this same layer, not an
   * in-flight app store type, so there is nothing to project down to).
   *
   * A field an OLDER exported file (written before this field existed) will
   * be missing entirely. Rather than mark this field optional on the type
   * (which would force every reader to re-check presence forever),
   * `importProgress` gives every caller a real, always-present array by
   * explicitly defaulting a missing `techniqueAttempts` to `[]` at parse
   * time — see the comment above its parse site.
   */
  readonly techniqueAttempts: readonly TechniqueAttempt[]
  /**
   * Ear-training session + generated-item cache (roadmap 3.11, REQ-3.6.3):
   * per-kind levels, SRS cards, the id -> kind map, the attempt log, and
   * every `EarItem` this session has ever generated, keyed by id.
   *
   * Unlike every other field above, this one is genuinely OPTIONAL, not
   * "optional on the wire but always present after parsing" the way
   * `techniqueAttempts` is (that field defaults a missing key to `[]`,
   * which is safe because an empty attempt history is indistinguishable
   * from "no history yet"). An empty ear-training session is NOT
   * indistinguishable from "no data" — replacing a learner's current
   * session with `emptyEarSession()` destroys their adapted levels, SRS
   * cards and attempt log. So `importProgress` leaves this field entirely
   * absent when the source JSON does not have it (an older export,
   * written before this field existed), rather than filling in a default
   * value, and the caller (`@app/state/snapshot.ts`'s
   * `applyProgressSnapshot`) treats absence as "leave the store alone".
   */
  readonly earTraining?: EarTrainingSnapshot
}

/** See `ProgressSnapshot.earTraining`'s doc comment for why this field is optional. */
export type EarTrainingSnapshot = {
  readonly session: EarSessionState
  readonly itemsById: Readonly<Record<string, EarItem>>
}

/** One CSV per collection — a single flat CSV cannot represent this without lying. */
export type CsvBundle = Readonly<
  Record<
    'practiceEntries' | 'srsCards' | 'sightReadingHistory' | 'levels' | 'repertoire' | 'assessments',
    string
  >
>

// -------------------------------------------------------------- JSON export

/** Project a `RepertoirePieceLike` down to exactly the fields `parseRepertoirePieceLike`
 *  accepts, so a caller's real (wider) object can never write a field to the export
 *  file that `importProgress` would silently drop on restore. */
function projectRepertoirePieceLike(p: RepertoirePieceLike): RepertoirePieceLike {
  return {
    id: p.id,
    title: p.title,
    ...(p.composer === undefined ? {} : { composer: p.composer }),
    ...(p.status === undefined ? {} : { status: p.status }),
    ...(p.addedAt === undefined ? {} : { addedAt: p.addedAt }),
  }
}

/** Project a `StoredAssessmentLike` down to exactly the fields
 *  `parseStoredAssessmentLike` accepts (see `projectRepertoirePieceLike`). */
function projectStoredAssessmentLike(a: StoredAssessmentLike): StoredAssessmentLike {
  return {
    id: a.id,
    at: a.at,
    accuracy: a.accuracy,
    ...(a.kind === undefined ? {} : { kind: a.kind }),
    ...(a.itemId === undefined ? {} : { itemId: a.itemId }),
  }
}

/** JSON.stringify replacer: a NaN/Infinity anywhere in the snapshot would silently
 * serialize as `null` and then make the exported file unrestorable (`importProgress`
 * rejects it as "expected finite number, got null"). A corrupt in-memory snapshot is
 * programmer error, so this throws rather than producing a file that cannot be read
 * back. */
function assertFiniteNumbers(_key: string, value: unknown): unknown {
  if (typeof value === 'number') {
    invariant(Number.isFinite(value), `exportJson: non-finite number (${value})`)
  }
  return value
}

export function exportJson(snapshot: ProgressSnapshot): string {
  const projected: ProgressSnapshot = {
    ...snapshot,
    repertoire: snapshot.repertoire.map(projectRepertoirePieceLike),
    assessments: snapshot.assessments.map(projectStoredAssessmentLike),
  }
  return JSON.stringify(projected, assertFiniteNumbers, 2)
}

// --------------------------------------------------------- parsing helpers

function parsePracticeEntry(item: unknown, path: string): Result<PracticeEntry, string> {
  if (!isRecord(item)) return err(`${path}: expected object, got ${typeOf(item)}`)
  const id = requireString(item, 'id', path)
  if (!id.ok) return id
  const startedAt = requireFiniteNumber(item, 'startedAt', path)
  if (!startedAt.ok) return startedAt
  const endedAt = requireFiniteNumber(item, 'endedAt', path)
  if (!endedAt.ok) return endedAt
  if (endedAt.value < startedAt.value) {
    return err(
      `${path}.endedAt: ${endedAt.value} is before startedAt (${startedAt.value})`,
    )
  }
  const kindStr = requireString(item, 'kind', path)
  if (!kindStr.ok) return kindStr
  if (!ACTIVITY_KINDS.includes(kindStr.value as ActivityKind)) {
    return err(`${path}.kind: '${kindStr.value}' is not a valid ActivityKind`)
  }
  const kind = kindStr.value as ActivityKind
  const itemName = requireString(item, 'itemName', path)
  if (!itemName.ok) return itemName
  const itemId = optionalString(item, 'itemId', path)
  if (!itemId.ok) return itemId
  const tempoBpm = optionalFiniteNumber(item, 'tempoBpm', path)
  if (!tempoBpm.ok) return tempoBpm
  const accuracy = optionalFiniteNumber(item, 'accuracy', path)
  if (!accuracy.ok) return accuracy
  const note = optionalString(item, 'note', path)
  if (!note.ok) return note
  return ok({
    id: id.value,
    startedAt: startedAt.value,
    endedAt: endedAt.value,
    kind,
    ...(itemId.value === undefined ? {} : { itemId: itemId.value }),
    itemName: itemName.value,
    ...(tempoBpm.value === undefined ? {} : { tempoBpm: tempoBpm.value }),
    ...(accuracy.value === undefined ? {} : { accuracy: accuracy.value }),
    ...(note.value === undefined ? {} : { note: note.value }),
  })
}

function parseCard(item: unknown, path: string): Result<Card, string> {
  if (!isRecord(item)) return err(`${path}: expected object, got ${typeOf(item)}`)
  const id = requireString(item, 'id', path)
  if (!id.ok) return id
  const due = requireFiniteNumber(item, 'due', path)
  if (!due.ok) return due
  const intervalDays = requireFiniteNumber(item, 'intervalDays', path)
  if (!intervalDays.ok) return intervalDays
  const ease = requireFiniteNumber(item, 'ease', path)
  if (!ease.ok) return ease
  const reps = requireFiniteNumber(item, 'reps', path)
  if (!reps.ok) return reps
  const lapses = requireFiniteNumber(item, 'lapses', path)
  if (!lapses.ok) return lapses
  const introducedAt = requireFiniteNumber(item, 'introducedAt', path)
  if (!introducedAt.ok) return introducedAt
  return ok({
    id: id.value,
    due: due.value,
    intervalDays: intervalDays.value,
    ease: ease.value,
    reps: reps.value,
    lapses: lapses.value,
    introducedAt: introducedAt.value,
  })
}

function parseSightReadingRecord(item: unknown, path: string): Result<SightReadingRecord, string> {
  if (!isRecord(item)) return err(`${path}: expected object, got ${typeOf(item)}`)
  const pieceId = requireString(item, 'pieceId', path)
  if (!pieceId.ok) return pieceId
  const readAt = requireFiniteNumber(item, 'readAt', path)
  if (!readAt.ok) return readAt
  const accuracy = requireFiniteNumber(item, 'accuracy', path)
  if (!accuracy.ok) return accuracy
  const level = requireFiniteNumber(item, 'level', path)
  if (!level.ok) return level
  return ok({
    pieceId: pieceId.value,
    readAt: readAt.value,
    accuracy: accuracy.value,
    level: level.value,
  })
}

function parseRepertoirePieceLike(item: unknown, path: string): Result<RepertoirePieceLike, string> {
  if (!isRecord(item)) return err(`${path}: expected object, got ${typeOf(item)}`)
  const id = requireString(item, 'id', path)
  if (!id.ok) return id
  const title = requireString(item, 'title', path)
  if (!title.ok) return title
  const composer = optionalString(item, 'composer', path)
  if (!composer.ok) return composer
  const status = optionalString(item, 'status', path)
  if (!status.ok) return status
  const addedAt = optionalFiniteNumber(item, 'addedAt', path)
  if (!addedAt.ok) return addedAt
  return ok({
    id: id.value,
    title: title.value,
    ...(composer.value === undefined ? {} : { composer: composer.value }),
    ...(status.value === undefined ? {} : { status: status.value }),
    ...(addedAt.value === undefined ? {} : { addedAt: addedAt.value }),
  })
}

function parseStoredAssessmentLike(item: unknown, path: string): Result<StoredAssessmentLike, string> {
  if (!isRecord(item)) return err(`${path}: expected object, got ${typeOf(item)}`)
  const id = requireString(item, 'id', path)
  if (!id.ok) return id
  const at = requireFiniteNumber(item, 'at', path)
  if (!at.ok) return at
  const accuracy = requireFiniteNumber(item, 'accuracy', path)
  if (!accuracy.ok) return accuracy
  const kind = optionalString(item, 'kind', path)
  if (!kind.ok) return kind
  const itemId = optionalString(item, 'itemId', path)
  if (!itemId.ok) return itemId
  return ok({
    id: id.value,
    at: at.value,
    accuracy: accuracy.value,
    ...(kind.value === undefined ? {} : { kind: kind.value }),
    ...(itemId.value === undefined ? {} : { itemId: itemId.value }),
  })
}

function parseTechniqueAttempt(item: unknown, path: string): Result<TechniqueAttempt, string> {
  if (!isRecord(item)) return err(`${path}: expected object, got ${typeOf(item)}`)
  const drillId = requireString(item, 'drillId', path)
  if (!drillId.ok) return drillId
  const atMs = requireFiniteNumber(item, 'at', path)
  if (!atMs.ok) return atMs
  const bpm = requireFiniteNumber(item, 'bpm', path)
  if (!bpm.ok) return bpm
  const evenness = requireFiniteNumber(item, 'evenness', path)
  if (!evenness.ok) return evenness
  const accuracy = requireFiniteNumber(item, 'accuracy', path)
  if (!accuracy.ok) return accuracy
  const clean = requireBoolean(item, 'clean', path)
  if (!clean.ok) return clean
  return ok({
    drillId: drillId.value,
    at: atMs.value,
    bpm: bpm.value,
    evenness: evenness.value,
    accuracy: accuracy.value,
    clean: clean.value,
  })
}

const EAR_ITEM_KINDS: readonly EarItemKind[] = [
  'interval-melodic', 'interval-harmonic', 'chord-quality', 'scale-mode', 'melodic-dictation', 'rhythmic-dictation',
]

function isEarItemKind(value: unknown): value is EarItemKind {
  return typeof value === 'string' && (EAR_ITEM_KINDS as readonly string[]).includes(value)
}

/** Prompt structural check, inlined into `parseEarItem` (its only caller) rather than its own
 *  function — see `isValidScore`'s identical "structural only" reasoning in
 *  `@app/state/persistedShapes.ts` for why a full `Score` is never re-validated against its own
 *  invariants here. */
function parseEarItem(item: unknown, path: string): Result<EarItem, string> {
  if (!isRecord(item)) return err(`${path}: expected object, got ${typeOf(item)}`)
  const id = requireString(item, 'id', path)
  if (!id.ok) return id
  const kind = item['kind']
  if (!isEarItemKind(kind)) return err(`${path}.kind: '${String(kind)}' is not a valid EarItemKind`)
  const prompt = item['prompt']
  if (!isRecord(prompt) || !Array.isArray(prompt['notes']) || !isRecord(prompt['meta'])) return err(`${path}.prompt: not a valid Score`)
  const answerKey = requireString(item, 'answerKey', path)
  if (!answerKey.ok) return answerKey
  const level = requireFiniteNumber(item, 'level', path)
  if (!level.ok) return level
  return ok({ id: id.value, kind, prompt: prompt as unknown as Score, answerKey: answerKey.value, level: level.value })
}

/**
 * Accepts BOTH shapes an `EarAttempt` has ever been persisted in (roadmap
 * 3.26): the current `{ accuracy: number }` in `[0,1]`, and a pre-3.26 record
 * — `{ correct: boolean }`, no `accuracy` at all — that a backup file
 * exported before this change still carries. Mirrors the identical
 * migration `isValidEarAttempt` performs in `@app/state/persistedShapes.ts`
 * for the IndexedDB restore path, except here it returns a fresh `number`
 * rather than mutating the input in place (this module builds a new object
 * per record throughout, never reuses the caller's).
 *
 * A present-but-out-of-range or wrong-typed `accuracy` is always rejected —
 * even when a `correct` boolean also happens to be present — so a corrupt
 * `accuracy` can never be silently papered over by the legacy fallback.
 */
function parseEarAttemptAccuracy(item: Record<string, unknown>, path: string): Result<number, string> {
  const raw = item['accuracy']
  if (raw !== undefined) {
    if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < 0 || raw > 1) {
      return err(`${path}.accuracy: expected a finite number in [0,1], got ${typeOf(raw)}`)
    }
    return ok(raw)
  }
  const correct = item['correct']
  if (typeof correct === 'boolean') return ok(correct ? 1 : 0)
  return err(`${path}.accuracy: expected a finite number in [0,1], got ${typeOf(raw)}`)
}

function parseEarAttempt(item: unknown, path: string): Result<EarAttempt, string> {
  if (!isRecord(item)) return err(`${path}: expected object, got ${typeOf(item)}`)
  const itemId = requireString(item, 'itemId', path)
  if (!itemId.ok) return itemId
  const kind = item['kind']
  if (!isEarItemKind(kind)) return err(`${path}.kind: '${String(kind)}' is not a valid EarItemKind`)
  const accuracy = parseEarAttemptAccuracy(item, path)
  if (!accuracy.ok) return accuracy
  const at = requireFiniteNumber(item, 'at', path)
  if (!at.ok) return at
  const level = requireFiniteNumber(item, 'level', path)
  if (!level.ok) return level
  return ok({ itemId: itemId.value, kind, accuracy: accuracy.value, at: at.value, level: level.value })
}

// Unlike `isValidEarLevels` in `@app/state/persistedShapes.ts`, this does not reject an
// extra/unknown key — this module's own stated policy (see the module doc comment) is
// that unknown extra fields are dropped, not fatal; every known kind is still required.
function parseEarLevels(value: unknown, path: string): Result<Readonly<Record<EarItemKind, number>>, string> {
  if (!isRecord(value)) return err(`${path}: expected object, got ${typeOf(value)}`)
  const entries: [EarItemKind, number][] = []
  for (const kind of EAR_ITEM_KINDS) {
    const level = value[kind]
    if (typeof level !== 'number' || !Number.isFinite(level) || level < EAR_MIN_LEVEL || level > EAR_MAX_LEVEL) return err(`${path}.${kind}: expected a finite number in [${EAR_MIN_LEVEL}, ${EAR_MAX_LEVEL}], got ${typeOf(level)}`)
    entries.push([kind, level])
  }
  return ok(Object.fromEntries(entries) as Readonly<Record<EarItemKind, number>>)
}

/** Same anti-prototype-pollution reasoning as `parseLevels` below: `Object.fromEntries`, never `obj[key] =`. */
function parseEarKinds(value: unknown, path: string): Result<Readonly<Record<string, EarItemKind>>, string> {
  if (!isRecord(value)) return err(`${path}: expected object, got ${typeOf(value)}`)
  const entries: [string, EarItemKind][] = []
  for (const [key, raw] of Object.entries(value)) {
    if (!isEarItemKind(raw)) return err(`${path}.${key}: '${String(raw)}' is not a valid EarItemKind`)
    entries.push([key, raw])
  }
  return ok(Object.fromEntries(entries))
}

function parseEarSessionState(value: unknown, path: string): Result<EarSessionState, string> {
  if (!isRecord(value)) return err(`${path}: expected object, got ${typeOf(value)}`)
  const levels = parseEarLevels(value['levels'], `${path}.levels`)
  if (!levels.ok) return levels
  const attempts = parseArray(value['attempts'], `${path}.attempts`, parseEarAttempt)
  if (!attempts.ok) return attempts
  const cards = parseArray(value['cards'], `${path}.cards`, parseCard)
  if (!cards.ok) return cards
  const kinds = parseEarKinds(value['kinds'], `${path}.kinds`)
  if (!kinds.ok) return kinds
  return ok({ levels: levels.value, attempts: attempts.value, cards: cards.value, kinds: kinds.value })
}

function parseEarTrainingSnapshot(value: unknown, path: string): Result<EarTrainingSnapshot, string> {
  if (!isRecord(value)) return err(`${path}: expected object, got ${typeOf(value)}`)
  const session = parseEarSessionState(value['session'], `${path}.session`)
  if (!session.ok) return session
  const itemsByIdRaw = value['itemsById']
  if (!isRecord(itemsByIdRaw)) return err(`${path}.itemsById: expected object, got ${typeOf(itemsByIdRaw)}`)
  const itemEntries: [string, EarItem][] = []
  for (const [key, raw] of Object.entries(itemsByIdRaw)) {
    const parsed = parseEarItem(raw, `${path}.itemsById.${key}`)
    if (!parsed.ok) return parsed
    itemEntries.push([key, parsed.value])
  }
  return ok({ session: session.value, itemsById: Object.fromEntries(itemEntries) })
}

function parseLevels(value: unknown, path: string): Result<Readonly<Record<string, number>>, string> {
  if (!isRecord(value)) return err(`${path}: expected object, got ${typeOf(value)}`)
  const entries: [string, number][] = []
  for (const [key, raw] of Object.entries(value)) {
    if (typeof raw !== 'number' || !Number.isFinite(raw)) {
      return err(`${path}.${key}: expected finite number, got ${typeOf(raw)}`)
    }
    entries.push([key, raw])
  }
  // Object.fromEntries defines own properties directly (CreateDataPropertyOrThrow),
  // unlike `obj[key] = value`, so an attacker-controlled key of "__proto__" in the
  // imported file cannot repoint this object's prototype.
  return ok(Object.fromEntries(entries))
}

// ------------------------------------------------------------------ import

/**
 * Parse a progress export back into a `ProgressSnapshot`. Never throws: JSON
 * syntax errors, a wrong/missing `version`, and any structurally invalid
 * field all come back as a readable `err`. Unknown extra fields on any
 * object are silently dropped.
 */
export function importProgress(text: string): Result<ProgressSnapshot, string> {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    return err(`invalid JSON: ${message}`)
  }
  if (!isRecord(raw)) return err(`root: expected object, got ${typeOf(raw)}`)

  const version = raw['version']
  if (version !== 1) {
    return err(`unsupported version: expected 1, got ${JSON.stringify(version)}`)
  }

  const exportedAt = requireFiniteNumber(raw, 'exportedAt', 'root')
  if (!exportedAt.ok) return exportedAt

  const practiceEntries = parseArray(raw['practiceEntries'], 'practiceEntries', parsePracticeEntry)
  if (!practiceEntries.ok) return practiceEntries

  const srsCards = parseArray(raw['srsCards'], 'srsCards', parseCard)
  if (!srsCards.ok) return srsCards

  const sightReadingHistory = parseArray(
    raw['sightReadingHistory'],
    'sightReadingHistory',
    parseSightReadingRecord,
  )
  if (!sightReadingHistory.ok) return sightReadingHistory

  const levels = parseLevels(raw['levels'], 'levels')
  if (!levels.ok) return levels

  const repertoire = parseArray(raw['repertoire'], 'repertoire', parseRepertoirePieceLike)
  if (!repertoire.ok) return repertoire

  const assessments = parseArray(raw['assessments'], 'assessments', parseStoredAssessmentLike)
  if (!assessments.ok) return assessments

  // Unlike every other collection above, a missing `techniqueAttempts` is NOT
  // an error: this field did not exist in older exported files, and an older
  // file must still import successfully, with the technique history simply
  // empty (see the type's own doc comment). A *present but malformed*
  // `techniqueAttempts` is still reported exactly like every other field.
  const rawTechniqueAttempts = raw['techniqueAttempts']
  const techniqueAttempts: Result<readonly TechniqueAttempt[], string> =
    rawTechniqueAttempts === undefined
      ? ok([])
      : parseArray(rawTechniqueAttempts, 'techniqueAttempts', parseTechniqueAttempt)
  if (!techniqueAttempts.ok) return techniqueAttempts

  // Unlike every other field, a missing `earTraining` stays MISSING on the
  // returned snapshot — never defaulted to an empty session. See
  // `ProgressSnapshot.earTraining`'s doc comment for why: an empty session is
  // not a safe stand-in for "no data" the way `[]` is for `techniqueAttempts`.
  const earTraining: Result<EarTrainingSnapshot | undefined, string> =
    raw['earTraining'] === undefined ? ok(undefined) : parseEarTrainingSnapshot(raw['earTraining'], 'earTraining')
  if (!earTraining.ok) return earTraining

  return ok({
    version: 1,
    exportedAt: exportedAt.value,
    practiceEntries: practiceEntries.value,
    srsCards: srsCards.value,
    sightReadingHistory: sightReadingHistory.value,
    levels: levels.value,
    repertoire: repertoire.value,
    assessments: assessments.value,
    techniqueAttempts: techniqueAttempts.value,
    ...(earTraining.value === undefined ? {} : { earTraining: earTraining.value }),
  })
}

// -------------------------------------------------------------- CSV export

/**
 * RFC 4180 field escaping, identical to `log.ts`'s private `csvField` (not
 * exported there, so it is reproduced here rather than left unreusable —
 * three lines, easier to duplicate than to plumb an export through a module
 * another agent might be mid-editing).
 */
function csvField(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
}

function rowsToCsv(header: readonly string[], rows: readonly (readonly string[])[]): string {
  const lines = [header.join(',')]
  for (const row of rows) lines.push(row.map(csvField).join(','))
  return lines.join('\n')
}

/** Serialize every collection in `snapshot` as its own CSV (REQ-3.10.4 / REQ-4.3). */
export function exportCsv(snapshot: ProgressSnapshot): CsvBundle {
  return {
    practiceEntries: toCsv(snapshot.practiceEntries),
    srsCards: rowsToCsv(
      ['id', 'due', 'intervalDays', 'ease', 'reps', 'lapses', 'introducedAt'],
      snapshot.srsCards.map((c) => [
        c.id,
        String(c.due),
        String(c.intervalDays),
        String(c.ease),
        String(c.reps),
        String(c.lapses),
        String(c.introducedAt),
      ]),
    ),
    sightReadingHistory: rowsToCsv(
      ['pieceId', 'readAt', 'accuracy', 'level'],
      snapshot.sightReadingHistory.map((r) => [
        r.pieceId,
        String(r.readAt),
        String(r.accuracy),
        String(r.level),
      ]),
    ),
    levels: rowsToCsv(
      ['key', 'level'],
      Object.entries(snapshot.levels).map(([key, level]) => [key, String(level)]),
    ),
    repertoire: rowsToCsv(
      ['id', 'title', 'composer', 'status', 'addedAt'],
      snapshot.repertoire.map((p) => [
        p.id,
        p.title,
        p.composer ?? '',
        p.status ?? '',
        p.addedAt === undefined ? '' : String(p.addedAt),
      ]),
    ),
    assessments: rowsToCsv(
      ['id', 'at', 'accuracy', 'kind', 'itemId'],
      snapshot.assessments.map((a) => [
        a.id,
        String(a.at),
        String(a.accuracy),
        a.kind ?? '',
        a.itemId ?? '',
      ]),
    ),
  }
}
