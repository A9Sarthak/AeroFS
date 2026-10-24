import { useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useStore } from '../state/store'
import { getBlockDetails } from '../api/client'
import type { TelemetryResponse } from '../api/types'
import { BLOCK_STATE_LABELS, BLOCK_STATE_COLORS, GRID_STATE_MAP } from '../api/types'

interface Props {
  telemetry?: TelemetryResponse
}

export default function Inspector({ telemetry }: Props) {
  const selectedBlockId = useStore((s) => s.selectedBlockId)
  const selectedFileName = useStore((s) => s.selectedFileName)
  const inspectorFile = useStore((s) => s.inspectorFile)
  const setInspectorBlock = useStore((s) => s.setInspectorBlock)
  const setSelectedView = useStore((s) => s.setActiveView)

  const { data: blockDetails, isLoading: blockLoading } = useQuery({
    queryKey: ['block', selectedBlockId],
    queryFn: () => getBlockDetails(selectedBlockId!),
    enabled: selectedBlockId !== null,
  })

  useEffect(() => {
    if (blockDetails) setInspectorBlock(blockDetails)
  }, [blockDetails, setInspectorBlock])

  const renderBlockInspector = () => {
    if (blockLoading) return <div className="skeleton" style={{ height: 200, borderRadius: 8 }} />
    if (!blockDetails) return null

    const state = blockDetails.is_corrupted ? 'corrupted'
      : blockDetails.is_metadata ? 'metadata'
      : blockDetails.refcount > 1 ? 'shared'
      : blockDetails.is_allocated ? 'unique'
      : 'free'

    return (
      <>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <div style={{
            width: 14, height: 14, borderRadius: 3,
            background: BLOCK_STATE_COLORS[state],
            boxShadow: `0 0 8px ${BLOCK_STATE_COLORS[state]}`,
            flexShrink: 0
          }} />
          <span className="fw-600">Block #{blockDetails.block_id}</span>
          <span style={{ marginLeft: 'auto', fontSize: '0.72rem', color: BLOCK_STATE_COLORS[state], fontWeight: 600 }}>
            {BLOCK_STATE_LABELS[state]}
          </span>
        </div>

        <div className="inspector-row">
          <span className="inspector-label">Allocated</span>
          <span className="inspector-value">{blockDetails.is_allocated ? '✅ Yes' : '❌ No'}</span>
        </div>
        <div className="inspector-row">
          <span className="inspector-label">Ref Count</span>
          <span className="inspector-value" style={{ color: blockDetails.refcount > 1 ? 'var(--status-purple)' : '' }}>
            {blockDetails.refcount}
          </span>
        </div>
        <div className="inspector-row">
          <span className="inspector-label">Corrupted</span>
          <span className="inspector-value" style={{ color: blockDetails.is_corrupted ? 'var(--status-error)' : 'var(--status-ok)' }}>
            {blockDetails.is_corrupted ? '⚠ Yes' : 'No'}
          </span>
        </div>
        <div className="inspector-row">
          <span className="inspector-label">Hash OK</span>
          <span className="inspector-value" style={{ color: blockDetails.hash_matches ? 'var(--status-ok)' : 'var(--status-error)' }}>
            {blockDetails.is_allocated ? (blockDetails.hash_matches ? '✅ Match' : '❌ Mismatch') : '—'}
          </span>
        </div>
        <div className="inspector-row">
          <span className="inspector-label">Sharing</span>
          <span className="inspector-value" style={{
            color: blockDetails.refcount > 1 ? 'var(--status-purple)' : 'var(--status-ok)',
            fontWeight: 700
          }}>
            {blockDetails.sharing_label || (blockDetails.refcount > 1 ? '🔗 CAS Shared' : '🟢 Unique')}
          </span>
        </div>
        {blockDetails.sharing_explanation && (
          <div style={{
            fontSize: '0.72rem',
            padding: '6px 8px',
            borderRadius: 4,
            background: blockDetails.refcount > 1 ? 'rgba(168, 85, 247, 0.12)' : 'rgba(16, 185, 129, 0.12)',
            border: `1px solid ${blockDetails.refcount > 1 ? 'rgba(168, 85, 247, 0.3)' : 'rgba(16, 185, 129, 0.3)'}`,
            color: blockDetails.refcount > 1 ? '#c084fc' : '#34d399',
            lineHeight: 1.4,
            marginBottom: 8,
          }}>
            {blockDetails.sharing_explanation}
          </div>
        )}
        {blockDetails.expected_hash && (
          <div className="inspector-row" style={{ flexDirection: 'column', gap: 4 }}>
            <span className="inspector-label">Expected SHA-256</span>
            <span className="hash-display inspector-value" title={blockDetails.expected_hash}>
              {blockDetails.expected_hash.slice(0, 24)}…
            </span>
          </div>
        )}
        {blockDetails.actual_hash && (
          <div className="inspector-row" style={{ flexDirection: 'column', gap: 4 }}>
            <span className="inspector-label">Actual SHA-256</span>
            <span className="hash-display inspector-value" title={blockDetails.actual_hash}
              style={{ color: blockDetails.hash_matches ? '' : 'var(--status-error)' }}>
              {blockDetails.actual_hash.slice(0, 24)}…
            </span>
          </div>
        )}
        {blockDetails.data_text && (
          <div className="inspector-row" style={{ flexDirection: 'column', gap: 4 }}>
            <span className="inspector-label">Block Payload Content (4KB Sector)</span>
            <div style={{
              maxHeight: 140,
              overflowY: 'auto',
              background: 'var(--bg-input)',
              border: '1px solid var(--border-dim)',
              borderRadius: 4,
              padding: '6px 8px',
              fontFamily: 'var(--font-mono)',
              fontSize: '0.72rem',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-all',
              color: 'var(--text-primary)',
            }}>
              {blockDetails.data_text}
            </div>
          </div>
        )}
        {blockDetails.referencing_files.length > 0 && (
          <div className="inspector-row" style={{ flexDirection: 'column', gap: 4 }}>
            <span className="inspector-label">Owner Files & Chunks</span>
            {blockDetails.file_chunks && blockDetails.file_chunks.length > 0 ? (
              blockDetails.file_chunks.map((fc, i) => (
                <span key={i} className="chip" style={{ cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
                  onClick={() => setSelectedView('files')}>
                  <span>📄 {fc.file_name}</span>
                  <span style={{ fontSize: '0.65rem', opacity: 0.8 }}>Part {fc.chunk_part}/{fc.total_chunks}</span>
                </span>
              ))
            ) : (
              blockDetails.referencing_files.map((f) => (
                <span key={f} className="chip" style={{ cursor: 'pointer' }}
                  onClick={() => setSelectedView('files')}>📄 {f}</span>
              ))
            )}
          </div>
        )}
        {blockDetails.referencing_snapshots.length > 0 && (
          <div className="inspector-row" style={{ flexDirection: 'column', gap: 4 }}>
            <span className="inspector-label">Snapshots</span>
            {blockDetails.referencing_snapshots.map((s) => (
              <span key={s} className="chip">📷 {s}</span>
            ))}
          </div>
        )}
      </>
    )
  }

  const renderFileInspector = () => {
    if (!inspectorFile) return null
    const f = inspectorFile
    return (
      <>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <span style={{ fontSize: '1.2rem' }}>📄</span>
          <span className="fw-600 truncate" style={{ maxWidth: 160 }} title={f.name}>{f.name}</span>
        </div>
        <div className="inspector-row">
          <span className="inspector-label">Inode ID</span>
          <span className="inspector-value">{f.inode_id ?? '—'}</span>
        </div>
        <div className="inspector-row">
          <span className="inspector-label">Size</span>
          <span className="inspector-value">{formatBytes(f.size)}</span>
        </div>
        <div className="inspector-row">
          <span className="inspector-label">Blocks</span>
          <span className="inspector-value" style={{ color: 'var(--accent)' }}>{f.num_blocks}</span>
        </div>
        <div className="inspector-row">
          <span className="inspector-label">Modified</span>
          <span className="inspector-value">{f.modified_at ?? '—'}</span>
        </div>
        {f.merkle_root && (
          <div className="inspector-row" style={{ flexDirection: 'column', gap: 4 }}>
            <span className="inspector-label">Merkle Root</span>
            <span className="hash-display inspector-value" title={f.merkle_root}>
              {f.merkle_root.slice(0, 24)}…
            </span>
          </div>
        )}
        {f.block_ids && f.block_ids.length > 0 && (
          <div className="inspector-row" style={{ flexDirection: 'column', gap: 4 }}>
            <span className="inspector-label">Block IDs ({f.block_ids.length})</span>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              {f.block_ids.slice(0, 12).map((bid) => (
                <span key={bid} className="chip" style={{ cursor: 'pointer', fontFamily: 'var(--font-mono)', fontSize: '0.68rem' }}
                  onClick={() => useStore.getState().setSelectedBlockId(bid)}>
                  #{bid}
                </span>
              ))}
              {f.block_ids.length > 12 && (
                <span className="chip">+{f.block_ids.length - 12} more</span>
              )}
            </div>
          </div>
        )}
      </>
    )
  }

  const hasContent = selectedBlockId !== null || inspectorFile !== null

  return (
    <aside className="inspector" aria-label="Inspector panel">
      <div className="inspector-header">
        <span>Inspector</span>
        {hasContent && (
          <button
            onClick={() => {
              useStore.getState().setSelectedBlockId(null)
              useStore.getState().setInspectorFile(null)
              useStore.getState().setSelectedFileName(null)
            }}
            style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '0.8rem' }}
          >✕ Clear</button>
        )}
      </div>
      <div className="inspector-body">
        {!hasContent ? (
          <div style={{ color: 'var(--text-muted)', fontSize: '0.82rem', textAlign: 'center', paddingTop: 24 }}>
            <div style={{ fontSize: '2rem', marginBottom: 8 }}>🔍</div>
            <div>Click a file or block to inspect its details</div>
          </div>
        ) : (
          <>
            {selectedBlockId !== null && renderBlockInspector()}
            {selectedBlockId === null && inspectorFile !== null && renderFileInspector()}
            {!hasContent && telemetry && (
              <DiskSummary telemetry={telemetry} />
            )}
          </>
        )}

        {/* Always show disk summary at bottom */}
        {telemetry && (
          <>
            <div className="divider" style={{ marginTop: 20 }} />
            <DiskSummary telemetry={telemetry} />
          </>
        )}
      </div>
    </aside>
  )
}

