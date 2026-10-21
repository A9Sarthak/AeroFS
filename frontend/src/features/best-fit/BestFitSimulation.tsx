/**
 * BestFitSimulation.tsx
 * Interactive Operating System Storage Lab:
 * Demonstrates Best-Fit Block Allocation and Dynamic Space Reclaiming:
 *  1. Scans contiguous free holes on the virtual disk container.
 *  2. Evaluates incoming file sizes (large multi-block files with auto-generated content).
 *  3. Compares Best-Fit vs First-Fit vs Worst-Fit decisions in real-time.
 *  4. Executes physical block allocation, occupying the closest matching hole.
 *  5. Demonstrates deletion and instant coalescing of freed space.
 */

import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getTelemetry, getBestFitPreview, createLargeSimulatedFile, deleteFile } from '../../api/client'
import { useStore } from '../../state/store'
import type { BestFitPreviewResponse, CreateLargeFileResponse } from '../../api/types'

export default function BestFitSimulation() {
  const queryClient = useQueryClient()
  const setActiveView = useStore((s) => s.setActiveView)
  const setHighlightedBlockIds = useStore((s) => s.setHighlightedBlockIds)
  const showToast = useStore((s) => s.showToast)
  const addEvent = useStore((s) => s.addEvent)
  const theme = useStore((s) => s.theme)

  // Configuration state
  const [requestedBlocks, setRequestedBlocks] = useState<number>(8)
  const [filename, setFilename] = useState<string>('best_fit_large_dataset.bin')
  const [isUnique, setIsUnique] = useState<boolean>(true)
  const [fillHolesFirst, setFillHolesFirst] = useState<boolean>(false)
  const [lastAllocation, setLastAllocation] = useState<CreateLargeFileResponse | null>(null)
  const [isAllocating, setIsAllocating] = useState<boolean>(false)

  // Telemetry query
  const { data: telemetry, isLoading: telemetryLoading } = useQuery({
    queryKey: ['telemetry'],
    queryFn: getTelemetry,
    refetchInterval: 4000,
  })

  // Decision Preview query
  const { data: preview, isLoading: previewLoading } = useQuery({
    queryKey: ['best-fit-preview', requestedBlocks, fillHolesFirst],
    queryFn: () => getBestFitPreview(requestedBlocks, fillHolesFirst),
    enabled: requestedBlocks > 0,
  })

  const disk = telemetry?.disk
  const freeExtents = disk?.free_extents ?? []

  // Mutation to allocate file
  const allocateMutation = useMutation({
    mutationFn: () =>
      createLargeSimulatedFile(
        filename.trim() || `large_file_${requestedBlocks}blk.bin`,
        requestedBlocks,
        isUnique,
        fillHolesFirst
      ),
    onMutate: () => setIsAllocating(true),
    onSuccess: (data) => {
      setIsAllocating(false)
      setLastAllocation(data)
      queryClient.invalidateQueries({ queryKey: ['telemetry'] })
      queryClient.invalidateQueries({ queryKey: ['best-fit-preview'] })
      showToast('success', `Best-Fit allocated ${data.num_blocks} blocks at sectors [${data.block_ids.join(', ')}]`)
      addEvent({
        operation: 'create_file',
        status: 'success',
        message: `Best-Fit Allocation: '${data.filename}' placed at sectors [${data.block_ids.join(', ')}] (Frag: ${data.pre_fragmentation_percent}% → ${data.post_fragmentation_percent}%)`,
        fileName: data.filename,
        affectedBlockIds: data.block_ids,
      })
    },
    onError: (err: Error) => {
      setIsAllocating(false)
      showToast('error', `Allocation failed: ${err.message}`)
    },
  })

  // Mutation to delete file & reclaim
  const deleteMutation = useMutation({
    mutationFn: (fname: string) => deleteFile(fname),
    onSuccess: (_, fname) => {
      setLastAllocation(null)
      queryClient.invalidateQueries({ queryKey: ['telemetry'] })
      queryClient.invalidateQueries({ queryKey: ['best-fit-preview'] })
      showToast('success', `File '${fname}' deleted — space returned to free hole pool!`)
      addEvent({
        operation: 'delete_file',
        status: 'success',
        message: `Space reclaimed: Deleted '${fname}' — physical blocks returned to free hole extents`,
        fileName: fname,
      })
    },
  })

  const handleInspectInStorageMap = (blockIds: number[]) => {
    setHighlightedBlockIds(new Set(blockIds))
    setActiveView('storage')
  }

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto', paddingBottom: 60 }}>
      {/* Header */}
      <div className="section-header" style={{ marginBottom: 20 }}>
        <div>
          <h1 className="section-title" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span>🧩</span> Best-Fit Block Allocation & Defragmentation Simulator
          </h1>
          <div className="section-sub">
            Interactive OS Storage Subsystem Demo: Watch AeroFS scan available free holes, evaluate leftover fragments,
            and reoccupy deleted sectors with minimum external fragmentation.
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            className="btn btn-secondary btn-sm"
            onClick={() => setActiveView('storage')}
          >
            💽 3D Storage Platter →
          </button>
        </div>
      </div>

      {/* Top Telemetry Metric Cards */}
      <div className="panel-grid cols-4" style={{ marginBottom: 20 }}>
        <div className="metric-card">
          <div className="metric-label">Allocation Engine</div>
          <div className="metric-value" style={{ color: '#38bdf8', fontSize: '1.25rem' }}>
            Best-Fit
          </div>
          <div className="metric-sub">Minimizes leftover hole space</div>
        </div>

        <div className="metric-card">
          <div className="metric-label">External Fragmentation</div>
          <div
            className="metric-value"
            style={{
              color: (disk?.fragmentation_percent ?? 0) > 40 ? '#f59e0b' : '#10b981',
            }}
          >
            {disk?.fragmentation_percent ?? 0}%
          </div>
          <div className="metric-sub">1 - (Largest Hole / Total Free)</div>
        </div>

        <div className="metric-card">
          <div className="metric-label">Contiguous Free Holes</div>
          <div className="metric-value" style={{ color: '#a78bfa' }}>
            {disk?.free_extents_count ?? 1}
          </div>
          <div className="metric-sub">
            Largest hole: {(disk?.largest_free_extent ?? 4092).toLocaleString()} blocks
          </div>
        </div>

        <div className="metric-card">
          <div className="metric-label">Allocated Blocks</div>
          <div className="metric-value" style={{ color: 'var(--text-primary)' }}>
            {disk?.allocated_blocks ?? 0}
          </div>
          <div className="metric-sub">of {disk?.total_blocks ?? 4096} total (16 MiB disk)</div>
        </div>
      </div>

      {/* ── Section 1: Visual Disk Platter Free Extents Scanner ── */}
      <div className="card" style={{ marginBottom: 20, padding: 18 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <div style={{ fontWeight: 700, fontSize: '0.96rem', display: 'flex', alignItems: 'center', gap: 8 }}>
            <span>🔍</span> Step 1: Disk Free Hole Scanner (Contiguous Extents)
          </div>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
            Scanned from Superblock Allocation Bitmap
          </span>
        </div>

        {/* Visual Platter Extents Strip */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
            background: theme === 'light' ? '#f1f5f9' : '#090d16',
            padding: 14,
            borderRadius: 8,
            border: theme === 'light' ? '1px solid #cbd5e1' : '1px solid #1e293b',
          }}
        >
          <div style={{ fontSize: '0.76rem', color: theme === 'light' ? '#475569' : '#94a3b8', marginBottom: 4 }}>
            Disk Layout Track (4,096 Physical Blocks):
          </div>

          <div
            style={{
              display: 'flex',
              height: 38,
              borderRadius: 6,
              overflow: 'hidden',
              background: theme === 'light' ? '#e2e8f0' : '#0f172a',
              border: theme === 'light' ? '1px solid #cbd5e1' : '1px solid #334155',
            }}
          >
            {/* Metadata (Blocks 0..3) */}
            <div
              style={{
                width: '3%',
                background: '#0ea5e9',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#fff',
                fontSize: '0.65rem',
                fontWeight: 700,
              }}
              title="Blocks #0..#3: Superblock & Allocation Bitmap"
            >
              Meta
            </div>

            {/* Extents Visualization */}
            {freeExtents.map((ext, idx) => {
              const isHole4 = ext.start === 4
              return (
                <div
                  key={idx}
                  style={{
                    flex: isHole4 ? 2 : 8,
                    background: isHole4 ? (theme === 'light' ? 'rgba(5, 150, 105, 0.2)' : 'rgba(16, 185, 129, 0.25)') : (theme === 'light' ? 'rgba(2, 132, 199, 0.15)' : 'rgba(56, 189, 248, 0.15)'),
                    borderLeft: `2px solid ${theme === 'light' ? '#059669' : '#10b981'}`,
                    borderRight: theme === 'light' ? '1px solid #cbd5e1' : '1px solid #334155',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: isHole4 ? (theme === 'light' ? '#065f46' : '#34d399') : (theme === 'light' ? '#0369a1' : '#38bdf8'),
                    fontSize: '0.72rem',
                    fontWeight: 700,
                    padding: '0 6px',
                  }}
                  title={`Hole #${idx + 1}: Sectors ${ext.start}..${ext.start + ext.length - 1} (${ext.length} blocks free)`}
                >
                  Hole #{idx + 1} ({ext.length} blk)
                </div>
              )
            })}
          </div>

          {/* List of Holes */}
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 6 }}>
            {freeExtents.map((ext, idx) => (
              <div
                key={idx}
                style={{
                  background: theme === 'light' ? '#ffffff' : '#131d31',
                  border: theme === 'light' ? '1px solid #cbd5e1' : '1px solid #233554',
                  boxShadow: theme === 'light' ? '0 1px 3px rgba(0,0,0,0.06)' : undefined,
                  borderRadius: 6,
                  padding: '6px 12px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  fontSize: '0.76rem',
                }}
              >
                <span
                  style={{
                    display: 'inline-block',
                    width: 8,
                    height: 8,
                    borderRadius: '50%',
                    background: ext.start === 4 ? '#10b981' : '#38bdf8',
                  }}
                />
                <span style={{ color: theme === 'light' ? '#0f172a' : '#cbd5e1' }}>
                  Hole #{idx + 1}: <strong>Sectors #{ext.start} .. #{ext.start + ext.length - 1}</strong>
                </span>
                <span
                  style={{
                    background: theme === 'light' ? 'rgba(5, 150, 105, 0.15)' : 'rgba(16, 185, 129, 0.2)',
                    color: theme === 'light' ? '#065f46' : '#34d399',
                    padding: '1px 6px',
                    borderRadius: 4,
                    fontWeight: 700,
                  }}
                >
                  {ext.length} blocks ({ext.length * 4} KB)
                </span>
                {ext.start === 4 && (
                  <span style={{ color: theme === 'light' ? '#b45309' : '#fbbf24', fontSize: '0.7rem' }}>★ Reclaimed from deleted files</span>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Visual Callout: OS Contiguous Allocation vs Hole-Filling Mode ── */}
      <div
        style={{
          marginBottom: 20,
          padding: '14px 18px',
          background: theme === 'light' ? 'rgba(2, 132, 199, 0.08)' : 'rgba(56, 189, 248, 0.08)',
          border: theme === 'light' ? '1px solid rgba(2, 132, 199, 0.3)' : '1px solid rgba(56, 189, 248, 0.3)',
          borderRadius: 8,
          display: 'flex',
          gap: 14,
          alignItems: 'flex-start',
        }}
      >
        <span style={{ fontSize: '1.4rem' }}>💡</span>
        <div style={{ flex: 1, fontSize: '0.82rem', lineHeight: 1.5 }}>
          <div style={{ fontWeight: 700, color: theme === 'light' ? '#0284c7' : '#38bdf8', marginBottom: 4, fontSize: '0.88rem' }}>
            Why was the 8-block Hole (#4..#11) NOT occupied by a 64-block file?
          </div>
          <div style={{ color: theme === 'light' ? '#334155' : '#cbd5e1' }}>
            In standard Operating System <strong>Contiguous Allocation</strong>, an incoming file must fit entirely within a single extent where <code style={{ color: theme === 'light' ? '#0284c7' : '#38bdf8' }}>Hole Length ≥ File Size</code>.
            Because Hole #1 only has <strong>8 blocks</strong>, a 64-block file cannot fit inside it without shattering the file into disjoint fragments.
            To avoid file fragmentation and preserve sequential disk I/O, Contiguous Best-Fit preserves Hole #1 for files of <code style={{ color: theme === 'light' ? '#059669' : '#10b981' }}>≤ 8 blocks (32 KB)</code>, and places the 64-block file contiguously in Hole #2.
          </div>
          <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ color: theme === 'light' ? '#b45309' : '#fbbf24', fontWeight: 600, fontSize: '0.78rem' }}>
              Want large files to fill small holes first?
            </span>
            <button
              type="button"
              className={`btn btn-sm ${fillHolesFirst ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setFillHolesFirst(!fillHolesFirst)}
              style={{ fontSize: '0.74rem', padding: '3px 10px' }}
            >
              {fillHolesFirst ? '✓ Hole-Filling Active (Scatter-Gather)' : 'Enable "Fill Small Holes First" Mode'}
            </button>
          </div>
        </div>
      </div>

      {/* ── Section 2: Large File Size & Auto-Content Generator ── */}
      <div className="card" style={{ marginBottom: 20, padding: 18 }}>
        <div style={{ fontWeight: 700, fontSize: '0.96rem', display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
          <span>⚙️</span> Step 2: Configure & Auto-Generate File (Multi-Block Workload)
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: 20 }}>
          {/* Left: Size presets & slider */}
          <div>
            <div style={{ fontSize: '0.78rem', color: theme === 'light' ? '#475569' : '#94a3b8', marginBottom: 8, fontWeight: 600 }}>
              Quick Presets (Select File Block Count):
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 14 }}>
              {[
                { label: '1 Block (4 KB)', blocks: 1, note: 'Tiny' },
                { label: '2 Blocks (8 KB)', blocks: 2, note: 'Small' },
                { label: '4 Blocks (16 KB)', blocks: 4, note: 'Medium' },
                { label: '8 Blocks (32 KB)', blocks: 8, note: '🎯 Exact Match Hole #1!' },
                { label: '16 Blocks (64 KB)', blocks: 16, note: 'Large' },
                { label: '32 Blocks (128 KB)', blocks: 32, note: 'Very Large' },
              ].map((p) => (
                <button
                  key={p.blocks}
                  type="button"
                  className={`btn ${requestedBlocks === p.blocks ? 'btn-primary' : 'btn-secondary'} btn-sm`}
                  onClick={() => {
                    setRequestedBlocks(p.blocks)
                    setFilename(`large_file_${p.blocks}blk_${Date.now().toString(36).slice(-4)}.bin`)
                  }}
                  style={{ fontSize: '0.75rem', padding: '5px 10px' }}
                >
                  {p.label}
                </button>
              ))}
            </div>

            <div style={{ marginBottom: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.78rem', color: theme === 'light' ? '#475569' : '#94a3b8', marginBottom: 4 }}>
                <span>Custom Block Count Slider:</span>
                <strong style={{ color: theme === 'light' ? '#0284c7' : '#38bdf8' }}>
                  {requestedBlocks} Blocks ({(requestedBlocks * 4).toLocaleString()} KB · {(requestedBlocks * 4096).toLocaleString()} bytes)
                </strong>
              </div>
              <input
                type="range"
                min="1"
                max="64"
                value={requestedBlocks}
                onChange={(e) => {
                  const b = parseInt(e.target.value, 10)
                  setRequestedBlocks(b)
                  setFilename(`large_file_${b}blk_${Date.now().toString(36).slice(-4)}.bin`)
                }}
                style={{ width: '100%', accentColor: '#38bdf8' }}
              />
            </div>
          </div>

          {/* Right: Filename and content generator options */}
          <div style={{ background: theme === 'light' ? '#f8fafc' : '#090d16', padding: 14, borderRadius: 8, border: theme === 'light' ? '1px solid #cbd5e1' : '1px solid #1e293b' }}>
            <div style={{ marginBottom: 10 }}>
              <label style={{ fontSize: '0.74rem', color: theme === 'light' ? '#475569' : '#94a3b8', display: 'block', marginBottom: 4 }}>
                Target Filename:
              </label>
              <input
                className="form-input"
                style={{ width: '100%', fontSize: '0.82rem', padding: '6px 10px' }}
                value={filename}
                onChange={(e) => setFilename(e.target.value)}
              />
            </div>

            <div style={{ marginBottom: 10 }}>
              <label style={{ fontSize: '0.74rem', color: theme === 'light' ? '#475569' : '#94a3b8', display: 'block', marginBottom: 6 }}>
                Content Entropy Mode:
              </label>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  type="button"
                  className={`btn btn-sm ${isUnique ? 'btn-primary' : 'btn-ghost'}`}
                  onClick={() => setIsUnique(true)}
                  style={{ fontSize: '0.73rem' }}
                >
                  ✨ Unique Entropy (Forces Full Physical Allocation)
                </button>
                <button
                  type="button"
                  className={`btn btn-sm ${!isUnique ? 'btn-primary' : 'btn-ghost'}`}
                  onClick={() => setIsUnique(false)}
                  style={{ fontSize: '0.73rem' }}
                >
                  🔗 Repeated Pattern (CAS Dedup)
                </button>
              </div>
            </div>

            <div style={{ fontSize: '0.7rem', color: '#64748b', lineHeight: 1.4 }}>
              {isUnique ? (
                <span>
                  ✓ Auto-generates cryptographically distinct SHA-256 blocks to guarantee all{' '}
                  <strong style={{ color: theme === 'light' ? '#0284c7' : '#38bdf8' }}>{requestedBlocks} sectors</strong> are physically claimed on the hard drive.
                </span>
              ) : (
                <span>
                  ✓ Auto-generates identical repeated blocks to test CoW deduplication against existing blocks.
                </span>
              )}
            </div>

            <div style={{ marginTop: 12, paddingTop: 10, borderTop: theme === 'light' ? '1px solid #e2e8f0' : '1px solid #1e293b' }}>
              <label style={{ fontSize: '0.74rem', color: theme === 'light' ? '#475569' : '#94a3b8', display: 'block', marginBottom: 6 }}>
                Allocation Strategy Mode:
              </label>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  type="button"
                  className={`btn btn-sm ${!fillHolesFirst ? 'btn-primary' : 'btn-ghost'}`}
                  onClick={() => setFillHolesFirst(false)}
                  style={{ fontSize: '0.73rem' }}
                >
                  🛡️ Contiguous Best-Fit
                </button>
                <button
                  type="button"
                  className={`btn btn-sm ${fillHolesFirst ? 'btn-primary' : 'btn-ghost'}`}
                  onClick={() => setFillHolesFirst(true)}
                  style={{ fontSize: '0.73rem' }}
                >
                  ⚡ Fill Small Holes First
                </button>
              </div>
              <div style={{ fontSize: '0.7rem', color: fillHolesFirst ? (theme === 'light' ? '#0284c7' : '#38bdf8') : (theme === 'light' ? '#475569' : '#94a3b8'), marginTop: 4 }}>
                {fillHolesFirst
                  ? '✓ Fills small holes (e.g. Sectors #4..#11) first, then spills remaining blocks into larger holes.'
                  : '✓ Strict contiguous placement: skips small holes that cannot fit the full file, preserving them for smaller files.'}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Section 3: Operating System Decision Matrix (Best-Fit vs First-Fit vs Worst-Fit) ── */}
      <div className="card" style={{ marginBottom: 20, padding: 18 }}>
        <div style={{ fontWeight: 700, fontSize: '0.96rem', display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
          <span>⚖️</span> Step 3: Operating System Allocation Strategy Comparison
        </div>

        {previewLoading ? (
          <div style={{ padding: 20, textAlign: 'center', color: '#94a3b8' }}>Evaluating disk holes…</div>
        ) : preview ? (
          <>
            {/* Strategy Comparison Cards */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14, marginBottom: 18 }}>
              {/* Best-Fit (Active) */}
              <div
                style={{
                  background: theme === 'light' ? 'rgba(5, 150, 105, 0.08)' : 'rgba(16, 185, 129, 0.1)',
                  border: `2px solid ${theme === 'light' ? '#059669' : '#10b981'}`,
                  borderRadius: 8,
                  padding: 14,
                  position: 'relative',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                  <strong style={{ color: theme === 'light' ? '#065f46' : '#34d399', fontSize: '0.88rem' }}>🧩 Best-Fit (Active)</strong>
                  <span
                    style={{
                      background: theme === 'light' ? '#059669' : '#10b981',
                      color: '#ffffff',
                      fontSize: '0.65rem',
                      fontWeight: 700,
                      padding: '1px 6px',
                      borderRadius: 4,
                    }}
                  >
                    CHOSEN
                  </span>
                </div>
                <div style={{ fontSize: '0.76rem', color: theme === 'light' ? '#1e293b' : '#cbd5e1', marginBottom: 4 }}>
                  Target Hole: <strong>#{preview.best_fit ? preview.best_fit.hole_index + 1 : '—'}</strong> (Sectors{' '}
                  {preview.best_fit ? `#${preview.best_fit.start}..#${preview.best_fit.start + preview.best_fit.length - 1}` : 'None'}
                  )
                </div>
                <div style={{ fontSize: '0.74rem', color: theme === 'light' ? '#059669' : '#34d399', fontWeight: 600 }}>
                  Leftover Space: {preview.best_fit?.leftover ?? 0} blocks
                </div>
                <div style={{ fontSize: '0.7rem', color: theme === 'light' ? '#475569' : '#94a3b8', marginTop: 4 }}>
                  {preview.best_fit?.leftover === 0 ? (
                    <span style={{ color: theme === 'light' ? '#b45309' : '#fbbf24', fontWeight: 600 }}>
                      🎯 EXACT FIT: Consumes hole completely with 0 wasted space!
                    </span>
                  ) : (
                    <span>Tightly fits into hole without splitting large free pools.</span>
                  )}
                </div>
              </div>

              {/* First-Fit */}
              <div
                style={{
                  background: theme === 'light' ? '#ffffff' : '#090d16',
                  border: theme === 'light' ? '1px solid #cbd5e1' : '1px solid #334155',
                  boxShadow: theme === 'light' ? '0 1px 3px rgba(0,0,0,0.06)' : undefined,
                  borderRadius: 8,
                  padding: 14,
                }}
              >
                <div style={{ fontWeight: 700, color: theme === 'light' ? '#475569' : '#94a3b8', fontSize: '0.88rem', marginBottom: 6 }}>
                  First-Fit
                </div>
                <div style={{ fontSize: '0.76rem', color: theme === 'light' ? '#1e293b' : '#cbd5e1', marginBottom: 4 }}>
                  Target Hole: <strong>#{preview.first_fit ? preview.first_fit.hole_index + 1 : '—'}</strong>
                </div>
                <div style={{ fontSize: '0.74rem', color: theme === 'light' ? '#64748b' : '#94a3b8' }}>
                  Leftover Space: {preview.first_fit?.leftover ?? 0} blocks
                </div>
                <div style={{ fontSize: '0.7rem', color: '#64748b', marginTop: 4 }}>
                  Takes first available hole $\ge K$.
                </div>
              </div>

              {/* Worst-Fit */}
              <div
                style={{
                  background: theme === 'light' ? '#ffffff' : '#090d16',
                  border: theme === 'light' ? '1px solid #cbd5e1' : '1px solid #334155',
                  boxShadow: theme === 'light' ? '0 1px 3px rgba(0,0,0,0.06)' : undefined,
                  borderRadius: 8,
                  padding: 14,
                }}
              >
                <div style={{ fontWeight: 700, color: '#dc2626', fontSize: '0.88rem', marginBottom: 6 }}>
                  Worst-Fit
                </div>
                <div style={{ fontSize: '0.76rem', color: theme === 'light' ? '#1e293b' : '#cbd5e1', marginBottom: 4 }}>
                  Target Hole: <strong>#{preview.worst_fit ? preview.worst_fit.hole_index + 1 : '—'}</strong>
                </div>
                <div style={{ fontSize: '0.74rem', color: '#dc2626' }}>
                  Leftover Space: {preview.worst_fit?.leftover ?? 0} blocks
                </div>
                <div style={{ fontSize: '0.7rem', color: '#64748b', marginTop: 4 }}>
                  Splits largest hole, destroying contiguous storage pools.
                </div>
              </div>
            </div>

            {/* Candidate Holes Evaluation Table */}
            <div style={{ overflowX: 'auto' }}>
              <table className="table" style={{ fontSize: '0.78rem', width: '100%' }}>
                <thead>
                  <tr>
                    <th>Hole ID</th>
                    <th>Sector Range</th>
                    <th>Hole Size</th>
                    <th>File Needed</th>
                    <th>Leftover Fragment</th>
                    <th>Fit Assessment</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.holes.map((h) => {
                    const isSelected = preview.best_fit?.hole_index === h.hole_index
                    return (
                      <tr
                        key={h.hole_index}
                        style={{
                          background: isSelected ? (theme === 'light' ? 'rgba(5, 150, 105, 0.08)' : 'rgba(16, 185, 129, 0.12)') : undefined,
                          fontWeight: isSelected ? 600 : undefined,
                        }}
                      >
                        <td style={{ color: isSelected ? (theme === 'light' ? '#059669' : '#34d399') : (theme === 'light' ? '#64748b' : '#94a3b8') }}>
                          Hole #{h.hole_index + 1}
                        </td>
                        <td className="mono" style={{ color: isSelected ? (theme === 'light' ? '#059669' : '#34d399') : (theme === 'light' ? '#0f172a' : '#cbd5e1') }}>
                          #{h.start} .. #{h.end}
                        </td>
                        <td>{h.length} blocks</td>
                        <td style={{ color: theme === 'light' ? '#0284c7' : '#38bdf8' }}>{requestedBlocks} blocks</td>
                        <td className="mono" style={{ color: h.leftover === 0 ? (theme === 'light' ? '#059669' : '#10b981') : h.leftover > 0 ? (theme === 'light' ? '#0284c7' : '#38bdf8') : '#dc2626' }}>
                          {h.leftover >= 0 ? `${h.leftover} blocks` : `${Math.abs(h.leftover)} short`}
                        </td>
                        <td>
                          {h.status === 'exact' ? (
                            <span className="badge badge-success" style={{ background: theme === 'light' ? '#059669' : '#059669', color: '#fff' }}>
                              🎯 Exact Match (Best-Fit)
                            </span>
                          ) : h.status === 'fit' ? (
                            <span className="badge badge-primary">
                              {isSelected ? '✓ Best-Fit Selected' : 'Available'}
                            </span>
                          ) : (
                            <span className="badge badge-error">Too small ({h.length} &lt; {requestedBlocks})</span>
                          )}
                          {h.reason && (
                            <div style={{ fontSize: '0.69rem', color: theme === 'light' ? '#64748b' : '#94a3b8', marginTop: 4, maxWidth: 320, lineHeight: 1.3 }}>
                              {h.reason}
                            </div>
                          )}
                        </td>
                        <td>
                          {isSelected ? (
                            <span style={{ color: theme === 'light' ? '#059669' : '#34d399', fontWeight: 700 }}>★ Chosen for Allocation</span>
                          ) : (
                            <span style={{ color: '#64748b' }}>Bypassed</span>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </>
        ) : null}
      </div>

      {/* ── Section 4: Execute Physical Allocation Button ── */}
      <div
        className="card"
        style={{
          marginBottom: 20,
          padding: 18,
          background: theme === 'light' ? 'linear-gradient(180deg, #f8fafc 0%, #f1f5f9 100%)' : 'linear-gradient(180deg, rgba(15, 23, 42, 0.9) 0%, rgba(9, 13, 22, 0.95) 100%)',
          border: theme === 'light' ? '1px solid #cbd5e1' : '1px solid #1e293b',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 14,
        }}
      >
        <div>
          <div style={{ fontWeight: 700, fontSize: '1rem', color: theme === 'light' ? '#0f172a' : '#f8fafc', marginBottom: 2 }}>
            Ready to Allocate & Write to Virtual Disk Platter
          </div>
          <div style={{ fontSize: '0.78rem', color: theme === 'light' ? '#475569' : '#94a3b8' }}>
            Will allocate <strong>{requestedBlocks} blocks</strong> ({(requestedBlocks * 4).toLocaleString()} KB)
            into Best-Fit Hole #{preview?.best_fit ? preview.best_fit.hole_index + 1 : 1}.
          </div>
        </div>

        <button
          className="btn btn-primary"
          style={{
            padding: '10px 22px',
            fontSize: '0.92rem',
            fontWeight: 700,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            boxShadow: '0 0 16px rgba(56, 189, 248, 0.35)',
          }}
          disabled={isAllocating || allocateMutation.isPending}
          onClick={() => allocateMutation.mutate()}
        >
          {isAllocating || allocateMutation.isPending ? (
            <>
              <span style={{ animation: 'spin 1s linear infinite', display: 'inline-block' }}>⟳</span>
              Allocating Sectors…
            </>
          ) : (
            <>
              <span>🚀</span> Allocate & Write Large File (Best-Fit)
            </>
          )}
        </button>
      </div>

      {/* ── Section 5: Allocation Results & Reclaim Cycle ── */}
      {lastAllocation && (
        <div
          className="card"
          style={{
            marginBottom: 20,
            padding: 18,
            border: `2px solid ${theme === 'light' ? '#059669' : '#10b981'}`,
            background: theme === 'light' ? 'rgba(5, 150, 105, 0.06)' : 'rgba(16, 185, 129, 0.08)',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <div style={{ fontWeight: 700, fontSize: '1.05rem', color: theme === 'light' ? '#065f46' : '#34d399', display: 'flex', alignItems: 'center', gap: 8 }}>
              <span>✅</span> Allocation Verified: '{lastAllocation.filename}' Successfully Written!
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                className="btn btn-secondary btn-sm"
                onClick={() => handleInspectInStorageMap(lastAllocation.block_ids)}
              >
                🔍 View on 3D Platter
              </button>
              <button
                className="btn btn-danger btn-sm"
                onClick={() => deleteMutation.mutate(lastAllocation.filename)}
                disabled={deleteMutation.isPending}
              >
                {deleteMutation.isPending ? 'Reclaiming…' : '🗑️ Delete & Reclaim Space'}
              </button>
            </div>
          </div>

          <div className="panel-grid cols-3" style={{ marginBottom: 12 }}>
            <div style={{ background: theme === 'light' ? '#ffffff' : '#090d16', padding: 12, borderRadius: 6, border: theme === 'light' ? '1px solid #cbd5e1' : '1px solid #1e293b' }}>
              <div style={{ fontSize: '0.72rem', color: theme === 'light' ? '#475569' : '#94a3b8' }}>Physical Sectors Occupied</div>
              <div className="mono" style={{ fontSize: '0.85rem', color: theme === 'light' ? '#0284c7' : '#38bdf8', fontWeight: 700, marginTop: 4 }}>
                [{lastAllocation.block_ids.join(', ')}]
              </div>
              <div style={{ fontSize: '0.7rem', color: '#64748b', marginTop: 2 }}>
                {lastAllocation.num_blocks} contiguous blocks assigned via Best-Fit
              </div>
            </div>

            <div style={{ background: theme === 'light' ? '#ffffff' : '#090d16', padding: 12, borderRadius: 6, border: theme === 'light' ? '1px solid #cbd5e1' : '1px solid #1e293b' }}>
              <div style={{ fontSize: '0.72rem', color: theme === 'light' ? '#475569' : '#94a3b8' }}>External Fragmentation Change</div>
              <div style={{ fontSize: '0.95rem', fontWeight: 700, marginTop: 4, color: theme === 'light' ? '#059669' : '#34d399' }}>
                {lastAllocation.pre_fragmentation_percent}% ➔ {lastAllocation.post_fragmentation_percent}%
              </div>
              <div style={{ fontSize: '0.7rem', color: theme === 'light' ? '#475569' : '#94a3b8', marginTop: 2 }}>
                {lastAllocation.post_fragmentation_percent <= lastAllocation.pre_fragmentation_percent
                  ? '✓ External fragmentation reduced or preserved'
                  : 'Minimal fragmentation impact'}
              </div>
            </div>

            <div style={{ background: theme === 'light' ? '#ffffff' : '#090d16', padding: 12, borderRadius: 6, border: theme === 'light' ? '1px solid #cbd5e1' : '1px solid #1e293b' }}>
              <div style={{ fontSize: '0.72rem', color: theme === 'light' ? '#475569' : '#94a3b8' }}>Merkle Tree Root</div>
              <div className="mono" style={{ fontSize: '0.72rem', color: theme === 'light' ? '#7c3aed' : '#a78bfa', marginTop: 4, wordBreak: 'break-all' }}>
                {lastAllocation.merkle_root.slice(0, 24)}…
              </div>
              <div style={{ fontSize: '0.7rem', color: '#64748b', marginTop: 2 }}>
                Cryptographically audited by StorageScrubber
              </div>
            </div>
          </div>

          <div style={{ fontSize: '0.76rem', color: theme === 'light' ? '#0369a1' : '#cbd5e1', background: theme === 'light' ? 'rgba(2, 132, 199, 0.08)' : 'rgba(0,0,0,0.3)', padding: '8px 12px', borderRadius: 6 }}>
            💡 <strong>Next Step to Observe Defragmentation Reclaim:</strong> Click the{' '}
            <strong style={{ color: '#ef4444' }}>"Delete & Reclaim Space"</strong> button above.
            The blocks will return to the free hole pool. Then select a new file size to watch Best-Fit re-occupy the freed hole!
          </div>
        </div>
      )}
    </div>
  )
}
