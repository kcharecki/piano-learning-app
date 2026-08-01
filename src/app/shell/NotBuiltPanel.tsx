/** An honest placeholder for a nav destination that has no screen yet. */
export type NotBuiltPanelProps = {
  readonly label: string
  readonly roadmapTask: string
}

export function NotBuiltPanel({ label, roadmapTask }: NotBuiltPanelProps) {
  return (
    <div className="not-built-panel" role="status">
      <h2>{label}</h2>
      <p>
        Not built yet — see roadmap task <strong>{roadmapTask}</strong> in <code>ROADMAP.md</code>.
      </p>
    </div>
  )
}
