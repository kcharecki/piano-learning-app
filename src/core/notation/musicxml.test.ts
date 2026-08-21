/**
 * Golden-file tests for the MusicXML parser.
 *
 * The fixtures in `__fixtures__/` are hand-written and each one states its
 * musical content in an XML comment, so a reader can check the music theory
 * rather than trusting the code. Exact ticks and MIDI numbers are asserted
 * first; the snapshot at the end of each block is regression cover, not the
 * specification.
 *
 * `node:fs` is imported HERE and only here — the module under test is pure.
 */
import { readFileSync } from 'node:fs'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { parseMusicXml, parseXml, type XmlNode } from './musicxml.ts'
import { type Score, type ScoreNote } from './score.ts'
import { notesInMeasure, scoreDurationTicks } from './scoreQueries.ts'
import { isErr, type Result } from '@core/shared/result.ts'

const load = (name: string): string =>
  readFileSync(new URL(`./__fixtures__/${name}.musicxml`, import.meta.url), 'utf8')

function parse(name: string, opts?: { id?: string }): Score {
  const result = parseMusicXml(load(name), opts)
  if (!result.ok) throw new Error(`expected ${name} to parse, got: ${result.error}`)
  return result.value
}

const errorOf = (result: Result<unknown, string>): string =>
  isErr(result) ? result.error : '<unexpectedly ok>'

const failure = (name: string): string => errorOf(parseMusicXml(load(name)))

const midis = (notes: readonly ScoreNote[]): number[] => notes.map((n) => n.midi)
const startTicks = (notes: readonly ScoreNote[]): number[] => notes.map((n) => n.startTick)
const durations = (notes: readonly ScoreNote[]): number[] => notes.map((n) => n.durationTicks)

/** Compact, readable serialisation for the regression snapshots. */
function summarize(score: Score): string {
  return [
    `id=${score.id} title="${score.meta.title}" composer="${score.meta.composer}"`,
    `staves ${score.staves.map((s) => `${s.staff}:${s.clef}:${s.hand}`).join(' ')}`,
    `tempos ${score.tempos.map((t) => `${t.tick}@${t.bpm}bpm`).join(' ')}`,
    ...score.measures.map(
      (m) =>
        `measure ${m.index} "${m.number}" start=${m.startTick} len=${m.durationTicks} ` +
        `${m.timeSignature.beats}/${m.timeSignature.beatType} key=${m.keyFifths}`,
    ),
    ...score.notes.map(
      (n) =>
        `note ${n.id} midi=${n.midi} @${n.startTick}+${n.durationTicks} ${n.hand} v${n.voice} s${n.staff}` +
        `${n.tiedFrom ? ' tiedFrom' : ''}${n.tiedTo ? ' tiedTo' : ''}` +
        `${n.fingering === undefined ? '' : ` finger=${n.fingering}`}`,
    ),
  ].join('\n')
}

// ============================================================== the XML reader

describe('parseXml', () => {
  const tree = (source: string): XmlNode => {
    const result = parseXml(source)
    if (!result.ok) throw new Error(`expected XML to parse, got: ${result.error}`)
    return result.value
  }

  it('reads elements, attributes, text and nesting', () => {
    const node = tree('<a x="1" y="two"><b>hello</b><b>world</b></a>')
    expect(node.tag).toBe('a')
    expect(node.attrs).toEqual({ x: '1', y: 'two' })
    expect(node.children.map((c) => c.text)).toEqual(['hello', 'world'])
    expect(node.text).toBe('')
  })

  it('trims and concatenates the direct text of an element', () => {
    expect(tree('<a>\n  hi\n</a>').text).toBe('hi')
    expect(tree('<a>x<b/>y</a>').text).toBe('xy')
    expect(tree('<a></a>').text).toBe('')
  })

  it('accepts self-closing tags, with and without attributes', () => {
    const node = tree('<a><b/><c type="stop"/></a>')
    expect(node.children.map((c) => c.tag)).toEqual(['b', 'c'])
    expect(node.children[1]?.attrs['type']).toBe('stop')
    expect(node.children[0]?.children).toEqual([])
  })

  it('accepts single-quoted attribute values', () => {
    expect(tree('<a x=\'he said "hi"\'/>').attrs['x']).toBe('he said "hi"')
  })

  it('skips the XML declaration, processing instructions, DOCTYPE and comments', () => {
    const source = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<?xml-stylesheet href="x.xsl"?>',
      '<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "partwise.dtd">',
      '<!-- a comment with <tags> inside -->',
      '<a><!--another--><b/></a>',
    ].join('\n')
    expect(tree(source).children.map((c) => c.tag)).toEqual(['b'])
  })

  it('skips a DOCTYPE with an internal subset', () => {
    expect(tree('<!DOCTYPE a [ <!ENTITY x "y"> ]><a>z</a>').text).toBe('z')
  })

  it('reads CDATA verbatim, markup and all', () => {
    expect(tree('<a><![CDATA[ 1 < 2 & <b/> ]]></a>').text).toBe('1 < 2 & <b/>')
  })

  it('decodes the five standard entities plus numeric references', () => {
    expect(tree('<a>&lt;&gt;&amp;&apos;&quot;</a>').text).toBe('<>&\'"')
    expect(tree('<a>&#65;&#x42;&#38;</a>').text).toBe('AB&')
    expect(tree('<a x="&amp;&#67;"/>').attrs['x']).toBe('&C')
  })

  it('leaves an unknown or malformed entity alone rather than losing text', () => {
    expect(tree('<a>&nbsp;&#x110000;&#zz;</a>').text).toBe('&nbsp;&#x110000;&#zz;')
  })

  it.each<[string, RegExp]>([
    ['<a><!-- never ends', /unterminated comment/],
    ['<a><![CDATA[ never ends', /unterminated CDATA/],
    ['<?xml version="1.0"', /unterminated processing instruction/],
    ['<!DOCTYPE a', /unterminated <! declaration/],
    ['<a><b></a>', /closing tag <\/a> does not match <b>/],
    ['<a></a></b>', /unexpected closing tag <\/b>/],
    ['<a><b>', /unclosed element <b>/],
    ['<a>x', /unclosed element <a>/],
    ['<a/><b/>', /unexpected second root element <b>/],
    ['<a><b/></a><c>x</c>', /unexpected second root element <c>/],
    ['   ', /no root element/],
    ['<>', /empty tag name/],
    ['<a x/>', /attribute x of <a> has no value/],
    ['<a x=1/>', /attribute x of <a> must have a quoted value/],
    ['<a ="1"/>', /malformed attribute in <a>/],
    ['<a x="1', /unterminated value for attribute x of <a>/],
    ['<a x="1"', /unterminated <a> tag/],
    ['<a /x>', /malformed self-closing <a> tag/],
    ['<a></b', /unterminated closing tag/],
  ])('rejects %s', (source, message) => {
    expect(errorOf(parseXml(source))).toMatch(message)
  })

  it('tolerates whitespace around the attribute equals sign', () => {
    expect(tree('<a x = "1"  y\n=\n"2" />').attrs).toEqual({ x: '1', y: '2' })
  })

  it('reports the offset of the failure', () => {
    expect(errorOf(parseXml('<a><b></a>'))).toMatch(/offset 6/)
  })

  // --------------------------------------------------------------- properties

  const nameArb = fc
    .array(fc.constantFrom('a', 'b', 'c', 'd'), { minLength: 1, maxLength: 4 })
    .map((cs) => cs.join(''))
  const textArb = fc
    .array(fc.constantFrom('x', 'y', '<', '>', '&', '"', "'", '1'), { maxLength: 6 })
    .map((cs) => cs.join(''))

  const nodeArb: fc.Arbitrary<XmlNode> = fc.letrec<{ node: XmlNode }>((tie) => ({
    node: fc
      .tuple(
        nameArb,
        fc.dictionary(nameArb, textArb, { maxKeys: 2 }),
        fc.oneof(
          { maxDepth: 3 },
          fc.constant<readonly XmlNode[]>([]),
          fc.array(tie('node'), { maxLength: 2 }),
        ),
        textArb,
      )
      .map(([tag, attrs, children, text]) => ({
        tag,
        attrs,
        children,
        text: children.length > 0 ? '' : text,
      })),
  })).node

  const escapeText = (s: string): string =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const escapeAttr = (s: string): string => escapeText(s).replace(/"/g, '&quot;')

  const serialize = (node: XmlNode, noise = ''): string => {
    const attrs = Object.entries(node.attrs)
      .map(([k, v]) => ` ${k}="${escapeAttr(v)}"`)
      .join('')
    const body =
      node.children.length > 0
        ? node.children.map((c) => serialize(c, noise)).join(noise)
        : escapeText(node.text)
    return `<${node.tag}${attrs}>${noise}${body}${noise}</${node.tag}>`
  }

  it('round-trips any tree: parse(serialize(t)) === t', () => {
    fc.assert(
      fc.property(nodeArb, (node) => {
        const result = parseXml(serialize(node))
        expect(result.ok && result.value).toEqual(node)
      }),
    )
  })

  it('ignores comments wherever they appear', () => {
    fc.assert(
      fc.property(nodeArb, (node) => {
        const result = parseXml(serialize(node, '<!--noise-->'))
        expect(result.ok && result.value).toEqual(node)
      }),
    )
  })
})

