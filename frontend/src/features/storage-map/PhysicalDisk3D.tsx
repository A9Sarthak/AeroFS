import React, { useRef, useMemo, useEffect } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import {
  GRID_STATE_MAP,
  BLOCK_STATE_COLORS,
  BLOCK_STATE_COLORS_LIGHT,
  type BlockState,
} from '../../api/types'

export const DISK_INNER_R = 3.2
export const DISK_OUTER_R = 9.2
export const TRACKS_COUNT = 32
export const SECTORS_PER_TRACK = 128 // 32 * 128 = 4096 blocks

export const DEFAULT_DISK_CENTER = new THREE.Vector3(18, 0, 0)
export const DEFAULT_DISK_TILT = 0.32 // ~18 degrees tilt towards camera

/** Calculate world coordinates of any physical block on the platter */
export function getDiskCoords(
  id: number,
  diskCenter: THREE.Vector3 = DEFAULT_DISK_CENTER,
  tilt: number = DEFAULT_DISK_TILT
): THREE.Vector3 {
  const safeId = Math.max(0, Math.min(4095, id))
  const track = Math.floor(safeId / SECTORS_PER_TRACK) // 0..31
  const sector = safeId % SECTORS_PER_TRACK // 0..127

  const r = DISK_INNER_R + (track / (TRACKS_COUNT - 1)) * (DISK_OUTER_R - DISK_INNER_R)
  const angle = (sector / SECTORS_PER_TRACK) * Math.PI * 2

  const localX = r * Math.cos(angle)
  const localZ = r * Math.sin(angle)
  const localY = 0.55 // top surface of platter

  // Rotate around X by tilt
  const tiltedY = localY * Math.cos(tilt) - localZ * Math.sin(tilt)
  const tiltedZ = localY * Math.sin(tilt) + localZ * Math.cos(tilt)

  return new THREE.Vector3(
    diskCenter.x + localX,
    diskCenter.y + tiltedY,
    diskCenter.z + tiltedZ
  )
}

interface PhysicalDisk3DProps {
  position?: [number, number, number]
  tilt?: number
  gridBlocks: number[]
  selectedBlockId: number | null
  hoveredBlockId: number | null
  highlightedBlockIds?: Set<number>
  theme: 'dark' | 'light'
  onSelectBlock: (id: number) => void
  onHoverBlock: (id: number | null) => void
}

