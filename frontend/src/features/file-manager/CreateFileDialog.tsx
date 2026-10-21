import { useState, useEffect, useRef } from 'react'
import { useMutation } from '@tanstack/react-query'
import { createTextFile, checkFileConflict } from '../../api/client'
import { useStore } from '../../state/store'

const DEMO_PAYLOADS = [
  { label: 'Small text (< 1 block)', content: 'Hello from AeroFS! This is a small text file.\n' },
  { label: 'Exact 1 block (4096 B)', content: 'A'.repeat(4096) },
  { label: 'Multi-block (3 blocks)', content: 'AeroFS Block Content\n'.repeat(200) },
  { label: 'Repeated content (high dedup)', content: 'DEDUP_BLOCK_CONTENT\n'.repeat(300) },
  { label: 'Unique content (low dedup)', content: Array.from({ length: 300 }, (_, i) => `Line ${i}: ${Math.random().toString(36)}`).join('\n') },
  { label: 'OS kernel-like text', content: 'Operating System Core Kernel Architecture & Filesystem Implementation.\n'.repeat(120) },
]

/** SHA-256 of a string using SubtleCrypto */
async function sha256Hex(text: string): Promise<string> {
  const enc = new TextEncoder()
  const buf = await crypto.subtle.digest('SHA-256', enc.encode(text))
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('')
}

interface ConflictState {
  exists: boolean
  is_duplicate: boolean
  conflict: boolean
}

interface Props {
  onClose: () => void
  onSuccess: () => void
}