// ================================================================== the parser

describe('parseMusicXml: a single-part, single-voice piece', () => {
  const score = parse('single-part')

  it('reads the work title and the composer, and slugs an id from the title', () => {
    expect(score.meta.title).toBe('C Major Scale & Study') // &amp; decoded
    expect(score.meta.composer).toBe('Anon.') // creator type="composer", not the lyricist
    expect(score.id).toBe('c-major-scale-study')
  })

  it('places one octave of C major on the 480-tick grid', () => {
    // C4 D4 E4 F4 | G4 A4 B4 C5 as quarter notes, divisions=1
    expect(midis(score.notes)).toEqual([60, 62, 64, 65, 67, 69, 71, 72])
    expect(startTicks(score.notes)).toEqual([0, 480, 960, 1440, 1920, 2400, 2880, 3360])
    expect(durations(score.notes)).toEqual(Array<number>(8).fill(480))
    expect(score.notes.every((n) => n.hand === 'right' && n.staff === 1 && n.voice === 1)).toBe(
      true,
    )
  })

  it('builds two 4/4 measures in C major and defaults the tempo to 120', () => {
    expect(score.measures.map((m) => m.durationTicks)).toEqual([1920, 1920])
    expect(score.measures.map((m) => m.number)).toEqual(['1', '2'])
    expect(score.measures.every((m) => m.keyFifths === 0)).toBe(true)
    expect(score.measures[0]?.timeSignature).toEqual({ beats: 4, beatType: 4 })
    expect(score.tempos).toEqual([{ tick: 0, bpm: 120 }])
    expect(score.staves).toEqual([{ staff: 1, clef: 'treble', hand: 'right' }])
    expect(scoreDurationTicks(score)).toBe(3840)
  })

  it('keeps fingerings, and omits the property where the file gives none', () => {
    expect(score.notes.map((n) => n.fingering)).toEqual([1, 2, ...Array(5).fill(undefined), 5])
    expect(Object.hasOwn(score.notes[2] ?? {}, 'fingering')).toBe(false)
  })

  it('matches its golden snapshot', () => {
    expect(summarize(score)).toMatchInlineSnapshot(`
      "id=c-major-scale-study title="C Major Scale & Study" composer="Anon."
      staves 1:treble:right
      tempos 0@120bpm
      measure 0 "1" start=0 len=1920 4/4 key=0
      measure 1 "2" start=1920 len=1920 4/4 key=0
      note m0.r.0.60 midi=60 @0+480 right v1 s1 finger=1
      note m0.r.480.62 midi=62 @480+480 right v1 s1 finger=2
      note m0.r.960.64 midi=64 @960+480 right v1 s1
      note m0.r.1440.65 midi=65 @1440+480 right v1 s1
      note m1.r.1920.67 midi=67 @1920+480 right v1 s1
      note m1.r.2400.69 midi=69 @2400+480 right v1 s1
      note m1.r.2880.71 midi=71 @2880+480 right v1 s1
      note m1.r.3360.72 midi=72 @3360+480 right v1 s1 finger=5"
    `)
  })
})

describe('parseMusicXml: a two-staff piano part sharing measures with <backup>', () => {
  const score = parse('two-staff-piano')

  it('puts staff 1 in the right hand and staff 2 in the left', () => {
    expect(score.staves).toEqual([
      { staff: 1, clef: 'treble', hand: 'right' },
      { staff: 2, clef: 'bass', hand: 'left' },
    ])
  })

  it('rewinds the cursor so both hands start at the top of the bar', () => {
    // bar 1: RH C5 D5 E5 F5 quarters over LH C3 whole note
    const bar1 = score.notes.filter((n) => n.measureIndex === 0)
    expect(bar1.map((n) => [n.midi, n.startTick, n.durationTicks, n.hand])).toEqual([
      [48, 0, 1920, 'left'], // C3, the whole note the <backup> made room for
      [72, 0, 480, 'right'],
      [74, 480, 480, 'right'],
      [76, 960, 480, 'right'],
      [77, 1440, 480, 'right'],
    ])
  })

  it('reads a rest as time only, and a left-hand chord as one onset', () => {
    // bar 2: RH G5 half + half rest; LH G2/D3 dyad, whole note
    const bar2 = score.notes.filter((n) => n.measureIndex === 1)
    expect(bar2.map((n) => [n.midi, n.startTick, n.durationTicks])).toEqual([
      [43, 1920, 1920], // G2
      [50, 1920, 1920], // D3 — <chord/>, same onset
      [79, 1920, 960], // G5, the only right-hand note; the rest produced nothing
    ])
  })

  it('takes the tempo from <sound tempo>', () => {
    expect(score.tempos).toEqual([{ tick: 0, bpm: 88 }])
  })

  it('matches its golden snapshot', () => {
    expect(summarize(score)).toMatchInlineSnapshot(`
      "id=two-staff-piano title="Two Staff Piano" composer="Test"
      staves 1:treble:right 2:bass:left
      tempos 0@88bpm
      measure 0 "1" start=0 len=1920 4/4 key=0
      measure 1 "2" start=1920 len=1920 4/4 key=0
      note m0.l.0.48 midi=48 @0+1920 left v5 s2
      note m0.r.0.72 midi=72 @0+480 right v1 s1
      note m0.r.480.74 midi=74 @480+480 right v1 s1
      note m0.r.960.76 midi=76 @960+480 right v1 s1
      note m0.r.1440.77 midi=77 @1440+480 right v1 s1
      note m1.l.1920.43 midi=43 @1920+1920 left v5 s2
      note m1.l.1920.50 midi=50 @1920+1920 left v5 s2
      note m1.r.1920.79 midi=79 @1920+960 right v1 s1"
    `)
  })
})

