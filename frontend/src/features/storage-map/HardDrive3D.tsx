import React, { useRef, useMemo, useEffect } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import {
  GRID_STATE_MAP,
  BLOCK_STATE_COLORS,
  BLOCK_STATE_COLORS_LIGHT,
  type BlockState,
} from '../../api/types'

export const HARD_DRIVE_POS = new THREE.Vector3(12, 0, 0)
export const GRID_COLS = 64
export const GRID_ROWS = 64
export const CELL_SIZE = 0.28
export const CELL_GAP = 0.04
export const CELL_STEP = CELL_SIZE + CELL_GAP // 0.32

/**
 * Calculates world coordinates of any physical block (0..4095)
 * on the vertical front face of the Hard Drive.
 */
export function getHardDriveBlockCoords(
  id: number,
  driveCenter: THREE.Vector3 = HARD_DRIVE_POS
): THREE.Vector3 {
  const safeId = Math.max(0, Math.min(4095, id))
  const col = safeId % GRID_COLS
  const row = Math.floor(safeId / GRID_COLS)

  const localX = (col - (GRID_COLS - 1) / 2) * CELL_STEP
  // Must subtract 0.6 to match instancedMesh parent group offset position={[0, -0.6, 0]}
  const localY = ((GRID_ROWS - 1) / 2 - row) * CELL_STEP - 0.6
  // Front face of block (lz=1.88 + 0.12/2 = 1.94)
  const localZ = 1.95

  return new THREE.Vector3(
    driveCenter.x + localX,
    driveCenter.y + localY,
    driveCenter.z + localZ
  )
}

interface HardDrive3DProps {
  position?: [number, number, number]
  gridBlocks: number[]
  selectedBlockId: number | null
  hoveredBlockId: number | null
  highlightedBlockIds?: Set<number>
  theme: 'dark' | 'light'
  onSelectBlock: (id: number) => void
  onHoverBlock: (id: number | null) => void
}

