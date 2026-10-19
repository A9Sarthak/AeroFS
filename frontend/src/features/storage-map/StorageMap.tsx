import React, { useRef, useMemo, useState, useEffect, Suspense } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
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
  type BlockState
} from '../../api/types'
import BlockGrid2D from './BlockGrid2D'

// 16 x 16 x 16 = 4096 blocks
const COLS = 16
const DEPTH = 16
const SPACING = 1.6
const BOX_SIZE = 1.0

interface BlockMeshProps {
  gridBlocks: number[]
  filter: string
  highlightIds: Set<number>
  selectedId: number | null
  theme: 'dark' | 'light'
  onSelectBlock: (id: number) => void
  onHoverBlock: (id: number | null, event?: React.MouseEvent) => void
}

function InstancedBlocks({
  gridBlocks,
  filter,
  highlightIds,
  selectedId,
  theme,
  onSelectBlock,
  onHoverBlock,
}: BlockMeshProps) {
  const meshRef = useRef<THREE.InstancedMesh>(null)
  const dummy = useMemo(() => new THREE.Object3D(), [])
  const color = useMemo(() => new THREE.Color(), [])

  const total = gridBlocks.length || 4096

  // Coordinate computation
  const getCoords = (id: number) => {
    const x = (id % COLS) - COLS / 2
    const z = (Math.floor(id / COLS) % DEPTH) - DEPTH / 2
    const y = Math.floor(id / (COLS * DEPTH)) - (4096 / (COLS * DEPTH)) / 2
    return { x: x * SPACING, y: y * SPACING, z: z * SPACING }
  }

  // Update instance matrices and colors
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

      const { x, y, z } = getCoords(i)
      dummy.position.set(x, y, z)

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

      // Color
      if (isSelected) {
        color.set(theme === 'light' ? '#0f172a' : '#ffffff')
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
  }, [gridBlocks, filter, highlightIds, selectedId, total, dummy, color, theme])

  // Click & pointer handling
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

