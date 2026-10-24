// ============================================================
//  AeroFS Studio — Storage Space Savings Utility & Calculations
//  Computes space reclaimed through Content-Addressable Storage (CAS)
//  and Copy-on-Write (CoW) Zero-Copy Snapshots.
// ============================================================

import type { TelemetryResponse, StorageSavingsBreakdown } from '../../api/types'

export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const abs = Math.abs(bytes)
  if (abs < 1024) return `${bytes} B`
  if (abs < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MiB`
}

export function computeStorageSavings(telemetry?: TelemetryResponse | null): StorageSavingsBreakdown {
  if (!telemetry) {
    return {
      total_logical_bytes: 0,
      total_logical_blocks: 0,
      total_physical_bytes: 0,
      total_physical_blocks: 0,
      total_saved_bytes: 0,
      total_saved_blocks: 0,
      savings_ratio: '1.0x',
      savings_percent: 0,
      cas: {
        saved_bytes: 0,
        saved_blocks: 0,
        dedup_hits: 0,
        shared_blocks_count: 0,
      },
      cow: {
        saved_bytes: 0,
        saved_blocks: 0,
        snapshot_count: 0,
        snapshot_logical_bytes: 0,
        snapshot_logical_blocks: 0,
        snapshot_extra_physical_blocks: 0,
      },
    }
  }

  // If backend already provided savings, return it directly
  if (telemetry.savings && telemetry.savings.total_logical_blocks > 0) {
    return telemetry.savings
  }

  const blockSize = telemetry.disk?.block_size || 4096
  const files = telemetry.files || []
  const snapshots = telemetry.snapshots || []
  const gridBlocks = telemetry.grid_blocks || []

  // 1. Active files logical footprint
  const activeLogicalBlocks = files.reduce((acc, f) => acc + (f.block_ids?.length || 0), 0)
  const activeLogicalBytes = files.reduce((acc, f) => acc + (f.size || 0), 0)
  const activeUniqueBlocks = new Set<number>()
  for (const f of files) {
    for (const bid of f.block_ids || []) {
      activeUniqueBlocks.add(bid)
    }
  }

  // CAS savings: identical data blocks shared between files or duplicate chunks within files
  const casSavedBlocks = Math.max(0, activeLogicalBlocks - activeUniqueBlocks.size)
  const casSavedBytes = casSavedBlocks * blockSize

  // 2. Snapshot logical footprint (what a traditional FS would duplicate)
  let snapLogicalBlocks = 0
  let snapLogicalBytes = 0
  const snapUniqueBlocks = new Set<number>()

  for (const snap of snapshots) {
    if (snap.file_blocks) {
      for (const bids of Object.values(snap.file_blocks)) {
        snapLogicalBlocks += bids.length
        for (const bid of bids) snapUniqueBlocks.add(bid)
      }
    } else if (snap.block_ids) {
      snapLogicalBlocks += snap.block_ids.length
      for (const bid of snap.block_ids) snapUniqueBlocks.add(bid)
    }
    snapLogicalBytes += snap.total_size || 0
  }

  // Blocks held uniquely by snapshots (not in active files)
  let snapExtraPhysicalBlocks = 0
  for (const bid of snapUniqueBlocks) {
    if (!activeUniqueBlocks.has(bid)) {
      snapExtraPhysicalBlocks++
    }
  }

  // CoW zero-copy snapshot savings: snapshots preserve data without duplicating shared physical sectors
  const cowSavedBlocks = Math.max(0, snapLogicalBlocks - snapExtraPhysicalBlocks)
  const cowSavedBytes = cowSavedBlocks * blockSize

  // 3. Combined Totals
  const allDataBlocks = new Set<number>([...activeUniqueBlocks, ...snapUniqueBlocks])
  const totalLogicalBlocks = activeLogicalBlocks + snapLogicalBlocks
  const totalLogicalBytes = activeLogicalBytes + snapLogicalBytes

  const totalPhysicalBlocks = allDataBlocks.size
  const totalPhysicalBytes = totalPhysicalBlocks * blockSize

  const totalSavedBlocks = Math.max(0, totalLogicalBlocks - totalPhysicalBlocks)
  const totalSavedBytes = totalSavedBlocks * blockSize

  const ratio = totalPhysicalBlocks > 0 ? (totalLogicalBlocks / totalPhysicalBlocks).toFixed(1) : '1.0'
  const percent = totalLogicalBytes > 0 ? Math.round((totalSavedBytes / totalLogicalBytes) * 1000) / 10 : 0

  const sharedBlocksCount = gridBlocks.filter((s) => s === 3).length

  return {
    total_logical_bytes: totalLogicalBytes,
    total_logical_blocks: totalLogicalBlocks,
    total_physical_bytes: totalPhysicalBytes,
    total_physical_blocks: totalPhysicalBlocks,
    total_saved_bytes: totalSavedBytes,
    total_saved_blocks: totalSavedBlocks,
    savings_ratio: `${ratio}x`,
    savings_percent: percent,
    cas: {
      saved_bytes: casSavedBytes,
      saved_blocks: casSavedBlocks,
      dedup_hits: telemetry.dedup?.dedup_hits || 0,
      shared_blocks_count: sharedBlocksCount,
    },
    cow: {
      saved_bytes: cowSavedBytes,
      saved_blocks: cowSavedBlocks,
      snapshot_count: snapshots.length,
      snapshot_logical_bytes: snapLogicalBytes,
      snapshot_logical_blocks: snapLogicalBlocks,
      snapshot_extra_physical_blocks: snapExtraPhysicalBlocks,
    },
  }
}
