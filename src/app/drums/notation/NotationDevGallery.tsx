/**
 * DR-05's development gallery — the proof surface for the drum groove
 * renderer while no trainer screen (DR-09+) exists to host it. Reached only
 * by URL (`/drums/notation-dev`, see `route.ts`); deliberately absent from
 * the drums nav table, so a learner never lands here.
 *
 * This file is a stub until the DR-05 slice replaces it with the real
 * gallery rendering the reference grooves through `GrooveStaff`.
 */
export function NotationDevGallery() {
  return (
    <section className="screen">
      <h1>Notation dev gallery</h1>
      <p>DR-05 renderer gallery placeholder — nothing to show yet.</p>
    </section>
  )
}
