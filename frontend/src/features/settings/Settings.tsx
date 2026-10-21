import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getHealth, getTelemetry, formatFilesystem } from '../../api/client'
import { useStore } from '../../state/store'

export default function Settings() {
  const queryClient = useQueryClient()
  const showToast = useStore((s) => s.showToast)
  const addEvent = useStore((s) => s.addEvent)
  const setCurrentOperation = useStore((s) => s.setCurrentOperation)

  const [confirmFormat, setConfirmFormat] = useState(false)

  const { data: health } = useQuery({
    queryKey: ['health'],
    queryFn: () => getHealth(),
  })

  const { data: telemetry } = useQuery({
    queryKey: ['telemetry'],
    queryFn: () => getTelemetry(),
  })

  const formatMutation = useMutation({
    mutationFn: () => formatFilesystem(),
    onMutate: () => setCurrentOperation('Formatting filesystem…'),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['telemetry'] })
      queryClient.invalidateQueries({ queryKey: ['files'] })
      queryClient.invalidateQueries({ queryKey: ['snapshots'] })
      setConfirmFormat(false)
      showToast('warning', 'Filesystem formatted: Virtual disk re-initialized')
      addEvent({
        operation: 'Disk Formatted',
        status: 'warning',
        message: 'Re-initialized virtual block device bitmap, superblock, and root directories',
      })
    },
    onError: (err: Error) => {
      showToast('error', `Format failed: ${err.message}`)
    },
    onSettled: () => setCurrentOperation(null),
  })

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
        alignItems: 'center'
      }}>
        <div>
          <h2 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span>⚙️</span> Settings & Architecture Guide
          </h2>
          <p style={{ margin: '4px 0 0', fontSize: '0.8rem', color: '#94a3b8' }}>
            System specifications, virtual disk management, and core operating system architecture
          </p>
        </div>
      </div>

      {/* Grid: System Specs and Destructive Operations */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.25rem' }}>
        {/* System Specifications */}
        <div style={{
          background: 'var(--bg-card)',
          borderRadius: '8px',
          border: '1px solid var(--border-dim)',
          padding: '1.25rem'
        }}>
          <h3 style={{ margin: '0 0 1rem', fontSize: '1rem', fontWeight: 600, color: 'var(--text-primary)' }}>
            Virtual Disk Device Specification
          </h3>

          <div style={{ display: 'grid', gridTemplateColumns: '160px 1fr', gap: '0.6rem', fontSize: '0.85rem' }}>
            <span style={{ color: 'var(--text-muted)' }}>Backend Status:</span>
            <span style={{ color: 'var(--status-ok)', fontWeight: 600 }}>Connected (FastAPI + Python)</span>

            <span style={{ color: 'var(--text-muted)' }}>Virtual Disk Image:</span>
            <span style={{ color: 'var(--text-secondary)', fontFamily: 'monospace' }}>{health?.disk_path || 'disks/test_disk.bin'}</span>

            <span style={{ color: 'var(--text-muted)' }}>Total Block Count:</span>
            <span style={{ color: 'var(--text-primary)' }}>{health?.total_blocks ?? 4096} blocks</span>

            <span style={{ color: 'var(--text-muted)' }}>Physical Block Size:</span>
            <span style={{ color: 'var(--text-primary)' }}>{health?.block_size ?? 4096} bytes (4 KiB)</span>

            <span style={{ color: 'var(--text-muted)' }}>Total Disk Capacity:</span>
            <span style={{ color: 'var(--accent)', fontWeight: 600 }}>16.0 MiB</span>

            <span style={{ color: 'var(--text-muted)' }}>Reserved Superblocks:</span>
            <span style={{ color: 'var(--text-secondary)' }}>Blocks #0 - #3 (Superblock & Bitmap)</span>

            <span style={{ color: 'var(--text-muted)' }}>Hashing Algorithm:</span>
            <span style={{ color: 'var(--text-secondary)' }}>SHA-256 (Content-Addressable Chunks)</span>
          </div>
        </div>

        {/* Destructive Maintenance Card */}
        <div style={{
          background: 'var(--bg-card)',
          borderRadius: '8px',
          border: '1px solid rgba(239, 68, 68, 0.3)',
          padding: '1.25rem',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between'
        }}>
          <div>
            <h3 style={{ margin: '0 0 0.5rem', fontSize: '1rem', fontWeight: 600, color: 'var(--status-error)' }}>
              Format & Reset Filesystem
            </h3>
            <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
              Completely zeroes out all user inodes, snapshots, and data blocks on the simulation disk.
              Reserved superblocks and allocation bitmaps will be re-initialized to pristine empty state.
            </p>
          </div>

          <div style={{ marginTop: '1rem' }}>
            {!confirmFormat ? (
              <button
                onClick={() => setConfirmFormat(true)}
                style={{
                  background: 'rgba(239, 68, 68, 0.15)',
                  color: '#ef4444',
                  border: '1px solid rgba(239, 68, 68, 0.4)',
                  padding: '6px 16px',
                  borderRadius: '6px',
                  fontSize: '0.85rem',
                  fontWeight: 600,
                  cursor: 'pointer'
                }}
              >
                ⚠️ Re-Format Virtual Disk
              </button>
            ) : (
              <div style={{
                background: 'rgba(239, 68, 68, 0.1)',
                padding: '0.85rem',
                borderRadius: '6px',
                border: '1px solid rgba(239, 68, 68, 0.4)'
              }}>
                <div style={{ fontSize: '0.8rem', color: '#ef4444', fontWeight: 600, marginBottom: '0.5rem' }}>
                  Are you absolutely sure? All data on test_disk.bin will be erased.
                </div>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <button
                    onClick={() => setConfirmFormat(false)}
                    style={{
                      background: 'var(--bg-input)',
                      color: 'var(--text-secondary)',
                      border: '1px solid var(--border-dim)',
                      padding: '4px 10px',
                      borderRadius: '4px',
                      fontSize: '0.75rem',
                      cursor: 'pointer'
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => formatMutation.mutate()}
                    disabled={formatMutation.isPending}
                    style={{
                      background: '#ef4444',
                      color: '#fff',
                      border: 'none',
                      padding: '4px 14px',
                      borderRadius: '4px',
                      fontSize: '0.75rem',
                      fontWeight: 600,
                      cursor: 'pointer'
                    }}
                  >
                    {formatMutation.isPending ? 'Formatting…' : 'Yes, Erase & Format'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* OS Concepts Glossary / Explainer */}
      <div style={{
        background: 'var(--bg-card)',
        borderRadius: '8px',
        border: '1px solid var(--border-dim)',
        padding: '1.25rem'
      }}>
        <h3 style={{ margin: '0 0 1rem', fontSize: '1rem', fontWeight: 600, color: 'var(--text-primary)' }}>
          📖 AeroFS Core Architecture Concepts
        </h3>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '1rem' }}>
          <div style={{ background: 'var(--bg-panel)', border: '1px solid var(--border-dim)', padding: '0.85rem', borderRadius: '6px' }}>
            <div style={{ fontWeight: 600, color: 'var(--accent)', marginBottom: 4 }}>
              Copy-on-Write (CoW)
            </div>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: 1.4 }}>
              When a file or snapshot sharing blocks is edited, the original data is never overwritten in place. Instead, new blocks are allocated for the modified chunks, leaving historical snapshots intact.
            </div>
          </div>

          <div style={{ background: 'var(--bg-panel)', border: '1px solid var(--border-dim)', padding: '0.85rem', borderRadius: '6px' }}>
            <div style={{ fontWeight: 600, color: '#8b5cf6', marginBottom: 4 }}>
              Content-Addressable Deduplication (CAS)
            </div>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: 1.4 }}>
              Blocks are fingerprinted with SHA-256. If another file writes identical content, the filesystem increments the existing physical block's reference count rather than allocating redundant storage.
            </div>
          </div>

          <div style={{ background: 'var(--bg-panel)', border: '1px solid var(--border-dim)', padding: '0.85rem', borderRadius: '6px' }}>
            <div style={{ fontWeight: 600, color: '#10b981', marginBottom: 4 }}>
              Merkle Trees & Scrubbing
            </div>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: 1.4 }}>
              Every file is represented as a Merkle tree of block hashes with the root anchored in the inode. Background scrubs verify physical blocks against expected leaf hashes to detect silent bit rot.
            </div>
          </div>

          <div style={{ background: 'var(--bg-panel)', border: '1px solid var(--border-dim)', padding: '0.85rem', borderRadius: '6px' }}>
            <div style={{ fontWeight: 600, color: '#f59e0b', marginBottom: 4 }}>
              Verified Self-Healing
            </div>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: 1.4 }}>
              When bit rot is detected, AeroFS sources clean bytes from either historical snapshot extents or the recovery cache, verifies candidate bytes against the trusted hash, and repairs the corrupted block.
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
