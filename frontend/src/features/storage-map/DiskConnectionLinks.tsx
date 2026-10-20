import React, { useRef, useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import type { FileView } from '../../api/types'
import { getDiskCoords, DEFAULT_DISK_CENTER, DEFAULT_DISK_TILT } from './PhysicalDisk3D'

const COLS = 16
const DEPTH = 16
const SPACING = 1.6

/** Get coordinates of a block inside the 3D cube */
export function getCubeCoords(id: number, cubeOffsetX: number = -16): THREE.Vector3 {
  const safeId = Math.max(0, Math.min(4095, id))
  const x = (safeId % COLS) - COLS / 2
  const z = (Math.floor(safeId / COLS) % DEPTH) - DEPTH / 2
  const y = Math.floor(safeId / (COLS * DEPTH)) - (4096 / (COLS * DEPTH)) / 2
  return new THREE.Vector3(cubeOffsetX + x * SPACING, y * SPACING, z * SPACING)
}

/** Individual animated 3D arc line between cube and disk */
function ConnectionBeam({
  start,
  end,
  color = '#8b5cf6',
  speed = 2.0,
  minOpacity = 0.3,
  maxOpacity = 0.9,
  arcElevation = 6,
}: {
  start: THREE.Vector3
  end: THREE.Vector3
  color?: string
  speed?: number
  minOpacity?: number
  maxOpacity?: number
  arcElevation?: number
}) {
  const t = useRef(Math.random() * Math.PI * 2)

  const lineObj = useMemo(() => {
    // Elevated 3D Bezier curve bridging from cube to disk
    const mid = start.clone().lerp(end, 0.5)
    mid.y += Math.max(arcElevation, start.distanceTo(end) * 0.35)
    const curve = new THREE.QuadraticBezierCurve3(start, mid, end)
    const pts = curve.getPoints(36)
    const geometry = new THREE.BufferGeometry().setFromPoints(pts)
    const mat = new THREE.LineBasicMaterial({
      color: new THREE.Color(color),
      transparent: true,
      opacity: minOpacity,
      linewidth: 1,
    })
    const line = new THREE.Line(geometry, mat)
    return { line, mat }
  }, [start, end, color, arcElevation, minOpacity])

  useFrame((_, delta) => {
    t.current += delta * speed
    lineObj.mat.opacity = minOpacity + (maxOpacity - minOpacity) * (0.5 + 0.5 * Math.sin(t.current))
  })

  return <primitive object={lineObj.line} />
}

/** Animated glowing beacon on the physical disk platter where links land */
function PlatterConvergenceBeacon({
  position,
  color = '#c084fc',
}: {
  position: THREE.Vector3
  color?: string
}) {
  const meshRef = useRef<THREE.Mesh>(null)
  const t = useRef(Math.random() * Math.PI * 2)

  useFrame((_, delta) => {
    if (!meshRef.current) return
    t.current += delta * 3.5
    const s = 1.0 + 0.45 * Math.sin(t.current)
    meshRef.current.scale.set(s, s, s)
    const mat = meshRef.current.material as THREE.MeshBasicMaterial
    if (mat) {
      mat.opacity = 0.4 + 0.5 * (0.5 + 0.5 * Math.sin(t.current))
    }
  })

  return (
    <mesh ref={meshRef} position={position}>
      <torusGeometry args={[0.6, 0.08, 8, 20]} />
      <meshBasicMaterial color={color} transparent opacity={0.7} />
    </mesh>
  )
}

interface DiskConnectionLinksProps {
  cubeOffsetX?: number
  diskCenter?: THREE.Vector3
  diskTilt?: number
  files: FileView[]
  gridBlocks: number[]
  selectedBlockId: number | null
  hoveredBlockId: number | null
  highlightedBlockIds?: Set<number>
  linkMode: 'shared' | 'all' | 'selected' | 'off'
}

export default function DiskConnectionLinks({
  cubeOffsetX = -16,
  diskCenter = DEFAULT_DISK_CENTER,
  diskTilt = DEFAULT_DISK_TILT,
  files,
  gridBlocks,
  selectedBlockId,
  hoveredBlockId,
  highlightedBlockIds = new Set(),
  linkMode,
}: DiskConnectionLinksProps) {
  if (linkMode === 'off') return null

  // Map: block_id -> list of file names referencing it
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

  // Active targeted block (selected or hovered)
  const activeBlockId = hoveredBlockId !== null ? hoveredBlockId : selectedBlockId

  // 1. Shared / Deduplicated block links:
  // For each shared block, multiple files point to this block in the logical cube.
  // We draw a link from each file anchor in the cube -> the SAME physical sector on disk!
  const sharedConvergences = useMemo(() => {
    if (linkMode !== 'shared' && linkMode !== 'all') return []

    const links: {
      key: string
      start: THREE.Vector3
      end: THREE.Vector3
      blockId: number
      color: string
      fileName: string
    }[] = []

    const destinations = new Set<number>()

    for (const [blockId, owners] of blockOwners) {
      // Shared block condition: 2 or more files or marked state 3 in grid
      const isSharedState = gridBlocks[blockId] === 3 || owners.length >= 2
      if (!isSharedState) continue

      const diskTarget = getDiskCoords(blockId, diskCenter, diskTilt)
      destinations.add(blockId)

      // Draw an incoming beam from each owning file
      for (const fileName of owners) {
        const file = files.find((f) => f.name === fileName)
        if (!file || !file.block_ids || file.block_ids.length === 0) continue

        // Use the block itself or the file's primary block in the cube as origin
        const originBlockId = file.block_ids.includes(blockId) ? blockId : file.block_ids[0]
        const cubeOrigin = getCubeCoords(originBlockId, cubeOffsetX)

        links.push({
          key: `${fileName}->block${blockId}`,
          start: cubeOrigin,
          end: diskTarget,
          blockId,
          color: '#a855f7', // vibrant purple for CAS dedup convergence
          fileName,
        })

        if (links.length >= 48) break
      }
      if (links.length >= 48) break
    }

    return links
  }, [blockOwners, files, gridBlocks, linkMode, cubeOffsetX, diskCenter, diskTilt])

  // 2. Selected or Hovered Block Laser Tracer
  const activeTracer = useMemo(() => {
    if (activeBlockId === null) return null
    const start = getCubeCoords(activeBlockId, cubeOffsetX)
    const end = getDiskCoords(activeBlockId, diskCenter, diskTilt)
    const isShared = gridBlocks[activeBlockId] === 3 || (blockOwners.get(activeBlockId)?.length ?? 0) >= 2
    return {
      start,
      end,
      blockId: activeBlockId,
      color: isShared ? '#c084fc' : '#38bdf8',
    }
  }, [activeBlockId, cubeOffsetX, diskCenter, diskTilt, gridBlocks, blockOwners])

  // 3. Highlighted File Blocks Links (when a file is clicked, e.g. highlightedBlockIds is populated)
  const highlightedLinks = useMemo(() => {
    if (highlightedBlockIds.size === 0) return []
    const list: { start: THREE.Vector3; end: THREE.Vector3; blockId: number }[] = []
    let count = 0
    for (const bid of highlightedBlockIds) {
      if (count++ >= 16) break
      list.push({
        start: getCubeCoords(bid, cubeOffsetX),
        end: getDiskCoords(bid, diskCenter, diskTilt),
        blockId: bid,
      })
    }
    return list
  }, [highlightedBlockIds, cubeOffsetX, diskCenter, diskTilt])

  // Unique convergence destinations for beacons on platter
  const beaconPositions = useMemo(() => {
    const coords: THREE.Vector3[] = []
    const seen = new Set<number>()

    for (const lk of sharedConvergences) {
      if (!seen.has(lk.blockId)) {
        seen.add(lk.blockId)
        coords.push(lk.end)
      }
    }
    return coords
  }, [sharedConvergences])

  return (
    <group>
      {/* ── CAS Deduplication Convergence Beams ─────────────────────────────── */}
      {(linkMode === 'shared' || linkMode === 'all') &&
        sharedConvergences.map((lk) => (
          <ConnectionBeam
            key={lk.key}
            start={lk.start}
            end={lk.end}
            color={lk.color}
            speed={2.2}
            minOpacity={0.35}
            maxOpacity={0.9}
            arcElevation={7}
          />
        ))}

      {/* Pulsing convergence beacons on physical disk platter */}
      {(linkMode === 'shared' || linkMode === 'all') &&
        beaconPositions.map((pos, i) => (
          <PlatterConvergenceBeacon key={i} position={pos} color="#c084fc" />
        ))}

      {/* ── Active Selected / Hovered Tracer Beam ──────────────────────────── */}
      {activeTracer && (
        <>
          <ConnectionBeam
            start={activeTracer.start}
            end={activeTracer.end}
            color={activeTracer.color}
            speed={4.0}
            minOpacity={0.6}
            maxOpacity={1.0}
            arcElevation={8}
          />
          <PlatterConvergenceBeacon position={activeTracer.end} color={activeTracer.color} />
        </>
      )}

      {/* ── File Highlighted Block Beams ───────────────────────────────────── */}
      {highlightedLinks.map((lk) => (
        <ConnectionBeam
          key={`hl-${lk.blockId}`}
          start={lk.start}
          end={lk.end}
          color="#38bdf8"
          speed={3.0}
          minOpacity={0.4}
          maxOpacity={0.85}
          arcElevation={6}
        />
      ))}
    </group>
  )
}
