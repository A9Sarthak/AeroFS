import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getTelemetry, createTextFile, simulateWorkload, runScrub, formatFilesystem } from '../../api/client'
import { useStore } from '../../state/store'
import { BLOCK_STATE_COLORS, GRID_STATE_MAP } from '../../api/types'
import { useState } from 'react'
import BlockGrid2D from '../storage-map/BlockGrid2D'

export default function Overview() {
  const { data: telemetry, isLoading, isError, error } = useQuery({
    queryKey: ['telemetry'],
    queryFn: getTelemetry,
    refetchInterval: 8000,
  })

  const queryClient = useQueryClient()
  const addEvent = useStore((s) => s.addEvent)
  const showToast = useStore((s) => s.showToast)
  const setCurrentOperation = useStore((s) => s.setCurrentOperation)
  const setActiveView = useStore((s) => s.setActiveView)

  const [confirmFormat, setConfirmFormat] = useState(false)

  const workloadMut = useMutation({
    mutationFn: simulateWorkload,
    onMutate: () => setCurrentOperation('Generating demo workload…'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['telemetry'] })
      addEvent({ operation: 'simulate_workload', status: 'success', message: 'Demo workload generated: files, dedup, snapshot, CoW' })
      showToast('success', 'Demo workload generated!')
      setCurrentOperation(null)
    },
    onError: (e: Error) => {
      addEvent({ operation: 'simulate_workload', status: 'failed', message: e.message })
      showToast('error', e.message)
      setCurrentOperation(null)
    },
  })

  const scrubMut = useMutation({
    mutationFn: runScrub,
    onMutate: () => setCurrentOperation('Running Merkle scrub…'),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['telemetry'] })
      const corrupt = data.corrupted_blocks?.length ?? 0
      addEvent({
        operation: 'scrub',
        status: corrupt > 0 ? 'warning' : 'success',
        message: `Scrub complete: ${data.files_checked ?? data.total_files ?? '?'} files checked, ${corrupt} corrupt blocks`,
        affectedBlockIds: data.corrupted_blocks,
      })
      showToast(corrupt > 0 ? 'warning' : 'success', `Scrub: ${corrupt} corrupted blocks found`)
      setCurrentOperation(null)
    },
    onError: (e: Error) => {
      addEvent({ operation: 'scrub', status: 'failed', message: e.message })
      showToast('error', e.message)
      setCurrentOperation(null)
    },
  })

  const formatMut = useMutation({
    mutationFn: formatFilesystem,
    onMutate: () => setCurrentOperation('Formatting filesystem…'),
    onSuccess: () => {
      queryClient.invalidateQueries()
      addEvent({ operation: 'format', status: 'warning', message: 'Filesystem formatted and reset' })
      showToast('warning', 'Filesystem formatted.')
      setConfirmFormat(false)
      setCurrentOperation(null)
    },
    onError: (e: Error) => {
      showToast('error', e.message)
      setCurrentOperation(null)
    },
  })

  if (isLoading) {
    return (
      <div>
        <div className="section-header">
          <div>
            <div className="section-title">🌐 Overview</div>
            <div className="section-sub">Loading system state…</div>
          </div>
        </div>
        <div className="panel-grid cols-4" style={{ marginBottom: 16 }}>
          {[...Array(4)].map((_, i) => <div key={i} className="skeleton metric-card" style={{ height: 90 }} />)}
        </div>
        <div className="skeleton" style={{ height: 300, borderRadius: 16 }} />
      </div>
    )
  }

  if (isError) {
    return (
      <div>
        <div className="section-header">
          <div className="section-title">🌐 Overview</div>
        </div>
        <div className="alert alert-error">
          <span className="alert-icon">❌</span>
          <div>
            <div className="fw-600">Backend Unreachable</div>
            <div>{(error as Error).message}</div>
            <div style={{ marginTop: 6, fontSize: '0.78rem' }}>
              Make sure the AeroFS backend is running: <code className="mono">uvicorn aerofs.app:app --reload</code>
            </div>
          </div>
        </div>
      </div>
    )
  }

  const d = telemetry!.disk
  const dedup = telemetry!.dedup
  const corruptCount = d.corrupted_blocks_count

  return (
    <div>
      <div className="section-header">
        <div>
          <h1 className="section-title">🌐 System Overview</h1>
          <div className="section-sub">
            AeroFS virtual disk · {d.total_blocks.toLocaleString()} blocks · {(d.capacity_bytes / (1024 * 1024)).toFixed(1)} MiB total
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn btn-ghost btn-sm" onClick={() => workloadMut.mutate()} disabled={workloadMut.isPending}>
            {workloadMut.isPending ? '⟳ Generating…' : '🚀 Generate Demo Workload'}
          </button>
          <button className="btn btn-ghost btn-sm" onClick={() => scrubMut.mutate()} disabled={scrubMut.isPending}>
            {scrubMut.isPending ? '⟳ Scrubbing…' : '🔍 Run Scrub'}
          </button>
          {!confirmFormat ? (
            <button className="btn btn-danger btn-sm" onClick={() => setConfirmFormat(true)}>
              💥 Format Disk
            </button>
          ) : (
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <span style={{ fontSize: '0.78rem', color: 'var(--status-error)' }}>⚠ This erases all data. Sure?</span>
              <button className="btn btn-danger btn-sm" onClick={() => formatMut.mutate()} disabled={formatMut.isPending}>
                {formatMut.isPending ? 'Formatting…' : 'Confirm Format'}
              </button>
              <button className="btn btn-ghost btn-sm" onClick={() => setConfirmFormat(false)}>Cancel</button>
            </div>
          )}
        </div>
      </div>

      {/* Metrics */}
      <div className="panel-grid cols-4" style={{ marginBottom: 16 }}>
        <div className="metric-card">
          <div className="metric-label">Allocated Blocks</div>
          <div className="metric-value" style={{ color: 'var(--accent)' }}>
            {d.allocated_blocks.toLocaleString()}
          </div>
          <div className="metric-sub">of {d.total_blocks.toLocaleString()} total · {d.utilization_percent}%</div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Files</div>
          <div className="metric-value" style={{ color: 'var(--status-ok)' }}>
            {telemetry!.file_count}
          </div>
          <div className="metric-sub">{telemetry!.snapshot_count} snapshots</div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Dedup Hits</div>
          <div className="metric-value" style={{ color: 'var(--status-purple)' }}>
            {(dedup.dedup_hits ?? 0).toLocaleString()}
          </div>
          <div className="metric-sub">{(dedup.blocks_saved ?? 0).toLocaleString()} blocks saved</div>
        </div>
        <div className="metric-card" style={{ borderColor: corruptCount > 0 ? 'rgba(239,68,68,0.5)' : undefined }}>
          <div className="metric-label">Corrupted Blocks</div>
          <div className="metric-value" style={{ color: corruptCount > 0 ? 'var(--status-error)' : 'var(--status-ok)' }}>
            {corruptCount}
          </div>
          <div className="metric-sub" style={{ color: corruptCount > 0 ? 'var(--status-error)' : '' }}>
            {corruptCount > 0 ? 'Integrity alert!' : 'All blocks healthy'}
          </div>
        </div>
      </div>

      {/* Utilization bar */}
      <div className="card" style={{ marginBottom: 16, padding: '16px 20px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8, fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
          <span>Disk Utilization</span>
          <span className="mono">{d.utilization_percent}%</span>
        </div>
        <div style={{ height: 10, borderRadius: 5, background: 'var(--bg-input)', overflow: 'hidden' }}>
          <div style={{
            height: '100%',
            width: `${d.utilization_percent}%`,
            background: d.utilization_percent > 85
              ? 'linear-gradient(90deg, var(--status-warn), var(--status-error))'
              : 'linear-gradient(90deg, var(--accent), var(--status-purple))',
            transition: 'width 0.6s ease',
          }} />
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6, fontSize: '0.72rem', color: 'var(--text-muted)' }}>
          <span>{d.allocated_blocks.toLocaleString()} allocated</span>
          <span>{d.free_blocks.toLocaleString()} free</span>
        </div>
      </div>

      {/* 2D Block Grid */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-title">
          <span>🧊 Block Map (first {Math.min(telemetry!.grid_blocks.length, 1024)} blocks)</span>
          <button className="btn btn-ghost btn-sm" style={{ marginLeft: 'auto' }} onClick={() => setActiveView('storage')}>
            Open 3D Map →
          </button>
        </div>
        <BlockGrid2D
          gridBlocks={telemetry!.grid_blocks}
          compact
        />
        <div className="legend" style={{ marginTop: 12 }}>
          {[
            { label: 'Free', color: 'var(--color-free)', border: '1px solid #334155' },
            { label: 'Metadata', color: 'var(--color-meta)' },
            { label: 'Unique', color: 'var(--color-unique)' },
            { label: 'Shared/Deduped', color: 'var(--color-shared)' },
            { label: 'Corrupted', color: 'var(--color-corrupted)' },
          ].map((l) => (
            <div key={l.label} className="legend-item">
              <div className="legend-dot" style={{ background: l.color, border: l.border ?? 'none' }} />
              <span>{l.label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Quick actions */}
      <div className="panel-grid cols-3">
        <button className="card" style={{ cursor: 'pointer', textAlign: 'left' }} onClick={() => setActiveView('files')}>
          <div className="card-title">📁 File Manager</div>
          <div style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
            Create, edit, duplicate files. See CoW and CAS dedup in action.
          </div>
        </button>
        <button className="card" style={{ cursor: 'pointer', textAlign: 'left' }} onClick={() => setActiveView('integrity')}>
          <div className="card-title" style={{ color: corruptCount > 0 ? 'var(--status-error)' : undefined }}>
            🔬 Integrity Lab
          </div>
          <div style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
            {corruptCount > 0
              ? `⚠ ${corruptCount} corrupted blocks! Run Merkle scrub & self-heal.`
              : 'Inject bit rot, run Merkle scrub, and self-heal corrupted blocks.'}
          </div>
        </button>
        <button className="card" style={{ cursor: 'pointer', textAlign: 'left' }} onClick={() => setActiveView('snapshots')}>
          <div className="card-title">📷 Snapshots</div>
          <div style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
            {telemetry!.snapshot_count} snapshots. Create, inspect, and restore point-in-time filesystem views.
          </div>
        </button>
      </div>
    </div>
  )
}
