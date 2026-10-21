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
}

export default function BlockGrid2D({ gridBlocks, compact = false, highlightIds }: Props) {
  const setSelectedBlockId = useStore((s) => s.setSelectedBlockId)
  const selectedBlockId = useStore((s) => s.selectedBlockId)
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
              border: isCorrupted
                ? '1.5px solid #ff4444'
                : isSelected
                ? '1.5px solid #fff'
                : isHighlighted
                ? `1.5px solid ${cell.color}`
                : '1px solid transparent',
              boxShadow: isCorrupted
                ? '0 0 8px rgba(239, 68, 68, 0.8)'
                : isSelected
                ? `0 0 6px ${cell.color}`
                : isHighlighted
                ? `0 0 4px ${cell.color}`
                : 'none',
              transform: (isCorrupted || isSelected || isHighlighted) ? 'scale(1.25)' : undefined,
              zIndex: isCorrupted ? 3 : isSelected ? 2 : isHighlighted ? 1 : 0,
              transition: 'transform 0.15s, box-shadow 0.15s',
              opacity: cell.state === 'free' ? 0.5 : 1,
            }}
          />
        )
      })}
    </div>
  )
}