describe('parseMusicXml: chords', () => {
  const score = parse('chords')

  it('does not advance the cursor for a <chord/> note — the classic parser bug', () => {
    // C major then F major, half notes: ticks 0 and 960, NOT 0 960 1920 2880 …
    expect(startTicks(score.notes)).toEqual([0, 0, 0, 960, 960, 960])
    expect(midis(score.notes)).toEqual([60, 64, 67, 65, 69, 72])
    expect(durations(score.notes)).toEqual(Array<number>(6).fill(960))
  })

  it('keeps the bar one 4/4 measure long', () => {
    expect(score.measures).toHaveLength(1)
    expect(score.measures[0]?.durationTicks).toBe(1920)
  })

  it('matches its golden snapshot', () => {
    expect(summarize(score)).toMatchInlineSnapshot(`
      "id=chords title="Chords" composer=""
      staves 1:treble:right
      tempos 0@120bpm
      measure 0 "1" start=0 len=1920 4/4 key=0
      note m0.r.0.60 midi=60 @0+960 right v1 s1
      note m0.r.0.64 midi=64 @0+960 right v1 s1
      note m0.r.0.67 midi=67 @0+960 right v1 s1
      note m0.r.960.65 midi=65 @960+960 right v1 s1
      note m0.r.960.69 midi=69 @960+960 right v1 s1
      note m0.r.960.72 midi=72 @960+960 right v1 s1"
    `)
  })
})

describe('parseMusicXml: a tie across the barline', () => {
  const score = parse('tie-across-barline')

  it('splits the sustained C4 into two notes joined by tiedTo/tiedFrom', () => {
    // E4 half | C4 half ~ | ~ C4 half | G4 half
    expect(midis(score.notes)).toEqual([64, 60, 60, 67])
    expect(startTicks(score.notes)).toEqual([0, 960, 1920, 2880])
    expect(score.notes.map((n) => [n.tiedTo, n.tiedFrom])).toEqual([
      [false, false],
      [true, false], // <tie type="start"/> + <tied type="start"/>
      [false, true], // only <notations><tied type="stop"/>
      [false, false],
    ])
  })

  it('matches its golden snapshot', () => {
    expect(summarize(score)).toMatchInlineSnapshot(`
      "id=tied-notes title="Tied Notes" composer=""
      staves 1:treble:right
      tempos 0@120bpm
      measure 0 "1" start=0 len=1920 4/4 key=0
      measure 1 "2" start=1920 len=1920 4/4 key=0
      note m0.r.0.64 midi=64 @0+960 right v1 s1
      note m0.r.960.60 midi=60 @960+960 right v1 s1 tiedTo
      note m1.r.1920.60 midi=60 @1920+960 right v1 s1 tiedFrom
      note m1.r.2880.67 midi=67 @2880+960 right v1 s1"
    `)
  })
})

describe('parseMusicXml: a pickup measure in 3/4', () => {
  const score = parse('pickup-measure')

  it('makes the implicit opening measure only as long as its content', () => {
    expect(score.measures.map((m) => m.durationTicks)).toEqual([480, 1440, 1440])
    expect(score.measures.map((m) => m.startTick)).toEqual([0, 480, 1920])
    expect(score.measures.map((m) => m.number)).toEqual(['0', '1', '2'])
    expect(score.measures.every((m) => m.timeSignature.beats === 3)).toBe(true)
  })

  it('places the upbeat and the dotted half correctly', () => {
    // G4 | C5 D5 E5 | F5 (dotted half = 3 divisions = 1440 ticks)
    expect(midis(score.notes)).toEqual([67, 72, 74, 76, 77])
    expect(startTicks(score.notes)).toEqual([0, 480, 960, 1440, 1920])
    expect(durations(score.notes)).toEqual([480, 480, 480, 480, 1440])
    expect(scoreDurationTicks(score)).toBe(3360)
  })

  it('matches its golden snapshot', () => {
    expect(summarize(score)).toMatchInlineSnapshot(`
      "id=pickup-measure title="Pickup Measure" composer=""
      staves 1:treble:right
      tempos 0@120bpm
      measure 0 "0" start=0 len=480 3/4 key=0
      measure 1 "1" start=480 len=1440 3/4 key=0
      measure 2 "2" start=1920 len=1440 3/4 key=0
      note m0.r.0.67 midi=67 @0+480 right v1 s1
      note m1.r.480.72 midi=72 @480+480 right v1 s1
      note m1.r.960.74 midi=74 @960+480 right v1 s1
      note m1.r.1440.76 midi=76 @1440+480 right v1 s1
      note m2.r.1920.77 midi=77 @1920+1440 right v1 s1"
    `)
  })
})

