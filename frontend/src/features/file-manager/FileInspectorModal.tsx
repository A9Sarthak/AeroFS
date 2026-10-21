import { useQuery } from '@tanstack/react-query'
import { inspectFile } from '../../api/client'
import type { FileView } from '../../api/types'

interface Props {
  file: FileView
  onClose: () => void
  onShowInMap: () => void
}

export default function FileInspectorModal({ file, onClose, onShowInMap }: Props) {
  const { data: details, isLoading, isError, error } = useQuery({
    queryKey: ['inspect_file', file.name],
    queryFn: () => inspectFile(file.name),
  })

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      background: 'rgba(0, 0, 0, 0.75)',
      backdropFilter: 'blur(5px)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 100
    }}>
      <div style={{
        background: 'var(--bg-surface)',
        border: '1px solid var(--border-dim)',
        borderRadius: '10px',
        padding: '1.5rem',
        width: '680px',
        maxWidth: '92vw',
        maxHeight: '85vh',
        boxShadow: '0 20px 50px rgba(0,0,0,0.4)',
        display: 'flex',
        flexDirection: 'column',
        gap: '1rem',
        overflowY: 'auto'
      }}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h3 style={{ margin: 0, color: 'var(--text-primary)', fontSize: '1.15rem', fontWeight: 700 }}>
              🔍 Inode & Merkle Inspector: {file.name}
            </h3>
            <div style={{ fontSize: '0.75rem', color: '#94a3b8', marginTop: 2 }}>
              Authoritative on-disk inode record and cryptographic tree hierarchy
            </div>
          </div>
          <button
            onClick={onClose}
            style={{ background: 'transparent', border: 'none', color: '#94a3b8', fontSize: '1.2rem', cursor: 'pointer' }}
          >
            ✕
          </button>
        </div>

        {isLoading ? (
          <div style={{ padding: '3rem', textAlign: 'center', color: '#64748b' }}>Inspecting inode…</div>
        ) : isError ? (
          <div style={{ padding: '1rem', background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.3)', borderRadius: '6px', color: '#ef4444', fontSize: '0.85rem' }}>
            Failed to inspect file: {(error as any)?.message}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {/* Metadata attributes */}
            <div style={{
              background: 'var(--bg-panel)',
              padding: '1rem',
              borderRadius: '6px',
              border: '1px solid var(--border-dim)',
              display: 'grid',
              gridTemplateColumns: '140px 1fr',
              gap: '0.5rem',
              fontSize: '0.85rem'
            }}>
              <span style={{ color: 'var(--text-secondary)' }}>Filename:</span>
              <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{file.name}</span>

              <span style={{ color: 'var(--text-secondary)' }}>Inode ID:</span>
              <span style={{ color: 'var(--text-primary)' }}>{details?.inode.inode_id ?? file.inode_id ?? 'N/A'}</span>

              <span style={{ color: 'var(--text-secondary)' }}>Logical Size:</span>
              <span style={{ color: 'var(--text-primary)' }}>{file.size} bytes</span>

              <span style={{ color: 'var(--text-secondary)' }}>Physical Blocks:</span>
              <span style={{ color: 'var(--accent)', fontFamily: 'monospace' }}>
                {file.block_ids?.join(', ') || 'None'} ({file.num_blocks} blocks)
              </span>

              <span style={{ color: 'var(--text-secondary)' }}>Integrity Status:</span>
              <span>
                {details?.is_healthy ? (
                  <span style={{ color: '#10b981', fontWeight: 600 }}>✓ Healthy</span>
                ) : (
                  <span style={{ color: '#ef4444', fontWeight: 600 }}>
                    ⚠️ Corrupted (Blocks: {details?.corrupted_blocks?.join(', ')})
                  </span>
                )}
              </span>

              <span style={{ color: 'var(--text-secondary)' }}>Merkle Root:</span>
              <span style={{ color: '#10b981', fontFamily: 'monospace', fontSize: '0.75rem', wordBreak: 'break-all' }}>
                {file.merkle_root || 'N/A'}
              </span>
            </div>

            {/* ASCII Merkle Tree visualization if provided */}
            {details?.ascii_tree && (
              <div>
                <div style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 4 }}>
                  Merkle Tree Graph:
                </div>
                <pre style={{
                  background: 'var(--bg-input)',
                  border: '1px solid var(--border-base)',
                  padding: '0.75rem',
                  borderRadius: '6px',
                  color: 'var(--text-mono)',
                  fontSize: '0.75rem',
                  overflowX: 'auto',
                  margin: 0
                }}>
                  {details.ascii_tree}
                </pre>
              </div>
            )}

            {/* Preview of file content */}
            {details?.preview && (
              <div>
                <div style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 4 }}>
                  Content Preview:
                </div>
                <pre style={{
                  background: 'var(--bg-input)',
                  border: '1px solid var(--border-base)',
                  padding: '0.75rem',
                  borderRadius: '6px',
                  color: 'var(--text-primary)',
                  fontSize: '0.75rem',
                  overflowX: 'auto',
                  maxHeight: '120px',
                  margin: 0
                }}>
                  {details.preview}
                </pre>
              </div>
            )}

            {/* Actions */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '0.5rem' }}>
              <button
                onClick={onShowInMap}
                style={{
                  background: '#8b5cf6',
                  color: '#fff',
                  border: 'none',
                  padding: '6px 14px',
                  borderRadius: '6px',
                  fontSize: '0.85rem',
                  fontWeight: 600,
                  cursor: 'pointer'
                }}
              >
                🧊 Show Blocks in 3D Map
              </button>

              <button
                onClick={onClose}
                className="btn btn-secondary"
                style={{
                  padding: '6px 16px',
                  borderRadius: '6px',
                  fontSize: '0.85rem',
                  cursor: 'pointer'
                }}
              >
                Close
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
