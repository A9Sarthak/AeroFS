import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getTelemetry, createTextFile, readFile, deleteFile, duplicateFile, inspectFile } from '../../api/client'
import { useStore } from '../../state/store'
import type { FileView } from '../../api/types'
import CreateFileDialog from './CreateFileDialog'
import DuplicateDialog from './DuplicateDialog'
import FileEditor from './FileEditor'
import FileInspectorModal from './FileInspectorModal'

type ViewMode = 'list' | 'grid'

export default function FileManager() {
  const { data: telemetry, isLoading, isError } = useQuery({
    queryKey: ['telemetry'],
    queryFn: getTelemetry,
    refetchInterval: 8000,
  })

  const queryClient = useQueryClient()
  const addEvent = useStore((s) => s.addEvent)
  const showToast = useStore((s) => s.showToast)
  const setCurrentOperation = useStore((s) => s.setCurrentOperation)
  const setInspectorFile = useStore((s) => s.setInspectorFile)
  const setSelectedFileName = useStore((s) => s.setSelectedFileName)
  const setHighlightedBlockIds = useStore((s) => s.setHighlightedBlockIds)
  const setActiveView = useStore((s) => s.setActiveView)

  const [viewMode, setViewMode] = useState<ViewMode>('list')
  const [searchQuery, setSearchQuery] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [duplicateSource, setDuplicateSource] = useState<FileView | null>(null)
  const [editingFile, setEditingFile] = useState<FileView | null>(null)
  const [inspectingFile, setInspectingFile] = useState<FileView | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)

  const deleteMut = useMutation({
    mutationFn: (name: string) => deleteFile(name),
    onMutate: (name) => setCurrentOperation(`Deleting ${name}…`),
    onSuccess: (_, name) => {
      queryClient.invalidateQueries({ queryKey: ['telemetry'] })
      addEvent({ operation: 'delete_file', status: 'success', message: `File '${name}' deleted`, fileName: name })
      showToast('success', `Deleted '${name}'`)
      setConfirmDelete(null)
      setCurrentOperation(null)
    },
    onError: (e: Error) => {
      addEvent({ operation: 'delete_file', status: 'failed', message: e.message })
      showToast('error', e.message)
      setCurrentOperation(null)
    },
  })

  const files = telemetry?.files ?? []
  const filtered = files.filter((f) =>
    f.name.toLowerCase().includes(searchQuery.toLowerCase())
  )

  const handleShowInMap = (file: FileView) => {
    setSelectedFileName(file.name)
    setHighlightedBlockIds(new Set(file.block_ids))
    setActiveView('storage')
  }

  const handleSelectFile = (file: FileView) => {
    setSelectedFileName(file.name)
    setInspectorFile(file)
  }

  if (isLoading) {
    return (
      <div>
        <div className="section-header">
          <div className="section-title">📁 File System</div>
        </div>
        {[...Array(4)].map((_, i) => (
          <div key={i} className="skeleton" style={{ height: 52, borderRadius: 10, marginBottom: 8 }} />
        ))}
      </div>
    )
  }

  if (isError) {
    return (
      <div className="alert alert-error">
        <span className="alert-icon">❌</span>
        <span>Backend not reachable. Start the AeroFS server.</span>
      </div>
    )
  }

  return (
    <div>
      <div className="section-header">
        <div>
          <h1 className="section-title">📁 File System</h1>
          <div className="section-sub">{files.length} files · {telemetry!.disk.allocated_blocks} blocks used</div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <button
            className={`btn ${viewMode === 'list' ? 'btn-primary' : 'btn-ghost'} btn-sm`}
            onClick={() => setViewMode('list')} aria-pressed={viewMode === 'list'}
          >☰ List</button>
          <button
            className={`btn ${viewMode === 'grid' ? 'btn-primary' : 'btn-ghost'} btn-sm`}
            onClick={() => setViewMode('grid')} aria-pressed={viewMode === 'grid'}
          >⊞ Grid</button>
          <button className="btn btn-primary btn-sm" onClick={() => setShowCreate(true)}>
            + Create File
          </button>
        </div>
      </div>

      {/* Search */}
      <div style={{ marginBottom: 12 }}>
        <input
          className="form-input"
          placeholder="🔍 Search files…"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          aria-label="Search files"
        />
      </div>

      {/* File list */}
      {filtered.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: 40 }}>
          <div style={{ fontSize: '2.5rem', marginBottom: 8 }}>📂</div>
          <div style={{ color: 'var(--text-secondary)', marginBottom: 12 }}>
            {searchQuery ? 'No files match your search.' : 'No files yet. Create your first file!'}
          </div>
          {!searchQuery && (
            <button className="btn btn-primary" onClick={() => setShowCreate(true)}>+ Create File</button>
          )}
        </div>
      ) : viewMode === 'list' ? (
        <div className="file-list">
          {filtered.map((file) => (
            <FileRow
              key={file.name}
              file={file}
              onSelect={() => handleSelectFile(file)}
              onEdit={() => setEditingFile(file)}
              onDuplicate={() => setDuplicateSource(file)}
              onDelete={() => setConfirmDelete(file.name)}
              onInspect={() => setInspectingFile(file)}
              onShowInMap={() => handleShowInMap(file)}
            />
          ))}
        </div>
      ) : (
        <div className="panel-grid cols-3">
          {filtered.map((file) => (
            <FileCard
              key={file.name}
              file={file}
              onSelect={() => handleSelectFile(file)}
              onEdit={() => setEditingFile(file)}
              onDuplicate={() => setDuplicateSource(file)}
              onDelete={() => setConfirmDelete(file.name)}
              onInspect={() => setInspectingFile(file)}
            />
          ))}
        </div>
      )}

      {/* Delete confirm modal */}
      {confirmDelete && (
        <div className="modal-overlay" onClick={() => setConfirmDelete(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-title">🗑 Delete File</div>
            <div className="modal-subtitle">
              This will permanently delete <strong>'{confirmDelete}'</strong> and release its blocks
              (if not referenced by snapshots). This action cannot be undone.
            </div>
            <div className="alert alert-warn" style={{ marginBottom: 12 }}>
              <span className="alert-icon">⚠️</span>
              <span>Blocks shared with snapshots will not be freed until those snapshots are deleted too.</span>
            </div>
            <div className="modal-actions">
              <button className="btn btn-ghost" onClick={() => setConfirmDelete(null)}>Cancel</button>
              <button className="btn btn-danger" onClick={() => deleteMut.mutate(confirmDelete!)} disabled={deleteMut.isPending}>
                {deleteMut.isPending ? 'Deleting…' : 'Delete File'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showCreate && (
        <CreateFileDialog
          onClose={() => setShowCreate(false)}
          onSuccess={() => {
            setShowCreate(false)
            queryClient.invalidateQueries({ queryKey: ['telemetry'] })
          }}
        />
      )}

      {duplicateSource && (
        <DuplicateDialog
          source={duplicateSource}
          onClose={() => setDuplicateSource(null)}
          onSuccess={() => {
            setDuplicateSource(null)
            queryClient.invalidateQueries({ queryKey: ['telemetry'] })
          }}
        />
      )}

      {editingFile && (
        <FileEditor
          file={editingFile}
          onClose={() => setEditingFile(null)}
          onSaved={() => {
            setEditingFile(null)
            queryClient.invalidateQueries({ queryKey: ['telemetry'] })
          }}
        />
      )}

      {inspectingFile && (
        <FileInspectorModal
          file={inspectingFile}
          onClose={() => setInspectingFile(null)}
          onShowInMap={() => { handleShowInMap(inspectingFile); setInspectingFile(null) }}
        />
      )}
    </div>
  )
}

function FileRow({ file, onSelect, onEdit, onDuplicate, onDelete, onInspect, onShowInMap }: {
  file: FileView
  onSelect: () => void
  onEdit: () => void
  onDuplicate: () => void
  onDelete: () => void
  onInspect: () => void
  onShowInMap: () => void
}) {
  const ext = file.name.split('.').pop() ?? ''
  const icon = getFileIcon(ext)
  const selectedFileName = useStore((s) => s.selectedFileName)
  const isSelected = selectedFileName === file.name

  return (
    <div className={`file-row ${isSelected ? 'selected' : ''}`} onClick={onSelect} role="listitem" tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && onSelect()}>
      <span className="file-icon" aria-hidden="true">{icon}</span>
      <div>
        <div className="file-name">{file.name}</div>
        <div className="file-meta">
          {formatBytes(file.size)} · {file.num_blocks} blocks
          {file.modified_at && ` · ${file.modified_at}`}
        </div>
      </div>
      <div style={{ marginLeft: 'auto', display: 'flex', gap: 4, alignItems: 'center' }}>
        {/* Block count pills */}
        {file.num_blocks > 0 && (
          <span className="chip" style={{ fontFamily: 'var(--font-mono)', fontSize: '0.68rem' }}>
            {file.num_blocks} blocks
          </span>
        )}
      </div>
      <div className="file-actions">
        <button className="btn btn-ghost btn-sm btn-icon" onClick={(e) => { e.stopPropagation(); onInspect() }} title="Inspect inode">🔍</button>
        <button className="btn btn-ghost btn-sm btn-icon" onClick={(e) => { e.stopPropagation(); onEdit() }} title="Edit file">✏️</button>
        <button className="btn btn-ghost btn-sm btn-icon" onClick={(e) => { e.stopPropagation(); onDuplicate() }} title="Duplicate">📋</button>
        <button className="btn btn-ghost btn-sm btn-icon" onClick={(e) => { e.stopPropagation(); onShowInMap() }} title="Show in 3D">🧊</button>
        <button className="btn btn-danger btn-sm btn-icon" onClick={(e) => { e.stopPropagation(); onDelete() }} title="Delete">🗑</button>
      </div>
    </div>
  )
}

function FileCard({ file, onSelect, onEdit, onDuplicate, onDelete, onInspect }: {
  file: FileView
  onSelect: () => void
  onEdit: () => void
  onDuplicate: () => void
  onDelete: () => void
  onInspect: () => void
}) {
  const ext = file.name.split('.').pop() ?? ''
  const icon = getFileIcon(ext)

  return (
    <div className="card" onClick={onSelect} style={{ cursor: 'pointer' }}>
      <div style={{ fontSize: '2rem', marginBottom: 8, textAlign: 'center' }}>{icon}</div>
      <div style={{ fontWeight: 700, fontSize: '0.88rem', marginBottom: 4, textAlign: 'center', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{file.name}</div>
      <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', textAlign: 'center', marginBottom: 10 }}>
        {formatBytes(file.size)} · {file.num_blocks} blocks
      </div>
      <div style={{ display: 'flex', gap: 4, justifyContent: 'center', flexWrap: 'wrap' }}>
        <button className="btn btn-ghost btn-sm" onClick={(e) => { e.stopPropagation(); onInspect() }}>🔍</button>
        <button className="btn btn-ghost btn-sm" onClick={(e) => { e.stopPropagation(); onEdit() }}>✏️</button>
        <button className="btn btn-ghost btn-sm" onClick={(e) => { e.stopPropagation(); onDuplicate() }}>📋</button>
        <button className="btn btn-danger btn-sm" onClick={(e) => { e.stopPropagation(); onDelete() }}>🗑</button>
      </div>
    </div>
  )
}

function getFileIcon(ext: string): string {
  const map: Record<string, string> = {
    c: '📜', h: '📜', py: '🐍', txt: '📄', md: '📝',
    json: '📋', sys: '⚙️', bin: '💾', log: '📋', tmp: '🔧',
  }
  return map[ext.toLowerCase()] ?? '📄'
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MiB`
}
