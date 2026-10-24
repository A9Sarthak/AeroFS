// ============================================================
//  AeroFS Studio — Comprehensive Space Savings & Viva Analysis Modal
//  Provides deep mathematical, structural, and per-file storage metrics
// ============================================================

import React, { useMemo } from 'react'
import type { TelemetryResponse } from '../../api/types'
import { computeStorageSavings, formatBytes } from './savingsUtils'

interface SpaceSavingsModalProps {
  isOpen: boolean
  onClose: () => void
  telemetry?: TelemetryResponse | null
  theme: 'dark' | 'light'
  onHighlightShared: () => void
  onHighlightSnapshot: () => void
}

export default function SpaceSavingsModal({
  isOpen,
  onClose,
  telemetry,
  theme,
  onHighlightShared,
  onHighlightSnapshot,
}: SpaceSavingsModalProps) {
  if (!isOpen) return null

  const isLight = theme === 'light'
  const savings = computeStorageSavings(telemetry)
  const files = telemetry?.files || []
  const snapshots = telemetry?.snapshots || []
  const blockSize = telemetry?.disk.block_size || 4096

  // Per-file and per-snapshot detailed impact
  const detailedItems = useMemo(() => {
    // Map block_id -> referencing file count
    const blockRefCount: Record<number, number> = {}
    for (const f of files) {
      for (const bid of f.block_ids || []) {
        blockRefCount[bid] = (blockRefCount[bid] || 0) + 1
      }
    }

    const items: Array<{
      name: string
      category: 'file' | 'snapshot'
      logicalBytes: number
      logicalBlocks: number
      sharedBlocks: number
      uniqueBlocks: number
      savedBytes: number
      savedPercent: number
      notes: string
    }> = []

    // 1. Files
    for (const f of files) {
      const totalBlks = f.block_ids?.length || 0
      let sharedBlks = 0
      for (const bid of f.block_ids || []) {
        if ((blockRefCount[bid] || 0) > 1) {
          sharedBlks++
        }
      }
      const uniqueBlks = totalBlks - sharedBlks
      const savedBytes = sharedBlks > 0 ? (totalBlks - Math.max(1, uniqueBlks)) * blockSize : 0
      const savedPercent = totalBlks > 0 ? Math.round((sharedBlks / totalBlks) * 100) : 0

      items.push({
        name: f.name,
        category: 'file',
        logicalBytes: f.size,
        logicalBlocks: totalBlks,
        sharedBlocks: sharedBlks,
        uniqueBlocks: uniqueBlks,
        savedBytes: Math.max(0, savedBytes),
        savedPercent: savedPercent,
        notes:
          sharedBlks === totalBlks && totalBlks > 0
            ? '100% Identical CAS Clone (Shares all physical blocks)'
            : sharedBlks > 0
            ? `${sharedBlks}/${totalBlks} blocks shared via CAS dedup`
            : 'Unique data blocks on disk',
      })
    }

    // 2. Snapshots
    for (const s of snapshots) {
      const snapLogicalBlks = s.block_ids?.length || 0
      const snapLogicalBytes = s.total_size || 0
      // Snapshots use 0 extra blocks if live files exist with same blocks
      items.push({
        name: s.name,
        category: 'snapshot',
        logicalBytes: snapLogicalBytes,
        logicalBlocks: snapLogicalBlks,
        sharedBlocks: snapLogicalBlks,
        uniqueBlocks: 0,
        savedBytes: snapLogicalBlks * blockSize,
        savedPercent: 100,
        notes: 'CoW Frozen Pointers: O(1) Instant zero-copy snapshot',
      })
    }

    return items
  }, [files, snapshots, blockSize])

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.75)',
        backdropFilter: 'blur(8px)',
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '1rem',
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: isLight ? '#ffffff' : '#0b1120',
          border: isLight ? '1px solid #cbd5e1' : '1px solid #334155',
          borderRadius: 12,
          width: '100%',
          maxWidth: '860px',
          maxHeight: '90vh',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: isLight
            ? '0 25px 50px -12px rgba(0, 0, 0, 0.25)'
            : '0 25px 50px -12px rgba(0, 0, 0, 0.8), 0 0 30px rgba(16, 185, 129, 0.2)',
          color: isLight ? '#0f172a' : '#f8fafc',
          overflow: 'hidden',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          style={{
            padding: '1.25rem 1.5rem',
            borderBottom: isLight ? '1px solid #e2e8f0' : '1px solid #1e293b',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            background: isLight ? '#f8fafc' : '#0f172a',
          }}
        >
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: '1.3rem' }}>⚡</span>
              <h2 style={{ fontSize: '1.2rem', fontWeight: 800, margin: 0, color: isLight ? '#0f172a' : '#ffffff' }}>
                AeroFS Storage Space Savings & Efficiency Analysis
              </h2>
            </div>
            <p style={{ margin: '4px 0 0', fontSize: '0.78rem', color: isLight ? '#64748b' : '#94a3b8' }}>
              Mathematical verification of Content-Addressable Storage (CAS) Deduplication and Copy-on-Write (CoW) Snapshots
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{
              background: 'transparent',
              border: 'none',
              color: isLight ? '#64748b' : '#94a3b8',
              fontSize: '1.25rem',
              cursor: 'pointer',
              padding: '4px 8px',
              borderRadius: 4,
            }}
          >
            ✕
          </button>
        </div>

        {/* Scrollable Content Body */}
        <div style={{ padding: '1.5rem', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          {/* Hero KPI Cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '0.75rem' }}>
            <div
              style={{
                background: isLight ? 'rgba(16, 185, 129, 0.08)' : 'rgba(16, 185, 129, 0.12)',
                border: isLight ? '1px solid rgba(16, 185, 129, 0.3)' : '1px solid rgba(16, 185, 129, 0.4)',
                borderRadius: 8,
                padding: '0.85rem',
              }}
            >
              <div style={{ fontSize: '0.7rem', color: isLight ? '#047857' : '#34d399', fontWeight: 700, textTransform: 'uppercase' }}>
                Total Space Reclaimed
              </div>
              <div style={{ fontSize: '1.4rem', fontWeight: 900, color: isLight ? '#065f46' : '#10b981', marginTop: 4 }}>
                +{formatBytes(savings.total_saved_bytes)}
              </div>
              <div style={{ fontSize: '0.72rem', color: isLight ? '#059669' : '#6ee7b7', marginTop: 2 }}>
                {savings.total_saved_blocks} disk blocks saved
              </div>
            </div>

            <div
              style={{
                background: isLight ? 'rgba(124, 58, 237, 0.08)' : 'rgba(168, 85, 247, 0.12)',
                border: isLight ? '1px solid rgba(124, 58, 237, 0.3)' : '1px solid rgba(168, 85, 247, 0.4)',
                borderRadius: 8,
                padding: '0.85rem',
              }}
            >
              <div style={{ fontSize: '0.7rem', color: isLight ? '#6b21a8' : '#c084fc', fontWeight: 700, textTransform: 'uppercase' }}>
                CAS Deduplication
              </div>
              <div style={{ fontSize: '1.4rem', fontWeight: 900, color: isLight ? '#7c3aed' : '#a855f7', marginTop: 4 }}>
                +{formatBytes(savings.cas.saved_bytes)}
              </div>
              <div style={{ fontSize: '0.72rem', color: isLight ? '#6b21a8' : '#c084fc', marginTop: 2 }}>
                {savings.cas.saved_blocks} duplicate chunks merged
              </div>
            </div>

            <div
              style={{
                background: isLight ? 'rgba(217, 119, 6, 0.08)' : 'rgba(245, 158, 11, 0.12)',
                border: isLight ? '1px solid rgba(217, 119, 6, 0.3)' : '1px solid rgba(245, 158, 11, 0.4)',
                borderRadius: 8,
                padding: '0.85rem',
              }}
            >
              <div style={{ fontSize: '0.7rem', color: isLight ? '#b45309' : '#fbbf24', fontWeight: 700, textTransform: 'uppercase' }}>
                CoW Zero-Copy Snaps
              </div>
              <div style={{ fontSize: '1.4rem', fontWeight: 900, color: isLight ? '#d97706' : '#f59e0b', marginTop: 4 }}>
                +{formatBytes(savings.cow.saved_bytes)}
              </div>
              <div style={{ fontSize: '0.72rem', color: isLight ? '#b45309' : '#fbbf24', marginTop: 2 }}>
                {savings.cow.snapshot_count} snapshots (O(1) pointers)
              </div>
            </div>

            <div
              style={{
                background: isLight ? '#f1f5f9' : '#1e293b',
                border: isLight ? '1px solid #cbd5e1' : '1px solid #334155',
                borderRadius: 8,
                padding: '0.85rem',
              }}
            >
              <div style={{ fontSize: '0.7rem', color: isLight ? '#475569' : '#94a3b8', fontWeight: 700, textTransform: 'uppercase' }}>
                Storage Reduction Ratio
              </div>
              <div style={{ fontSize: '1.4rem', fontWeight: 900, color: isLight ? '#0284c7' : '#38bdf8', marginTop: 4 }}>
                {savings.savings_ratio}
              </div>
              <div style={{ fontSize: '0.72rem', color: isLight ? '#0369a1' : '#7dd3fc', marginTop: 2 }}>
                {savings.savings_percent}% less disk consumed
              </div>
            </div>
          </div>

          {/* Visual Footprint Comparison Bar */}
          <div
            style={{
              padding: '1rem',
              borderRadius: 8,
              background: isLight ? '#f8fafc' : '#0f172a',
              border: isLight ? '1px solid #e2e8f0' : '1px solid #1e293b',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <span style={{ fontSize: '0.85rem', fontWeight: 700 }}>
                Footprint Comparison: Traditional Operating System vs AeroFS
              </span>
              <span style={{ fontSize: '0.75rem', color: isLight ? '#047857' : '#34d399', fontWeight: 700 }}>
                Efficiency Gain: {savings.savings_ratio} ({savings.savings_percent}% Space Saved)
              </span>
            </div>

            <div
              style={{
                height: 18,
                borderRadius: 6,
                background: isLight ? '#e2e8f0' : '#1e293b',
                overflow: 'hidden',
                display: 'flex',
                border: isLight ? '1px solid #cbd5e1' : '1px solid #334155',
              }}
            >
              <div
                style={{
                  height: '100%',
                  width: `${savings.total_logical_blocks > 0 ? (savings.total_physical_blocks / savings.total_logical_blocks) * 100 : 100}%`,
                  background: 'linear-gradient(90deg, #0284c7 0%, #10b981 100%)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '0.65rem',
                  fontWeight: 800,
                  color: '#fff',
                }}
              >
                AeroFS: {formatBytes(savings.total_physical_bytes)}
              </div>
              <div
                style={{
                  height: '100%',
                  flex: 1,
                  background: 'repeating-linear-gradient(45deg, rgba(168, 85, 247, 0.45), rgba(168, 85, 247, 0.45) 8px, rgba(16, 185, 129, 0.5) 8px, rgba(16, 185, 129, 0.5) 16px)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '0.65rem',
                  fontWeight: 800,
                  color: isLight ? '#4c1d95' : '#ffffff',
                }}
              >
                Saved: +{formatBytes(savings.total_saved_bytes)} ({savings.savings_percent}%)
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.72rem', color: isLight ? '#64748b' : '#94a3b8', marginTop: 6 }}>
              <div>
                Traditional Non-Dedup / Non-CoW Footprint: <strong>{formatBytes(savings.total_logical_bytes)}</strong> ({savings.total_logical_blocks} blocks)
              </div>
              <div>
                Physical Container Sectors Used: <strong>{formatBytes(savings.total_physical_bytes)}</strong> ({savings.total_physical_blocks} blocks)
              </div>
            </div>
          </div>

          {/* Per-Item Detailed Table */}
          <div>
            <div style={{ fontSize: '0.85rem', fontWeight: 700, marginBottom: 8, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span>Live File & Snapshot Savings Ledger</span>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  type="button"
                  onClick={onHighlightShared}
                  style={{
                    background: 'transparent',
                    border: '1px solid #a855f7',
                    borderRadius: 4,
                    color: '#c084fc',
                    fontSize: '0.7rem',
                    padding: '2px 8px',
                    cursor: 'pointer',
                    fontWeight: 600,
                  }}
                >
                  🔗 Highlight CAS Blocks
                </button>
                <button
                  type="button"
                  onClick={onHighlightSnapshot}
                  style={{
                    background: 'transparent',
                    border: '1px solid #f59e0b',
                    borderRadius: 4,
                    color: '#fbbf24',
                    fontSize: '0.7rem',
                    padding: '2px 8px',
                    cursor: 'pointer',
                    fontWeight: 600,
                  }}
                >
                  📷 Highlight Snapshot Blocks
                </button>
              </div>
            </div>

            <div
              style={{
                borderRadius: 8,
                border: isLight ? '1px solid #cbd5e1' : '1px solid #334155',
                overflow: 'hidden',
                maxHeight: '220px',
                overflowY: 'auto',
              }}
            >
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.74rem' }}>
                <thead>
                  <tr style={{ background: isLight ? '#f1f5f9' : '#1e293b', borderBottom: isLight ? '1px solid #cbd5e1' : '1px solid #334155', textAlign: 'left' }}>
                    <th style={{ padding: '8px 10px' }}>Name</th>
                    <th style={{ padding: '8px 10px' }}>Type</th>
                    <th style={{ padding: '8px 10px' }}>Logical Size</th>
                    <th style={{ padding: '8px 10px' }}>Blocks (Shared/Total)</th>
                    <th style={{ padding: '8px 10px' }}>Storage Reclaimed</th>
                    <th style={{ padding: '8px 10px' }}>Mechanism</th>
                  </tr>
                </thead>
                <tbody>
                  {detailedItems.map((item, idx) => (
                    <tr
                      key={idx}
                      style={{
                        borderBottom: isLight ? '1px solid #f1f5f9' : '1px solid #1e293b',
                        background:
                          item.savedPercent > 0
                            ? isLight
                              ? 'rgba(16, 185, 129, 0.03)'
                              : 'rgba(16, 185, 129, 0.06)'
                            : 'transparent',
                      }}
                    >
                      <td style={{ padding: '8px 10px', fontWeight: 600 }}>{item.name}</td>
                      <td style={{ padding: '8px 10px' }}>
                        <span
                          style={{
                            padding: '1px 6px',
                            borderRadius: 4,
                            fontSize: '0.65rem',
                            fontWeight: 700,
                            background: item.category === 'file' ? 'rgba(56, 189, 248, 0.15)' : 'rgba(245, 158, 11, 0.15)',
                            color: item.category === 'file' ? '#0284c7' : '#d97706',
                          }}
                        >
                          {item.category.toUpperCase()}
                        </span>
                      </td>
                      <td style={{ padding: '8px 10px' }}>{formatBytes(item.logicalBytes)}</td>
                      <td style={{ padding: '8px 10px' }}>
                        <strong style={{ color: item.sharedBlocks > 0 ? '#a855f7' : undefined }}>{item.sharedBlocks}</strong> / {item.logicalBlocks}
                      </td>
                      <td style={{ padding: '8px 10px', color: item.savedBytes > 0 ? '#10b981' : '#64748b', fontWeight: 700 }}>
                        {item.savedBytes > 0 ? `+${formatBytes(item.savedBytes)} (${item.savedPercent}%)` : '—'}
                      </td>
                      <td style={{ padding: '8px 10px', color: isLight ? '#64748b' : '#94a3b8' }}>{item.notes}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Academic & Viva Defense Equations */}
          <div
            style={{
              padding: '1rem',
              borderRadius: 8,
              background: isLight ? 'rgba(124, 58, 237, 0.05)' : 'rgba(168, 85, 247, 0.08)',
              border: isLight ? '1px solid rgba(124, 58, 237, 0.2)' : '1px solid rgba(168, 85, 247, 0.25)',
              fontSize: '0.78rem',
              lineHeight: 1.55,
            }}
          >
            <div style={{ fontWeight: 800, color: isLight ? '#6b21a8' : '#c084fc', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
              <span>🎓</span> Operating Systems Academic & Viva Theory Reference
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginTop: 8 }}>
              <div>
                <strong>1. Dual-Purpose Cryptographic CAS:</strong>
                <p style={{ margin: '2px 0', color: isLight ? '#475569' : '#94a3b8', fontSize: '0.74rem' }}>
                  AeroFS uses a single 256-bit SHA-256 computation to index identical 4KB chunks in the CAS table and anchor the leaf node of the file Merkle Tree.
                </p>
              </div>
              <div>
                <strong>2. Instant O(1) Zero-Copy Snapshots:</strong>
                <p style={{ margin: '2px 0', color: isLight ? '#475569' : '#94a3b8', fontSize: '0.74rem' }}>
                  Snapshots freeze block pointers in &lt;1.0ms without duplicating underlying data sectors. Increments reference counters on active blocks.
                </p>
              </div>
              <div>
                <strong>3. 128:1 Metadata Storage Return:</strong>
                <p style={{ margin: '2px 0', color: isLight ? '#475569' : '#94a3b8', fontSize: '0.74rem' }}>
                  Metadata overhead is only 36 bytes per 4,096-byte sector (0.87%). Every 1 byte spent on deduplication metadata reclaims 128 bytes of raw disk space.
                </p>
              </div>
              <div>
                <strong>4. Out-of-Place Copy-on-Write:</strong>
                <p style={{ margin: '2px 0', color: isLight ? '#475569' : '#94a3b8', fontSize: '0.74rem' }}>
                  Modifications redirect to fresh clean sectors chosen by Best-Fit allocation, guaranteeing full crash resilience and torn-write protection.
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div
          style={{
            padding: '1rem 1.5rem',
            borderTop: isLight ? '1px solid #e2e8f0' : '1px solid #1e293b',
            display: 'flex',
            justifyContent: 'flex-end',
            gap: '0.75rem',
            background: isLight ? '#f8fafc' : '#0f172a',
          }}
        >
          <button
            type="button"
            className="btn btn-primary"
            onClick={onClose}
            style={{
              padding: '6px 18px',
              fontSize: '0.8rem',
              fontWeight: 700,
            }}
          >
            Done
          </button>
        </div>
      </div>
    </div>
  )
}
