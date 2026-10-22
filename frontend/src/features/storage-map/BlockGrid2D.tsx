import { useMemo } from 'react'
import { useStore } from '../../state/store'
import {
  GRID_STATE_MAP,
  BLOCK_STATE_COLORS,
  BLOCK_STATE_COLORS_LIGHT,
  BLOCK_STATE_LABELS,
} from '../../api/types'

interface Props {
  gridBlocks: number[]
  compact?: boolean
  highlightIds?: Set<number>
  filter?: string
}

export default function BlockGrid2D({ gridBlocks, compact = false, highlightIds, filter }: Props) {
  const setSelectedBlockId = useStore((s) => s.setSelectedBlockId)
  const selectedBlockId = useStore((s) => s.selectedBlockId)
  const storeFilter = useStore((s) => s.blockFilter)
  const activeFilter = filter ?? storeFilter ?? 'all'
  const theme = useStore((s) => s.theme)

  const colors = theme === 'light' ? BLOCK_STATE_COLORS_LIGHT : BLOCK_STATE_COLORS

  const cols = compact ? 64 : 48
  const cellSize = compact ? 10 : 14

  const cells = useMemo(() => {
    return gridBlocks.map((stateCode, idx) => ({
      id: idx,
      state: GRID_STATE_MAP[stateCode] ?? 'unknown',
      color: colors[GRID_STATE_MAP[stateCode] ?? 'unknown'],
    }))
  }, [gridBlocks, colors])

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${cols}, ${cellSize}px)`,
        gap: '2px',
        overflowX: 'auto',
        overflowY: 'auto',
        maxHeight: compact ? 200 : 400,
      }}
      role="grid"
      aria-label="Block allocation map"
    >
      {cells.map((cell) => {
        const isSelected = selectedBlockId === cell.id
        const isHighlighted = highlightIds?.has(cell.id)
        const isCorrupted = cell.state === 'corrupted'

        const matchesFilter =
          activeFilter === 'all' ||
          (activeFilter === 'free' && cell.state === 'free') ||
          (activeFilter === 'metadata' && cell.state === 'metadata') ||
          (activeFilter === 'unique' && cell.state === 'unique') ||
          (activeFilter === 'shared' && cell.state === 'shared') ||
          (activeFilter === 'corrupted' && cell.state === 'corrupted')

        const isFilteredOut = activeFilter !== 'all' && !matchesFilter
        const isFilterActiveMatch = activeFilter !== 'all' && matchesFilter

        let border = '1px solid transparent'
        let boxShadow = 'none'
        let transform = undefined
        let zIndex = 0
        let opacity = cell.state === 'free' ? 0.45 : 1

        if (isFilteredOut) {
          opacity = theme === 'light' ? 0.15 : 0.08
          transform = 'scale(0.85)'
        } else if (isFilterActiveMatch) {
          opacity = 1
          transform = 'scale(1.35)'
          zIndex = 4
          if (cell.state === 'shared') {
            border = '2px solid #c084fc'
            boxShadow = '0 0 10px #a855f7, 0 0 18px rgba(168, 85, 247, 0.85)'
          } else if (cell.state === 'unique') {
            border = '2px solid #34d399'
            boxShadow = '0 0 10px #10b981, 0 0 18px rgba(16, 185, 129, 0.85)'
          } else if (cell.state === 'metadata') {
            border = '2px solid #38bdf8'
            boxShadow = '0 0 10px #0284c7, 0 0 18px rgba(2, 132, 199, 0.85)'
          } else if (cell.state === 'corrupted') {
            border = '2px solid #ff4444'
            boxShadow = '0 0 12px #ef4444, 0 0 20px rgba(239, 68, 68, 0.9)'
          } else {
            border = '2px solid #fff'
            boxShadow = '0 0 8px rgba(255, 255, 255, 0.6)'
          }
        } else if (isCorrupted) {
          border = '1.5px solid #ff4444'
          boxShadow = '0 0 8px rgba(239, 68, 68, 0.8)'
          transform = 'scale(1.25)'
          zIndex = 3
        } else if (isSelected) {
          border = '2px solid #fff'
          boxShadow = `0 0 8px ${cell.color}`
          transform = 'scale(1.3)'
          zIndex = 3
        } else if (isHighlighted) {
          border = `1.5px solid ${cell.color}`
          boxShadow = `0 0 6px ${cell.color}`
          transform = 'scale(1.2)'
          zIndex = 2
        }

        return (
          <div
            key={cell.id}
            role="gridcell"
            title={`Block #${cell.id}: ${BLOCK_STATE_LABELS[cell.state]}`}
            aria-label={`Block ${cell.id}, ${BLOCK_STATE_LABELS[cell.state]}`}
            aria-selected={isSelected}
            onClick={() => setSelectedBlockId(cell.id)}
            style={{
              width: cellSize,
              height: cellSize,
              borderRadius: 2,
              background: isCorrupted ? '#ef4444' : cell.color,
              cursor: 'pointer',
              border,
              boxShadow,
              transform,
              zIndex,
              transition: 'transform 0.15s, box-shadow 0.15s, opacity 0.15s',
              opacity,
            }}
          />
        )
      })}
    </div>
  )
}
