import React, { useRef, useMemo, useState, useEffect, Suspense } from 'react'
import { Canvas, useThree } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import * as THREE from 'three'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { getTelemetry, simulatePartialDedup75 } from '../../api/client'
import { useStore } from '../../state/store'
import {
  GRID_STATE_MAP,
  BLOCK_STATE_COLORS,
  BLOCK_STATE_COLORS_LIGHT,
  BLOCK_STATE_LABELS,
  type BlockState,
  type FileView,
  type DiskView,
} from '../../api/types'
import BlockGrid2D from './BlockGrid2D'
import HardDrive3D, {
  HARD_DRIVE_POS,
  GRID_COLS,
  GRID_ROWS,
  getHardDriveBlockCoords,
} from './HardDrive3D'
import LogicalFiles3D from './LogicalFiles3D'
import HardDriveLinks from './HardDriveLinks'

const CUBE_OFFSET_X = -15
const BOX_SIZE = 0.95

// ─────────────────────────────────────────────────────────────────────────────
//  InstancedBlocks: 3D spatial cube (16x16x16 = 4096 blocks) for matrix mode
// ─────────────────────────────────────────────────────────────────────────────
interface BlockMeshProps {
  gridBlocks: number[]
  filter: string
  highlightIds: Set<number>
  selectedId: number | null
  cubeOffsetX: number
  theme: 'dark' | 'light'
  onSelectBlock: (id: number) => void
  onHoverBlock: (id: number | null) => void
}

