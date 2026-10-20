import React, { useRef, useMemo } from 'react'
import { Text } from '@react-three/drei'
import * as THREE from 'three'
import type { FileView } from '../../api/types'

export const FILES_BASE_X = -12.5
export const FILE_SPACING_Y = 5.2

/**
 * Returns exact world coordinates of a file's logical block.
 */
export function getFileBlockCoords(
  fileIndex: number,
  totalFiles: number,
  blockIndex: number,
  baseX: number = FILES_BASE_X
): THREE.Vector3 {
  const yCenter = ((totalFiles - 1) / 2 - fileIndex) * FILE_SPACING_Y
  const bx = baseX - 2.8 + blockIndex * 1.3
  const by = yCenter - 0.6
  const bz = 0.525 // Exact front surface of the logical block tile
  return new THREE.Vector3(bx, by, bz)
}

interface LogicalFiles3DProps {
  files: FileView[]
  gridBlocks: number[]
  selectedBlockId: number | null
  hoveredBlockId: number | null
  onSelectBlock: (id: number) => void
  onHoverBlock: (id: number | null) => void
  onSelectFile?: (fileName: string) => void
  theme: 'dark' | 'light'
}

export default function LogicalFiles3D({
  files,
  gridBlocks,
  selectedBlockId,
  hoveredBlockId,
  onSelectBlock,
  onHoverBlock,
  onSelectFile,
  theme,
}: LogicalFiles3DProps) {
  // Map of shared blocks
  const sharedBlockIds = useMemo(() => {
    const ids = new Set<number>()
    const countMap = new Map<number, number>()
    for (const f of files) {
      for (const b of f.block_ids ?? []) {
        countMap.set(b, (countMap.get(b) ?? 0) + 1)
      }
    }
    for (const [bid, cnt] of countMap) {
      if (cnt >= 2 || gridBlocks[bid] === 3) ids.add(bid)
    }
    return ids
  }, [files, gridBlocks])

  const activeId = hoveredBlockId !== null ? hoveredBlockId : selectedBlockId

  return (
    <group>
      {/* Section Title Header in 3D */}
      <group position={[FILES_BASE_X, ((files.length || 1) * FILE_SPACING_Y) / 2 + 1.8, 0]}>
        <Text
          fontSize={0.9}
          color="#38bdf8"
          anchorX="center"
          anchorY="middle"
          fontWeight="bold"
        >
          LOGICAL FILESYSTEM (INODES)
        </Text>
        <Text
          position={[0, -0.65, 0]}
          fontSize={0.5}
          color="#94a3b8"
          anchorX="center"
          anchorY="middle"
        >
          Files point to Physical Hard Drive blocks via CAS
        </Text>
      </group>

      {/* Render each File Entity */}
      {files.map((file, fileIdx) => {
        const yCenter = ((files.length - 1) / 2 - fileIdx) * FILE_SPACING_Y
        const hasShared = file.block_ids?.some((b) => sharedBlockIds.has(b))

        return (
          <group key={file.name} position={[FILES_BASE_X, yCenter, 0]}>
            {/* ── File Card Container Frame ─────────────────────────────────── */}
            <mesh
              position={[0, 0, 0]}
              onClick={() => onSelectFile?.(file.name)}
            >
              <boxGeometry args={[9.6, 4.0, 0.3]} />
              <meshStandardMaterial
                color={
                  hasShared
                    ? theme === 'light'
                      ? '#f5f3ff'
                      : '#1e1435'
                    : theme === 'light'
                    ? '#f8fafc'
                    : '#0f172a'
                }
                metalness={0.7}
                roughness={0.3}
                transparent
                opacity={0.9}
              />
            </mesh>

            {/* Glowing Accent Border */}
            <mesh position={[0, 0, 0.16]}>
              <planeGeometry args={[9.5, 3.9]} />
              <meshBasicMaterial
                color={hasShared ? '#a855f7' : '#0284c7'}
                transparent
                opacity={0.25}
                wireframe
              />
            </mesh>

            {/* Top Accent Strip */}
            <mesh position={[0, 1.85, 0.18]}>
              <boxGeometry args={[9.5, 0.18, 0.1]} />
              <meshBasicMaterial color={hasShared ? '#c084fc' : '#38bdf8'} />
            </mesh>

            {/* File Icon & Name */}
            <Text
              position={[-4.3, 1.1, 0.25]}
              fontSize={0.65}
              color={hasShared ? '#e9d5ff' : '#f8fafc'}
              anchorX="left"
              anchorY="middle"
              fontWeight="bold"
            >
              {`📄 ${file.name}`}
            </Text>

            {/* Inode & Deduplication Tag */}
            <Text
              position={[-4.3, 0.4, 0.25]}
              fontSize={0.42}
              color={hasShared ? '#c084fc' : '#94a3b8'}
              anchorX="left"
              anchorY="middle"
            >
              {`Inode #${file.inode_id ?? fileIdx + 1} · ${file.num_blocks} Block${file.num_blocks !== 1 ? 's' : ''}${
                hasShared ? ' · 🔗 CAS DEDUPLICATED' : ''
              }`}
            </Text>

            {/* ── File's Logical Block Nodes ──────────────────────────────── */}
            {file.block_ids?.map((bid, bIdx) => {
              const isShared = sharedBlockIds.has(bid)
              const isSelected = selectedBlockId === bid
              const isHovered = hoveredBlockId === bid
              const isActive = activeId === bid

              const bx = -2.8 + bIdx * 1.3
              const by = -0.6
              const bz = 0.35

              let blockColor = isShared ? '#a855f7' : '#0284c7'
              if (isSelected) blockColor = '#ffffff'
              else if (isHovered) blockColor = '#38bdf8'
              else if (isShared) blockColor = '#c084fc'

              return (
                <group key={`${file.name}-b${bid}-${bIdx}`} position={[bx, by, bz]}>
                  {/* Logical Block Tile */}
                  <mesh
                    onClick={(e) => {
                      e.stopPropagation()
                      onSelectBlock(bid)
                    }}
                    onPointerOver={(e) => {
                      e.stopPropagation()
                      onHoverBlock(bid)
                    }}
                    onPointerOut={() => onHoverBlock(null)}
                    scale={isActive ? [1.2, 1.2, 1.3] : [1, 1, 1]}
                  >
                    <boxGeometry args={[1.05, 1.05, 0.35]} />
                    <meshStandardMaterial
                      color={blockColor}
                      metalness={0.6}
                      roughness={0.3}
                    />
                  </mesh>

                  {/* Block Index Label on Tile */}
                  <Text
                    position={[0, 0.15, 0.22]}
                    fontSize={0.34}
                    color={isSelected ? '#0f172a' : '#ffffff'}
                    anchorX="center"
                    anchorY="middle"
                    fontWeight="bold"
                  >
                    {`#${bid}`}
                  </Text>
                  <Text
                    position={[0, -0.22, 0.22]}
                    fontSize={0.24}
                    color={isSelected ? '#334155' : '#cbd5e1'}
                    anchorX="center"
                    anchorY="middle"
                  >
                    {`Chunk ${bIdx}`}
                  </Text>
                </group>
              )
            })}
          </group>
        )
      })}
    </group>
  )
}