function DiskSummary({ telemetry }: { telemetry: TelemetryResponse }) {
  const d = telemetry.disk
  return (
    <div>
      <div style={{ fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--text-muted)', marginBottom: 8 }}>
        Disk Summary
      </div>
      <div className="inspector-row">
        <span className="inspector-label">Total Blocks</span>
        <span className="inspector-value">{d.total_blocks.toLocaleString()}</span>
      </div>
      <div className="inspector-row">
        <span className="inspector-label">Block Size</span>
        <span className="inspector-value">{d.block_size / 1024} KiB</span>
      </div>
      <div className="inspector-row">
        <span className="inspector-label">Allocated</span>
        <span className="inspector-value" style={{ color: 'var(--accent)' }}>
          {d.allocated_blocks.toLocaleString()}
        </span>
      </div>
      <div className="inspector-row">
        <span className="inspector-label">Free</span>
        <span className="inspector-value" style={{ color: 'var(--status-ok)' }}>
          {d.free_blocks.toLocaleString()}
        </span>
      </div>
      <div className="inspector-row">
        <span className="inspector-label">Utilization</span>
        <span className="inspector-value">{d.utilization_percent}%</span>
      </div>
      <div style={{ marginTop: 8, height: 6, borderRadius: 3, background: 'var(--bg-input)', overflow: 'hidden' }}>
        <div style={{
          height: '100%',
          width: `${d.utilization_percent}%`,
          background: 'linear-gradient(90deg, var(--accent), var(--status-purple))',
          transition: 'width 0.5s ease',
        }} />
      </div>

      <div style={{ marginTop: 14, fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--text-muted)', marginBottom: 8 }}>
        Dedup Stats
      </div>
      <div className="inspector-row">
        <span className="inspector-label">Unique Chunks</span>
        <span className="inspector-value">{telemetry.dedup.unique_chunks?.toLocaleString() ?? '—'}</span>
      </div>
      <div className="inspector-row">
        <span className="inspector-label">Dedup Hits</span>
        <span className="inspector-value" style={{ color: 'var(--status-purple)' }}>
          {telemetry.dedup.dedup_hits?.toLocaleString() ?? '—'}
        </span>
      </div>
      <div className="inspector-row">
        <span className="inspector-label">Blocks Saved</span>
        <span className="inspector-value" style={{ color: 'var(--status-ok)' }}>
          {telemetry.dedup.blocks_saved?.toLocaleString() ?? '—'}
        </span>
      </div>
    </div>
  )
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MiB`
}
