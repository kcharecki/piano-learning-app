/**
 * Resolves a `GradedPiece.scoreId` (roadmap 5.1, REQ-5.2) to a real `Score` —
 * every bundled file is parsed by `@core/notation/musicxml` at call time, the
 * same untrusted path `ScoreScreen` uses for a file the learner opens, never
 * a trusted builder object like `demoScores.ts`'s. See `LICENSE.md` for the
 * provenance and scope of every file this resolves.
 */
import { parseMusicXml } from '@core/notation/musicxml.ts'
import type { Score } from '@core/notation/score.ts'
import { err, type Result } from '@core/shared/result.ts'

import auClairDeLaLune from './au-clair-de-la-lune.musicxml?raw'
import hotCrossBuns from './hot-cross-buns.musicxml?raw'
import londonBridgeIsFallingDown from './london-bridge-is-falling-down.musicxml?raw'
import maryHadALittleLamb from './mary-had-a-little-lamb.musicxml?raw'
import merrilyWeRollAlong from './merrily-we-roll-along.musicxml?raw'
import odeToJoyTheme from './ode-to-joy-theme.musicxml?raw'
import amazingGrace from './amazing-grace.musicxml?raw'
import longLongAgo from './long-long-ago.musicxml?raw'
import minuetInGMajorBwvAnh114 from './minuet-in-g-major-bwv-anh-114.musicxml?raw'
import scarboroughFair from './scarborough-fair.musicxml?raw'
import skipToMyLou from './skip-to-my-lou.musicxml?raw'
import furEliseTheme from './fur-elise-theme.musicxml?raw'
import greensleeves from './greensleeves.musicxml?raw'
import burgmullerArabesqueOp100No2 from './burgmuller-arabesque-op-100-no-2.musicxml?raw'
import bachPreludeInCMajorBwv846 from './bach-prelude-in-c-major-bwv-846.musicxml?raw'
import kuhlauSonatinaOp20No1 from './kuhlau-sonatina-op-20-no-1.musicxml?raw'
import clementiSonatinaOp36No1 from './clementi-sonatina-op-36-no-1.musicxml?raw'
import beethovenSonatinaOp49No1 from './beethoven-sonatina-op-49-no-1.musicxml?raw'
import bachInventionNo1Bwv772 from './bach-invention-no-1-bwv-772.musicxml?raw'
import chopinPreludeOp28No4 from './chopin-prelude-op-28-no-4.musicxml?raw'
import twinkleTwinkleLittleStar from './twinkle-twinkle-little-star.musicxml?raw'
import rowRowRowYourBoat from './row-row-row-your-boat.musicxml?raw'
import frereJacques from './frere-jacques.musicxml?raw'
import thisOldMan from './this-old-man.musicxml?raw'
import oldMacdonaldHadAFarm from './old-macdonald-had-a-farm.musicxml?raw'
import lightlyRow from './lightly-row.musicxml?raw'
import yankeeDoodle from './yankee-doodle.musicxml?raw'
import jollyOldSaintNicholas from './jolly-old-saint-nicholas.musicxml?raw'
import ringAroundTheRosie from './ring-around-the-rosie.musicxml?raw'
import rainRainGoAway from './rain-rain-go-away.musicxml?raw'
import theFarmerInTheDell from './the-farmer-in-the-dell.musicxml?raw'
import whenTheSaintsGoMarchingIn from './when-the-saints-go-marching-in.musicxml?raw'
import jingleBells from './jingle-bells.musicxml?raw'
import camptownRaces from './camptown-races.musicxml?raw'
import ohSusanna from './oh-susanna.musicxml?raw'
import auldLangSyne from './auld-lang-syne.musicxml?raw'
import simpleGifts from './simple-gifts.musicxml?raw'
import homeOnTheRange from './home-on-the-range.musicxml?raw'
import myBonnieLiesOverTheOcean from './my-bonnie-lies-over-the-ocean.musicxml?raw'
import dannyBoy from './danny-boy.musicxml?raw'

/** Raw MusicXML text for every bundled `GRADED_PIECES` score, keyed by `scoreId`. */
const GRADED_SCORE_FILES: ReadonlyMap<string, string> = new Map([
  ['au-clair-de-la-lune', auClairDeLaLune],
  ['hot-cross-buns', hotCrossBuns],
  ['london-bridge-is-falling-down', londonBridgeIsFallingDown],
  ['mary-had-a-little-lamb', maryHadALittleLamb],
  ['merrily-we-roll-along', merrilyWeRollAlong],
  ['ode-to-joy-theme', odeToJoyTheme],
  ['amazing-grace', amazingGrace],
  ['long-long-ago', longLongAgo],
  ['minuet-in-g-major-bwv-anh-114', minuetInGMajorBwvAnh114],
  ['scarborough-fair', scarboroughFair],
  ['skip-to-my-lou', skipToMyLou],
  ['fur-elise-theme', furEliseTheme],
  ['greensleeves', greensleeves],
  ['burgmuller-arabesque-op-100-no-2', burgmullerArabesqueOp100No2],
  ['bach-prelude-in-c-major-bwv-846', bachPreludeInCMajorBwv846],
  ['kuhlau-sonatina-op-20-no-1', kuhlauSonatinaOp20No1],
  ['clementi-sonatina-op-36-no-1', clementiSonatinaOp36No1],
  ['beethoven-sonatina-op-49-no-1', beethovenSonatinaOp49No1],
  ['bach-invention-no-1-bwv-772', bachInventionNo1Bwv772],
  ['chopin-prelude-op-28-no-4', chopinPreludeOp28No4],
  ['twinkle-twinkle-little-star', twinkleTwinkleLittleStar],
  ['row-row-row-your-boat', rowRowRowYourBoat],
  ['frere-jacques', frereJacques],
  ['this-old-man', thisOldMan],
  ['old-macdonald-had-a-farm', oldMacdonaldHadAFarm],
  ['lightly-row', lightlyRow],
  ['yankee-doodle', yankeeDoodle],
  ['jolly-old-saint-nicholas', jollyOldSaintNicholas],
  ['ring-around-the-rosie', ringAroundTheRosie],
  ['rain-rain-go-away', rainRainGoAway],
  ['the-farmer-in-the-dell', theFarmerInTheDell],
  ['when-the-saints-go-marching-in', whenTheSaintsGoMarchingIn],
  ['jingle-bells', jingleBells],
  ['camptown-races', camptownRaces],
  ['oh-susanna', ohSusanna],
  ['auld-lang-syne', auldLangSyne],
  ['simple-gifts', simpleGifts],
  ['home-on-the-range', homeOnTheRange],
  ['my-bonnie-lies-over-the-ocean', myBonnieLiesOverTheOcean],
  ['danny-boy', dannyBoy],
])

/** Parses the bundled file for `scoreId`, or an error naming it, when there is no such file. */
export function gradedScoreById(scoreId: string): Result<Score, string> {
  const raw = GRADED_SCORE_FILES.get(scoreId)
  if (raw === undefined) return err(`no bundled graded score for scoreId "${scoreId}"`)
  return parseMusicXml(raw, { id: scoreId })
}

/** The raw MusicXML text bundled for `scoreId`, or undefined if there is no such file. */
export function gradedScoreXmlById(scoreId: string): string | undefined {
  return GRADED_SCORE_FILES.get(scoreId)
}
