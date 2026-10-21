import React, { useRef, useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import type { FileView } from '../../api/types'
import { getHardDriveBlockCoords, HARD_DRIVE_POS } from './HardDrive3D'
import { getFileBlockCoords } from './LogicalFiles3D'

/** Clean animated 3D laser line between file block and hard drive block */
function DynamicBeam({
  start,
  end,
  color = '#a855f7',
  speed = 2.5,
  minOpacity = 0.5,
  maxOpacity = 1.0,
}: {
  start: THREE.Vector3
  end: THREE.Vector3
  color?: string
  speed?: number
  minOpacity?: number
  maxOpacity?: number
}) {
  const t = useRef(Math.random() * Math.PI * 2)

  const lineObj = useMemo(() => {
    // Gentle 3D curve with subtle forward arc for depth, landing exactly on the block
    const mid = start.clone().lerp(end, 0.5)
    mid.z += 0.8 // Subtle 0.8 forward lift so the beam doesn't clip flat surfaces
    const curve = new THREE.QuadraticBezierCurve3(start, mid, end)
    const pts = curve.getPoints(32)
    const geometry = new THREE.BufferGeometry().setFromPoints(pts)
    const mat = new THREE.LineBasicMaterial({
      color: new THREE.Color(color),
      transparent: true,
      opacity: minOpacity,
      linewidth: 2,
    })
    const line = new THREE.Line(geometry, mat)
    return { line, mat }
  }, [start, end, color, minOpacity])

  useFrame((_, delta) => {
    t.current += delta * speed
    lineObj.mat.opacity =
      minOpacity + (maxOpacity - minOpacity) * (0.5 + 0.5 * Math.sin(t.current))
  })

  return <primitive object={lineObj.line} />
}

interface HardDriveLinksProps {
  files: FileView[]
  gridBlocks: number[]
  selectedBlockId: number | null
  hoveredBlockId: number | null
  linkMode: 'shared' | 'all' | 'selected' | 'off'
}

export default function HardDriveLinks({
  files,
  gridBlocks,
  selectedBlockId,
  hoveredBlockId,
  linkMode,
}: HardDriveLinksProps) {
  if (linkMode === 'off') return null

  const activeBlockId = hoveredBlockId !== null ? hoveredBlockId : selectedBlockId

  // Map: block_id -> list of file indices and their block chunk indices
  const blockFileMap = useMemo(() => {
    const map = new Map<number, { fileIndex: number; blockIndex: number; fileName: string }[]>()
    files.forEach((file, fIdx) => {
      file.block_ids?.forEach((bid, bIdx) => {
        if (!map.has(bid)) map.set(bid, [])
        map.get(bid)!.push({ fileIndex: fIdx, blockIndex: bIdx, fileName: file.name })
      })
    })
    return map
  }, [files])

  // Build convergence links:
  // For each shared block, draw a beam from EACH referencing file's block
  // directly to the ONE single physical block on the Hard Drive!
  const links = useMemo(() => {
    const result: {
      key: string
      start: THREE.Vector3
      end: THREE.Vector3
      blockId: number
      color: string
      isShared: boolean
      fileName: string
    }[] = []

    for (const [blockId, refs] of blockFileMap) {
      const isShared = refs.length >= 2 || gridBlocks[blockId] === 3
      const isSelected = activeBlockId === blockId

      // Filter by linkMode
      if (linkMode === 'selected' && !isSelected) continue
      if (linkMode === 'shared' && !isShared && !isSelected) continue

      // Exact world coordinates of the physical block on the Hard Drive
      const hardDriveTarget = getHardDriveBlockCoords(blockId, HARD_DRIVE_POS)

      // Draw a line from EACH file referencing this block
      for (const ref of refs) {
        // Exact world coordinates of the file's logical block
        const fileStart = getFileBlockCoords(
          ref.fileIndex,
          files.length,
          ref.blockIndex
        )

        let beamColor = isShared ? '#a855f7' : '#0284c7'
        if (isSelected) beamColor = '#38bdf8'
        else if (isShared) beamColor = '#c084fc'

        result.push({
          key: `${ref.fileName}-b${blockId}-${ref.blockIndex}`,
          start: fileStart,
          end: hardDriveTarget,
          blockId,
          color: beamColor,
          isShared,
          fileName: ref.fileName,
        })
      }
    }

    return result
  }, [blockFileMap, files, gridBlocks, activeBlockId, linkMode])

  return (
    <group>
      {/* ── Convergence Beams from Files to Hard Drive Blocks (Direct & Circle-Free) ── */}
      {links.map((lk) => (
        <DynamicBeam
          key={lk.key}
          start={lk.start}
          end={lk.end}
          color={lk.color}
          speed={lk.isShared ? 3.2 : 2.0}
          minOpacity={lk.isShared ? 0.5 : 0.3}
          maxOpacity={lk.isShared ? 1.0 : 0.8}
        />
      ))}
    </group>
  )
}