export default function CreateFileDialog({ onClose, onSuccess }: Props) {
  const [filename, setFilename] = useState('')
  const [content, setContent] = useState('')
  const [conflict, setConflict] = useState<ConflictState | null>(null)
  const [checking, setChecking] = useState(false)
  const checkTimeout = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [fillHolesFirst, setFillHolesFirst] = useState(false)

  const theme = useStore((s) => s.theme)
  const addEvent = useStore((s) => s.addEvent)
  const showToast = useStore((s) => s.showToast)
  const setCurrentOperation = useStore((s) => s.setCurrentOperation)

  // ── debounced conflict check ────────────────────────────────────────────────
  useEffect(() => {
    if (!filename.trim() || !content) {
      setConflict(null)
      return
    }
    if (checkTimeout.current) clearTimeout(checkTimeout.current)
    checkTimeout.current = setTimeout(async () => {
      setChecking(true)
      try {
        const hash = await sha256Hex(content)
        const result = await checkFileConflict(filename.trim(), hash)
        setConflict(result)
      } catch {
        setConflict(null)
      } finally {
        setChecking(false)
      }
    }, 400)
    return () => { if (checkTimeout.current) clearTimeout(checkTimeout.current) }
  }, [filename, content])

  const createMut = useMutation({
    mutationFn: () => createTextFile(filename.trim(), content, fillHolesFirst),
    onMutate: () => setCurrentOperation(`Creating ${filename}…`),
    onSuccess: (data) => {
      const isDupLabel = conflict?.is_duplicate ? ' [DUPLICATE — same blocks reused via CAS]' : ''
      addEvent({
        operation: 'create_file',
        status: 'success',
        message: `Created '${data.filename}' — ${data.blocks_used} blocks allocated at Sector(s) [${data.block_ids.join(', ')}], ${data.deduplicated_chunks} dedup hits${isDupLabel} via Best-Fit`,
        fileName: data.filename,
        affectedBlockIds: data.block_ids,
        details: { inode_id: data.inode_id, merkle_root: data.merkle_root },
      })
      showToast('success', `Created '${data.filename}' (Sector(s): [${data.block_ids.join(', ')}])`)
      setCurrentOperation(null)
      onSuccess()
    },
    onError: (e: Error) => {
      addEvent({ operation: 'create_file', status: 'failed', message: e.message })
      showToast('error', e.message)
      setCurrentOperation(null)
    },
  })

  const byteLen = new TextEncoder().encode(content).length
  const estimatedBlocks = Math.max(1, Math.ceil(byteLen / 4096))

  // Blocked if name exists with different content
  const isBlocked = conflict?.conflict === true
  const isDuplicate = conflict?.is_duplicate === true
  const isValid = filename.trim().length > 0 && content.length > 0 && !isBlocked

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ width: 580 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-title">📝 Create New File</div>
        <div className="modal-subtitle">
          Write a file to AeroFS using Copy-on-Write and CAS deduplication.
        </div>

        <div className="form-group">
          <label className="form-label" htmlFor="create-filename">Filename</label>
          <input
            id="create-filename"
            className="form-input"
            placeholder="e.g. kernel.c, report.txt"
            value={filename}
            onChange={(e) => setFilename(e.target.value)}
            autoFocus
            style={{
              borderColor: isBlocked ? '#ef4444' : isDuplicate ? '#8b5cf6' : undefined,
              boxShadow: isBlocked
                ? '0 0 0 2px rgba(239,68,68,0.25)'
                : isDuplicate
                ? '0 0 0 2px rgba(139,92,246,0.25)'
                : undefined,
            }}
          />
        </div>

        {/* ── Conflict / Duplicate Banner ── */}
        {checking && (
          <div style={{
            marginBottom: 12,
            padding: '8px 12px',
            background: 'rgba(56,189,248,0.08)',
            border: '1px solid rgba(56,189,248,0.2)',
            borderRadius: 6,
            fontSize: '0.82rem',
            color: '#7dd3fc',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}>
            <span style={{ animation: 'spin 1s linear infinite', display: 'inline-block' }}>⟳</span>
            Checking for conflicts…
          </div>
        )}

        {!checking && isBlocked && (
          <div style={{
            marginBottom: 12,
            padding: '10px 14px',
            background: 'rgba(239,68,68,0.10)',
            border: '1px solid rgba(239,68,68,0.4)',
            borderRadius: 6,
            fontSize: '0.84rem',
            color: '#fca5a5',
          }}>
            <div style={{ fontWeight: 700, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
              <span>⛔</span> Filename Conflict — Rename Required
            </div>
            <div style={{ lineHeight: 1.5 }}>
              A file named <code style={{ background: 'rgba(0,0,0,0.3)', padding: '1px 5px', borderRadius: 3 }}>{filename}</code> already
              exists with <strong>different content</strong>. To protect existing data, you must use a different filename.
              The existing file will <em>not</em> be overwritten.
            </div>
            <div style={{ marginTop: 8, fontSize: '0.78rem', color: '#ef4444' }}>
              💡 Tip: Use a versioned name like <code style={{ background: 'rgba(0,0,0,0.3)', padding: '1px 5px', borderRadius: 3 }}>{filename.replace(/(\.\w+)?$/, '_v2$1')}</code>
            </div>
          </div>
        )}

        {!checking && isDuplicate && (
          <div style={{
            marginBottom: 12,
            padding: '10px 14px',
            background: 'rgba(139,92,246,0.10)',
            border: '1px solid rgba(139,92,246,0.4)',
            borderRadius: 6,
            fontSize: '0.84rem',
            color: '#c4b5fd',
          }}>
            <div style={{ fontWeight: 700, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
              <span>🔗</span> Duplicate Detected — CAS Block Sharing
            </div>
            <div style={{ lineHeight: 1.5 }}>
              Identical content already exists as <code style={{ background: 'rgba(0,0,0,0.3)', padding: '1px 5px', borderRadius: 3 }}>{filename}</code>.
              AeroFS will <strong>reuse the same physical disk blocks</strong> via Content-Addressable Storage — no extra disk space will be consumed.
              You can proceed; both files will point to the same blocks in the 3D Storage Map.
            </div>
            <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.78rem', color: '#8b5cf6' }}>
              <span style={{
                display: 'inline-block',
                width: 10,
                height: 10,
                background: '#8b5cf6',
                borderRadius: 2,
              }} />
              Purple blocks in 3D view = Shared/Deduplicated blocks
            </div>
          </div>
        )}

        {/* Large File & Best-Fit Multi-Block Generator */}
        <div
          style={{
            marginBottom: 14,
            padding: '10px 12px',
            background: theme === 'light' ? 'rgba(2, 132, 199, 0.08)' : 'rgba(56, 189, 248, 0.08)',
            border: theme === 'light' ? '1px solid rgba(2, 132, 199, 0.3)' : '1px solid rgba(56, 189, 248, 0.3)',
            borderRadius: 8,
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
            <span style={{ fontSize: '0.82rem', fontWeight: 700, color: theme === 'light' ? '#0369a1' : '#38bdf8', display: 'flex', alignItems: 'center', gap: 6 }}>
              <span>⚡</span> Auto-Generate Large File (Best-Fit Allocation)
            </span>
            <span style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>
              Distinct 4KB physical blocks
            </span>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {[
              { label: '2 Blocks (8 KB)', blocks: 2 },
              { label: '4 Blocks (16 KB)', blocks: 4 },
              { label: '8 Blocks (32 KB · Exact Hole)', blocks: 8 },
              { label: '16 Blocks (64 KB)', blocks: 16 },
              { label: '32 Blocks (128 KB)', blocks: 32 },
              { label: '64 Blocks (256 KB Large)', blocks: 64 },
            ].map((preset) => (
              <button
                key={preset.label}
                type="button"
                className="btn btn-secondary btn-sm"
                style={{
                  fontSize: '0.74rem',
                  padding: '4px 8px',
                  background: 'var(--bg-card)',
                  border: '1px solid var(--border-base)',
                  color: 'var(--text-primary)',
                }}
                onClick={() => {
                  const fname = filename.trim() || `large_file_${preset.blocks}blk_${Date.now().toString(36).slice(-4)}.bin`
                  setFilename(fname)
                  let generated = ''
                  for (let i = 0; i < preset.blocks; i++) {
                    const header = `[AeroFS Sector Chunk #${i + 1}/${preset.blocks} | Entropy: ${Math.random().toString(36).slice(2)}]\n`
                    const padding = `Data block ${i}: Best-Fit fragmentation management and storage verification.\n`.repeat(40)
                    const chunk = (header + padding).slice(0, 4096)
                    generated += chunk.padEnd(4096, ' ')
                  }
                  setContent(generated)
                }}
              >
                + {preset.label}
              </button>
            ))}
          </div>
        </div>

        <div className="form-group">
          <label className="form-label">Demo Payload Presets</label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
            {DEMO_PAYLOADS.map((p) => (
              <button
                key={p.label}
                className="btn btn-ghost btn-sm"
                onClick={() => setContent(p.content)}
                type="button"
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        <div className="form-group">
          <label className="form-label" htmlFor="create-content">
            Content
            <span style={{ float: 'right', color: 'var(--text-muted)', fontWeight: 400 }}>
              {byteLen.toLocaleString()} bytes · ~{estimatedBlocks} block{estimatedBlocks !== 1 ? 's' : ''}
            </span>
          </label>
          <textarea
            id="create-content"
            className="form-textarea"
            style={{ minHeight: 140 }}
            placeholder="Enter file content…"
            value={content}
            onChange={(e) => setContent(e.target.value)}
          />
        </div>

        {/* ── Allocation Strategy Option & Contiguous Explanation ── */}
        <div style={{
          marginBottom: 14,
          padding: '10px 14px',
          background: theme === 'light' ? 'rgba(241, 245, 249, 0.85)' : 'rgba(30, 41, 59, 0.5)',
          border: '1px solid var(--border-base)',
          borderRadius: 6,
          fontSize: '0.8rem',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontWeight: 600, color: 'var(--text-primary)' }}>
              <input
                type="checkbox"
                checked={fillHolesFirst}
                onChange={(e) => setFillHolesFirst(e.target.checked)}
                style={{ accentColor: theme === 'light' ? '#0284c7' : '#38bdf8' }}
              />
              <span>Fill small free holes first (Scatter-Gather)</span>
            </label>
            <span style={{ fontSize: '0.72rem', color: fillHolesFirst ? (theme === 'light' ? '#0284c7' : '#38bdf8') : 'var(--text-secondary)' }}>
              {fillHolesFirst ? 'Splits file across small holes' : 'Default: Contiguous Best-Fit'}
            </span>
          </div>
          <div style={{ marginTop: 6, fontSize: '0.74rem', color: 'var(--text-secondary)', lineHeight: 1.45 }}>
            {fillHolesFirst ? (
              <span style={{ color: theme === 'light' ? '#0284c7' : '#38bdf8', fontWeight: 500 }}>
                ✓ Small reclaimed holes (like Sectors #4..#11) will be filled first. If the file is larger than the hole, the remainder spills into the next extent.
              </span>
            ) : (
              <span>
                💡 <strong>Why small holes get bypassed by large files:</strong> Contiguous Best-Fit requires an extent of size ≥ {estimatedBlocks} blocks to keep the file contiguous. Holes smaller than this file (e.g. 8-block holes) are preserved for files of ≤ 8 blocks.
              </span>
            )}
          </div>
        </div>

        {createMut.isSuccess && (
          <div className="alert alert-success" style={{ marginBottom: 12 }}>
            <span className="alert-icon">✅</span>
            <div>
              <div className="fw-600">
                {conflict?.is_duplicate ? 'Duplicate file created! Blocks shared via CAS.' : 'File created!'}
              </div>
              <div>
                Inode: #{createMut.data.inode_id} · {createMut.data.blocks_used} blocks ·{' '}
                {createMut.data.deduplicated_chunks} deduped · Merkle root: <span className="mono">{createMut.data.merkle_root.slice(0, 16)}…</span>
              </div>
              {conflict?.is_duplicate && (
                <div style={{ marginTop: 4, fontSize: '0.78rem', color: '#8b5cf6' }}>
                  🔗 View shared blocks in the 3D Storage Map — they appear as purple "Shared/Deduped" blocks.
                </div>
              )}
            </div>
          </div>
        )}

        {createMut.isError && (
          <div className="alert alert-error" style={{ marginBottom: 12 }}>
            <span className="alert-icon">❌</span>
            <span>{(createMut.error as Error).message}</span>
          </div>
        )}

        <div className="modal-actions">
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button
            className="btn btn-primary"
            onClick={() => createMut.mutate()}
            disabled={!isValid || createMut.isPending}
            style={isDuplicate ? { background: 'linear-gradient(135deg, #7c3aed, #8b5cf6)' } : undefined}
          >
            {createMut.isPending
              ? '⟳ Creating…'
              : isBlocked
              ? '⛔ Rename Required'
              : isDuplicate
              ? '🔗 Create Duplicate (CAS Reuse)'
              : '📝 Create File'}
          </button>
        </div>
      </div>
    </div>
  )
}
