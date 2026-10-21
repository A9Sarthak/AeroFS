import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getHealLog } from '../../api/client'
import { useStore } from '../../state/store'

export default function AuditLog() {
  const [filterStatus, setFilterStatus] = useState<'all' | 'success' | 'failed'>('all')
  const [searchQuery, setSearchQuery] = useState('')

  // Fetch heal log from backend
  const { data: healData, isLoading } = useQuery({
    queryKey: ['heal_log'],
    queryFn: () => getHealLog(),
    refetchInterval: 10000,
  })

  // Get operation events from local store
  const localEvents = useStore((s) => s.events)

  const healRecords = healData?.heal_events ?? []

  // Filtered heal records
  const filteredRecords = healRecords.filter((rec) => {
    if (filterStatus === 'success' && !rec.success) return false
    if (filterStatus === 'failed' && rec.success) return false
    if (searchQuery) {
      const q = searchQuery.toLowerCase()
      const matchBlock = rec.block_id.toString().includes(q)
      const matchSource = rec.source?.toLowerCase().includes(q)
      const matchFile = rec.owning_file?.toLowerCase().includes(q)
      return matchBlock || matchSource || matchFile
    }
    return true
  })

  const exportJSON = () => {
    const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify({
      heal_records: healRecords,
      operation_events: localEvents
    }, null, 2))
    const downloadAnchor = document.createElement('a')
    downloadAnchor.setAttribute('href', dataStr)
    downloadAnchor.setAttribute('download', `aerofs_audit_log_${Date.now()}.json`)
    document.body.appendChild(downloadAnchor)
    downloadAnchor.click()
    downloadAnchor.remove()
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem', height: '100%', overflowY: 'auto' }}>
      {/* Header */}
      <div style={{
        padding: '1.25rem',
        background: 'rgba(30, 41, 59, 0.7)',
        borderRadius: '8px',
        border: '1px solid rgba(255, 255, 255, 0.08)',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: '1rem'
      }}>
        <div>
          <h2 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span>📜</span> Recovery & Audit Log
          </h2>
          <p style={{ margin: '4px 0 0', fontSize: '0.8rem', color: '#94a3b8' }}>
            Authoritative chronicle of self-healing operations, verification proofs, and storage events
          </p>
        </div>

        <button
          onClick={exportJSON}
          style={{
            background: '#1e293b',
            color: '#f8fafc',
            border: '1px solid #334155',
            padding: '6px 14px',
            borderRadius: '6px',
            fontSize: '0.85rem',
            cursor: 'pointer'
          }}
        >
          ⬇ Export JSON
        </button>
      </div>

      {/* Filter and Search Bar */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '1rem',
        flexWrap: 'wrap'
      }}>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          {(['all', 'success', 'failed'] as const).map((st) => (
            <button
              key={st}
              onClick={() => setFilterStatus(st)}
              style={{
                padding: '5px 12px',
                borderRadius: '6px',
                fontSize: '0.8rem',
                fontWeight: 600,
                border: 'none',
                cursor: 'pointer',
                background: filterStatus === st ? '#38bdf8' : '#1e293b',
                color: filterStatus === st ? '#0f172a' : '#94a3b8'
              }}
            >
              {st.charAt(0).toUpperCase() + st.slice(1)}
            </button>
          ))}
        </div>

        <input
          type="text"
          placeholder="Filter by block ID, source, or filename..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          style={{
            background: 'var(--bg-input)',
            border: '1px solid var(--border-dim)',
            color: 'var(--text-primary)',
            padding: '6px 12px',
            borderRadius: '6px',
            fontSize: '0.85rem',
            width: '280px'
          }}
        />
      </div>

      {/* Backend Heal Audit Table */}
      <div style={{
        background: 'var(--bg-card)',
        borderRadius: '8px',
        border: '1px solid var(--border-dim)',
        overflow: 'hidden'
      }}>
        <div style={{
          padding: '0.75rem 1rem',
          borderBottom: '1px solid var(--border-dim)',
          fontSize: '0.9rem',
          fontWeight: 600,
          color: 'var(--text-primary)'
        }}>
          Verified Block Self-Heal Records ({filteredRecords.length})
        </div>

        {isLoading ? (
          <div style={{ padding: '2rem', textAlign: 'center', color: '#64748b' }}>Loading heal logs…</div>
        ) : filteredRecords.length === 0 ? (
          <div style={{ padding: '3rem 1rem', textAlign: 'center', color: '#64748b' }}>
            No self-heal events recorded in this session.
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem', textAlign: 'left' }}>
              <thead>
                <tr style={{ background: 'rgba(30, 41, 59, 0.5)', color: '#94a3b8', borderBottom: '1px solid rgba(255, 255, 255, 0.05)' }}>
                  <th style={{ padding: '0.6rem 1rem' }}>Block ID</th>
                  <th style={{ padding: '0.6rem 1rem' }}>Status</th>
                  <th style={{ padding: '0.6rem 1rem' }}>Recovery Source</th>
                  <th style={{ padding: '0.6rem 1rem' }}>Owning File</th>
                  <th style={{ padding: '0.6rem 1rem' }}>Expected Hash</th>
                  <th style={{ padding: '0.6rem 1rem' }}>Recovered Hash</th>
                </tr>
              </thead>
              <tbody>
                {filteredRecords.map((r, idx) => (
                  <tr key={idx} style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.04)' }}>
                    <td style={{ padding: '0.6rem 1rem', fontWeight: 600, color: '#38bdf8' }}>
                      #{r.block_id}
                    </td>
                    <td style={{ padding: '0.6rem 1rem' }}>
                      <span style={{
                        padding: '2px 8px',
                        borderRadius: '4px',
                        fontSize: '0.75rem',
                        fontWeight: 600,
                        background: r.success ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.15)',
                        color: r.success ? '#10b981' : '#ef4444'
                      }}>
                        {r.success ? '✓ VERIFIED' : 'FAILED'}
                      </span>
                    </td>
                    <td style={{ padding: '0.6rem 1rem', color: '#cbd5e1' }}>
                      <code>{r.source || 'None'}</code>
                    </td>
                    <td style={{ padding: '0.6rem 1rem', color: '#f8fafc' }}>
                      {r.owning_file || '—'}
                    </td>
                    <td style={{ padding: '0.6rem 1rem', color: '#94a3b8', fontFamily: 'monospace', fontSize: '0.75rem' }}>
                      {r.expected_hash ? `${r.expected_hash.slice(0, 12)}…` : '—'}
                    </td>
                    <td style={{ padding: '0.6rem 1rem', color: '#94a3b8', fontFamily: 'monospace', fontSize: '0.75rem' }}>
                      {r.recovered_hash ? `${r.recovered_hash.slice(0, 12)}…` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Session Events Stream */}
      <div style={{
        background: 'var(--bg-card)',
        borderRadius: '8px',
        border: '1px solid var(--border-dim)',
        overflow: 'hidden'
      }}>
        <div style={{
          padding: '0.75rem 1rem',
          borderBottom: '1px solid var(--border-dim)',
          fontSize: '0.9rem',
          fontWeight: 600,
          color: 'var(--text-primary)'
        }}>
          Session Activity Stream ({localEvents.length})
        </div>

        <div style={{ padding: '0.75rem', display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
          {localEvents.length === 0 ? (
            <div style={{ padding: '1rem', textAlign: 'center', color: '#64748b', fontSize: '0.85rem' }}>
              No operations performed in this session yet.
            </div>
          ) : (
            localEvents.map((evt) => (
              <div
                key={evt.id}
                style={{
                  padding: '0.5rem 0.75rem',
                  borderRadius: '4px',
                  background: 'rgba(30, 41, 59, 0.4)',
                  fontSize: '0.8rem',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center'
                }}
              >
                <div>
                  <span style={{ fontWeight: 600, color: '#f8fafc', marginRight: 8 }}>{evt.operation}</span>
                  <span style={{ color: '#94a3b8' }}>{evt.message}</span>
                </div>
                <div style={{ fontSize: '0.75rem', color: '#64748b' }}>
                  {evt.timestamp}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
