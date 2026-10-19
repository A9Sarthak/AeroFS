import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { duplicateFile } from '../../api/client'
import { useStore } from '../../state/store'
import type { FileView } from '../../api/types'

interface Props {
  source: FileView
  onClose: () => void
  onSuccess: () => void
}

export default function DuplicateDialog({ source, onClose, onSuccess }: Props) {
  const [destName, setDestName] = useState(`${source.name.replace(/\.[^.]+$/, '')}_copy.${source.name.split('.').pop()}`)
  const addEvent = useStore((s) => s.addEvent)
  const showToast = useStore((s) => s.showToast)
  const setCurrentOperation = useStore((s) => s.setCurrentOperation)
  const setHighlightedBlockIds = useStore((s) => s.setHighlightedBlockIds)

  const dupMut = useMutation({
    mutationFn: () => duplicateFile(source.name, destName.trim()),
    onMutate: () => setCurrentOperation(`Duplicating ${source.name}…`),
    onSuccess: (data) => {
      const sharedBlocks = data.block_ids.filter((b) => source.block_ids.includes(b))
      setHighlightedBlockIds(new Set(sharedBlocks))
      addEvent({
        operation: 'duplicate_file',
        status: 'success',
        message: `Duplicated '${source.name}' → '${data.destination}' · ${data.deduplicated_chunks}/${data.blocks_used} blocks deduped via CAS`,
        fileName: data.destination,
        affectedBlockIds: sharedBlocks,
        details: { dedup_hits: data.deduplicated_chunks, shared_blocks: sharedBlocks.length },
      })
      showToast('success', `Duplicated — ${data.deduplicated_chunks} blocks reused via CAS dedup`)
      setCurrentOperation(null)
      onSuccess()
    },
    onError: (e: Error) => {
      addEvent({ operation: 'duplicate_file', status: 'failed', message: e.message })
      showToast('error', e.message)
      setCurrentOperation(null)
    },
  })

  const isValid = destName.trim().length > 0 && destName !== source.name

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-title">📋 Duplicate File</div>
        <div className="modal-subtitle">
          Write identical content under a new filename. If content is the same, CAS deduplication
          will reuse existing physical blocks without extra disk allocation.
        </div>

        <div className="card" style={{ marginBottom: 16, padding: '12px 16px' }}>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: 6 }}>Source file</div>
          <div style={{ fontWeight: 600 }}>📄 {source.name}</div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 4 }}>
            {source.num_blocks} blocks · {(source.size / 1024).toFixed(1)} KiB
          </div>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', marginTop: 4 }}>
            Blocks: [{source.block_ids.slice(0, 6).join(', ')}{source.block_ids.length > 6 ? '…' : ''}]
          </div>
        </div>

        <div className="form-group">
          <label className="form-label" htmlFor="dup-dest">Destination Filename</label>
          <input
            id="dup-dest"
            className="form-input"
            value={destName}
            onChange={(e) => setDestName(e.target.value)}
            autoFocus
          />
        </div>

        <div className="alert alert-info" style={{ marginBottom: 12 }}>
          <span className="alert-icon">ℹ️</span>
          <div>
            <div className="fw-600">Prediction: Likely to deduplicate</div>
            <div>Since the content is identical, CAS will likely reuse all {source.num_blocks} existing physical blocks.
            Actual result depends on backend verification. Shared blocks will appear <span style={{ color: 'var(--status-purple)' }}>purple</span> in the map.</div>
          </div>
        </div>

        {dupMut.isSuccess && (
          <div className="alert alert-success" style={{ marginBottom: 12 }}>
            <span className="alert-icon">✅</span>
            <div>
              <div className="fw-600">Duplicated!</div>
              <div>
                {dupMut.data.deduplicated_chunks}/{dupMut.data.blocks_used} blocks reused via CAS deduplication.
                Shared block IDs: [{dupMut.data.block_ids.filter((b) => source.block_ids.includes(b)).slice(0, 5).join(', ')}…]
              </div>
            </div>
          </div>
        )}

        {dupMut.isError && (
          <div className="alert alert-error" style={{ marginBottom: 12 }}>
            <span className="alert-icon">❌</span>
            <span>{(dupMut.error as Error).message}</span>
          </div>
        )}

        <div className="modal-actions">
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button
            className="btn btn-purple"
            onClick={() => dupMut.mutate()}
            disabled={!isValid || dupMut.isPending}
          >
            {dupMut.isPending ? '⟳ Duplicating…' : '📋 Duplicate (CAS)'}
          </button>
        </div>
      </div>
    </div>
  )
}