export default function HardDrive3D({
  position = [12, 0, 0],
  gridBlocks,
  selectedBlockId,
  hoveredBlockId,
  highlightedBlockIds = new Set(),
  theme,
  onSelectBlock,
  onHoverBlock,
}: HardDrive3DProps) {
  const meshRef = useRef<THREE.InstancedMesh>(null)
  const dummy = useMemo(() => new THREE.Object3D(), [])
  const color = useMemo(() => new THREE.Color(), [])
  const activityLedRef = useRef<THREE.MeshBasicMaterial>(null)

  const total = gridBlocks.length || 4096

  // Count shared blocks
  const sharedCount = useMemo(() => {
    return gridBlocks.filter((s) => s === 3).length
  }, [gridBlocks])

  // Update instanced blocks on the hard drive face
  useEffect(() => {
    if (!meshRef.current) return
    const palette = theme === 'light' ? BLOCK_STATE_COLORS_LIGHT : BLOCK_STATE_COLORS

    for (let i = 0; i < total; i++) {
      const stateCode = gridBlocks[i] ?? 0
      const stateName: BlockState = GRID_STATE_MAP[stateCode] ?? 'free'

      const isSelected = selectedBlockId === i
      const isHovered = hoveredBlockId === i
      const isHighlighted = highlightedBlockIds.has(i)

      const col = i % GRID_COLS
      const row = Math.floor(i / GRID_COLS)

      const lx = (col - (GRID_COLS - 1) / 2) * CELL_STEP
      const ly = ((GRID_ROWS - 1) / 2 - row) * CELL_STEP
      const lz = 1.88

      dummy.position.set(lx, ly, lz)

      if (isSelected) {
        dummy.scale.set(1.6, 1.6, 2.5)
      } else if (isHovered || isHighlighted) {
        dummy.scale.set(1.35, 1.35, 1.8)
      } else if (stateName === 'shared') {
        dummy.scale.set(1.15, 1.15, 1.3)
      } else if (stateName === 'free') {
        dummy.scale.set(0.85, 0.85, 0.7)
      } else {
        dummy.scale.set(1.0, 1.0, 1.0)
      }

      dummy.updateMatrix()
      meshRef.current.setMatrixAt(i, dummy.matrix)

      // Color selection
      if (isSelected) {
        color.set('#ffffff')
      } else if (isHovered || isHighlighted) {
        color.set('#38bdf8')
      } else if (stateName === 'shared') {
        color.set('#c084fc') // Vibrant purple for deduplicated blocks
      } else if (stateName === 'free') {
        color.set(theme === 'light' ? '#cbd5e1' : '#1e293b')
      } else {
        color.set(palette[stateName] || '#64748b')
      }

      meshRef.current.setColorAt(i, color)
    }

    meshRef.current.instanceMatrix.needsUpdate = true
    if (meshRef.current.instanceColor) {
      meshRef.current.instanceColor.needsUpdate = true
    }
  }, [gridBlocks, selectedBlockId, hoveredBlockId, highlightedBlockIds, total, dummy, color, theme])

  // LED blink animation
  useFrame(({ clock }) => {
    if (activityLedRef.current) {
      const t = clock.getElapsedTime()
      // Pulse activity LED
      const intensity = 0.5 + 0.5 * Math.sin(t * 6)
      activityLedRef.current.opacity = 0.4 + 0.6 * intensity
    }
  })

  // Pointer & click handlers
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
    <group position={position}>
      {/* ── 1. Enterprise Hard Drive Main Chassis ───────────────────────────── */}
      {/* Outer aluminum drive enclosure */}
      <mesh position={[0, 0, 0]} castShadow receiveShadow>
        <boxGeometry args={[23.6, 26.2, 3.6]} />
        <meshStandardMaterial
          color={theme === 'light' ? '#e2e8f0' : '#0b1120'}
          metalness={0.88}
          roughness={0.22}
        />
      </mesh>

      {/* Outer Metallic Bevel Rim */}
      <mesh position={[0, 0, 1.7]}>
        <boxGeometry args={[23.0, 25.6, 0.2]} />
        <meshStandardMaterial
          color={theme === 'light' ? '#94a3b8' : '#1e293b'}
          metalness={0.92}
          roughness={0.15}
        />
      </mesh>

      {/* Recessed Block Bay (the dark inner tray where vertical blocks sit) */}
      <mesh position={[0, -0.6, 1.8]}>
        <boxGeometry args={[21.4, 21.4, 0.1]} />
        <meshStandardMaterial
          color={theme === 'light' ? '#f1f5f9' : '#020617'}
          metalness={0.5}
          roughness={0.8}
        />
      </mesh>

      {/* ── 2. Top Header Label & Drive Branding ────────────────────────────── */}
      <mesh position={[0, 11.3, 1.82]}>
        <boxGeometry args={[21.4, 2.2, 0.1]} />
        <meshStandardMaterial
          color={theme === 'light' ? '#cbd5e1' : '#0f172a'}
          metalness={0.7}
          roughness={0.3}
        />
      </mesh>

      {/* Drive Status LEDs */}
      {/* Power LED (Cyan) */}
      <mesh position={[-8.8, 11.3, 1.92]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.2, 0.2, 0.15, 16]} />
        <meshBasicMaterial color="#38bdf8" />
      </mesh>
      {/* CAS Dedup Status LED (Purple) */}
      <mesh position={[-7.8, 11.3, 1.92]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.2, 0.2, 0.15, 16]} />
        <meshBasicMaterial
          ref={activityLedRef}
          color={sharedCount > 0 ? '#c084fc' : '#475569'}
          transparent
          opacity={0.9}
        />
      </mesh>
      {/* Seek Activity LED (Green) */}
      <mesh position={[-6.8, 11.3, 1.92]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.2, 0.2, 0.15, 16]} />
        <meshBasicMaterial color="#22c55e" />
      </mesh>

      {/* ── 3. Four Corner Mounting Hex Screws ──────────────────────────────── */}
      {[
        [-10.8, -12.0],
        [10.8, -12.0],
        [-10.8, 12.0],
        [10.8, 12.0],
      ].map(([sx, sy], i) => (
        <mesh key={i} position={[sx, sy, 1.82]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.42, 0.42, 0.2, 6]} />
          <meshStandardMaterial color="#94a3b8" metalness={0.95} roughness={0.1} />
        </mesh>
      ))}

      {/* ── 4. Bottom SATA / SAS Connector Ports ────────────────────────────── */}
      <group position={[0, -13.2, 0]}>
        <mesh position={[-3.5, 0, 0]}>
          <boxGeometry args={[6.0, 0.6, 1.2]} />
          <meshStandardMaterial color="#b45309" metalness={0.9} roughness={0.2} />
        </mesh>
        <mesh position={[4.0, 0, 0]}>
          <boxGeometry args={[4.5, 0.6, 1.2]} />
          <meshStandardMaterial color="#1e293b" metalness={0.8} roughness={0.3} />
        </mesh>
      </group>

      {/* ── 5. The Vertical Physical Block Matrix (4,096 blocks) ─────────────── */}
      <group position={[0, -0.6, 0]}>
        <instancedMesh
          ref={meshRef}
          args={[undefined, undefined, total]}
          onClick={handleClick}
          onPointerMove={handlePointerMove}
          onPointerOut={handlePointerOut}
        >
          <boxGeometry args={[CELL_SIZE, CELL_SIZE, 0.12]} />
          <meshStandardMaterial roughness={0.35} metalness={0.25} />
        </instancedMesh>
      </group>

    </group>
  )
}