function SceneCameraReset({ trigger }: { trigger: number }) {
  const { camera } = useThree()
  useEffect(() => {
    if (trigger > 0) {
      camera.position.set(24, 20, 30)
      camera.lookAt(0, 0, 0)
    }
  }, [trigger, camera])
  return null
}

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
  const theme = useStore((s) => s.theme)

  const [hoveredId, setHoveredId] = useState<number | null>(null)
  const [searchInput, setSearchInput] = useState('')
  const [cameraResetCounter, setCameraResetCounter] = useState(0)
  const [webglError, setWebglError] = useState(false)

  const gridBlocks = telemetry?.grid_blocks ?? []

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    const id = parseInt(searchInput.trim(), 10)
    if (!isNaN(id) && id >= 0 && id < (telemetry?.disk.total_blocks ?? 4096)) {
      setSelectedBlockId(id)
    }
  }

  const hoveredStateCode = hoveredId !== null ? gridBlocks[hoveredId] : undefined
  const hoveredState = hoveredStateCode !== undefined ? (GRID_STATE_MAP[hoveredStateCode] ?? 'free') : null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: '1rem' }}>
      {/* Header controls bar */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: '0.75rem',
        padding: '0.75rem 1rem',
        background: 'var(--bg-card)',
        borderRadius: '8px',
        border: '1px solid var(--border-dim)'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <div>
            <h2 style={{ fontSize: '1.15rem', fontWeight: 700, margin: 0 }}>🧊 3D Storage Map</h2>
            <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>
              4,096 Physical Blocks (16×16×16 spatial matrix) · 4 KiB/block
            </div>
          </div>

          {/* Filter tabs */}
          <div style={{ display: 'flex', gap: '0.25rem', background: '#0f172a', padding: '3px', borderRadius: '6px' }}>
            {(['all', 'unique', 'shared', 'metadata', 'corrupted', 'free'] as const).map((f) => (
              <button
                key={f}
                onClick={() => setBlockFilter(f)}
                style={{
                  padding: '4px 10px',
                  borderRadius: '4px',
                  fontSize: '0.75rem',
                  fontWeight: 600,
                  border: 'none',
                  cursor: 'pointer',
                  background: blockFilter === f ? '#38bdf8' : 'transparent',
                  color: blockFilter === f ? '#0f172a' : '#94a3b8',
                  transition: 'all 0.15s ease'
                }}
              >
                {f.charAt(0).toUpperCase() + f.slice(1)}
              </button>
            ))}
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
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
                fontSize: '0.8rem',
                width: '110px'
              }}
            />
            <button
              type="submit"
              style={{
                background: '#334155',
                color: '#f8fafc',
                border: 'none',
                padding: '4px 10px',
                borderRadius: '4px',
                fontSize: '0.8rem',
                cursor: 'pointer'
              }}
            >
              Go
            </button>
          </form>

          {/* Reset camera */}
          <button
            onClick={() => setCameraResetCounter((c) => c + 1)}
            style={{
              background: '#1e293b',
              color: '#94a3b8',
              border: '1px solid #334155',
              padding: '4px 10px',
              borderRadius: '4px',
              fontSize: '0.8rem',
              cursor: 'pointer'
            }}
            title="Reset 3D camera to default orbit view"
          >
            🎯 Center
          </button>

          {/* 2D / 3D view toggle */}
          <button
            onClick={() => setUse2DFallback(!use2DFallback)}
            style={{
              background: use2DFallback ? '#8b5cf6' : '#1e293b',
              color: '#fff',
              border: '1px solid #475569',
              padding: '4px 12px',
              borderRadius: '4px',
              fontSize: '0.8rem',
              cursor: 'pointer',
              fontWeight: 600
            }}
          >
            {use2DFallback ? '🧊 Switch to 3D' : '▦ 2D View'}
          </button>
        </div>
      </div>

      {/* Main Map Area */}
      <div style={{
        flex: 1,
        position: 'relative',
        background: theme === 'light' ? '#f1f5f9' : '#0a0f1d',
        borderRadius: '8px',
        overflow: 'hidden',
        border: '1px solid var(--border-dim)',
        minHeight: '480px'
      }}>
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
              camera={{ position: [24, 20, 30], fov: 45 }}
              onCreated={({ gl }) => {
                if (!gl) setWebglError(true)
              }}
              style={{ width: '100%', height: '100%' }}
            >
              <ambientLight intensity={theme === 'light' ? 1.0 : 0.8} />
              <pointLight position={[30, 40, 30]} intensity={1.2} />
              <pointLight position={[-30, -30, -30]} intensity={0.4} />

              <Suspense fallback={null}>
                <InstancedBlocks
                  gridBlocks={gridBlocks}
                  filter={blockFilter}
                  highlightIds={highlightedBlockIds}
                  selectedId={selectedBlockId}
                  theme={theme}
                  onSelectBlock={(id) => setSelectedBlockId(id)}
                  onHoverBlock={(id) => setHoveredId(id)}
                />
              </Suspense>

              <OrbitControls
                enableDamping
                dampingFactor={0.08}
                maxDistance={120}
                minDistance={5}
              />
              <SceneCameraReset trigger={cameraResetCounter} />
            </Canvas>

            {/* Hover Tooltip Overlay */}
            {hoveredId !== null && hoveredState && (
              <div style={{
                position: 'absolute',
                top: 16,
                left: 16,
                background: 'var(--bg-card)',
                backdropFilter: 'blur(8px)',
                padding: '0.6rem 0.9rem',
                borderRadius: '6px',
                border: '1px solid var(--border-dim)',
                boxShadow: '0 8px 24px rgba(0,0,0,0.25)',
                pointerEvents: 'none',
                zIndex: 10
              }}>
                <div style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <span style={{
                    display: 'inline-block',
                    width: 10,
                    height: 10,
                    borderRadius: '50%',
                    background: (theme === 'light' ? BLOCK_STATE_COLORS_LIGHT : BLOCK_STATE_COLORS)[hoveredState]
                  }} />
                  Block #{hoveredId}
                </div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: 4 }}>
                  State: <strong style={{ color: (theme === 'light' ? BLOCK_STATE_COLORS_LIGHT : BLOCK_STATE_COLORS)[hoveredState] }}>
                    {BLOCK_STATE_LABELS[hoveredState]}
                  </strong>
                </div>
                <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: 2 }}>
                  Click to inspect in Right Panel
                </div>
              </div>
            )}

            {/* Legend Overlay at bottom */}
            <div style={{
              position: 'absolute',
              bottom: 16,
              left: 16,
              background: 'var(--bg-card)',
              backdropFilter: 'blur(6px)',
              padding: '0.5rem 0.8rem',
              borderRadius: '6px',
              border: '1px solid var(--border-dim)',
              display: 'flex',
              gap: '1rem',
              alignItems: 'center',
              fontSize: '0.75rem',
              zIndex: 10
            }}>
              {(['metadata', 'unique', 'shared', 'corrupted', 'free'] as const).map((s) => (
                <div key={s} style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                  <span style={{
                    width: 10,
                    height: 10,
                    borderRadius: '2px',
                    background: (theme === 'light' ? BLOCK_STATE_COLORS_LIGHT : BLOCK_STATE_COLORS)[s]
                  }} />
                  <span style={{ color: 'var(--text-secondary)' }}>{BLOCK_STATE_LABELS[s]}</span>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