function InstancedBlocks({
  gridBlocks,
  filter,
  highlightIds,
  selectedId,
  cubeOffsetX,
  theme,
  onSelectBlock,
  onHoverBlock,
}: BlockMeshProps) {
  const meshRef = useRef<THREE.InstancedMesh>(null)
  const dummy = useMemo(() => new THREE.Object3D(), [])
  const color = useMemo(() => new THREE.Color(), [])

  const total = gridBlocks.length || 4096

  useEffect(() => {
    if (!meshRef.current) return
    const palette = theme === 'light' ? BLOCK_STATE_COLORS_LIGHT : BLOCK_STATE_COLORS

    for (let i = 0; i < total; i++) {
      const stateCode = gridBlocks[i] ?? 0
      const stateName: BlockState = GRID_STATE_MAP[stateCode] ?? 'free'

      const matchesFilter =
        filter === 'all' ||
        (filter === 'free' && stateName === 'free') ||
        (filter === 'metadata' && stateName === 'metadata') ||
        (filter === 'unique' && stateName === 'unique') ||
        (filter === 'shared' && stateName === 'shared') ||
        (filter === 'corrupted' && stateName === 'corrupted')

      const isHighlighted = highlightIds.has(i)
      const isSelected = selectedId === i

      const x = (i % 16) - 8
      const z = (Math.floor(i / 16) % 16) - 8
      const y = Math.floor(i / (16 * 16)) - 8

      dummy.position.set(cubeOffsetX + x * 1.5, y * 1.5, z * 1.5)

      if (!matchesFilter) {
        dummy.scale.set(0, 0, 0)
      } else if (isSelected) {
        dummy.scale.set(1.5, 1.5, 1.5)
      } else if (isHighlighted) {
        dummy.scale.set(1.3, 1.3, 1.3)
      } else if (stateName === 'free') {
        dummy.scale.set(0.35, 0.35, 0.35)
      } else {
        dummy.scale.set(BOX_SIZE, BOX_SIZE, BOX_SIZE)
      }

      dummy.updateMatrix()
      meshRef.current.setMatrixAt(i, dummy.matrix)

      // Color assignment
      if (isSelected) {
        color.set('#ffffff')
      } else if (isHighlighted) {
        color.set('#38bdf8')
      } else {
        color.set(palette[stateName] || (theme === 'light' ? '#cbd5e1' : '#1e293b'))
      }
      meshRef.current.setColorAt(i, color)
    }

    meshRef.current.instanceMatrix.needsUpdate = true
    if (meshRef.current.instanceColor) {
      meshRef.current.instanceColor.needsUpdate = true
    }
  }, [gridBlocks, filter, highlightIds, selectedId, total, dummy, color, theme, cubeOffsetX])

  const handleClick = (e: any) => {
    e.stopPropagation()
    const instanceId = e.instanceId
    if (instanceId !== undefined && instanceId >= 0 && instanceId < total) {
      onSelectBlock(instanceId)
    }
  }

  const handlePointerMove = (e: any) => {
    e.stopPropagation()
    const instanceId = e.instanceId
    if (instanceId !== undefined && instanceId >= 0 && instanceId < total) {
      onHoverBlock(instanceId)
    }
  }

  const handlePointerOut = () => {
    onHoverBlock(null)
  }

  return (
    <instancedMesh
      ref={meshRef}
      args={[undefined, undefined, total]}
      onClick={handleClick}
      onPointerMove={handlePointerMove}
      onPointerOut={handlePointerOut}
    >
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial roughness={0.3} metalness={0.2} toneMapped={false} />
    </instancedMesh>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
//  Camera preset controller
// ─────────────────────────────────────────────────────────────────────────────
function SceneCameraController({
  viewMode,
  resetTrigger,
}: {
  viewMode: 'dedup' | 'matrix' | 'drive'
  resetTrigger: number
}) {
  const { camera } = useThree()

  useEffect(() => {
    if (viewMode === 'dedup') {
      camera.position.set(0, 4, 38)
      camera.lookAt(0, 0, 0)
    } else if (viewMode === 'matrix') {
      camera.position.set(0, 18, 44)
      camera.lookAt(0, 0, 0)
    } else if (viewMode === 'drive') {
      camera.position.set(HARD_DRIVE_POS.x, 0, 26)
      camera.lookAt(HARD_DRIVE_POS.x, 0, 0)
    }
  }, [viewMode, resetTrigger, camera])

  return null
}

// ─────────────────────────────────────────────────────────────────────────────
//  SharedBlocksPanel: Deduplicated File Pairs
// ─────────────────────────────────────────────────────────────────────────────
function SharedBlocksPanel({ files, theme }: { files: FileView[]; theme: 'dark' | 'light' }) {
  const [collapsed, setCollapsed] = useState(false)

  const blockOwners = useMemo(() => {
    const map = new Map<number, string[]>()
    for (const file of files) {
      for (const bid of file.block_ids ?? []) {
        if (!map.has(bid)) map.set(bid, [])
        map.get(bid)!.push(file.name)
      }
    }
    return map
  }, [files])

  const sharedPairs = useMemo(() => {
    const pairMap = new Map<string, { files: string[]; blockCount: number; sampleBlock: number }>()
    for (const [blockId, owners] of blockOwners) {
      if (owners.length < 2) continue
      const key = [...owners].sort().join('|')
      if (!pairMap.has(key)) {
        pairMap.set(key, { files: owners, blockCount: 0, sampleBlock: blockId })
      }
      pairMap.get(key)!.blockCount++
    }
    return [...pairMap.values()]
  }, [blockOwners])

  if (sharedPairs.length === 0) return null

  return (
    <div
      style={{
        position: 'absolute',
        top: 16,
        right: 16,
        width: collapsed ? 200 : 280,
        background: theme === 'light' ? 'rgba(255, 255, 255, 0.96)' : 'rgba(10, 15, 29, 0.92)',
        backdropFilter: 'blur(12px)',
        border: theme === 'light' ? '1px solid rgba(124, 58, 237, 0.4)' : '1px solid rgba(168, 85, 247, 0.5)',
        borderRadius: 8,
        padding: '0.75rem',
        zIndex: 10,
        boxShadow: theme === 'light' ? '0 8px 32px rgba(124, 58, 237, 0.12)' : '0 8px 32px rgba(168, 85, 247, 0.25)',
        transition: 'all 0.2s ease',
      }}
    >
      <div
        style={{
          fontSize: '0.78rem',
          fontWeight: 700,
          color: theme === 'light' ? '#6b21a8' : '#c084fc',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          cursor: 'pointer',
        }}
        onClick={() => setCollapsed(!collapsed)}
      >
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: '#a855f7',
              boxShadow: '0 0 8px #a855f7',
            }}
          />
          🔗 Deduplicated File Pairs
        </span>
        <span style={{ fontSize: '0.7rem', color: theme === 'light' ? '#64748b' : '#94a3b8' }}>
          {collapsed ? '▶' : '▼'}
        </span>
      </div>

      {!collapsed && (
        <>
          <div style={{ fontSize: '0.71rem', color: theme === 'light' ? '#475569' : '#94a3b8', margin: '6px 0 8px 0', lineHeight: 1.4 }}>
            Duplicate files share physical blocks via CAS. Purple beams show both files pointing to the same block on the Hard Drive!
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 180, overflowY: 'auto' }}>
            {sharedPairs.map((pair, i) => (
              <div
                key={i}
                style={{
                  background: theme === 'light' ? 'rgba(124, 58, 237, 0.06)' : 'rgba(168, 85, 247, 0.1)',
                  border: theme === 'light' ? '1px solid rgba(124, 58, 237, 0.25)' : '1px solid rgba(168, 85, 247, 0.3)',
                  borderRadius: 6,
                  padding: '6px 8px',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap', marginBottom: 2 }}>
                  {pair.files.map((f, fi) => (
                    <React.Fragment key={f}>
                      <span
                        style={{
                          background: theme === 'light' ? 'rgba(124, 58, 237, 0.15)' : 'rgba(168, 85, 247, 0.25)',
                          color: theme === 'light' ? '#581c87' : '#f3e8ff',
                          padding: '1px 5px',
                          borderRadius: 3,
                          fontFamily: 'monospace',
                          fontSize: '0.69rem',
                          fontWeight: 600,
                        }}
                      >
                        {f}
                      </span>
                      {fi < pair.files.length - 1 && (
                        <span style={{ color: theme === 'light' ? '#7c3aed' : '#c084fc', fontWeight: 700 }}>↔</span>
                      )}
                    </React.Fragment>
                  ))}
                </div>
                <div style={{ fontSize: '0.67rem', color: theme === 'light' ? '#6b21a8' : '#c084fc' }}>
                  {pair.blockCount} shared block{pair.blockCount !== 1 ? 's' : ''} · Physical Block #{pair.sampleBlock}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
//  HardDriveHUD: Live hardware telemetry for the vertical block Hard Drive
// ─────────────────────────────────────────────────────────────────────────────
function HardDriveHUD({
  activeBlockId,
  gridBlocks,
  files,
  disk,
  theme,
}: {
  activeBlockId: number | null
  gridBlocks: number[]
  files: FileView[]
  disk?: DiskView
  theme: 'dark' | 'light'
}) {
  const activeCol = activeBlockId !== null ? activeBlockId % GRID_COLS : null
  const activeRow = activeBlockId !== null ? Math.floor(activeBlockId / GRID_COLS) : null

  const stateCode = activeBlockId !== null ? gridBlocks[activeBlockId] : undefined
  const isShared = stateCode === 3
  const isSnapshot = stateCode === 5
  const isFree = activeBlockId !== null && (stateCode === 0 || stateCode === undefined)

  // Owners of active block
  const owners = useMemo(() => {
    if (activeBlockId === null) return []
    return files.filter((f) => f.block_ids?.includes(activeBlockId)).map((f) => f.name)
  }, [activeBlockId, files])

  // Containing free extent if this block is free
  const containingExtent = useMemo(() => {
    if (activeBlockId === null || !disk?.free_extents || !isFree) return null
    return disk.free_extents.find((e) => activeBlockId >= e.start && activeBlockId < e.start + e.length) ?? null
  }, [activeBlockId, disk?.free_extents, isFree])

  return (
    <div
      style={{
        position: 'absolute',
        bottom: 16,
        right: 16,
        width: 320,
        background: theme === 'light' ? 'rgba(255, 255, 255, 0.96)' : 'rgba(10, 15, 29, 0.94)',
        backdropFilter: 'blur(12px)',
        border: `1px solid ${
          theme === 'light'
            ? isShared
              ? 'rgba(124, 58, 237, 0.5)'
              : isSnapshot
              ? 'rgba(217, 119, 6, 0.5)'
              : 'rgba(2, 132, 199, 0.4)'
            : isShared
            ? 'rgba(168, 85, 247, 0.5)'
            : isSnapshot
            ? 'rgba(245, 158, 11, 0.5)'
            : 'rgba(56, 189, 248, 0.35)'
        }`,
        borderRadius: 8,
        padding: '0.8rem',
        zIndex: 10,
        boxShadow: theme === 'light' ? '0 8px 32px rgba(0, 0, 0, 0.12)' : '0 8px 32px rgba(0, 0, 0, 0.5)',
        color: theme === 'light' ? '#0f172a' : '#cbd5e1',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 8,
          borderBottom: theme === 'light' ? '1px solid rgba(0, 0, 0, 0.08)' : '1px solid rgba(255, 255, 255, 0.08)',
          paddingBottom: 6,
        }}
      >
        <span style={{ fontSize: '0.82rem', fontWeight: 700, color: theme === 'light' ? '#0284c7' : '#38bdf8', display: 'flex', alignItems: 'center', gap: 6 }}>
          <span>💽</span> Enterprise Hard Drive (Physical Layer)
        </span>
        <span
          style={{
            fontSize: '0.68rem',
            padding: '2px 6px',
            borderRadius: 4,
            background: theme === 'light' ? 'rgba(2, 132, 199, 0.1)' : 'rgba(56, 189, 248, 0.15)',
            color: theme === 'light' ? '#0369a1' : '#7dd3fc',
            fontFamily: 'monospace',
            fontWeight: 600,
          }}
        >
          SATA 6 Gb/s
        </span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px', fontSize: '0.72rem', color: theme === 'light' ? '#475569' : '#94a3b8' }}>
        <div>
          Vertical Grid: <strong style={{ color: theme === 'light' ? '#0f172a' : '#f8fafc' }}>64 Col × 64 Row</strong>
        </div>
        <div>
          Capacity: <strong style={{ color: theme === 'light' ? '#0f172a' : '#f8fafc' }}>4,096 Blocks (16 MiB)</strong>
        </div>
        <div>
          Column: <strong style={{ color: activeCol !== null ? (theme === 'light' ? '#0284c7' : '#38bdf8') : (theme === 'light' ? '#64748b' : '#94a3b8') }}>
            {activeCol !== null ? `Col #${activeCol}` : '—'}
          </strong>
        </div>
        <div>
          Row: <strong style={{ color: activeRow !== null ? (theme === 'light' ? '#0284c7' : '#38bdf8') : (theme === 'light' ? '#64748b' : '#94a3b8') }}>
            {activeRow !== null ? `Row #${activeRow}` : '—'}
          </strong>
        </div>
      </div>

      {/* Best-Fit Allocation & Fragmentation Telemetry */}
      <div
        style={{
          marginTop: 8,
          paddingTop: 6,
          borderTop: theme === 'light' ? '1px solid rgba(0, 0, 0, 0.08)' : '1px solid rgba(255, 255, 255, 0.08)',
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: '6px',
          fontSize: '0.7rem',
          color: theme === 'light' ? '#475569' : '#94a3b8',
        }}
      >
        <div>
          Engine: <strong style={{ color: theme === 'light' ? '#0284c7' : '#38bdf8' }}>Best-Fit</strong>
        </div>
        <div>
          External Frag:{' '}
          <strong style={{ color: (disk?.fragmentation_percent ?? 0) > 40 ? '#d97706' : '#059669' }}>
            {disk?.fragmentation_percent ?? 0}%
          </strong>
        </div>
        <div>
          Free Holes: <strong style={{ color: theme === 'light' ? '#0f172a' : '#f8fafc' }}>{disk?.free_extents_count ?? 1} holes</strong>
        </div>
        <div>
          Largest Hole:{' '}
          <strong style={{ color: theme === 'light' ? '#7c3aed' : '#a78bfa' }}>
            {(disk?.largest_free_extent ?? 4092).toLocaleString()} blk
          </strong>
        </div>
      </div>

      {activeBlockId !== null && (
        <div
          style={{
            marginTop: 8,
            padding: '6px 8px',
            background: isShared
              ? theme === 'light'
                ? 'rgba(124, 58, 237, 0.1)'
                : 'rgba(168, 85, 247, 0.18)'
              : isSnapshot
              ? theme === 'light'
                ? 'rgba(217, 119, 6, 0.1)'
                : 'rgba(245, 158, 11, 0.15)'
              : isFree
              ? theme === 'light'
                ? 'rgba(5, 150, 105, 0.1)'
                : 'rgba(16, 185, 129, 0.12)'
              : theme === 'light'
              ? 'rgba(2, 132, 199, 0.08)'
              : 'rgba(56, 189, 248, 0.1)',
            border: `1px solid ${
              isShared
                ? theme === 'light' ? 'rgba(124, 58, 237, 0.4)' : 'rgba(168, 85, 247, 0.5)'
                : isSnapshot
                ? theme === 'light' ? 'rgba(217, 119, 6, 0.4)' : 'rgba(245, 158, 11, 0.5)'
                : isFree
                ? theme === 'light' ? 'rgba(5, 150, 105, 0.35)' : 'rgba(16, 185, 129, 0.35)'
                : theme === 'light' ? 'rgba(2, 132, 199, 0.3)' : 'rgba(56, 189, 248, 0.3)'
            }`,
            borderRadius: 6,
          }}
        >
          <div
            style={{
              fontSize: '0.74rem',
              fontWeight: 700,
              color: isShared
                ? theme === 'light' ? '#7c3aed' : '#c084fc'
                : isSnapshot
                ? theme === 'light' ? '#d97706' : '#fbbf24'
                : isFree
                ? theme === 'light' ? '#059669' : '#34d399'
                : theme === 'light' ? '#0284c7' : '#38bdf8',
              marginBottom: 2,
            }}
          >
            Physical Block #{activeBlockId}{' '}
            {isShared && '🔗 [CAS DEDUPLICATED]'}
            {isSnapshot && '📷 [SNAPSHOT PROTECTED]'}
            {isFree && '🟢 [FREE / RECLAIMABLE]'}
          </div>
          <div style={{ fontSize: '0.69rem', color: theme === 'light' ? '#1e293b' : '#cbd5e1' }}>
            {isShared ? (
              <span>
                Shared 4KB Physical Block via CAS:{' '}
                <strong style={{ color: theme === 'light' ? '#581c87' : '#f3e8ff' }}>{owners.join(' & ')}</strong>
                <div style={{ color: theme === 'light' ? '#6b21a8' : '#a855f7', marginTop: 2, fontWeight: 600 }}>
                  ✓ Block-Level CAS ({owners.length} files converge here · Refcount: 2)
                </div>
                <div style={{ color: theme === 'light' ? '#0369a1' : '#38bdf8', marginTop: 2, fontSize: '0.67rem', lineHeight: 1.3 }}>
                  💡 NO new location allocated! Only unique blocks (e.g. 25% diff) receive new physical disk sectors.
                </div>
              </span>
            ) : isSnapshot ? (
              <span>
                <strong style={{ color: theme === 'light' ? '#b45309' : '#fbbf24' }}>📷 Preserved on disk by Snapshot:</strong>
                <div style={{ color: theme === 'light' ? '#334155' : '#cbd5e1', marginTop: 2 }}>
                  {owners.length > 0 ? (
                    <span>Active File: <strong style={{ color: theme === 'light' ? '#0284c7' : '#38bdf8' }}>{owners.join(', ')}</strong></span>
                  ) : (
                    <span>Historical extent retained on disk (live file modified via CoW)</span>
                  )}
                </div>
                <div style={{ color: theme === 'light' ? '#b45309' : '#f59e0b', marginTop: 2, fontWeight: 600 }}>
                  ✓ Zero-Copy CoW · Block preserved without duplication
                </div>
              </span>
            ) : isFree ? (
              <span>
                <strong style={{ color: theme === 'light' ? '#059669' : '#34d399' }}>🟢 Free Sector (Best-Fit Hole)</strong>
                <div style={{ color: theme === 'light' ? '#475569' : '#94a3b8', marginTop: 2 }}>
                  {containingExtent ? (
                    <span>
                      Span: Sectors <strong style={{ color: theme === 'light' ? '#0f172a' : '#f8fafc' }}>#{containingExtent.start}..#{containingExtent.start + containingExtent.length - 1}</strong> ({containingExtent.length} contiguous free blocks)
                    </span>
                  ) : (
                    <span>Unallocated sector ready for immediate write</span>
                  )}
                </div>
                <div style={{ color: theme === 'light' ? '#0284c7' : '#38bdf8', marginTop: 3, lineHeight: 1.4 }}>
                  {containingExtent && containingExtent.length < 64 ? (
                    <span>
                      ✓ Best-Fit allocates files of <strong>≤ {containingExtent.length} blocks ({containingExtent.length * 4} KB)</strong> here.
                      <div style={{ color: theme === 'light' ? '#b45309' : '#f59e0b', marginTop: 3, fontSize: '0.67rem', lineHeight: 1.3 }}>
                        💡 Why did a 64-block file skip this? A 64-block file cannot fit in an {containingExtent.length}-block hole contiguously! Contiguous Best-Fit skips small holes to keep large files unfragmented.
                      </div>
                    </span>
                  ) : (
                    <span>✓ Best-Fit will allocate here when a matching file is created</span>
                  )}
                </div>
              </span>
            ) : owners.length > 0 ? (
              <span>Owner: <strong style={{ color: theme === 'light' ? '#0284c7' : '#38bdf8' }}>{owners.join(', ')}</strong></span>
            ) : (
              <span>Physical block at column {activeCol}, row {activeRow}</span>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
//  PartialDedupModal: Interactive 75% Partial Block Deduplication Showcase
// ─────────────────────────────────────────────────────────────────────────────
interface PartialDedupModalProps {
  isOpen: boolean
  onClose: () => void
  onDeployed: (sharedBlocks: number[]) => void
  theme: 'dark' | 'light'
}

function PartialDedupModal({ isOpen, onClose, onDeployed, theme }: PartialDedupModalProps) {
  const [deploying, setDeploying] = useState(false)
  const showToast = useStore((s) => s.showToast)
  const addEvent = useStore((s) => s.addEvent)
  const queryClient = useQueryClient()

  if (!isOpen) return null

  const handleDeploy = async () => {
    setDeploying(true)
    try {
      const res = await simulatePartialDedup75()
      queryClient.invalidateQueries({ queryKey: ['telemetry'] })
      queryClient.invalidateQueries({ queryKey: ['files'] })
      showToast('success', 'Created file_a.bin & file_b.bin! 3 blocks (75%) shared via CAS, 1 unique block each.')
      addEvent({
        operation: '75% Block Dedup Demo',
        status: 'success',
        message: `Created file_a.bin & file_b.bin. 3 shared blocks: [${res.shared_blocks.join(', ')}], unique: file_a=[${res.file_a_unique.join(', ')}], file_b=[${res.file_b_unique.join(', ')}]`,
        affectedBlockIds: [...res.shared_blocks, ...res.file_a_unique, ...res.file_b_unique],
      })
      onDeployed(res.shared_blocks)
      onClose()
    } catch (e: any) {
      showToast('error', e.message)
    } finally {
      setDeploying(false)
    }
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0, 0, 0, 0.82)',
        backdropFilter: 'blur(8px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 200,
        padding: '1rem',
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: theme === 'light' ? '#ffffff' : '#0b1120',
          border: theme === 'light' ? '1px solid #cbd5e1' : '1px solid rgba(168, 85, 247, 0.4)',
          borderRadius: 14,
          maxWidth: 820,
          width: '100%',
          maxHeight: '92vh',
          overflowY: 'auto',
          boxShadow: '0 24px 60px rgba(0, 0, 0, 0.6), 0 0 40px rgba(168, 85, 247, 0.25)',
          padding: '1.75rem',
          color: theme === 'light' ? '#0f172a' : '#f8fafc',
          position: 'relative',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.2rem' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: '1.4rem' }}>🎨</span>
              <h2 style={{ margin: 0, fontSize: '1.22rem', fontWeight: 800, color: theme === 'light' ? '#6b21a8' : '#c084fc' }}>
                How AeroFS Handles Files with 75% Identical Data
              </h2>
            </div>
            <div style={{ fontSize: '0.82rem', color: theme === 'light' ? '#475569' : '#94a3b8', marginTop: 4 }}>
              Block-Level CAS Deduplication vs. Whole-File Duplication
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'transparent',
              border: 'none',
              fontSize: '1.2rem',
              color: '#94a3b8',
              cursor: 'pointer',
              padding: '4px 8px',
            }}
          >
            ✕
          </button>
        </div>

        {/* Core Question & Direct Answer Alert */}
        <div
          style={{
            background: theme === 'light' ? 'rgba(124, 58, 237, 0.08)' : 'rgba(168, 85, 247, 0.12)',
            border: theme === 'light' ? '1px solid rgba(124, 58, 237, 0.35)' : '1px solid rgba(168, 85, 247, 0.4)',
            borderRadius: 10,
            padding: '1rem 1.2rem',
            marginBottom: '1.25rem',
          }}
        >
          <div style={{ fontSize: '0.90rem', fontWeight: 800, color: '#ef4444', marginBottom: 5 }}>
            ❌ Common Misconception: Does it allocate a completely new location for the whole file?
          </div>
          <div style={{ fontSize: '0.98rem', fontWeight: 800, color: theme === 'light' ? '#6b21a8' : '#e9d5ff', marginBottom: 4 }}>
            👉 NO! It does NOT create a completely new location for the whole file.
          </div>
          <div style={{ fontSize: '0.84rem', lineHeight: 1.5, color: theme === 'light' ? '#334155' : '#cbd5e1' }}>
            Because AeroFS works at the <strong>4KB block level</strong>, it <strong>shares the 75% identical blocks</strong> and <strong>only allocates new physical locations for the 25% that is different</strong>.
          </div>
        </div>

        {/* Visual Diagram Box */}
        <div
          style={{
            background: theme === 'light' ? '#f8fafc' : '#070b14',
            border: theme === 'light' ? '1px solid #e2e8f0' : '1px solid #1e293b',
            borderRadius: 10,
            padding: '1.2rem',
            marginBottom: '1.25rem',
          }}
        >
          <div style={{ fontSize: '0.8rem', fontWeight: 700, color: '#38bdf8', marginBottom: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            🎨 16 KB Example (4 Blocks of 4KB Each)
          </div>

          {/* Interactive ASCII / Block Map Diagram */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem', alignItems: 'center' }}>
            {/* File A Row */}
            <div style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              <span style={{ width: 85, fontSize: '0.78rem', fontWeight: 700, color: '#38bdf8' }}>File A:</span>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, flex: 1 }}>
                {['Part 1 (4KB)', 'Part 2 (4KB)', 'Part 3 (4KB)'].map((p, i) => (
                  <div
                    key={i}
                    style={{
                      padding: '8px 4px',
                      borderRadius: 6,
                      background: 'rgba(168, 85, 247, 0.2)',
                      border: '1px solid #a855f7',
                      textAlign: 'center',
                      fontSize: '0.75rem',
                      fontWeight: 700,
                      color: '#d8b4fe',
                    }}
                  >
                    <div>{p}</div>
                    <div style={{ fontSize: '0.65rem', color: '#c084fc' }}>Identical</div>
                  </div>
                ))}
                <div
                  style={{
                    padding: '8px 4px',
                    borderRadius: 6,
                    background: 'rgba(2, 132, 199, 0.2)',
                    border: '1px solid #0284c7',
                    textAlign: 'center',
                    fontSize: '0.75rem',
                    fontWeight: 700,
                    color: '#7dd3fc',
                  }}
                >
                  <div>Part 4 (Old)</div>
                  <div style={{ fontSize: '0.65rem', color: '#38bdf8' }}>Original 25%</div>
                </div>
              </div>
            </div>

            {/* Connecting Arrows Down */}
            <div style={{ width: '100%', display: 'flex', justifyContent: 'space-between', paddingLeft: 93, paddingRight: 8 }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, width: '100%', textAlign: 'center', color: '#94a3b8', fontSize: '0.85rem' }}>
                <span>│</span>
                <span>│</span>
                <span>│</span>
                <span>│</span>
              </div>
            </div>

            {/* Physical Disk Blocks Row */}
            <div style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              <span style={{ width: 85, fontSize: '0.78rem', fontWeight: 700, color: '#e2e8f0' }}>Physical Disk:</span>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, flex: 1 }}>
                {['#10', '#11', '#12'].map((bid, i) => (
                  <div
                    key={i}
                    style={{
                      padding: '8px 4px',
                      borderRadius: 6,
                      background: 'linear-gradient(135deg, rgba(168, 85, 247, 0.3) 0%, rgba(124, 58, 237, 0.4) 100%)',
                      border: '2px solid #a855f7',
                      textAlign: 'center',
                      fontSize: '0.76rem',
                      fontWeight: 800,
                      color: '#ffffff',
                      boxShadow: '0 0 12px rgba(168, 85, 247, 0.4)',
                    }}
                  >
                    <div>Block {bid}</div>
                    <div style={{ fontSize: '0.65rem', color: '#f3e8ff' }}>🔗 SHARED (Ref=2)</div>
                  </div>
                ))}
                <div
                  style={{
                    padding: '8px 4px',
                    borderRadius: 6,
                    background: 'rgba(2, 132, 199, 0.25)',
                    border: '1px solid #0284c7',
                    textAlign: 'center',
                    fontSize: '0.76rem',
                    fontWeight: 800,
                    color: '#38bdf8',
                  }}
                >
                  <div>Block #13</div>
                  <div style={{ fontSize: '0.65rem', color: '#93c5fd' }}>Unique to File A</div>
                </div>
              </div>
            </div>

            {/* Connecting Arrows Up */}
            <div style={{ width: '100%', display: 'flex', justifyContent: 'space-between', paddingLeft: 93, paddingRight: 8 }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, width: '100%', textAlign: 'center', color: '#94a3b8', fontSize: '0.85rem' }}>
                <span style={{ color: '#a855f7', fontWeight: 'bold' }}>▲</span>
                <span style={{ color: '#a855f7', fontWeight: 'bold' }}>▲</span>
                <span style={{ color: '#a855f7', fontWeight: 'bold' }}>▲</span>
                <span style={{ color: '#64748b' }}>✕ (No link)</span>
              </div>
            </div>

            {/* File B Row */}
            <div style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              <span style={{ width: 85, fontSize: '0.78rem', fontWeight: 700, color: '#38bdf8' }}>File B:</span>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, flex: 1 }}>
                {['Part 1 (4KB)', 'Part 2 (4KB)', 'Part 3 (4KB)'].map((p, i) => (
                  <div
                    key={i}
                    style={{
                      padding: '8px 4px',
                      borderRadius: 6,
                      background: 'rgba(168, 85, 247, 0.2)',
                      border: '1px solid #a855f7',
                      textAlign: 'center',
                      fontSize: '0.75rem',
                      fontWeight: 700,
                      color: '#d8b4fe',
                    }}
                  >
                    <div>{p}</div>
                    <div style={{ fontSize: '0.65rem', color: '#c084fc' }}>Identical (Reused)</div>
                  </div>
                ))}
                <div
                  style={{
                    padding: '8px 4px',
                    borderRadius: 6,
                    background: 'linear-gradient(135deg, rgba(16, 185, 129, 0.2) 0%, rgba(5, 150, 105, 0.3) 100%)',
                    border: '1px solid #10b981',
                    textAlign: 'center',
                    fontSize: '0.75rem',
                    fontWeight: 700,
                    color: '#6ee7b7',
                  }}
                >
                  <div>Part 4 (New)</div>
                  <div style={{ fontSize: '0.65rem', color: '#34d399' }}>➔ Block #99 (New!)</div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Under the Hood Steps */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1.25rem' }}>
          <div
            style={{
              padding: '0.9rem',
              borderRadius: 8,
              background: theme === 'light' ? 'rgba(124, 58, 237, 0.05)' : 'rgba(168, 85, 247, 0.08)',
              border: theme === 'light' ? '1px solid rgba(124, 58, 237, 0.2)' : '1px solid rgba(168, 85, 247, 0.25)',
              fontSize: '0.8rem',
              lineHeight: 1.5,
            }}
          >
            <div style={{ fontWeight: 800, color: theme === 'light' ? '#6b21a8' : '#c084fc', marginBottom: 4 }}>
              1. The 75% Identical Blocks (Parts 1, 2, 3)
            </div>
            <ul style={{ margin: 0, paddingLeft: '1.2rem', color: theme === 'light' ? '#334155' : '#cbd5e1' }}>
              <li>AeroFS hashes each 4KB chunk with SHA-256 in CAS.</li>
              <li>Hashes match existing Blocks #10, #11, and #12.</li>
              <li><strong>Zero new disk space allocated!</strong> Increments reference counter (<code style={{ color: '#a855f7' }}>refcount = 2</code>).</li>
            </ul>
          </div>

          <div
            style={{
              padding: '0.9rem',
              borderRadius: 8,
              background: theme === 'light' ? 'rgba(2, 132, 199, 0.05)' : 'rgba(56, 189, 248, 0.08)',
              border: theme === 'light' ? '1px solid rgba(2, 132, 199, 0.2)' : '1px solid rgba(56, 189, 248, 0.25)',
              fontSize: '0.8rem',
              lineHeight: 1.5,
            }}
          >
            <div style={{ fontWeight: 800, color: theme === 'light' ? '#0369a1' : '#38bdf8', marginBottom: 4 }}>
              2. The 25% Different Block (Part 4)
            </div>
            <ul style={{ margin: 0, paddingLeft: '1.2rem', color: theme === 'light' ? '#334155' : '#cbd5e1' }}>
              <li>Part 4 produces a new, unique SHA-256 hash.</li>
              <li>AeroFS allocates <strong>one single new block</strong> (Block #99) for that 25% unique data.</li>
              <li>File A keeps Block #13; File B points to Block #99.</li>
            </ul>
          </div>
        </div>

        {/* Space Saved Comparison Table */}
        <div style={{ marginBottom: '1.25rem' }}>
          <div style={{ fontSize: '0.8rem', fontWeight: 700, color: '#94a3b8', marginBottom: 6, textTransform: 'uppercase' }}>
            📊 Space Saved: Traditional OS vs. AeroFS (100 MB Files Example)
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
            <thead>
              <tr style={{ background: theme === 'light' ? '#f1f5f9' : '#1e293b', textAlign: 'left' }}>
                <th style={{ padding: '8px 10px', border: '1px solid #334155' }}>System</th>
                <th style={{ padding: '8px 10px', border: '1px solid #334155' }}>Storage Strategy</th>
                <th style={{ padding: '8px 10px', border: '1px solid #334155' }}>Total Disk Consumed</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td style={{ padding: '8px 10px', border: '1px solid #334155', fontWeight: 600 }}>Traditional (Windows / NTFS)</td>
                <td style={{ padding: '8px 10px', border: '1px solid #334155', color: '#ef4444' }}>Saves 2 completely separate 100MB files</td>
                <td style={{ padding: '8px 10px', border: '1px solid #334155', color: '#ef4444', fontWeight: 700 }}>200 MB (100% wasted duplication)</td>
              </tr>
              <tr style={{ background: 'rgba(168, 85, 247, 0.1)' }}>
                <td style={{ padding: '8px 10px', border: '1px solid #a855f7', fontWeight: 700, color: '#c084fc' }}>AeroFS (Our Subsystem)</td>
                <td style={{ padding: '8px 10px', border: '1px solid #a855f7', color: '#a78bfa' }}>Shares 75MB blocks, only stores 25MB new blocks</td>
                <td style={{ padding: '8px 10px', border: '1px solid #a855f7', color: '#34d399', fontWeight: 800 }}>125 MB (Saves 75 MB immediately!)</td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* Viva Summary Line Alert Box */}
        <div
          style={{
            background: 'rgba(16, 185, 129, 0.1)',
            border: '1px solid rgba(16, 185, 129, 0.35)',
            borderRadius: 8,
            padding: '10px 14px',
            marginBottom: '1.25rem',
            fontSize: '0.82rem',
            color: '#34d399',
            lineHeight: 1.5,
          }}
        >
          <strong>🎓 Viva Summary Line:</strong> "AeroFS does block-level deduplication, not whole-file deduplication. If two files are 75% identical, they share 75% of the same physical disk sectors and only consume new sectors for the 25% unique differences."
        </div>

        {/* Action Button */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem' }}>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={onClose}
            style={{ fontSize: '0.82rem', padding: '8px 16px' }}
          >
            Close
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={deploying}
            onClick={handleDeploy}
            style={{
              fontSize: '0.82rem',
              padding: '8px 18px',
              background: 'linear-gradient(135deg, #7c3aed 0%, #0284c7 100%)',
              border: 'none',
              fontWeight: 700,
              boxShadow: '0 4px 16px rgba(124, 58, 237, 0.4)',
              cursor: deploying ? 'not-allowed' : 'pointer',
            }}
          >
            {deploying ? 'Deploying to Virtual Disk…' : '⚡ Deploy 75% Dedup Live on Disk (File A & B)'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
//  Main StorageMap Component
// ─────────────────────────────────────────────────────────────────────────────
export default function StorageMap() {
  const { data: telemetry } = useQuery({
    queryKey: ['telemetry'],
    queryFn: () => getTelemetry(),
  })

  const selectedBlockId = useStore((s) => s.selectedBlockId)
  const setSelectedBlockId = useStore((s) => s.setSelectedBlockId)
  const highlightedBlockIds = useStore((s) => s.highlightedBlockIds)
  const blockFilter = useStore((s) => s.blockFilter)
  const setBlockFilter = useStore((s) => s.setBlockFilter)
  const use2DFallback = useStore((s) => s.use2DFallback)
  const setUse2DFallback = useStore((s) => s.setUse2DFallback)
  const setSelectedFileName = useStore((s) => s.setSelectedFileName)
  const theme = useStore((s) => s.theme)

  const [hoveredId, setHoveredId] = useState<number | null>(null)
  const [searchInput, setSearchInput] = useState('')
  const [cameraResetCounter, setCameraResetCounter] = useState(0)
  const [webglError, setWebglError] = useState(false)
  const [show75Modal, setShow75Modal] = useState(false)

  // View modes: 'dedup' (Files -> Hard Drive), 'matrix' (3D Cube -> Hard Drive), 'drive' (Hard Drive Only)
  const [viewMode, setViewMode] = useState<'dedup' | 'matrix' | 'drive'>('dedup')

  // Link modes: 'shared' (dedup convergence beams), 'all', 'selected', 'off'
  const [linkMode, setLinkMode] = useState<'shared' | 'all' | 'selected' | 'off'>('shared')

  const gridBlocks = telemetry?.grid_blocks ?? []
  const files = telemetry?.files ?? []

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    const id = parseInt(searchInput.trim(), 10)
    if (!isNaN(id) && id >= 0 && id < (telemetry?.disk.total_blocks ?? 4096)) {
      setSelectedBlockId(id)
    }
  }

  const hoveredStateCode = hoveredId !== null ? gridBlocks[hoveredId] : undefined
  const hoveredState =
    hoveredStateCode !== undefined ? (GRID_STATE_MAP[hoveredStateCode] ?? 'free') : null

  const sharedBlockCount = useMemo(() => {
    return gridBlocks.filter((s) => s === 3).length
  }, [gridBlocks])

  const stateCounts = useMemo(() => {
    const counts: Record<string, number> = {
      all: gridBlocks.length || 4096,
      unique: 0,
      shared: 0,
      metadata: 0,
      corrupted: 0,
      free: 0,
    }
    for (const code of gridBlocks) {
      const s = GRID_STATE_MAP[code] ?? 'free'
      if (counts[s] !== undefined) counts[s]++
    }
    return counts
  }, [gridBlocks])

  const activeBlockId = hoveredId !== null ? hoveredId : selectedBlockId

  const FILTER_ACTIVE_COLORS: Record<string, string> = {
    all: '#38bdf8',
    unique: '#10b981',
    shared: '#a855f7',
    metadata: '#0284c7',
    corrupted: '#ef4444',
    free: '#64748b',
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: '0.85rem' }}>
      {/* Top Controls Bar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '0.75rem',
          padding: '0.65rem 1rem',
          background: 'var(--bg-card)',
          borderRadius: '8px',
          border: '1px solid var(--border-dim)',
        }}
      >
        {/* Title and stats */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
          <div>
            <h2 style={{ fontSize: '1.15rem', fontWeight: 700, margin: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
              <span>💽</span> Filesystem to Hard Drive Mapping (CAS Deduplication)
            </h2>
            <div style={{ fontSize: '0.74rem', color: '#94a3b8' }}>
              Logical Files ➔ Enterprise Hard Drive (4,096 Vertical Physical Blocks · 64×64)
              <span style={{ marginLeft: 8, color: '#38bdf8', fontWeight: 600 }}>
                · 🧩 Best-Fit Allocation ({telemetry?.disk.fragmentation_percent ?? 0}% external frag)
              </span>
              {sharedBlockCount > 0 && (
                <span style={{ marginLeft: 8, color: '#c084fc', fontWeight: 600 }}>
                  · {sharedBlockCount} CAS Shared Blocks
                </span>
              )}
            </div>
          </div>

          {/* Block state filters */}
          <div
            style={{
              display: 'flex',
              gap: '0.2rem',
              background: '#0f172a',
              padding: '3px',
              borderRadius: '6px',
            }}
          >
            {(['all', 'unique', 'shared', 'metadata', 'corrupted', 'free'] as const).map((f) => {
              const isActive = blockFilter === f
              const activeBg = FILTER_ACTIVE_COLORS[f] ?? '#38bdf8'
              const count = stateCounts[f] ?? 0

              return (
                <button
                  key={f}
                  onClick={() => {
                    setBlockFilter(f)
                    if (f !== 'all') {
                      // Check if currently selected block already matches
                      const currMatches =
                        selectedBlockId !== null &&
                        selectedBlockId >= 0 &&
                        selectedBlockId < gridBlocks.length &&
                        (GRID_STATE_MAP[gridBlocks[selectedBlockId]] ?? 'free') === f

                      if (!currMatches) {
                        const matchIdx = gridBlocks.findIndex(
                          (s) => (GRID_STATE_MAP[s] ?? 'free') === f
                        )
                        if (matchIdx !== -1) {
                          setSelectedBlockId(matchIdx)
                        }
                      }
                    }
                  }}
                  style={{
                    padding: '4px 10px',
                    borderRadius: '4px',
                    fontSize: '0.74rem',
                    fontWeight: 600,
                    border: 'none',
                    cursor: 'pointer',
                    background: isActive ? activeBg : 'transparent',
                    color: isActive ? '#0f172a' : '#94a3b8',
                    transition: 'all 0.15s ease',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px',
                  }}
                >
                  <span>{f.charAt(0).toUpperCase() + f.slice(1)}</span>
                  {count > 0 && (
                    <span
                      style={{
                        fontSize: '0.66rem',
                        padding: '1px 5px',
                        borderRadius: '999px',
                        background: isActive ? 'rgba(0,0,0,0.22)' : 'rgba(255,255,255,0.08)',
                        color: isActive ? '#0f172a' : '#94a3b8',
                        fontWeight: 700,
                      }}
                    >
                      {count}
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        </div>

        {/* View Mode & Link Controls */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
          {/* 75% Partial Dedup Viva Demo Button */}
          <button
            onClick={() => setShow75Modal(true)}
            style={{
              background: 'linear-gradient(135deg, rgba(124, 58, 237, 0.22) 0%, rgba(2, 132, 199, 0.22) 100%)',
              border: '1px solid rgba(168, 85, 247, 0.55)',
              color: theme === 'light' ? '#6b21a8' : '#e9d5ff',
              padding: '4px 11px',
              borderRadius: '6px',
              fontSize: '0.75rem',
              fontWeight: 700,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              boxShadow: '0 0 10px rgba(168, 85, 247, 0.25)',
              transition: 'all 0.15s ease',
            }}
            title="Viva Defense: How AeroFS handles files with 75% identical blocks"
          >
            <span>🎨</span> 75% Dedup Viva Demo
          </button>

          {/* View mode switcher */}
          {!use2DFallback && (
            <div
              style={{
                display: 'flex',
                background: theme === 'light' ? '#e2e8f0' : '#0f172a',
                padding: '2px',
                borderRadius: '6px',
                border: theme === 'light' ? '1px solid #cbd5e1' : '1px solid #334155',
              }}
            >
              {(
                [
                  { id: 'dedup', label: '🗄️ File Deduplication' },
                  { id: 'matrix', label: '🧊 3D Matrix' },
                  { id: 'drive', label: '💽 Hard Drive' },
                ] as const
              ).map((mode) => (
                <button
                  key={mode.id}
                  onClick={() => setViewMode(mode.id)}
                  style={{
                    padding: '4px 9px',
                    borderRadius: '4px',
                    fontSize: '0.75rem',
                    fontWeight: 600,
                    border: 'none',
                    cursor: 'pointer',
                    background:
                      viewMode === mode.id
                        ? theme === 'light'
                          ? '#ffffff'
                          : '#334155'
                        : 'transparent',
                    color:
                      viewMode === mode.id
                        ? theme === 'light'
                          ? '#0284c7'
                          : '#38bdf8'
                        : theme === 'light'
                        ? '#64748b'
                        : '#94a3b8',
                    boxShadow: viewMode === mode.id && theme === 'light' ? '0 1px 3px rgba(0,0,0,0.1)' : undefined,
                    transition: 'all 0.15s ease',
                  }}
                >
                  {mode.label}
                </button>
              ))}
            </div>
          )}

          {/* Links visibility selector */}
          {!use2DFallback && (
            <select
              value={linkMode}
              onChange={(e) => setLinkMode(e.target.value as any)}
              style={{
                background: theme === 'light' ? '#ffffff' : '#0f172a',
                border: theme === 'light' ? '1px solid #cbd5e1' : '1px solid #334155',
                color:
                  theme === 'light'
                    ? linkMode === 'shared'
                      ? '#7c3aed'
                      : '#0f172a'
                    : linkMode === 'shared'
                    ? '#c084fc'
                    : '#cbd5e1',
                padding: '4px 8px',
                borderRadius: '4px',
                fontSize: '0.75rem',
                fontWeight: 600,
                cursor: 'pointer',
              }}
              title="Filter connection beams from files to the hard drive"
            >
              <option value="shared">🔗 Dedup Convergences Only</option>
              <option value="all">⚡ All File Links</option>
              <option value="selected">🎯 Selected Block Only</option>
              <option value="off">Off (No Links)</option>
            </select>
          )}

          {/* Search block ID */}
          <form onSubmit={handleSearch} style={{ display: 'flex', gap: '0.25rem' }}>
            <input
              type="number"
              min="0"
              max={(telemetry?.disk.total_blocks ?? 4096) - 1}
              placeholder="Block ID #..."
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              style={{
                background: theme === 'light' ? '#ffffff' : '#0f172a',
                border: theme === 'light' ? '1px solid #cbd5e1' : '1px solid #334155',
                color: theme === 'light' ? '#0f172a' : '#fff',
                padding: '4px 8px',
                borderRadius: '4px',
                fontSize: '0.78rem',
                width: '95px',
              }}
            />
            <button
              type="submit"
              style={{
                background: theme === 'light' ? '#0284c7' : '#334155',
                color: '#ffffff',
                border: 'none',
                padding: '4px 9px',
                borderRadius: '4px',
                fontSize: '0.78rem',
                cursor: 'pointer',
                fontWeight: 600,
              }}
            >
              Go
            </button>
          </form>

          {/* Center Camera */}
          {!use2DFallback && (
            <button
              onClick={() => setCameraResetCounter((c) => c + 1)}
              style={{
                background: theme === 'light' ? '#ffffff' : '#1e293b',
                color: theme === 'light' ? '#0f172a' : '#94a3b8',
                border: theme === 'light' ? '1px solid #cbd5e1' : '1px solid #334155',
                padding: '4px 10px',
                borderRadius: '4px',
                fontSize: '0.78rem',
                cursor: 'pointer',
                fontWeight: 600,
              }}
              title="Reset 3D camera"
            >
              🎯 Center
            </button>
          )}

          {/* 2D / 3D toggle */}
          <button
            onClick={() => setUse2DFallback(!use2DFallback)}
            style={{
              background: use2DFallback ? (theme === 'light' ? '#7c3aed' : '#8b5cf6') : (theme === 'light' ? '#ffffff' : '#1e293b'),
              color: use2DFallback ? '#fff' : (theme === 'light' ? '#0f172a' : '#fff'),
              border: theme === 'light' ? '1px solid #cbd5e1' : '1px solid #475569',
              padding: '4px 12px',
              borderRadius: '4px',
              fontSize: '0.78rem',
              cursor: 'pointer',
              fontWeight: 600,
            }}
          >
            {use2DFallback ? '🧊 Switch to 3D' : '▦ 2D View'}
          </button>
        </div>
      </div>

      {/* Main 3D Viewport */}
      <div
        style={{
          flex: 1,
          position: 'relative',
          background: theme === 'light' ? '#f1f5f9' : '#0a0f1d',
          borderRadius: '8px',
          overflow: 'hidden',
          border: '1px solid var(--border-dim)',
          minHeight: '520px',
        }}
      >
        {use2DFallback || webglError ? (
          <div style={{ padding: '1.5rem', height: '100%', overflowY: 'auto' }}>
            <div style={{ marginBottom: '1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
              <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                Displaying 2D Flat Matrix (4,096 blocks): Click any block to inspect details
              </span>
              {blockFilter !== 'all' && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span
                    style={{
                      fontSize: '0.75rem',
                      fontWeight: 600,
                      padding: '3px 9px',
                      borderRadius: '12px',
                      background: blockFilter === 'shared' ? 'rgba(168, 85, 247, 0.18)' : 'rgba(56, 189, 248, 0.18)',
                      color: blockFilter === 'shared' ? '#c084fc' : '#38bdf8',
                      border: `1px solid ${blockFilter === 'shared' ? '#a855f7' : '#38bdf8'}`,
                    }}
                  >
                    Active Filter: {blockFilter.toUpperCase()} ({stateCounts[blockFilter]} blocks highlighted)
                  </span>
                  <button
                    onClick={() => setBlockFilter('all')}
                    style={{
                      background: 'none',
                      border: '1px solid var(--border-dim)',
                      borderRadius: '4px',
                      padding: '2px 8px',
                      fontSize: '0.72rem',
                      color: 'var(--text-secondary)',
                      cursor: 'pointer',
                    }}
                  >
                    Reset to All
                  </button>
                </div>
              )}
            </div>
            <BlockGrid2D gridBlocks={gridBlocks} highlightIds={highlightedBlockIds} filter={blockFilter} />
          </div>
        ) : (
          <>
            <Canvas
              camera={{ position: [0, 4, 38], fov: 45 }}
              onCreated={({ gl }) => {
                if (!gl) setWebglError(true)
              }}
              style={{ width: '100%', height: '100%' }}
            >
              <ambientLight intensity={theme === 'light' ? 1.0 : 0.85} />
              <pointLight position={[20, 30, 25]} intensity={1.4} />
              <pointLight position={[-20, 20, 20]} intensity={1.1} />
              <pointLight position={[0, -20, 15]} intensity={0.5} />

              <Suspense fallback={null}>
                {/* ── Left Side: Logical Files OR 3D Matrix ─────────────────── */}
                {viewMode === 'dedup' ? (
                  <LogicalFiles3D
                    files={files}
                    gridBlocks={gridBlocks}
                    selectedBlockId={selectedBlockId}
                    hoveredBlockId={hoveredId}
                    filter={blockFilter}
                    onSelectBlock={(id) => setSelectedBlockId(id)}
                    onHoverBlock={(id) => setHoveredId(id)}
                    onSelectFile={(name) => setSelectedFileName(name)}
                    theme={theme}
                  />
                ) : viewMode === 'matrix' ? (
                  <InstancedBlocks
                    gridBlocks={gridBlocks}
                    filter={blockFilter}
                    highlightIds={highlightedBlockIds}
                    selectedId={selectedBlockId}
                    cubeOffsetX={CUBE_OFFSET_X}
                    theme={theme}
                    onSelectBlock={(id) => setSelectedBlockId(id)}
                    onHoverBlock={(id) => setHoveredId(id)}
                  />
                ) : null}

                {/* ── Right Side: Enterprise Hard Drive with Vertical Blocks ── */}
                <HardDrive3D
                  position={[HARD_DRIVE_POS.x, HARD_DRIVE_POS.y, HARD_DRIVE_POS.z]}
                  gridBlocks={gridBlocks}
                  selectedBlockId={selectedBlockId}
                  hoveredBlockId={hoveredId}
                  highlightedBlockIds={highlightedBlockIds}
                  filter={blockFilter}
                  theme={theme}
                  onSelectBlock={(id) => setSelectedBlockId(id)}
                  onHoverBlock={(id) => setHoveredId(id)}
                />

                {/* ── Center: Beams Connecting Files to Hard Drive Blocks ─────── */}
                <HardDriveLinks
                  files={files}
                  gridBlocks={gridBlocks}
                  selectedBlockId={selectedBlockId}
                  hoveredBlockId={hoveredId}
                  linkMode={linkMode}
                  filter={blockFilter}
                />
              </Suspense>

              <OrbitControls
                enableDamping
                dampingFactor={0.08}
                maxDistance={140}
                minDistance={5}
              />
              <SceneCameraController viewMode={viewMode} resetTrigger={cameraResetCounter} />
            </Canvas>

            {/* Active Filter Pill Badge (Top-Right of 3D Viewport) */}
            {blockFilter !== 'all' && (
              <div
                style={{
                  position: 'absolute',
                  top: 16,
                  right: 16,
                  background: 'rgba(15, 23, 42, 0.88)',
                  backdropFilter: 'blur(10px)',
                  border: `1px solid ${FILTER_ACTIVE_COLORS[blockFilter] ?? '#38bdf8'}`,
                  padding: '5px 12px',
                  borderRadius: '20px',
                  fontSize: '0.76rem',
                  color: '#ffffff',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  boxShadow: `0 0 16px ${
                    blockFilter === 'shared'
                      ? 'rgba(168, 85, 247, 0.45)'
                      : blockFilter === 'unique'
                      ? 'rgba(16, 185, 129, 0.45)'
                      : 'rgba(56, 189, 248, 0.45)'
                  }`,
                  zIndex: 10,
                }}
              >
                <span
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: '50%',
                    background: FILTER_ACTIVE_COLORS[blockFilter] ?? '#38bdf8',
                    boxShadow: `0 0 6px ${FILTER_ACTIVE_COLORS[blockFilter] ?? '#38bdf8'}`,
                  }}
                />
                <span>
                  Highlighting: <strong>{blockFilter.toUpperCase()}</strong> ({stateCounts[blockFilter]} blocks)
                </span>
                <button
                  onClick={() => setBlockFilter('all')}
                  style={{
                    background: 'rgba(255,255,255,0.15)',
                    border: 'none',
                    borderRadius: '50%',
                    width: '16px',
                    height: '16px',
                    color: '#fff',
                    cursor: 'pointer',
                    fontSize: '0.65rem',
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: 0,
                    lineHeight: 1,
                  }}
                  title="Clear filter (Show All)"
                >
                  ✕
                </button>
              </div>
            )}

            {/* Hover Tooltip Overlay (Top-Left) */}
            {hoveredId !== null && hoveredState && (
              <div
                style={{
                  position: 'absolute',
                  top: 16,
                  left: 16,
                  background: 'var(--bg-card)',
                  backdropFilter: 'blur(10px)',
                  padding: '0.6rem 0.9rem',
                  borderRadius: '6px',
                  border: '1px solid var(--border-dim)',
                  boxShadow: '0 8px 24px rgba(0,0,0,0.3)',
                  pointerEvents: 'none',
                  zIndex: 10,
                }}
              >
                <div
                  style={{
                    fontSize: '0.85rem',
                    fontWeight: 700,
                    color: 'var(--text-primary)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem',
                  }}
                >
                  <span
                    style={{
                      display: 'inline-block',
                      width: 10,
                      height: 10,
                      borderRadius: '50%',
                      background:
                        (theme === 'light' ? BLOCK_STATE_COLORS_LIGHT : BLOCK_STATE_COLORS)[
                          hoveredState
                        ],
                    }}
                  />
                  Physical Block #{hoveredId}
                </div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: 4 }}>
                  State:{' '}
                  <strong
                    style={{
                      color:
                        (theme === 'light' ? BLOCK_STATE_COLORS_LIGHT : BLOCK_STATE_COLORS)[
                          hoveredState
                        ],
                    }}
                  >
                    {BLOCK_STATE_LABELS[hoveredState]}
                  </strong>
                </div>
                <div style={{ fontSize: '0.7rem', color: '#38bdf8', marginTop: 2 }}>
                  Hard Drive Location: Column #{hoveredId % GRID_COLS}, Row #{Math.floor(hoveredId / GRID_COLS)}
                </div>
                {hoveredState === 'shared' && (
                  <div style={{ fontSize: '0.7rem', color: '#c084fc', marginTop: 2 }}>
                    🔗 CAS Deduplicated: Multiple files point to this single block on the drive!
                  </div>
                )}
                {hoveredState === 'snapshot' && (
                  <div style={{ fontSize: '0.7rem', color: '#fbbf24', marginTop: 2 }}>
                    📷 Snapshot Protected: Preserved on disk by point-in-time snapshot (Zero-Copy CoW)!
                  </div>
                )}
                {hoveredState === 'free' && (
                  <div style={{ fontSize: '0.7rem', color: '#34d399', marginTop: 2 }}>
                    🟢 Free Block: Reclaimed hole available for Best-Fit reallocation!
                  </div>
                )}
              </div>
            )}

            {/* Deduplicated Files Panel (Top-Right) */}
            <SharedBlocksPanel files={files} theme={theme} />

            {/* Hard Drive Hardware Telemetry HUD (Bottom-Right) */}
            <HardDriveHUD
              activeBlockId={activeBlockId}
              gridBlocks={gridBlocks}
              files={files}
              disk={telemetry?.disk}
              theme={theme}
            />

            {/* Color Legend Overlay (Bottom-Left) */}
            <div
              style={{
                position: 'absolute',
                bottom: 16,
                left: 16,
                background: 'var(--bg-card)',
                backdropFilter: 'blur(8px)',
                padding: '0.5rem 0.8rem',
                borderRadius: '6px',
                border: '1px solid var(--border-dim)',
                display: 'flex',
                gap: '0.9rem',
                alignItems: 'center',
                fontSize: '0.75rem',
                zIndex: 10,
                flexWrap: 'wrap',
              }}
            >
              {(['metadata', 'unique', 'shared', 'snapshot', 'corrupted', 'free'] as const).map((s) => (
                <div key={s} style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                  <span
                    style={{
                      width: 10,
                      height: 10,
                      borderRadius: '2px',
                      background: (theme === 'light' ? BLOCK_STATE_COLORS_LIGHT : BLOCK_STATE_COLORS)[s],
                    }}
                  />
                  <span style={{ color: 'var(--text-secondary)' }}>{BLOCK_STATE_LABELS[s]}</span>
                </div>
              ))}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.35rem',
                  borderLeft: '1px solid rgba(255,255,255,0.1)',
                  paddingLeft: '0.75rem',
                }}
              >
                <span style={{ fontSize: '0.85rem' }}>🔗</span>
                <span style={{ color: '#c084fc' }}>= Shared Physical Block</span>
              </div>
            </div>
          </>
        )}
      </div>

      {/* 75% Partial Block Deduplication Modal */}
      <PartialDedupModal
        isOpen={show75Modal}
        onClose={() => setShow75Modal(false)}
        onDeployed={(sharedBlocks) => {
          setViewMode('dedup')
          setUse2DFallback(false)
          if (sharedBlocks.length > 0) setSelectedBlockId(sharedBlocks[0])
        }}
        theme={theme}
      />
    </div>
  )
}
