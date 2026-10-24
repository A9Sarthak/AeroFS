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
  filter?: string
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
  filter = 'all',
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
  const isFilterActive = filter && filter !== 'all'

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
                    ? '#ffffff'
                    : '#0f172a'
                }
                metalness={theme === 'light' ? 0.2 : 0.7}
                roughness={theme === 'light' ? 0.6 : 0.3}
                transparent
                opacity={0.95}
              />
            </mesh>

            {/* Glowing Accent Border */}
            <mesh position={[0, 0, 0.16]}>
              <planeGeometry args={[9.5, 3.9]} />
              <meshBasicMaterial
                color={hasShared ? (theme === 'light' ? '#9333ea' : '#a855f7') : (theme === 'light' ? '#0284c7' : '#38bdf8')}
                transparent
                opacity={theme === 'light' ? 0.6 : 0.25}
                wireframe
              />
            </mesh>

            {/* Top Accent Strip */}
            <mesh position={[0, 1.85, 0.18]}>
              <boxGeometry args={[9.5, 0.18, 0.1]} />
              <meshBasicMaterial color={hasShared ? (theme === 'light' ? '#7e22ce' : '#c084fc') : (theme === 'light' ? '#0284c7' : '#38bdf8')} />
            </mesh>

            {/* File Icon & Name */}
            <Text
              position={[-4.3, 1.15, 0.25]}
              fontSize={0.58}
              color={hasShared ? (theme === 'light' ? '#581c87' : '#e9d5ff') : (theme === 'light' ? '#0f172a' : '#f8fafc')}
              anchorX="left"
              anchorY="middle"
              fontWeight="bold"
              raycast={() => null}
            >
              {`📄 ${file.name}`}
            </Text>

            {/* Inode & Deduplication Tag with Partial % Breakdown */}
            <Text
              position={[-4.3, 0.45, 0.25]}
              fontSize={0.28}
              color={hasShared ? (theme === 'light' ? '#7e22ce' : '#c084fc') : (theme === 'light' ? '#475569' : '#94a3b8')}
              anchorX="left"
              anchorY="middle"
              fontWeight="bold"
              raycast={() => null}
            >
              {(() => {
                const totalCount = file.block_ids?.length ?? 1
                const sharedCount = file.block_ids?.filter((b) => sharedBlockIds.has(b)).length ?? 0
                const isPartial = sharedCount > 0 && sharedCount < totalCount
                const pct = Math.round((sharedCount / totalCount) * 100)
                if (isPartial) {
                  return `Inode #${file.inode_id ?? fileIdx + 1} · ${totalCount} Blk · ⚡ ${pct}% CAS SHARED (${sharedCount}/${totalCount} shared · ${totalCount - sharedCount} unique)`
                }
                if (sharedCount === totalCount && totalCount > 0) {
                  return `Inode #${file.inode_id ?? fileIdx + 1} · ${totalCount} Blk · 🔗 100% CAS DEDUPLICATED (${sharedCount} blk)`
                }
                return `Inode #${file.inode_id ?? fileIdx + 1} · ${totalCount} Block${totalCount !== 1 ? 's' : ''}`
              })()}
            </Text>

            {/* ── File's Logical Block Nodes ──────────────────────────────── */}
            {file.block_ids?.map((bid, bIdx) => {
              const isShared = sharedBlockIds.has(bid)
              const isSelected = selectedBlockId === bid
              const isHovered = hoveredBlockId === bid
              const isActive = activeId === bid

              const matchesFilter =
                !isFilterActive ||
                (filter === 'shared' && isShared) ||
                (filter === 'unique' && !isShared)

              const isFilterMatch = isFilterActive && matchesFilter
              const isFilteredOut = isFilterActive && !matchesFilter

              const bx = -2.8 + bIdx * 1.3
              const by = -0.6
              const bz = 0.35

              let blockColor = isShared ? '#a855f7' : '#0284c7'
              if (isSelected) blockColor = '#ffffff'
              else if (isHovered) blockColor = '#38bdf8'
              else if (isFilterMatch) {
                blockColor = isShared ? '#d946ef' : '#10b981'
              } else if (isFilteredOut) {
                blockColor = theme === 'light' ? '#cbd5e1' : '#1e293b'
              } else if (isShared) {
                blockColor = '#c084fc'
              }

              let tileScale: [number, number, number] = isActive ? [1.25, 1.25, 1.35] : [1, 1, 1]
              if (isFilterMatch) {
                tileScale = [1.25, 1.25, 1.45]
              } else if (isFilteredOut) {
                tileScale = [0.75, 0.75, 0.35]
              }

              return (
                <group
                  key={`${file.name}-b${bid}-${bIdx}`}
                  position={[bx, by, bz]}
                  onClick={(e) => {
                    e.stopPropagation()
                    onSelectBlock(bid)
                  }}
                  onPointerOver={(e) => {
                    e.stopPropagation()
                    document.body.style.cursor = 'pointer'
                    onHoverBlock(bid)
                  }}
                  onPointerOut={() => {
                    document.body.style.cursor = 'auto'
                    onHoverBlock(null)
                  }}
                >
                  {/* Logical Block Tile */}
                  <mesh
                    onClick={(e) => {
                      e.stopPropagation()
                      onSelectBlock(bid)
                    }}
                    onPointerOver={(e) => {
                      e.stopPropagation()
                      document.body.style.cursor = 'pointer'
                      onHoverBlock(bid)
                    }}
                    onPointerOut={() => {
                      document.body.style.cursor = 'auto'
                      onHoverBlock(null)
                    }}
                    scale={tileScale}
                  >
                    <boxGeometry args={[1.1, 1.1, 0.35]} />
                    <meshStandardMaterial
                      color={blockColor}
                      metalness={isFilterMatch ? 0.8 : 0.6}
                      roughness={isFilterMatch ? 0.2 : 0.3}
                    />
                  </mesh>

                  {/* Block Index Label on Tile */}
                  <Text
                    position={[0, 0.28, 0.22]}
                    fontSize={0.28}
                    color={isSelected ? '#0f172a' : '#ffffff'}
                    anchorX="center"
                    anchorY="middle"
                    fontWeight="bold"
                    raycast={() => null}
                  >
                    {`#${bid}`}
                  </Text>
                  <Text
                    position={[0, 0.06, 0.22]}
                    fontSize={0.19}
                    color={isSelected ? '#334155' : isShared ? '#f3e8ff' : '#e0f2fe'}
                    anchorX="center"
                    anchorY="middle"
                    fontWeight="bold"
                    raycast={() => null}
                  >
                    {`Part ${bIdx + 1}`}
                  </Text>
                  <Text
                    position={[0, -0.15, 0.22]}
                    fontSize={0.15}
                    color={isSelected ? '#475569' : isShared ? '#fae8ff' : '#a7f3d0'}
                    anchorX="center"
                    anchorY="middle"
                    fontWeight="bold"
                    raycast={() => null}
                  >
                    {isShared ? '🔗 Shared' : '🟢 Unique'}
                  </Text>
                  <Text
                    position={[0, -0.34, 0.22]}
                    fontSize={0.13}
                    color={isSelected ? '#64748b' : isShared ? '#e9d5ff' : '#7dd3fc'}
                    anchorX="center"
                    anchorY="middle"
                    raycast={() => null}
                  >
                    {isShared ? 'Ref: 2 (CAS)' : '4KB Sector'}
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
