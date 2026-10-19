import { useStore } from '../state/store'

export default function Timeline() {
  const events = useStore((s) => s.events)
  const clearEvents = useStore((s) => s.clearEvents)

  return (
    <section className="timeline" aria-label="Operation timeline">
      <div className="timeline-header">
        <span>⚡ Event Timeline</span>
        <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>
          {events.length} events
        </span>
        {events.length > 0 && (
          <button
            onClick={clearEvents}
            className="btn btn-ghost btn-sm"
            style={{ marginLeft: 'auto', fontSize: '0.7rem', padding: '2px 8px' }}
          >
            Clear
          </button>
        )}
      </div>

      <div className="timeline-events" role="log" aria-live="polite">
        {events.length === 0 ? (
          <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem', textAlign: 'center', padding: '16px' }}>
            No operations yet. Use the File Manager or Integrity Lab to get started.
          </div>
        ) : (
          events.map((ev) => (
            <div key={ev.id} className="event-entry" role="listitem">
              <span className="event-ts">{ev.timestamp}</span>
              <span className="event-op" style={{ color: opColor(ev.operation) }}>
                {opIcon(ev.operation)} {ev.operation}
              </span>
              <span className="event-msg" title={ev.message}>{ev.message}</span>
              <span className={`event-badge ${ev.status}`}>{ev.status}</span>
            </div>
          ))
        )}
      </div>
    </section>
  )
}

function opIcon(op: string): string {
  if (op.includes('create') || op.includes('write')) return '📝'
  if (op.includes('delete'))   return '🗑'
  if (op.includes('duplicate') || op.includes('dedup')) return '📋'
  if (op.includes('snapshot')) return '📷'
  if (op.includes('scrub'))    return '🔍'
  if (op.includes('heal'))     return '🔧'
  if (op.includes('bitrot') || op.includes('corrupt')) return '☠'
  if (op.includes('read'))     return '📖'
  if (op.includes('restore'))  return '⏪'
  if (op.includes('format'))   return '💥'
  return '⚡'
}

function opColor(op: string): string {
  if (op.includes('delete') || op.includes('corrupt') || op.includes('bitrot')) return 'var(--status-error)'
  if (op.includes('heal') || op.includes('create') || op.includes('write')) return 'var(--status-ok)'
  if (op.includes('snapshot') || op.includes('dedup') || op.includes('duplicate')) return 'var(--status-purple)'
  if (op.includes('scrub') || op.includes('merkle')) return 'var(--status-info)'
  return 'var(--text-secondary)'
}
