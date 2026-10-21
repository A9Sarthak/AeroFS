import { useState, useEffect } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { readFile, createTextFile } from '../../api/client'
import { useStore } from '../../state/store'
import type { FileView } from '../../api/types'

interface Props {
  file: FileView
  onClose: () => void
  onSaved: () => void
}

export default function FileEditor({ file, onClose, onSaved }: Props) {
  const showToast = useStore((s) => s.showToast)
  const addEvent = useStore((s) => s.addEvent)
  const setCurrentOperation = useStore((s) => s.setCurrentOperation)

  const [content, setContent] = useState('')
  const [initialLoading, setInitialLoading] = useState(true)

  // Fetch current file contents
  const { data: fileData, isError, error } = useQuery({
    queryKey: ['file_read', file.name],
    queryFn: () => readFile(file.name),
  })

  useEffect(() => {
    if (fileData) {
      setContent(fileData.content ?? '')
      setInitialLoading(false)
    }
  }, [fileData])

  const saveMutation = useMutation({
    mutationFn: (newContent: string) => createTextFile(file.name, newContent),
    onMutate: () => setCurrentOperation(`Saving ${file.name} (Copy-on-Write)…`),
    onSuccess: (data) => {
      showToast('success', `Saved "${file.name}" via Copy-on-Write`)
      addEvent({
        operation: 'File Saved (CoW)',
        status: 'success',
        fileName: file.name,
        affectedBlockIds: data.block_ids,
        message: `Saved '${file.name}'. Allocated blocks: [${data.block_ids.join(', ')}]. Dedup hits: ${data.deduplicated_chunks}`,
      })
      onSaved()
    },
    onError: (err: Error) => {
      showToast('error', `Save failed: ${err.message}`)
    },
    onSettled: () => setCurrentOperation(null),
  })

  const byteLength = new TextEncoder().encode(content).length
  const estimatedBlocks = Math.max(1, Math.ceil(byteLength / 4096))

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
        width: '650px',
        maxWidth: '92vw',
        boxShadow: '0 20px 50px rgba(0,0,0,0.4)',
        display: 'flex',
        flexDirection: 'column',
        gap: '1rem'
      }}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h3 style={{ margin: 0, color: 'var(--text-primary)', fontSize: '1.1rem', fontWeight: 700 }}>
              ✏️ Edit File: {file.name}
            </h3>
            <div style={{ fontSize: '0.75rem', color: '#94a3b8', marginTop: 2 }}>
              Copy-on-Write (CoW) semantics — modifying shared blocks preserves historical snapshots
            </div>
          </div>
          <button
            onClick={onClose}
            style={{ background: 'transparent', border: 'none', color: '#94a3b8', fontSize: '1.2rem', cursor: 'pointer' }}
          >
            ✕
          </button>
        </div>

        {initialLoading ? (
          <div style={{ padding: '3rem', textAlign: 'center', color: '#64748b' }}>Reading file from disk…</div>
        ) : isError ? (
          <div style={{ padding: '1rem', background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.3)', borderRadius: '6px', color: '#ef4444', fontSize: '0.85rem' }}>
            ⚠️ Failed to read file: {(error as any)?.message}. If this file suffered bit rot, it cannot be safely read until self-healed.
          </div>
        ) : (
          <>
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              rows={12}
              style={{
                width: '100%',
                background: 'var(--bg-input)',
                border: '1px solid var(--border-base)',
                borderRadius: '6px',
                padding: '0.75rem',
                color: 'var(--text-primary)',
                fontFamily: 'monospace',
                fontSize: '0.85rem',
                lineHeight: 1.5,
                resize: 'vertical'
              }}
            />

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
              <div>
                Payload: <strong>{byteLength}</strong> bytes (~{estimatedBlocks} blocks @ 4 KiB/block)
              </div>
              <div>
                Current mapped blocks: <code style={{ color: 'var(--accent)' }}>{file.block_ids?.join(', ') || 'None'}</code>
              </div>
            </div>

            {/* Footer Buttons */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginTop: '0.5rem' }}>
              <button
                onClick={onClose}
                className="btn btn-secondary"
                style={{
                  padding: '6px 14px',
                  borderRadius: '6px',
                  fontSize: '0.85rem',
                  cursor: 'pointer'
                }}
              >
                Cancel
              </button>
              <button
                onClick={() => saveMutation.mutate(content)}
                disabled={saveMutation.isPending}
                style={{
                  background: '#0284c7',
                  color: '#fff',
                  border: 'none',
                  padding: '6px 18px',
                  borderRadius: '6px',
                  fontSize: '0.85rem',
                  fontWeight: 600,
                  cursor: 'pointer'
                }}
              >
                {saveMutation.isPending ? 'Saving (CoW)…' : '💾 Save Changes (CoW)'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
