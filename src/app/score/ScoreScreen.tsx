/**
 * The Practice nav destination: import a score or fall back to the bundled
 * sample (roadmap 1.17), then hand off to the practice screen (roadmap 1.18),
 * which renders the notation together with the transport, tempo, loop, hand
 * mute, metronome and wait-mode controls.
 *
 * This screen deliberately owns only the *source* of the score. Everything
 * about playing it belongs to `PracticeScreen`, which also owns the single
 * `ScoreViewer` instance — two viewers would mean two OSMD engravings of the
 * same piece and two cursors disagreeing about the position.
 */
import { parseMusicXml } from '@core/notation/musicxml.ts'
import { useScoreStore } from '@app/state/scoreStore.ts'
import { PracticeScreen } from '@app/practice/PracticeScreen.tsx'
import sampleMusicXml from '@content/scores/twinkle-twinkle-little-star.musicxml?raw'
import { useEffect } from 'react'
import { AnalysisPanel } from './AnalysisPanel.tsx'
import { ImportPanel } from './ImportPanel.tsx'

const SAMPLE_SCORE_SOURCE_NAME = 'Twinkle, Twinkle, Little Star (bundled sample)'

export function ScoreScreen() {
  const loaded = useScoreStore((s) => s.loaded)
  const loadScore = useScoreStore((s) => s.loadScore)

  useEffect(() => {
    if (loaded !== undefined) return
    const result = parseMusicXml(sampleMusicXml)
    if (result.ok) {
      loadScore({
        score: result.value,
        sourceName: SAMPLE_SCORE_SOURCE_NAME,
        musicXml: sampleMusicXml,
      })
    }
  }, [loaded, loadScore])

  return (
    <div className="score-screen">
      <ImportPanel />
      {loaded === undefined && <p>Loading the bundled sample score…</p>}
      {loaded !== undefined && (
        <section aria-label="Score">
          <h2>
            {loaded.score.meta.title.length > 0 ? loaded.score.meta.title : loaded.sourceName}
          </h2>
          <PracticeScreen />
          {/* `PracticeScreen` renders `ScoreViewer` only when `musicXml` is
              defined. Every import path now supplies it — a MIDI file is
              engraved from MusicXML written back out of the parsed Score
              (roadmap 2.20) — so this fallback covers only a score loaded
              some future way that genuinely has no notation, and says what is
              missing where the notation would have been rather than above the
              transport, where it was read as a caption and missed. */}
          {loaded.musicXml === undefined && (
            <p>There is no notation to engrave for this score — playback still works.</p>
          )}
          {/* REQ-3.5.5: the roman-numeral analysis of the piece being played,
              under it (roadmap 3.2a). */}
          <AnalysisPanel score={loaded.score} />
        </section>
      )}
    </div>
  )
}
