import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { createTextFile } from '../../api/client'
import { useStore } from '../../state/store'

const DEMO_PAYLOADS = [
  { label: 'Small text (< 1 block)', content: 'Hello from AeroFS! This is a small text file.\n' },
  { label: 'Exact 1 block (4096 B)', content: 'A'.repeat(4096) },
  { label: 'Multi-block (3 blocks)', content: 'AeroFS Block Content\n'.repeat(200) },
  { label: 'Repeated content (high dedup)', content: 'DEDUP_BLOCK_CONTENT\n'.repeat(300) },
  { label: 'Unique content (low dedup)', content: Array.from({ length: 300 }, (_, i) => `Line ${i}: ${Math.random().toString(36)}`).join('\n') },
  { label: 'OS kernel-like text', content: 'Operating System Core Kernel Architecture & Filesystem Implementation.\n'.repeat(120) },
]

interface Props {
  onClose: () => void
  onSuccess: () => void
}

export default function CreateFileDialog({ onClose, onSuccess }: Props) {
  const [filename, setFilename] = useState('')
  const [content, setContent] = useState('')
  const addEvent = useStore((s) => s.addEvent)
  const showToast = useStore((s) => s.showToast)
  const setCurrentOperation = useStore((s) => s.setCurrentOperation)

  const createMut = useMutation({
    mutationFn: () => createTextFile(filename.trim(), content),
    onMutate: () => setCurrentOperation(`Creating ${filename}…`),
    onSuccess: (data) => {
      addEvent({
        operation: 'create_file',
        status: 'success',
        message: `Created '${data.filename}' — ${data.blocks_used} blocks, ${data.deduplicated_chunks} dedup hits`,
        fileName: data.filename,
        affectedBlockIds: data.block_ids,
        details: { inode_id: data.inode_id, merkle_root: data.merkle_root },
      })
      showToast('success', `Created '${data.filename}' — ${data.deduplicated_chunks} blocks deduped`)
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

  const isValid = filename.trim().length > 0 && content.length > 0

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ width: 560 }} onClick={(e) => e.stopPropagation()}>
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
          />
        </div>

        <div className="form-group">
          <label className="form-label">Demo Payload</label>
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

        {createMut.isSuccess && (
          <div className="alert alert-success" style={{ marginBottom: 12 }}>
            <span className="alert-icon">✅</span>
            <div>
              <div className="fw-600">File created!</div>
              <div>
                Inode: #{createMut.data.inode_id} · {createMut.data.blocks_used} blocks ·{' '}
                {createMut.data.deduplicated_chunks} deduped · Merkle root: <span className="mono">{createMut.data.merkle_root.slice(0,16)}…</span>
              </div>
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
          >
            {createMut.isPending ? '⟳ Creating…' : '📝 Create File'}
          </button>
        </div>
      </div>
    </div>
  )
}