describe('parseMusicXml: an implicit measure in the middle of the score', () => {
  const score = parse('implicit-mid-score')

  // A short bar at index 0 is a pickup because it is first. A short bar further
  // in is only a pickup because it says implicit="yes" — that attribute is the
  // whole signal, and dropping it pads the bar out to a full metre.
  it('keeps a short implicit="yes" bar at its written content length', () => {
    const bar = score.measures[2]
    expect(bar?.number).toBe('0')
    expect(bar?.durationTicks).toBe(480) // one quarter, not the 1920-tick metre
    expect(bar?.timeSignature).toEqual({ beats: 4, beatType: 4 })
    expect(notesInMeasure(score, 2).map((n) => [n.midi, n.startTick, n.durationTicks])).toEqual([
      [74, 3840, 480],
    ])
  })

  it('starts the following bar immediately after it, with no padding', () => {
    const bar = score.measures[2]
    const next = score.measures[3]
    expect(next?.startTick).toBe((bar?.startTick ?? -1) + (bar?.durationTicks ?? -1))
    expect(score.measures.map((m) => m.durationTicks)).toEqual([1920, 1920, 480, 1920])
    expect(score.measures.map((m) => m.startTick)).toEqual([0, 1920, 3840, 4320])
    expect(scoreDurationTicks(score)).toBe(6240)
  })

  it('leaves every later note where the file wrote it', () => {
    expect(midis(score.notes)).toEqual([60, 62, 64, 65, 67, 69, 71, 72, 74, 76, 77, 79, 81])
    expect(startTicks(score.notes)).toEqual([
      0, 480, 960, 1440, 1920, 2400, 2880, 3360, 3840, 4320, 4800, 5280, 5760,
    ])
  })

  it('matches its golden snapshot', () => {
    expect(summarize(score)).toMatchInlineSnapshot(`
      "id=implicit-mid-score title="Implicit Mid Score" composer=""
      staves 1:treble:right
      tempos 0@120bpm
      measure 0 "1" start=0 len=1920 4/4 key=0
      measure 1 "2" start=1920 len=1920 4/4 key=0
      measure 2 "0" start=3840 len=480 4/4 key=0
      measure 3 "3" start=4320 len=1920 4/4 key=0
      note m0.r.0.60 midi=60 @0+480 right v1 s1
      note m0.r.480.62 midi=62 @480+480 right v1 s1
      note m0.r.960.64 midi=64 @960+480 right v1 s1
      note m0.r.1440.65 midi=65 @1440+480 right v1 s1
      note m1.r.1920.67 midi=67 @1920+480 right v1 s1
      note m1.r.2400.69 midi=69 @2400+480 right v1 s1
      note m1.r.2880.71 midi=71 @2880+480 right v1 s1
      note m1.r.3360.72 midi=72 @3360+480 right v1 s1
      note m2.r.3840.74 midi=74 @3840+480 right v1 s1
      note m3.r.4320.76 midi=76 @4320+480 right v1 s1
      note m3.r.4800.77 midi=77 @4800+480 right v1 s1
      note m3.r.5280.79 midi=79 @5280+480 right v1 s1
      note m3.r.5760.81 midi=81 @5760+480 right v1 s1"
    `)
  })
})

describe('parseMusicXml: 6/8 with a metronome mark', () => {
  const score = parse('six-eight')

  it('measures a compound bar as 1440 ticks', () => {
    expect(score.measures.map((m) => m.durationTicks)).toEqual([1440, 1440])
    expect(score.measures[0]?.timeSignature).toEqual({ beats: 6, beatType: 8 })
  })

  it('converts divisions=2 into 240-tick eighths', () => {
    expect(midis(score.notes)).toEqual([60, 62, 64, 65, 67, 69, 72, 67])
    expect(startTicks(score.notes)).toEqual([0, 240, 480, 720, 960, 1200, 1440, 2160])
    expect(durations(score.notes)).toEqual([240, 240, 240, 240, 240, 240, 720, 720])
  })

  it('turns "dotted quarter = 60" into 90 quarter-note bpm', () => {
    expect(score.tempos).toEqual([{ tick: 0, bpm: 90 }])
  })

  it('matches its golden snapshot', () => {
    expect(summarize(score)).toMatchInlineSnapshot(`
      "id=six-eight title="Six Eight" composer=""
      staves 1:treble:right
      tempos 0@90bpm
      measure 0 "1" start=0 len=1440 6/8 key=0
      measure 1 "2" start=1440 len=1440 6/8 key=0
      note m0.r.0.60 midi=60 @0+240 right v1 s1
      note m0.r.240.62 midi=62 @240+240 right v1 s1
      note m0.r.480.64 midi=64 @480+240 right v1 s1
      note m0.r.720.65 midi=65 @720+240 right v1 s1
      note m0.r.960.67 midi=67 @960+240 right v1 s1
      note m0.r.1200.69 midi=69 @1200+240 right v1 s1
      note m1.r.1440.72 midi=72 @1440+720 right v1 s1
      note m1.r.2160.67 midi=67 @2160+720 right v1 s1"
    `)
  })
})

describe('parseMusicXml: mid-score changes', () => {
  const score = parse('mid-score-changes')

  it('applies the key and time signature from the measure they appear in', () => {
    expect(
      score.measures.map((m) => `${m.timeSignature.beats}/${m.timeSignature.beatType}`),
    ).toEqual([
      '4/4',
      '3/4',
      '3/4', // inherited
      '3/4',
    ])
    expect(score.measures.map((m) => m.keyFifths)).toEqual([0, 2, 2, 2])
    expect(score.measures.map((m) => m.durationTicks)).toEqual([1920, 1440, 1440, 1440])
  })

  it('follows a mid-score <divisions> change', () => {
    // bar 3 switches to divisions=4, so its quarters are written <duration>4</duration>
    expect(midis(score.notes)).toEqual([60, 62, 64, 65, 62, 64, 66, 69, 71, 73, 50])
    expect(startTicks(score.notes)).toEqual([
      0, 480, 960, 1440, 1920, 2400, 2880, 3360, 3840, 4320, 4800,
    ])
    expect(durations(score.notes).at(-1)).toBe(1440) // D3 dotted half, 12 divisions of 4
  })

  it('collects both tempo marks at their absolute ticks', () => {
    // Bar 2 carries a <metronome> saying quarter = 60 AND a <sound tempo="72"/>.
    // The two disagree on purpose: 72 proves <sound> is what the parser reads.
    expect(score.tempos).toEqual([
      { tick: 0, bpm: 100 },
      { tick: 1920, bpm: 72 },
    ])
  })

  it('moves a single-staff part to the left hand when the clef turns bass', () => {
    // Bar 4 is written in bass clef; the staff itself keeps the clef it opened with.
    expect(score.notes.at(-1)?.hand).toBe('left')
    expect(score.notes.slice(0, -1).every((n) => n.hand === 'right')).toBe(true)
    expect(score.staves).toEqual([{ staff: 1, clef: 'treble', hand: 'right' }])
  })

  it('matches its golden snapshot', () => {
    expect(summarize(score)).toMatchInlineSnapshot(`
      "id=mid-score-changes title="Mid Score Changes" composer="Test"
      staves 1:treble:right
      tempos 0@100bpm 1920@72bpm
      measure 0 "1" start=0 len=1920 4/4 key=0
      measure 1 "2" start=1920 len=1440 3/4 key=2
      measure 2 "3" start=3360 len=1440 3/4 key=2
      measure 3 "4" start=4800 len=1440 3/4 key=2
      note m0.r.0.60 midi=60 @0+480 right v1 s1
      note m0.r.480.62 midi=62 @480+480 right v1 s1
      note m0.r.960.64 midi=64 @960+480 right v1 s1
      note m0.r.1440.65 midi=65 @1440+480 right v1 s1
      note m1.r.1920.62 midi=62 @1920+480 right v1 s1
      note m1.r.2400.64 midi=64 @2400+480 right v1 s1
      note m1.r.2880.66 midi=66 @2880+480 right v1 s1
      note m2.r.3360.69 midi=69 @3360+480 right v1 s1
      note m2.r.3840.71 midi=71 @3840+480 right v1 s1
      note m2.r.4320.73 midi=73 @4320+480 right v1 s1
      note m3.l.4800.50 midi=50 @4800+1440 left v1 s1"
    `)
  })
})

