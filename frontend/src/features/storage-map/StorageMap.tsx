import React, { useRef, useMemo, useState, useEffect, Suspense } from 'react'
import { Canvas, useThree } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import * as THREE from 'three'
import { useQuery } from '@tanstack/react-query'
import { getTelemetry } from '../../api/client'
import { useStore } from '../../state/store'
import {
  GRID_STATE_MAP,
  BLOCK_STATE_COLORS,
  BLOCK_STATE_COLORS_LIGHT,
  BLOCK_STATE_LABELS,
  type BlockState,
  type FileView,
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
function SharedBlocksPanel({ files }: { files: FileView[] }) {
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
        background: 'rgba(10, 15, 29, 0.92)',
        backdropFilter: 'blur(12px)',
        border: '1px solid rgba(168, 85, 247, 0.5)',
        borderRadius: 8,
        padding: '0.75rem',
        zIndex: 10,
        boxShadow: '0 8px 32px rgba(168, 85, 247, 0.25)',
        transition: 'all 0.2s ease',
      }}
    >
      <div
        style={{
          fontSize: '0.78rem',
          fontWeight: 700,
          color: '#c084fc',
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
        <span style={{ fontSize: '0.7rem', color: '#94a3b8' }}>
          {collapsed ? '▶' : '▼'}
        </span>
      </div>

      {!collapsed && (
        <>
          <div style={{ fontSize: '0.71rem', color: '#94a3b8', margin: '6px 0 8px 0' }}>
            Duplicate files share physical blocks via CAS. Purple beams show both files pointing to the same block on the Hard Drive!
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 180, overflowY: 'auto' }}>
            {sharedPairs.map((pair, i) => (
              <div
                key={i}
                style={{
                  background: 'rgba(168, 85, 247, 0.1)',
                  border: '1px solid rgba(168, 85, 247, 0.3)',
                  borderRadius: 6,
                  padding: '6px 8px',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap', marginBottom: 2 }}>
                  {pair.files.map((f, fi) => (
                    <React.Fragment key={f}>
                      <span
                        style={{
                          background: 'rgba(168, 85, 247, 0.25)',
                          color: '#f3e8ff',
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
                        <span style={{ color: '#c084fc', fontWeight: 700 }}>↔</span>
                      )}
                    </React.Fragment>
                  ))}
                </div>
                <div style={{ fontSize: '0.67rem', color: '#c084fc' }}>
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
}: {
  activeBlockId: number | null
  gridBlocks: number[]
  files: FileView[]
}) {
  const activeCol = activeBlockId !== null ? activeBlockId % GRID_COLS : null
  const activeRow = activeBlockId !== null ? Math.floor(activeBlockId / GRID_COLS) : null

  const isShared = activeBlockId !== null && gridBlocks[activeBlockId] === 3
  const isSnapshot = activeBlockId !== null && gridBlocks[activeBlockId] === 5

  // Owners of active block
  const owners = useMemo(() => {
    if (activeBlockId === null) return []
    return files.filter((f) => f.block_ids?.includes(activeBlockId)).map((f) => f.name)
  }, [activeBlockId, files])

  return (
    <div
      style={{
        position: 'absolute',
        bottom: 16,
        right: 16,
        width: 320,
        background: 'rgba(10, 15, 29, 0.94)',
        backdropFilter: 'blur(12px)',
        border: `1px solid ${isShared ? 'rgba(168, 85, 247, 0.5)' : isSnapshot ? 'rgba(245, 158, 11, 0.5)' : 'rgba(56, 189, 248, 0.35)'}`,
        borderRadius: 8,
        padding: '0.8rem',
        zIndex: 10,
        boxShadow: '0 8px 32px rgba(0, 0, 0, 0.5)',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 8,
          borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
          paddingBottom: 6,
        }}
      >
        <span style={{ fontSize: '0.82rem', fontWeight: 700, color: '#38bdf8', display: 'flex', alignItems: 'center', gap: 6 }}>
          <span>💽</span> Enterprise Hard Drive (Physical Layer)
        </span>
        <span
          style={{
            fontSize: '0.68rem',
            padding: '2px 6px',
            borderRadius: 4,
            background: 'rgba(56, 189, 248, 0.15)',
            color: '#7dd3fc',
            fontFamily: 'monospace',
          }}
        >
          SATA 6 Gb/s
        </span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px', fontSize: '0.72rem', color: '#94a3b8' }}>
        <div>
          Vertical Grid: <strong style={{ color: '#f8fafc' }}>64 Col × 64 Row</strong>
        </div>
        <div>
          Capacity: <strong style={{ color: '#f8fafc' }}>4,096 Blocks (16 MiB)</strong>
        </div>
        <div>
          Column: <strong style={{ color: activeCol !== null ? '#38bdf8' : '#94a3b8' }}>
            {activeCol !== null ? `Col #${activeCol}` : '—'}
          </strong>
        </div>
        <div>
          Row: <strong style={{ color: activeRow !== null ? '#38bdf8' : '#94a3b8' }}>
            {activeRow !== null ? `Row #${activeRow}` : '—'}
          </strong>
        </div>
      </div>

      {activeBlockId !== null && (
        <div
          style={{
            marginTop: 8,
            padding: '6px 8px',
            background: isShared
              ? 'rgba(168, 85, 247, 0.18)'
              : isSnapshot
              ? 'rgba(245, 158, 11, 0.15)'
              : 'rgba(56, 189, 248, 0.1)',
            border: `1px solid ${
              isShared
                ? 'rgba(168, 85, 247, 0.5)'
                : isSnapshot
                ? 'rgba(245, 158, 11, 0.5)'
                : 'rgba(56, 189, 248, 0.3)'
            }`,
            borderRadius: 6,
          }}
        >
          <div
            style={{
              fontSize: '0.74rem',
              fontWeight: 700,
              color: isShared ? '#c084fc' : isSnapshot ? '#fbbf24' : '#38bdf8',
              marginBottom: 2,
            }}
          >
            Physical Block #{activeBlockId}{' '}
            {isShared && '🔗 [CAS DEDUPLICATED]'}
            {isSnapshot && '📷 [SNAPSHOT PROTECTED]'}
          </div>
          <div style={{ fontSize: '0.69rem', color: '#cbd5e1' }}>
            {isShared ? (
              <span>
                Both duplicate files point to this single block on the drive:{' '}
                <strong style={{ color: '#f3e8ff' }}>{owners.join(' & ')}</strong>
                <div style={{ color: '#a855f7', marginTop: 2, fontWeight: 600 }}>
                  ✓ 1 Physical Block Shared via CAS ({owners.length} file references)
                </div>
              </span>
            ) : isSnapshot ? (
              <span>
                <strong style={{ color: '#fbbf24' }}>📷 Preserved on disk by Snapshot:</strong>
                <div style={{ color: '#cbd5e1', marginTop: 2 }}>
                  {owners.length > 0 ? (
                    <span>Active File: <strong style={{ color: '#38bdf8' }}>{owners.join(', ')}</strong></span>
                  ) : (
                    <span>Historical extent retained on disk (live file modified via CoW)</span>
                  )}
                </div>
                <div style={{ color: '#f59e0b', marginTop: 2, fontWeight: 600 }}>
                  ✓ Zero-Copy CoW · Block preserved without duplication
                </div>
              </span>
            ) : owners.length > 0 ? (
              <span>Owner: <strong style={{ color: '#38bdf8' }}>{owners.join(', ')}</strong></span>
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

  const activeBlockId = hoveredId !== null ? hoveredId : selectedBlockId

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
            {(['all', 'unique', 'shared', 'metadata', 'corrupted', 'free'] as const).map((f) => (
              <button
                key={f}
                onClick={() => setBlockFilter(f)}
                style={{
                  padding: '4px 9px',
                  borderRadius: '4px',
                  fontSize: '0.74rem',
                  fontWeight: 600,
                  border: 'none',
                  cursor: 'pointer',
                  background:
                    blockFilter === f ? (f === 'shared' ? '#a855f7' : '#38bdf8') : 'transparent',
                  color: blockFilter === f ? '#0f172a' : '#94a3b8',
                  transition: 'all 0.15s ease',
                }}
              >
                {f.charAt(0).toUpperCase() + f.slice(1)}
              </button>
            ))}
          </div>
        </div>

        {/* View Mode & Link Controls */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
          {/* View mode switcher */}
          {!use2DFallback && (
            <div
              style={{
                display: 'flex',
                background: '#0f172a',
                padding: '2px',
                borderRadius: '6px',
                border: '1px solid #334155',
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
                    background: viewMode === mode.id ? '#334155' : 'transparent',
                    color: viewMode === mode.id ? '#38bdf8' : '#94a3b8',
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
                background: '#0f172a',
                border: '1px solid #334155',
                color: linkMode === 'shared' ? '#c084fc' : '#cbd5e1',
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
                background: '#0f172a',
                border: '1px solid #334155',
                color: '#fff',
                padding: '4px 8px',
                borderRadius: '4px',
                fontSize: '0.78rem',
                width: '95px',
              }}
            />
            <button
              type="submit"
              style={{
                background: '#334155',
                color: '#f8fafc',
                border: 'none',
                padding: '4px 9px',
                borderRadius: '4px',
                fontSize: '0.78rem',
                cursor: 'pointer',
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
                background: '#1e293b',
                color: '#94a3b8',
                border: '1px solid #334155',
                padding: '4px 10px',
                borderRadius: '4px',
                fontSize: '0.78rem',
                cursor: 'pointer',
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
              background: use2DFallback ? '#8b5cf6' : '#1e293b',
              color: '#fff',
              border: '1px solid #475569',
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
            <div style={{ marginBottom: '1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                Displaying 2D Flat Matrix (4,096 blocks): Click any block to inspect details
              </span>
            </div>
            <BlockGrid2D gridBlocks={gridBlocks} highlightIds={highlightedBlockIds} />
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
              </div>
            )}

            {/* Deduplicated Files Panel (Top-Right) */}
            <SharedBlocksPanel files={files} />

            {/* Hard Drive Hardware Telemetry HUD (Bottom-Right) */}
            <HardDriveHUD
              activeBlockId={activeBlockId}
              gridBlocks={gridBlocks}
              files={files}
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
    </div>
  )
}
