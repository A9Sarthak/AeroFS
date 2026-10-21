import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { listSnapshots, createSnapshot, restoreSnapshot, deleteSnapshot, getTelemetry } from '../../api/client'
import { useStore } from '../../state/store'
import type { SnapshotView } from '../../api/types'

export default function Snapshots() {
  const queryClient = useQueryClient()
  const showToast = useStore((s) => s.showToast)
  const addEvent = useStore((s) => s.addEvent)
  const setCurrentOperation = useStore((s) => s.setCurrentOperation)
  const selectedSnapshotName = useStore((s) => s.selectedSnapshotName)
  const setSelectedSnapshotName = useStore((s) => s.setSelectedSnapshotName)
  const setSelectedBlockId = useStore((s) => s.setSelectedBlockId)
  const setHighlightedBlockIds = useStore((s) => s.setHighlightedBlockIds)
  const setActiveView = useStore((s) => s.setActiveView)

  const [newSnapshotName, setNewSnapshotName] = useState('')
  const [confirmRestoreName, setConfirmRestoreName] = useState<string | null>(null)
  const [confirmDeleteName, setConfirmDeleteName] = useState<string | null>(null)

  // Fetch snapshots
  const { data: snapshotData, isLoading } = useQuery({
    queryKey: ['snapshots'],
    queryFn: () => listSnapshots(),
    refetchInterval: 8000,
  })

  // Fetch telemetry to get current files for comparison
  const { data: telemetry } = useQuery({
    queryKey: ['telemetry'],
    queryFn: () => getTelemetry(),
  })

  const snapshots: SnapshotView[] = snapshotData?.snapshots ?? []
  const currentFiles = telemetry?.files ?? []

  // Create Snapshot Mutation
  const createMutation = useMutation({
    mutationFn: (name: string) => createSnapshot(name),
    onMutate: () => setCurrentOperation('Creating snapshot…'),
    onSuccess: (_, name) => {
      queryClient.invalidateQueries({ queryKey: ['snapshots'] })
      queryClient.invalidateQueries({ queryKey: ['telemetry'] })
      setNewSnapshotName('')
      showToast('success', `Snapshot "${name}" captured successfully`)
      addEvent({
        operation: 'Snapshot Created',
        status: 'success',
        message: `Created point-in-time snapshot "${name}" preserving current filesystem state`,
      })
    },
    onError: (err: Error) => {
      showToast('error', `Snapshot failed: ${err.message}`)
      addEvent({
        operation: 'Snapshot Failed',
        status: 'failed',
        message: err.message,
      })
    },
    onSettled: () => setCurrentOperation(null),
  })

  // Restore Snapshot Mutation
  const restoreMutation = useMutation({
    mutationFn: (name: string) => restoreSnapshot(name),
    onMutate: () => setCurrentOperation('Restoring snapshot…'),
    onSuccess: (_, name) => {
      queryClient.invalidateQueries({ queryKey: ['snapshots'] })
      queryClient.invalidateQueries({ queryKey: ['telemetry'] })
      queryClient.invalidateQueries({ queryKey: ['files'] })
      setConfirmRestoreName(null)
      showToast('success', `Restored filesystem to snapshot "${name}"`)
      addEvent({
        operation: 'Snapshot Restored',
        status: 'success',
        message: `Restored active filesystem to point-in-time snapshot "${name}"`,
      })
    },
    onError: (err: Error) => {
      showToast('error', `Restore failed: ${err.message}`)
      addEvent({
        operation: 'Snapshot Restore Failed',
        status: 'failed',
        message: err.message,
      })
    },
    onSettled: () => setCurrentOperation(null),
  })

  // Delete Snapshot Mutation
  const deleteMutation = useMutation({
    mutationFn: (name: string) => deleteSnapshot(name),
    onMutate: () => setCurrentOperation('Deleting snapshot…'),
    onSuccess: (_, name) => {
      queryClient.invalidateQueries({ queryKey: ['snapshots'] })
      queryClient.invalidateQueries({ queryKey: ['telemetry'] })
      if (selectedSnapshotName === name) {
        setSelectedSnapshotName(null)
      }
      setConfirmDeleteName(null)
      showToast('success', `Deleted snapshot "${name}"`)
      addEvent({
        operation: 'Snapshot Deleted',
        status: 'warning',
        message: `Deleted snapshot "${name}" and released unreferenced metadata`,
      })
    },
    onError: (err: Error) => {
      showToast('error', `Delete failed: ${err.message}`)
    },
    onSettled: () => setCurrentOperation(null),
  })

  const selectedSnapshot = snapshots.find((s) => s.name === selectedSnapshotName) ?? snapshots[0]

  // Compare active files with selected snapshot
  const comparison = selectedSnapshot
    ? (() => {
        const snapFileNames = new Set(selectedSnapshot.files)
        const currentFileNames = new Set(currentFiles.map((f) => f.name))

        const unchanged: string[] = []
        const addedInCurrent: string[] = []
        const removedInCurrent: string[] = []

        selectedSnapshot.files.forEach((f) => {
          if (currentFileNames.has(f)) {
            unchanged.push(f)
          } else {
            removedInCurrent.push(f)
          }
        })

        currentFiles.forEach((f) => {
          if (!snapFileNames.has(f.name)) {
            addedInCurrent.push(f.name)
          }
        })

        return { unchanged, addedInCurrent, removedInCurrent }
      })()
    : null

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault()
    if (!newSnapshotName.trim()) return
    createMutation.mutate(newSnapshotName.trim())
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem', height: '100%' }}>
      {/* Top Header Card */}
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
            <span>📷</span> Snapshot Manager
          </h2>
          <p style={{ margin: '4px 0 0', fontSize: '0.8rem', color: '#94a3b8' }}>
            Zero-copy reference-based point-in-time snapshots with instant restore capabilities
          </p>
        </div>

        {/* Create form */}
        <form onSubmit={handleCreate} style={{ display: 'flex', gap: '0.5rem' }}>
          <input
            type="text"
            placeholder="Snapshot name (e.g. v1-pre-test)..."
            value={newSnapshotName}
            onChange={(e) => setNewSnapshotName(e.target.value)}
            style={{
              background: 'var(--bg-input)',
              border: '1px solid var(--border-dim)',
              color: 'var(--text-primary)',
              padding: '6px 12px',
              borderRadius: '6px',
              fontSize: '0.85rem',
              width: '260px'
            }}
          />
          <button
            type="submit"
            disabled={!newSnapshotName.trim() || createMutation.isPending}
            style={{
              background: '#38bdf8',
              color: '#0f172a',
              border: 'none',
              padding: '6px 16px',
              borderRadius: '6px',
              fontSize: '0.85rem',
              fontWeight: 600,
              cursor: newSnapshotName.trim() ? 'pointer' : 'not-allowed',
              opacity: newSnapshotName.trim() ? 1 : 0.6
            }}
          >
            {createMutation.isPending ? 'Creating…' : '＋ Capture Snapshot'}
          </button>
        </form>
      </div>

      {/* Main Grid: Snapshots List & Inspection/Comparison */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.25rem', flex: 1, minHeight: 0 }}>
        {/* Left: Snapshots List */}
        <div style={{
          background: 'var(--bg-card)',
          borderRadius: '8px',
          border: '1px solid var(--border-dim)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden'
        }}>
          <div style={{
            padding: '0.75rem 1rem',
            borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center'
          }}>
            <h3 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 600, color: '#f8fafc' }}>
              Existing Snapshots ({snapshots.length})
            </h3>
            <span style={{ fontSize: '0.75rem', color: '#64748b' }}>Click to inspect & compare</span>
          </div>

          <div style={{ flex: 1, overflowY: 'auto', padding: '0.75rem' }}>
            {isLoading ? (
              <div style={{ padding: '2rem', textAlign: 'center', color: '#64748b' }}>Loading snapshots…</div>
            ) : snapshots.length === 0 ? (
              <div style={{ padding: '3rem 1rem', textAlign: 'center', color: '#64748b' }}>
                <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>📷</div>
                <div>No snapshots captured yet.</div>
                <div style={{ fontSize: '0.75rem', color: '#475569', marginTop: '0.25rem' }}>
                  Create one using the form above to preserve your current filesystem state.
                </div>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                {snapshots.map((snap) => {
                  const isSelected = selectedSnapshot?.name === snap.name
                  return (
                    <div
                      key={snap.name}
                      onClick={() => setSelectedSnapshotName(snap.name)}
                      style={{
                        padding: '0.85rem',
                        borderRadius: '6px',
                        background: isSelected ? 'rgba(56, 189, 248, 0.12)' : 'rgba(30, 41, 59, 0.5)',
                        border: isSelected ? '1px solid #38bdf8' : '1px solid rgba(255, 255, 255, 0.05)',
                        cursor: 'pointer',
                        transition: 'all 0.15s ease'
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                        <div>
                          <div style={{ fontWeight: 600, color: '#f8fafc', fontSize: '0.9rem' }}>
                            📷 {snap.name}
                          </div>
                          <div style={{ fontSize: '0.75rem', color: '#94a3b8', marginTop: 2 }}>
                            {snap.created_at || 'Recorded in journal'}
                          </div>
                        </div>

                        <div style={{ display: 'flex', gap: '0.4rem' }}>
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              setConfirmRestoreName(snap.name)
                            }}
                            style={{
                              background: '#0284c7',
                              color: '#fff',
                              border: 'none',
                              padding: '3px 8px',
                              borderRadius: '4px',
                              fontSize: '0.75rem',
                              cursor: 'pointer'
                            }}
                            title="Restore filesystem to this point in time"
                          >
                            Restore
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              setConfirmDeleteName(snap.name)
                            }}
                            style={{
                              background: 'transparent',
                              color: '#ef4444',
                              border: '1px solid rgba(239, 68, 68, 0.3)',
                              padding: '3px 8px',
                              borderRadius: '4px',
                              fontSize: '0.75rem',
                              cursor: 'pointer'
                            }}
                            title="Delete this snapshot"
                          >
                            Delete
                          </button>
                        </div>
                      </div>

                      <div style={{ display: 'flex', gap: '1rem', marginTop: '0.6rem', fontSize: '0.75rem', color: '#cbd5e1' }}>
                        <span>📁 <strong>{snap.file_count ?? snap.files?.length ?? 0}</strong> files</span>
                        <span>💾 <strong>{snap.total_size ? (snap.total_size / 1024).toFixed(1) : '0'}</strong> KiB</span>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>

        {/* Right: Snapshot Details & Live Comparison */}
        <div style={{
          background: 'var(--bg-card)',
          borderRadius: '8px',
          border: '1px solid var(--border-dim)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden'
        }}>
          <div style={{
            padding: '0.75rem 1rem',
            borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center'
          }}>
            <h3 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 600, color: '#f8fafc' }}>
              {selectedSnapshot ? `Snapshot Details: ${selectedSnapshot.name}` : 'Snapshot Details'}
            </h3>
            {selectedSnapshot && (
              <span style={{ fontSize: '0.75rem', color: '#38bdf8' }}>Point-in-time diff</span>
            )}
          </div>

          <div style={{ flex: 1, overflowY: 'auto', padding: '1rem' }}>
            {!selectedSnapshot ? (
              <div style={{ textAlign: 'center', padding: '3rem 1rem', color: '#64748b' }}>
                Select a snapshot on the left to view details and compare against current live state.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                {/* Snapshot metadata card */}
                <div style={{
                  padding: '0.85rem',
                  background: 'rgba(30, 41, 59, 0.6)',
                  borderRadius: '6px',
                  border: '1px solid rgba(255, 255, 255, 0.05)',
                  fontSize: '0.85rem'
                }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: '0.4rem' }}>
                    <span style={{ color: '#94a3b8' }}>Created:</span>
                    <span style={{ color: '#f8fafc' }}>{selectedSnapshot.created_at || 'Just now'}</span>

                    <span style={{ color: '#94a3b8' }}>Preserved Files:</span>
                    <span style={{ color: '#38bdf8', fontWeight: 600 }}>{selectedSnapshot.files?.length ?? 0}</span>

                    <span style={{ color: '#94a3b8' }}>Extent Store:</span>
                    <span style={{ color: '#10b981' }}>Independent clean extents stored</span>
                  </div>
                </div>

                {/* Diff Comparison against Current Live Disk */}
                {comparison && (
                  <div>
                    <h4 style={{ margin: '0 0 0.5rem', fontSize: '0.85rem', fontWeight: 600, color: '#cbd5e1' }}>
                      Comparison with Current Live Filesystem:
                    </h4>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                      {/* Unchanged / Present in both */}
                      <div style={{
                        padding: '0.6rem 0.8rem',
                        background: 'rgba(16, 185, 129, 0.08)',
                        border: '1px solid rgba(16, 185, 129, 0.2)',
                        borderRadius: '6px'
                      }}>
                        <div style={{ fontSize: '0.75rem', fontWeight: 600, color: '#10b981' }}>
                          ✓ Unchanged / Shared ({comparison.unchanged.length})
                        </div>
                        <div style={{ fontSize: '0.8rem', color: '#cbd5e1', marginTop: 4 }}>
                          {comparison.unchanged.length > 0
                            ? comparison.unchanged.join(', ')
                            : 'No identical files'}
                        </div>
                      </div>

                      {/* Added in Current (Will be removed if restored) */}
                      {comparison.addedInCurrent.length > 0 && (
                        <div style={{
                          padding: '0.6rem 0.8rem',
                          background: 'rgba(56, 189, 248, 0.08)',
                          border: '1px solid rgba(56, 189, 248, 0.2)',
                          borderRadius: '6px'
                        }}>
                          <div style={{ fontSize: '0.75rem', fontWeight: 600, color: '#38bdf8' }}>
                            ＋ Created since snapshot ({comparison.addedInCurrent.length})
                          </div>
                          <div style={{ fontSize: '0.8rem', color: '#cbd5e1', marginTop: 4 }}>
                            {comparison.addedInCurrent.join(', ')}
                          </div>
                        </div>
                      )}

                      {/* Missing in Current (Will be recovered if restored) */}
                      {comparison.removedInCurrent.length > 0 && (
                        <div style={{
                          padding: '0.6rem 0.8rem',
                          background: 'rgba(239, 68, 68, 0.08)',
                          border: '1px solid rgba(239, 68, 68, 0.2)',
                          borderRadius: '6px'
                        }}>
                          <div style={{ fontSize: '0.75rem', fontWeight: 600, color: '#ef4444' }}>
                            ⚠ Deleted since snapshot ({comparison.removedInCurrent.length})
                          </div>
                          <div style={{ fontSize: '0.8rem', color: '#cbd5e1', marginTop: 4 }}>
                            {comparison.removedInCurrent.join(', ')}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* List of files in snapshot */}
                <div>
                  <h4 style={{ margin: '0 0 0.5rem', fontSize: '0.85rem', fontWeight: 600, color: '#cbd5e1' }}>
                    Files preserved in this snapshot:
                  </h4>
                  <div style={{
                    background: '#0a0f1d',
                    padding: '0.5rem',
                    borderRadius: '6px',
                    border: '1px solid rgba(255, 255, 255, 0.05)',
                    display: 'flex',
                    flexWrap: 'wrap',
                    gap: '0.4rem'
                  }}>
                    {selectedSnapshot.files && selectedSnapshot.files.length > 0 ? (
                      selectedSnapshot.files.map((file) => (
                        <span
                          key={file}
                          style={{
                            background: '#1e293b',
                            color: '#e2e8f0',
                            padding: '3px 8px',
                            borderRadius: '4px',
                            fontSize: '0.75rem',
                            border: '1px solid rgba(255, 255, 255, 0.06)'
                          }}
                        >
                          📄 {file}
                        </span>
                      ))
                    ) : (
                      <span style={{ fontSize: '0.75rem', color: '#64748b' }}>Empty snapshot</span>
                    )}
                  </div>
                </div>

                {/* ── WHERE ON THE DISK IS THIS SNAPSHOT SAVED? ── */}
                <div style={{
                  padding: '0.85rem',
                  background: 'rgba(15, 23, 42, 0.85)',
                  border: '1px solid rgba(245, 158, 11, 0.35)',
                  borderRadius: '8px',
                  boxShadow: '0 4px 20px rgba(245, 158, 11, 0.08)',
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem', flexWrap: 'wrap', gap: '0.5rem' }}>
                    <h4 style={{ margin: 0, fontSize: '0.85rem', fontWeight: 700, color: '#fbbf24', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                      <span>💽</span> Physical Disk Location & Storage Layout
                    </h4>
                    <button
                      onClick={() => {
                        if (selectedSnapshot.block_ids && selectedSnapshot.block_ids.length > 0) {
                          setHighlightedBlockIds(new Set(selectedSnapshot.block_ids))
                          setSelectedBlockId(selectedSnapshot.block_ids[0])
                          setActiveView('storage')
                          showToast('success', `Highlighted ${selectedSnapshot.block_ids.length} snapshot blocks on 3D Hard Drive`)
                        }
                      }}
                      disabled={!selectedSnapshot.block_ids || selectedSnapshot.block_ids.length === 0}
                      style={{
                        background: 'linear-gradient(135deg, #f59e0b, #d97706)',
                        color: '#0f172a',
                        border: 'none',
                        padding: '4px 10px',
                        borderRadius: '5px',
                        fontSize: '0.75rem',
                        fontWeight: 700,
                        cursor: selectedSnapshot.block_ids?.length ? 'pointer' : 'not-allowed',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '4px',
                        opacity: selectedSnapshot.block_ids?.length ? 1 : 0.5,
                      }}
                    >
                      <span>🧊</span> View on 3D Platter →
                    </button>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.6rem', fontSize: '0.75rem', marginBottom: '0.75rem' }}>
                    {/* Physical Blocks Location */}
                    <div style={{ background: 'rgba(30, 41, 59, 0.5)', padding: '0.6rem', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.05)' }}>
                      <div style={{ color: '#94a3b8', fontSize: '0.68rem', fontWeight: 600, textTransform: 'uppercase' }}>Physical Disk Container</div>
                      <div style={{ color: '#f8fafc', fontWeight: 600, fontFamily: 'monospace', marginTop: 2 }}>
                        aerofs_production_disk.bin
                      </div>
                      <div style={{ color: '#64748b', fontSize: '0.68rem', marginTop: 2 }}>
                        Block Size: 4,096 Bytes · Binary Sector Image
                      </div>
                    </div>

                    {/* Metadata & Inode Journal Location */}
                    <div style={{ background: 'rgba(30, 41, 59, 0.5)', padding: '0.6rem', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.05)' }}>
                      <div style={{ color: '#94a3b8', fontSize: '0.68rem', fontWeight: 600, textTransform: 'uppercase' }}>Metadata & Journal Location</div>
                      <div style={{ color: '#38bdf8', fontWeight: 600, fontFamily: 'monospace', marginTop: 2 }}>
                        Blocks 0–3 + .journal.json
                      </div>
                      <div style={{ color: '#64748b', fontSize: '0.68rem', marginTop: 2 }}>
                        Block 0: Superblock · Blocks 1-3: Bitmap
                      </div>
                    </div>
                  </div>

                  {/* Exact Physical Block IDs on Disk */}
                  <div>
                    <div style={{ fontSize: '0.72rem', color: '#cbd5e1', fontWeight: 600, marginBottom: '0.35rem' }}>
                      Physical Sectors Frozen on Platter:
                      <span style={{ color: '#f59e0b', marginLeft: 6, fontWeight: 700 }}>
                        {selectedSnapshot.block_ids?.length ?? 0} sectors allocated
                      </span>
                    </div>
                    <div style={{
                      display: 'flex',
                      flexWrap: 'wrap',
                      gap: '4px',
                      maxHeight: '110px',
                      overflowY: 'auto',
                      background: '#090d1a',
                      padding: '0.5rem',
                      borderRadius: '6px',
                      border: '1px solid rgba(255,255,255,0.04)',
                    }}>
                      {selectedSnapshot.block_ids && selectedSnapshot.block_ids.length > 0 ? (
                        selectedSnapshot.block_ids.map((bid) => (
                          <span
                            key={bid}
                            onClick={() => {
                              setSelectedBlockId(bid)
                              showToast('success', `Physical Block #${bid} (Byte Offset: ${(bid * 4096).toLocaleString()} B)`)
                            }}
                            title={`Click to inspect Physical Block #${bid} · Byte offset ${(bid * 4096).toLocaleString()} · Sector #${bid}`}
                            style={{
                              padding: '2px 7px',
                              borderRadius: '4px',
                              background: 'rgba(245, 158, 11, 0.15)',
                              border: '1px solid rgba(245, 158, 11, 0.4)',
                              color: '#fbbf24',
                              fontFamily: 'monospace',
                              fontSize: '0.68rem',
                              fontWeight: 700,
                              cursor: 'pointer',
                              transition: 'all 0.15s ease',
                            }}
                          >
                            #{bid} ({(bid * 4).toFixed(0)} KB)
                          </span>
                        ))
                      ) : (
                        <span style={{ fontSize: '0.7rem', color: '#64748b' }}>No physical blocks allocated</span>
                      )}
                    </div>
                    <div style={{ fontSize: '0.68rem', color: '#94a3b8', marginTop: '0.45rem', lineHeight: 1.4 }}>
                      💡 <strong>Copy-on-Write (CoW) Principle:</strong> The snapshot does not duplicate block data. It holds immutable pointers to these physical sectors on disk. When live files are edited, new blocks are allocated, leaving these original sectors permanently protected.
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Confirmation Modal for Restore */}
      {confirmRestoreName && (
        <div style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0, 0, 0, 0.75)',
          backdropFilter: 'blur(4px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 100
        }}>
          <div style={{
            background: 'var(--bg-surface)',
            border: '1px solid rgba(56, 189, 248, 0.4)',
            borderRadius: '10px',
            padding: '1.5rem',
            width: '420px',
            boxShadow: '0 20px 40px rgba(0,0,0,0.4)'
          }}>
            <h3 style={{ margin: '0 0 0.75rem', color: 'var(--text-primary)', fontSize: '1.1rem' }}>
              Confirm Filesystem Restore
            </h3>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
              Are you sure you want to restore the filesystem to snapshot <strong>"{confirmRestoreName}"</strong>?
            </p>
            <p style={{ fontSize: '0.75rem', color: '#f59e0b', background: 'rgba(245, 158, 11, 0.1)', padding: '0.5rem', borderRadius: '4px' }}>
              ⚠️ Any files created or modified after this snapshot was captured will be reverted to match the snapshot state.
            </p>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginTop: '1.25rem' }}>
              <button
                onClick={() => setConfirmRestoreName(null)}
                style={{
                  background: 'transparent',
                  color: 'var(--text-secondary)',
                  border: '1px solid var(--border-dim)',
                  padding: '6px 12px',
                  borderRadius: '6px',
                  cursor: 'pointer'
                }}
              >
                Cancel
              </button>
              <button
                onClick={() => restoreMutation.mutate(confirmRestoreName)}
                disabled={restoreMutation.isPending}
                style={{
                  background: '#0284c7',
                  color: '#fff',
                  border: 'none',
                  padding: '6px 16px',
                  borderRadius: '6px',
                  fontWeight: 600,
                  cursor: 'pointer'
                }}
              >
                {restoreMutation.isPending ? 'Restoring…' : 'Yes, Restore Now'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirmation Modal for Delete */}
      {confirmDeleteName && (
        <div style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0, 0, 0, 0.75)',
          backdropFilter: 'blur(4px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 100
        }}>
          <div style={{
            background: 'var(--bg-surface)',
            border: '1px solid rgba(239, 68, 68, 0.4)',
            borderRadius: '10px',
            padding: '1.5rem',
            width: '400px',
            boxShadow: '0 20px 40px rgba(0,0,0,0.4)'
          }}>
            <h3 style={{ margin: '0 0 0.75rem', color: '#ef4444', fontSize: '1.1rem' }}>
              Delete Snapshot
            </h3>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
              Are you sure you want to delete snapshot <strong>"{confirmDeleteName}"</strong>? This action cannot be undone.
            </p>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginTop: '1.25rem' }}>
              <button
                onClick={() => setConfirmDeleteName(null)}
                style={{
                  background: 'transparent',
                  color: '#94a3b8',
                  border: '1px solid #334155',
                  padding: '6px 12px',
                  borderRadius: '6px',
                  cursor: 'pointer'
                }}
              >
                Cancel
              </button>
              <button
                onClick={() => deleteMutation.mutate(confirmDeleteName)}
                disabled={deleteMutation.isPending}
                style={{
                  background: '#ef4444',
                  color: '#fff',
                  border: 'none',
                  padding: '6px 16px',
                  borderRadius: '6px',
                  fontWeight: 600,
                  cursor: 'pointer'
                }}
              >
                {deleteMutation.isPending ? 'Deleting…' : 'Delete Snapshot'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