describe('parseMusicXml: tuplets (roadmap T.8)', () => {
  const score = parse('triplets')

  it('reads the ratio, so a triplet stays a triplet and not three odd durations', () => {
    expect(score.notes.map((n) => n.tuplet)).toEqual([
      { actual: 3, normal: 2, position: 'start' },
      { actual: 3, normal: 2, position: 'inner' },
      { actual: 3, normal: 2, position: 'stop' },
      undefined,
      { actual: 3, normal: 2, position: 'start' },
      { actual: 3, normal: 2, position: 'inner' },
      { actual: 3, normal: 2, position: 'stop' },
    ])
  })

  it('applies the ratio to the <type> fallback, so a triplet with no <duration> still fits its beat', () => {
    // Bar 1's triplet carries no <duration> at all. Read as three plain
    // eighths it would be 720 ticks and push the dotted half off the grid;
    // read through 3:2 it is 3 x 160 = one quarter, and the bar closes at 1920.
    const bar1 = notesInMeasure(score, 0)
    expect(durations(bar1)).toEqual([160, 160, 160, 1440])
    expect(startTicks(bar1)).toEqual([0, 160, 320, 480])
  })

  it('keeps trusting <duration> when the file gives one, even a coarse one', () => {
    // Bar 2's quarter triplet is written <duration>1</duration> at divisions 2
    // — 240 ticks each, not the true 320. `<duration>` is what the format says
    // is authoritative and what every other reader will use, so we follow it
    // rather than silently re-deriving a different rhythm from <type>.
    const bar2 = notesInMeasure(score, 1)
    expect(durations(bar2)).toEqual([240, 240, 240])
    expect(startTicks(bar2)).toEqual([1920, 2160, 2400])
  })

  it('reads an unbracketed middle note as inner rather than rejecting it', () => {
    const inner = score.notes[1]
    expect(inner?.tuplet?.position).toBe('inner')
  })

  it('ignores a <time-modification> that does not describe a ratio', () => {
    const broken = load('triplets').replace(
      '<actual-notes>3</actual-notes><normal-notes>2</normal-notes>',
      '<actual-notes>0</actual-notes><normal-notes></normal-notes>',
    )
    const result = parseMusicXml(broken)
    if (!result.ok) throw new Error(`expected a lenient parse, got: ${result.error}`)
    expect(result.value.notes[0]?.tuplet).toBeUndefined()
  })
})

describe('parseMusicXml: grace notes, voices, rests and <forward>', () => {
  const score = parse('grace-and-voices')

  it('drops grace notes without letting them steal time', () => {
    // C4 at 0, E4 at 1440 (a quarter rest and a <forward> quarter in between),
    // G3 whole note in voice 2 after a full-bar <backup>.
    expect(midis(score.notes)).toEqual([55, 60, 64])
    expect(startTicks(score.notes)).toEqual([0, 0, 1440])
    expect(durations(score.notes)).toEqual([1920, 480, 480])
    expect(score.notes.map((n) => n.voice)).toEqual([2, 1, 1])
  })

  it('keeps a numeric fingering and ignores a substitution like "3-2"', () => {
    expect(score.notes.map((n) => n.fingering)).toEqual([undefined, 1, undefined])
  })

  it('reads a CDATA composer and a numeric entity in the title', () => {
    expect(score.meta.title).toBe('Grace & Voices')
    expect(score.meta.composer).toBe('J. S. Test')
  })

  it('matches its golden snapshot', () => {
    expect(summarize(score)).toMatchInlineSnapshot(`
      "id=grace-voices title="Grace & Voices" composer="J. S. Test"
      staves 1:treble:right
      tempos 0@120bpm
      measure 0 "1" start=0 len=1920 4/4 key=0
      note m0.r.0.55 midi=55 @0+1920 right v2 s1
      note m0.r.0.60 midi=60 @0+480 right v1 s1 finger=1
      note m0.r.1440.64 midi=64 @1440+480 right v1 s1"
    `)
  })
})

// ==================================================================== failures