export default function PhysicalDisk3D({
  position = [18, 0, 0],
  tilt = DEFAULT_DISK_TILT,
  gridBlocks,
  selectedBlockId,
  hoveredBlockId,
  highlightedBlockIds = new Set(),
  theme,
  onSelectBlock,
  onHoverBlock,
}: PhysicalDisk3DProps) {
  const platterRef = useRef<THREE.Group>(null)
  const armRef = useRef<THREE.Group>(null)
  const ledRef = useRef<THREE.MeshBasicMaterial>(null)
  const currentArmAngle = useRef(0)

  // Calculate target track for actuator arm
  const activeBlockId = hoveredBlockId !== null ? hoveredBlockId : selectedBlockId
  const targetTrack = useMemo(() => {
    if (activeBlockId === null) return 8
    return Math.floor(activeBlockId / SECTORS_PER_TRACK)
  }, [activeBlockId])

  // Map track (0..31) to arm rotation angle (radians)
  // Arm pivots from outer edge to inner edge
  const targetArmAngle = useMemo(() => {
    const ratio = Math.max(0, Math.min(1, targetTrack / (TRACKS_COUNT - 1)))
    // When ratio = 0 (inner track), arm rotates deeper in; ratio = 1 (outer track), arm rests further out
    return -0.15 + ratio * 0.38
  }, [targetTrack])

  // Concentric track guide circles
  const trackGuides = useMemo(() => {
    const guides: number[] = []
    for (let t = 0; t < TRACKS_COUNT; t += 4) {
      guides.push(DISK_INNER_R + (t / (TRACKS_COUNT - 1)) * (DISK_OUTER_R - DISK_INNER_R))
    }
    guides.push(DISK_OUTER_R)
    return guides
  }, [])

  // Instanced markers for allocated blocks on platter
  const allocatedInstances = useMemo(() => {
    const list: { id: number; r: number; angle: number; state: BlockState }[] = []
    const total = gridBlocks.length || 4096
    for (let i = 0; i < total; i++) {
      const stateCode = gridBlocks[i] ?? 0
      const stateName: BlockState = GRID_STATE_MAP[stateCode] ?? 'free'
      if (stateName !== 'free') {
        const track = Math.floor(i / SECTORS_PER_TRACK)
        const sector = i % SECTORS_PER_TRACK
        const r = DISK_INNER_R + (track / (TRACKS_COUNT - 1)) * (DISK_OUTER_R - DISK_INNER_R)
        const angle = (sector / SECTORS_PER_TRACK) * Math.PI * 2
        list.push({ id: i, r, angle, state: stateName })
      }
    }
    return list
  }, [gridBlocks])

  // Animate platter spin and actuator arm seek
  useFrame((_, delta) => {
    // Subtle realistic platter spin (visual rotation around platter center)
    if (platterRef.current) {
      platterRef.current.rotation.y += delta * 1.5
    }

    // Smooth actuator arm seek
    if (armRef.current) {
      currentArmAngle.current = THREE.MathUtils.lerp(
        currentArmAngle.current,
        targetArmAngle,
        Math.min(1, delta * 12)
      )
      armRef.current.rotation.y = currentArmAngle.current

      // Blink seek LED when arm is actively moving
      if (ledRef.current) {
        const diff = Math.abs(currentArmAngle.current - targetArmAngle)
        ledRef.current.color.set(diff > 0.02 ? '#22c55e' : '#38bdf8')
      }
    }
  })

  // Selected or hovered target position on platter (in local platter coordinates)
  const targetSectorLocal = useMemo(() => {
    if (activeBlockId === null) return null
    const track = Math.floor(activeBlockId / SECTORS_PER_TRACK)
    const sector = activeBlockId % SECTORS_PER_TRACK
    const r = DISK_INNER_R + (track / (TRACKS_COUNT - 1)) * (DISK_OUTER_R - DISK_INNER_R)
    const angle = (sector / SECTORS_PER_TRACK) * Math.PI * 2
    return new THREE.Vector3(r * Math.cos(angle), 0.58, r * Math.sin(angle))
  }, [activeBlockId])

  const palette = theme === 'light' ? BLOCK_STATE_COLORS_LIGHT : BLOCK_STATE_COLORS

  return (
    <group position={position} rotation={[tilt, 0, 0]}>
      {/* ── 1. Drive Chassis Base Plate ─────────────────────────────────────────── */}
      <mesh position={[0, -0.6, 0]} receiveShadow>
        <boxGeometry args={[22, 1.2, 22]} />
        <meshStandardMaterial
          color={theme === 'light' ? '#cbd5e1' : '#0b1120'}
          metalness={0.85}
          roughness={0.25}
        />
      </mesh>

      {/* Chassis Top Rim Bevel */}
      <mesh position={[0, 0.05, 0]}>
        <boxGeometry args={[21.4, 0.15, 21.4]} />
        <meshStandardMaterial
          color={theme === 'light' ? '#94a3b8' : '#1e293b'}
          metalness={0.9}
          roughness={0.2}
        />
      </mesh>

      {/* Recessed Platter Well */}
      <mesh position={[0, 0.1, 0]}>
        <cylinderGeometry args={[10.2, 10.2, 0.25, 48]} />
        <meshStandardMaterial
          color={theme === 'light' ? '#64748b' : '#020617'}
          metalness={0.8}
          roughness={0.5}
        />
      </mesh>

      {/* Mounting Screws in 4 corners of chassis */}
      {[
        [-9.8, -9.8],
        [9.8, -9.8],
        [-9.8, 9.8],
        [9.8, 9.8],
      ].map(([sx, sz], i) => (
        <mesh key={i} position={[sx, 0.12, sz]}>
          <cylinderGeometry args={[0.5, 0.5, 0.2, 16]} />
          <meshStandardMaterial color="#94a3b8" metalness={0.95} roughness={0.1} />
        </mesh>
      ))}

      {/* ── 2. Spinning Platter Group ───────────────────────────────────────────── */}
      <group ref={platterRef}>
        {/* Main Mirror Platter */}
        <mesh position={[0, 0.35, 0]}>
          <cylinderGeometry args={[DISK_OUTER_R + 0.5, DISK_OUTER_R + 0.5, 0.2, 64]} />
          <meshStandardMaterial
            color={theme === 'light' ? '#f1f5f9' : '#e2e8f0'}
            metalness={0.98}
            roughness={0.12}
            envMapIntensity={1.5}
          />
        </mesh>

        {/* Concentric Magnetic Track Rings */}
        {trackGuides.map((r, i) => (
          <mesh key={i} position={[0, 0.46, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <ringGeometry args={[r - 0.02, r + 0.02, 64]} />
            <meshBasicMaterial
              color={theme === 'light' ? '#94a3b8' : '#64748b'}
              transparent
              opacity={0.35}
            />
          </mesh>
        ))}

        {/* Allocated Block Markers on Platter Surface */}
        {allocatedInstances.map((item) => {
          const isSelected = selectedBlockId === item.id
          const isHovered = hoveredBlockId === item.id
          const isHighlighted = highlightedBlockIds.has(item.id)
          const px = item.r * Math.cos(item.angle)
          const pz = item.r * Math.sin(item.angle)

          let color = palette[item.state] || '#38bdf8'
          let size = 0.22
          if (isSelected) {
            color = '#ffffff'
            size = 0.45
          } else if (isHovered || isHighlighted) {
            color = '#38bdf8'
            size = 0.38
          } else if (item.state === 'shared') {
            color = '#c084fc'
            size = 0.3
          }

          return (
            <mesh
              key={item.id}
              position={[px, 0.48, pz]}
              onClick={(e) => {
                e.stopPropagation()
                onSelectBlock(item.id)
              }}
              onPointerOver={(e) => {
                e.stopPropagation()
                onHoverBlock(item.id)
              }}
              onPointerOut={() => onHoverBlock(null)}
            >
              <cylinderGeometry args={[size, size, 0.08, 12]} />
              <meshBasicMaterial color={color} />
            </mesh>
          )
        })}
      </group>

      {/* ── 3. Spindle Hub Center Assembly (Static center axle) ──────────────────── */}
      <mesh position={[0, 0.5, 0]}>
        <cylinderGeometry args={[DISK_INNER_R - 0.4, DISK_INNER_R - 0.4, 0.45, 32]} />
        <meshStandardMaterial
          color={theme === 'light' ? '#e2e8f0' : '#475569'}
          metalness={0.95}
          roughness={0.15}
        />
      </mesh>
      {/* Spindle Center Retaining Cap */}
      <mesh position={[0, 0.75, 0]}>
        <cylinderGeometry args={[1.2, 1.2, 0.15, 24]} />
        <meshStandardMaterial color="#cbd5e1" metalness={0.98} roughness={0.1} />
      </mesh>

      {/* ── 4. Actuator Pivot Base & Magnet ─────────────────────────────────────── */}
      {/* Voice Coil Magnet Assembly (top-left chassis corner) */}
      <group position={[-8.2, 0.2, -7.5]}>
        {/* Neodymium Magnet Housing */}
        <mesh position={[0, 0.3, 0]}>
          <boxGeometry args={[4.2, 0.8, 3.2]} />
          <meshStandardMaterial color="#334155" metalness={0.9} roughness={0.2} />
        </mesh>
        {/* Copper Voice Coil Accents */}
        <mesh position={[1.2, 0.3, 0]}>
          <boxGeometry args={[1.4, 0.4, 2.4]} />
          <meshStandardMaterial color="#b45309" metalness={0.8} roughness={0.3} />
        </mesh>
        {/* Actuator Pivot Bearing Tower */}
        <mesh position={[1.5, 0.7, 1.2]}>
          <cylinderGeometry args={[1.1, 1.3, 1.4, 24]} />
          <meshStandardMaterial color="#94a3b8" metalness={0.95} roughness={0.15} />
        </mesh>

        {/* ── 5. Pivoting Actuator Arm ────────────────────────────────────────── */}
        <group ref={armRef} position={[1.5, 1.2, 1.2]}>
          {/* Main Arm Beam (extends out over the platter) */}
          <mesh position={[4.8, 0.05, 3.8]} rotation={[0, -0.65, 0]}>
            <boxGeometry args={[8.8, 0.12, 0.65]} />
            <meshStandardMaterial
              color={theme === 'light' ? '#94a3b8' : '#e2e8f0'}
              metalness={0.95}
              roughness={0.15}
            />
          </mesh>

          {/* Thin Flexible Head Gimbal Suspension Tip */}
          <mesh position={[8.4, 0.02, 6.2]} rotation={[0, -0.65, 0]}>
            <boxGeometry args={[2.0, 0.04, 0.3]} />
            <meshStandardMaterial color="#cbd5e1" metalness={0.99} roughness={0.05} />
          </mesh>

          {/* Read/Write Slider Magnetic Head (directly above platter surface) */}
          <mesh position={[9.2, -0.1, 6.7]}>
            <boxGeometry args={[0.3, 0.2, 0.2]} />
            <meshStandardMaterial color="#0f172a" metalness={0.8} roughness={0.3} />
          </mesh>

          {/* Activity/Seek Micro-LED on arm */}
          <mesh position={[1.5, 0.12, 1.2]}>
            <sphereGeometry args={[0.15, 12, 12]} />
            <meshBasicMaterial ref={ledRef} color="#38bdf8" />
          </mesh>
        </group>
      </group>

      {/* ── 6. Active Target Beacon / Reticle on Platter ─────────────────────────── */}
      {targetSectorLocal && (
        <group position={[targetSectorLocal.x, targetSectorLocal.y, targetSectorLocal.z]}>
          {/* Pulsing Target Torus */}
          <TargetBeacon color={activeBlockId !== null && (gridBlocks[activeBlockId] === 3) ? '#c084fc' : '#38bdf8'} />
        </group>
      )}

      {/* ── 7. Platter Overlay Title Badge in 3D ────────────────────────────────── */}
      <group position={[0, 0.2, 12.2]}>
        <mesh>
          <planeGeometry args={[14, 1.6]} />
          <meshBasicMaterial color="#020617" transparent opacity={0.7} />
        </mesh>
      </group>
    </group>
  )
}

/** Animated pulsing ring reticle on the targeted physical sector */
function TargetBeacon({ color }: { color: string }) {
  const meshRef = useRef<THREE.Mesh>(null)
  const t = useRef(0)

  useFrame((_, delta) => {
    if (!meshRef.current) return
    t.current += delta * 4
    const s = 1.0 + 0.35 * Math.sin(t.current)
    meshRef.current.scale.set(s, 1, s)
    if ((meshRef.current.material as THREE.MeshBasicMaterial).opacity !== undefined) {
      ;(meshRef.current.material as THREE.MeshBasicMaterial).opacity =
        0.4 + 0.5 * (0.5 + 0.5 * Math.sin(t.current))
    }
  })

  return (
    <mesh ref={meshRef} rotation={[-Math.PI / 2, 0, 0]}>
      <ringGeometry args={[0.35, 0.55, 24]} />
      <meshBasicMaterial color={color} transparent opacity={0.8} />
    </mesh>
  )
}