describe('parseMusicXml: bad input comes back as Err, never as a throw', () => {
  it('refuses score-timewise by name instead of mis-parsing it', () => {
    expect(failure('bad-timewise')).toMatch(/score-timewise is not supported/)
  })

  it('reports malformed XML', () => {
    expect(failure('bad-unclosed-tag')).toMatch(/malformed MusicXML: closing tag/)
  })

  it('reports a note with neither pitch nor rest', () => {
    expect(failure('bad-note-without-pitch')).toMatch(
      /measure 1: <note> has neither <pitch> nor <rest>/,
    )
  })

  it('reports divisions of 0', () => {
    expect(failure('bad-divisions-zero')).toMatch(/<divisions> must be positive, got 0/)
  })

  it('reports a score with no parts', () => {
    expect(failure('bad-no-parts')).toMatch(/score has no <part> elements/)
  })

  const wrap = (body: string, attrs = ''): string =>
    `<score-partwise><part id="P1"><measure number="1"${attrs}>${body}</measure></part></score-partwise>`
  const withDivisions = (body: string, divisions = 1): string =>
    wrap(`<attributes><divisions>${divisions}</divisions></attributes>${body}`)
  const note = (inner: string): string => `<note>${inner}</note>`
  const pitched = (extra = ''): string =>
    note(`<pitch><step>C</step><octave>4</octave></pitch><duration>1</duration>${extra}`)

  it.each<[string, RegExp]>([
    ['<not-a-score/>', /expected a <score-partwise> root element, found <not-a-score>/],
    ['<score-partwise><part id="P1"/></score-partwise>', /part P1 has no <measure> elements/],
    ['<score-partwise><part/></score-partwise>', /part #1 has no <measure> elements/],
    [
      withDivisions(note('<pitch><step>H</step><octave>4</octave></pitch><duration>1</duration>')),
      /unknown <step> "H"/,
    ],
    [
      withDivisions(note('<pitch><step>C</step></pitch><duration>1</duration>')),
      /missing or non-integer <octave>/,
    ],
    [
      withDivisions(note('<pitch><step>C</step><octave>11</octave></pitch><duration>1</duration>')),
      /outside the MIDI range/,
    ],
    [
      withDivisions(note('<pitch><step>C</step><octave>4</octave></pitch>')),
      /<note> has no <duration>/,
    ],
    [
      withDivisions(note('<pitch><step>C</step><octave>4</octave></pitch><duration>x</duration>')),
      /<duration> is empty or not a number/,
    ],
    [
      withDivisions(note('<pitch><step>C</step><octave>4</octave></pitch><duration>-1</duration>')),
      /<duration> must not be negative/,
    ],
    [
      wrap(note('<pitch><step>C</step><octave>4</octave></pitch><duration>1</duration>')),
      /no <divisions> was declared/,
    ],
    [
      withDivisions('<backup><duration>4</duration></backup>'),
      /moves before the start of the measure/,
    ],
    [withDivisions('<forward><type>bogus</type></forward>'), /<forward> has no <duration>/],
    [
      withDivisions(`${pitched()}<attributes><key><fifths>9</fifths></key></attributes>`),
      /<fifths> "9" is outside -7\.\.7/,
    ],
    [
      withDivisions(
        `${pitched()}<attributes><time><beats>0</beats><beat-type>4</beat-type></time></attributes>`,
      ),
      /whole positive <beats> and <beat-type>/,
    ],
    [
      withDivisions(`${pitched()}<attributes><time><beats>4</beats></time></attributes>`),
      /whole positive <beats> and <beat-type>/,
    ],
    [
      withDivisions(
        `${pitched()}<attributes><time><beats>4</beats><beat-type>7</beat-type></time></attributes>`,
      ),
      /time signature 4\/7 is not tick-exact/,
    ],
  ])('rejects %#', (source, message) => {
    expect(errorOf(parseMusicXml(source))).toMatch(message)
  })

  it('turns a rejected score model into an Err rather than an exception', () => {
    expect(errorOf(parseMusicXml(load('single-part'), { id: '' }))).toMatch(
      /could not build a score: .*score id must not be empty/,
    )
  })

  it('falls back to a stable id when the file has no title', () => {
    const anonymous = parseMusicXml(withDivisions(pitched()))
    expect(anonymous.ok && anonymous.value.id).toBe('musicxml-score')
    expect(anonymous.ok && anonymous.value.meta).toEqual({ title: '', composer: '' })
  })

  it('reads <movement-title> when there is no <work-title>', () => {
    expect(parse('two-staff-piano').meta.title).toBe('Two Staff Piano')
  })
})

// ================================================================= odd corners

describe('parseMusicXml: the corners of the format', () => {
  const oneBar = (attributes: string, body: string, measureAttrs = ' number="1"'): string =>
    `<score-partwise><part id="P1"><measure${measureAttrs}>` +
    `<attributes><divisions>1</divisions>${attributes}</attributes>${body}</measure>` +
    '</part></score-partwise>'
  const whole = '<note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration></note>'
  const quarter = (step: string): string =>
    `<note><pitch><step>${step}</step><octave>4</octave></pitch><duration>1</duration></note>`

  const parsed = (source: string): Score => {
    const result = parseMusicXml(source)
    if (!result.ok) throw new Error(result.error)
    return result.value
  }

  it('defaults a clef with no <sign> to treble', () => {
    expect(parsed(oneBar('<clef/>', whole)).staves).toEqual([
      { staff: 1, clef: 'treble', hand: 'right' },
    ])
  })

  it('reads C clefs: line 3 is alto, line 4 is tenor', () => {
    const clef = (line: number): string => `<clef><sign>C</sign><line>${line}</line></clef>`
    expect(parsed(oneBar(clef(3), whole)).staves[0]?.clef).toBe('alto')
    expect(parsed(oneBar(clef(4), whole)).staves[0]?.clef).toBe('tenor')
  })

  it('sends a single bass-clef staff to the left hand', () => {
    const score = parsed(oneBar('<clef><sign>F</sign><line>4</line></clef>', whole))
    expect(score.staves).toEqual([{ staff: 1, clef: 'bass', hand: 'left' }])
    expect(score.notes[0]?.hand).toBe('left')
  })

  it('assumes treble over bass when <staves> is declared without clefs', () => {
    const body =
      '<note><pitch><step>C</step><octave>5</octave></pitch><duration>4</duration><staff>1</staff></note>' +
      '<backup><duration>4</duration></backup>' +
      '<note><pitch><step>C</step><octave>3</octave></pitch><duration>4</duration><staff>2</staff></note>'
    expect(parsed(oneBar('<staves>2</staves>', body)).staves).toEqual([
      { staff: 1, clef: 'treble', hand: 'right' },
      { staff: 2, clef: 'bass', hand: 'left' },
    ])
  })

  it('falls back to staff 1 for a clef with an unusable number', () => {
    const score = parsed(oneBar('<clef number="x"><sign>F</sign><line>4</line></clef>', whole))
    expect(score.staves).toEqual([{ staff: 1, clef: 'bass', hand: 'left' }])
  })

  it.each<[string, string]>([
    [
      'a direction with no tempo in it',
      '<direction><direction-type><words>dolce</words></direction-type></direction>',
    ],
    [
      'a metronome with no <beat-unit>',
      '<direction><direction-type><metronome><per-minute>72</per-minute></metronome></direction-type></direction>',
    ],
    [
      'a metronome with no <per-minute>',
      '<direction><direction-type><metronome><beat-unit>quarter</beat-unit></metronome></direction-type></direction>',
    ],
    [
      'a metronome marked "0"',
      '<direction><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>0</per-minute></metronome></direction-type></direction>',
    ],
    ['a <sound> with no tempo attribute', '<sound dynamics="70"/>'],
    ['a <sound tempo> that is not a number', '<sound tempo="fast"/>'],
  ])('keeps the default 120 bpm for %s', (_label, direction) => {
    expect(parsed(oneBar('', direction + whole)).tempos).toEqual([{ tick: 0, bpm: 120 }])
  })

  it('keeps only the first of two tempo marks at the same tick', () => {
    const score = parsed(oneBar('', `<sound tempo="60"/><sound tempo="90"/>${whole}`))
    expect(score.tempos).toEqual([{ tick: 0, bpm: 60 }])
  })

  it('derives a duration from <type> and <dot> when <duration> is missing', () => {
    // A dotted quarter with no <duration> is 1.5 x 480 = 720 ticks.
    const body =
      '<note><pitch><step>C</step><octave>4</octave></pitch><type>quarter</type><dot/></note>'
    expect(parsed(oneBar('', body)).notes[0]?.durationTicks).toBe(720)
  })

  it('numbers measures itself when the file does not', () => {
    const score = parsed(oneBar('', whole, ''))
    expect(score.measures[0]?.number).toBe('1')
  })

  it('drops a zero-length note sitting on the barline', () => {
    const body = `${quarter('C')}${quarter('D')}${quarter('E')}${quarter('F')}<note><pitch><step>G</step><octave>4</octave></pitch><duration>0</duration></note>`
    const score = parsed(oneBar('', body))
    expect(midis(score.notes)).toEqual([60, 62, 64, 65])
  })

  it('reports an out-of-range pitch with its spelling, not with a raw <alter>', () => {
    const pitch = (alter: number, octave: number): string =>
      `<note><pitch><step>C</step><alter>${alter}</alter><octave>${octave}</octave></pitch>` +
      '<duration>4</duration></note>'
    // C#10, not "C110" — an alter glued onto the octave reads as a nonsense octave.
    expect(errorOf(parseMusicXml(oneBar('', pitch(1, 10))))).toMatch(
      /pitch C#10 is outside the MIDI range/,
    )
    expect(errorOf(parseMusicXml(oneBar('', pitch(-1, -2))))).toMatch(
      /pitch Cb-2 is outside the MIDI range/,
    )
    expect(errorOf(parseMusicXml(oneBar('', pitch(-2, -1))))).toMatch(
      /pitch Cbb-1 is outside the MIDI range/,
    )
    // An absurd <alter> is named as a number rather than as a row of sharps.
    expect(errorOf(parseMusicXml(oneBar('', pitch(40, 9))))).toMatch(
      /pitch C\(alter 40\)9 is outside the MIDI range/,
    )
  })

  it('reads a fingering only when it is a real 1-5 finger', () => {
    const fingered = (inner: string): string =>
      '<note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration>' +
      `<notations><technical>${inner}</technical></notations></note>`
    const finger = (source: string): number | undefined =>
      parsed(oneBar('', fingered(source))).notes[0]?.fingering

    // An empty <fingering/> is Number('') === 0, and there is no finger 0.
    expect(finger('<fingering/>')).toBeUndefined()
    expect(finger('<fingering></fingering>')).toBeUndefined()
    expect(finger('<fingering>0</fingering>')).toBeUndefined()
    expect(finger('<fingering>6</fingering>')).toBeUndefined()
    expect(finger('<fingering>-1</fingering>')).toBeUndefined()
    expect(finger('<fingering>1-2</fingering>')).toBeUndefined()
    expect(finger('<fingering>1</fingering>')).toBe(1)
    expect(finger('<fingering>5</fingering>')).toBe(5)
    // …and the property is absent, not present-and-undefined (exactOptionalPropertyTypes).
    expect(
      Object.hasOwn(parsed(oneBar('', fingered('<fingering/>'))).notes[0] ?? {}, 'fingering'),
    ).toBe(false)
  })

  it('sums an additive <beats> like 3+2', () => {
    const time = (beats: string, beatType: number): string =>
      `<time><beats>${beats}</beats><beat-type>${beatType}</beat-type></time>`
    // 3+2/8 is five eighth-note beats: 5 * 480 / 2 = 1200 ticks to the bar.
    const score = parsed(oneBar(time('3+2', 8), whole))
    expect(score.measures[0]?.timeSignature).toEqual({ beats: 5, beatType: 8 })
    expect(score.measures[0]?.durationTicks).toBe(1920) // content overflows the 1200-tick metre

    const short = parsed(oneBar(time('3+2', 8), quarter('C')))
    expect(short.measures[0]?.durationTicks).toBe(480) // opening bar: a pickup
    const full = parsed(
      `<score-partwise><part id="P1"><measure number="1">` +
        `<attributes><divisions>1</divisions>${time('3+2', 8)}</attributes>${quarter('C')}</measure>` +
        `<measure number="2">${quarter('D')}</measure></part></score-partwise>`,
    )
    expect(full.measures[1]?.durationTicks).toBe(1200)
  })

  it.each<string>(['+', '3+', '3+0', '3+x', '3.5', '0'])(
    'rejects <beats>%s</beats> rather than guessing',
    (beats) => {
      const body = `<time><beats>${beats}</beats><beat-type>4</beat-type></time>`
      expect(errorOf(parseMusicXml(oneBar(body, whole)))).toMatch(
        /whole positive <beats> and <beat-type>/,
      )
    },
  )

  it('reports a <pitch> with no <step> at all', () => {
    const body = '<note><pitch><octave>4</octave></pitch><duration>4</duration></note>'
    expect(errorOf(parseMusicXml(oneBar('', body)))).toMatch(/unknown <step> ""/)
  })

  it('reads a second part as the staff after the first', () => {
    const part = (id: string, sign: string, step: string, octave: number): string =>
      `<part id="${id}"><measure number="1"><attributes><divisions>1</divisions>` +
      `<clef><sign>${sign}</sign></clef></attributes>` +
      `<note><pitch><step>${step}</step><octave>${octave}</octave></pitch><duration>4</duration></note>` +
      '</measure></part>'
    const score = parsed(
      `<score-partwise>${part('P1', 'G', 'C', 5)}${part('P2', 'F', 'C', 3)}</score-partwise>`,
    )
    expect(score.staves).toEqual([
      { staff: 1, clef: 'treble', hand: 'right' },
      { staff: 2, clef: 'bass', hand: 'left' },
    ])
    expect(score.notes.map((n) => [n.midi, n.staff, n.hand])).toEqual([
      [48, 2, 'left'],
      [72, 1, 'right'],
    ])
  })
})

// ================================================================== properties

describe('parseMusicXml properties', () => {
  type Ev = { step: string; octave: number; quarters: number }

  const evArb: fc.Arbitrary<Ev> = fc.record({
    step: fc.constantFrom('C', 'D', 'E', 'F', 'G', 'A', 'B'),
    octave: fc.integer({ min: 3, max: 5 }),
    quarters: fc.constantFrom(1, 2, 4),
  })
  const eventsArb = fc.array(evArb, { minLength: 1, maxLength: 6 })
  const divisionsArb = fc.integer({ min: 1, max: 12 })

  const noteXml = (
    e: Ev,
    divisions: number,
    opts: { grace?: boolean; chord?: boolean } = {},
  ): string =>
    [
      '<note>',
      opts.grace === true ? '<grace/>' : '',
      opts.chord === true ? '<chord/>' : '',
      `<pitch><step>${e.step}</step><octave>${e.octave}</octave></pitch>`,
      opts.grace === true ? '' : `<duration>${e.quarters * divisions}</duration>`,
      '<type>quarter</type></note>',
    ].join('')

  const scoreXml = (body: string, divisions: number): string =>
    '<?xml version="1.0"?><score-partwise><part-list><score-part id="P1"/></part-list>' +
    `<part id="P1"><measure number="1"><attributes><divisions>${divisions}</divisions>` +
    '<key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time>' +
    `<clef><sign>G</sign><line>2</line></clef></attributes>${body}</measure></part></score-partwise>`

  const parseOrThrow = (source: string): Score => {
    const result = parseMusicXml(source)
    if (!result.ok) throw new Error(result.error)
    return result.value
  }
  const timeline = (score: Score): string =>
    score.notes.map((n) => `${n.midi}@${n.startTick}+${n.durationTicks}`).join(' ')

  it('is invariant under the choice of <divisions>', () => {
    // The same music written with any divisions value lands on the same ticks:
    // tick = value * 480 / divisions.
    fc.assert(
      fc.property(eventsArb, divisionsArb, divisionsArb, (events, d1, d2) => {
        const render = (d: number): string => scoreXml(events.map((e) => noteXml(e, d)).join(''), d)
        expect(timeline(parseOrThrow(render(d1)))).toBe(timeline(parseOrThrow(render(d2))))
      }),
    )
  })

  it('gives every note an onset that is the sum of the durations before it', () => {
    fc.assert(
      fc.property(eventsArb, divisionsArb, (events, d) => {
        const score = parseOrThrow(scoreXml(events.map((e) => noteXml(e, d)).join(''), d))
        let tick = 0
        for (const [i, e] of events.entries()) {
          expect(score.notes[i]?.startTick).toBe(tick)
          tick += e.quarters * 480
        }
        // The bar is exactly as long as its content: a short one is a pickup,
        // an over-full one stretches so no note crosses the barline.
        expect(scoreDurationTicks(score)).toBe(tick)
      }),
    )
  })

  it('lets grace notes change nothing at all', () => {
    fc.assert(
      fc.property(eventsArb, evArb, divisionsArb, (events, grace, d) => {
        const plain = events.map((e) => noteXml(e, d)).join('')
        const graced = events
          .map((e) => noteXml(grace, d, { grace: true }) + noteXml(e, d))
          .join('')
        expect(timeline(parseOrThrow(scoreXml(graced, d)))).toBe(
          timeline(parseOrThrow(scoreXml(plain, d))),
        )
      }),
    )
  })

  it('never advances the cursor for a <chord/> note', () => {
    fc.assert(
      fc.property(
        eventsArb,
        fc.array(evArb, { maxLength: 3 }),
        divisionsArb,
        (events, extra, d) => {
          const first = events[0]
          if (first === undefined) return
          const plain = events.map((e) => noteXml(e, d)).join('')
          const chorded =
            noteXml(first, d) +
            extra
              .map((e) => noteXml({ ...e, quarters: first.quarters }, d, { chord: true }))
              .join('') +
            events
              .slice(1)
              .map((e) => noteXml(e, d))
              .join('')
          const withChord = parseOrThrow(scoreXml(chorded, d))
          const without = parseOrThrow(scoreXml(plain, d))
          // The chord adds notes at tick 0 but shifts nothing: same total length,
          // same measure count, and the trailing notes keep their onsets.
          expect(scoreDurationTicks(withChord)).toBe(scoreDurationTicks(without))
          expect(withChord.notes.filter((n) => n.startTick > 0).map((n) => n.startTick)).toEqual(
            without.notes.filter((n) => n.startTick > 0).map((n) => n.startTick),
          )
        },
      ),
    )
  })

  it('treats <backup> and <forward> of the same length as a no-op', () => {
    fc.assert(
      fc.property(eventsArb, divisionsArb, fc.integer({ min: 1, max: 8 }), (events, d, back) => {
        const body = events.map((e) => noteXml(e, d)).join('')
        const total = events.reduce((sum, e) => sum + e.quarters, 0) * d
        const shift = Math.min(back, total)
        const shifted = `${body}<backup><duration>${shift}</duration></backup><forward><duration>${shift}</duration></forward>`
        expect(timeline(parseOrThrow(scoreXml(shifted, d)))).toBe(
          timeline(parseOrThrow(scoreXml(body, d))),
        )
      }),
    )
  })

  it('rounds a duration that does not land on the tick grid', () => {
    // 1 quarter in 7 divisions is 480/7 = 68.571… ticks, which must round to 69.
    const score = parseOrThrow(
      scoreXml(
        '<note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration></note>',
        7,
      ),
    )
    expect(score.notes[0]?.durationTicks).toBe(69)
    expect(score.measures[0]?.durationTicks).toBe(69) // a short bar: the content decides
  })
})

// ================================================================ import speed

describe('parse cost', () => {
  /** 9 notes a bar, two staves: 63 bars is the ~500-note score of a real study. */
  const bigScore = (barCount: number): string => {
    const bars: string[] = []
    for (let bar = 0; bar < barCount; bar++) {
      const rh: string[] = []
      for (let i = 0; i < 8; i++) {
        const step = 'CDEFGAB'[(bar + i) % 7] ?? 'C'
        rh.push(
          `<note><pitch><step>${step}</step><octave>4</octave></pitch><duration>1</duration>` +
            '<voice>1</voice><type>eighth</type><staff>1</staff></note>',
        )
      }
      const attributes =
        bar === 0
          ? '<attributes><divisions>2</divisions><key><fifths>0</fifths></key>' +
            '<time><beats>4</beats><beat-type>4</beat-type></time><staves>2</staves>' +
            '<clef number="1"><sign>G</sign><line>2</line></clef>' +
            '<clef number="2"><sign>F</sign><line>4</line></clef></attributes>'
          : ''
      bars.push(
        `<measure number="${bar + 1}">${attributes}${rh.join('')}` +
          '<backup><duration>8</duration></backup>' +
          '<note><pitch><step>C</step><octave>3</octave></pitch><duration>8</duration>' +
          '<voice>5</voice><type>whole</type><staff>2</staff></note></measure>',
      )
    }
    return `<?xml version="1.0"?><score-partwise><part-list><score-part id="P1"/></part-list><part id="P1">${bars.join('')}</part></score-partwise>`
  }

  /**
   * A deterministic stand-in for the wall-clock check this used to be. Timing a
   * parse needs a real clock, which the testing rules forbid, and a 50 ms budget
   * against a 1.6 ms parse could not have failed anyway.
   *
   * `String.prototype.slice` is the parser's only bulk operation: every tag name,
   * attribute name, attribute value and run of text is one slice. The number of
   * CHARACTERS those slices copy is therefore a machine-independent count of the
   * work done, and it is exactly the quantity that goes quadratic in the classic
   * regression — re-slicing the rest of the source for every token. The patch is
   * installed around a single `parseMusicXml` call and always removed.
   */
  const sliceWork = (source: string): number => {
    const original = String.prototype.slice
    let characters = 0
    String.prototype.slice = function patched(this: string, start?: number, end?: number): string {
      const out = original.call(this, start, end)
      characters += out.length
      return out
    }
    try {
      const result = parseMusicXml(source)
      if (!result.ok) throw new Error(result.error)
    } finally {
      String.prototype.slice = original
    }
    return characters
  }

  it('parses a ~500-note score correctly', () => {
    const result = parseMusicXml(bigScore(63))
    expect(result.ok && result.value.notes).toHaveLength(63 * 9)
    expect(result.ok && result.value.measures).toHaveLength(63)
  })

  it('does work proportional to the file, not to its square', () => {
    const small = bigScore(20)
    const large = bigScore(80) // 4x the bars, ~4x the characters
    const smallWork = sliceWork(small)
    const largeWork = sliceWork(large)

    // Linear: the parser copies each character a bounded number of times.
    expect(smallWork).toBeLessThan(small.length * 2)
    expect(largeWork).toBeLessThan(large.length * 2)
    // 4x the input costs ~4x the work. An O(n^2) parser would cost ~16x, so the
    // ceiling of 6 leaves a wide margin for constant-factor noise while still
    // failing the moment the growth stops being linear.
    expect(largeWork / smallWork).toBeLessThan(6)
    expect(largeWork / smallWork).toBeGreaterThan(3)
  })
})
