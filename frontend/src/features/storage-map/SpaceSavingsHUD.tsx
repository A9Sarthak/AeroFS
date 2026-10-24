// ============================================================
//  AeroFS Studio — 3D Storage Map Space Savings & Efficiency HUD
//  Interactive real-time telemetry card floating over the 3D drive
// ============================================================

import React, { useState } from 'react'
import type { TelemetryResponse } from '../../api/types'
import { computeStorageSavings, formatBytes } from './savingsUtils'

interface SpaceSavingsHUDProps {
  telemetry?: TelemetryResponse | null
  theme: 'dark' | 'light'
  onOpenAnalysisModal: () => void
  onOpen75DemoModal: () => void
  onFilterShared: () => void
  onFilterSnapshot: () => void
}

export default function SpaceSavingsHUD({
  telemetry,
  theme,
  onOpenAnalysisModal,
  onOpen75DemoModal,
  onFilterShared,
  onFilterSnapshot,
}: SpaceSavingsHUDProps) {
  const [collapsed, setCollapsed] = useState(false)
  const savings = computeStorageSavings(telemetry)

  const isLight = theme === 'light'
  const hasSavings = savings.total_saved_bytes > 0

  return (
    <div
      style={{
        position: 'absolute',
        top: 16,
        left: 16,
        width: collapsed ? 240 : 330,
        background: isLight ? 'rgba(255, 255, 255, 0.96)' : 'rgba(10, 15, 29, 0.94)',
        backdropFilter: 'blur(16px)',
        border: `1px solid ${
          isLight
            ? hasSavings
              ? 'rgba(16, 185, 129, 0.5)'
              : 'rgba(2, 132, 199, 0.4)'
            : hasSavings
            ? 'rgba(16, 185, 129, 0.55)'
            : 'rgba(56, 189, 248, 0.35)'
        }`,
        borderRadius: 10,
        padding: '0.85rem',
        zIndex: 10,
        boxShadow: isLight
          ? '0 10px 32px rgba(16, 185, 129, 0.14), 0 2px 8px rgba(0,0,0,0.06)'
          : '0 12px 36px rgba(0, 0, 0, 0.6), 0 0 20px rgba(16, 185, 129, 0.15)',
        transition: 'all 0.25s ease',
        color: isLight ? '#0f172a' : '#f8fafc',
      }}
    >
      {/* Header with Title and Collapse Toggle */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          cursor: 'pointer',
          paddingBottom: collapsed ? 0 : 8,
          borderBottom: collapsed
            ? 'none'
            : isLight
            ? '1px solid rgba(0,0,0,0.08)'
            : '1px solid rgba(255,255,255,0.08)',
        }}
        onClick={() => setCollapsed(!collapsed)}
        title="Click to toggle Space Savings Telemetry"
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <span
            style={{
              width: 10,
              height: 10,
              borderRadius: '50%',
              background: '#10b981',
              boxShadow: '0 0 10px #10b981',
              animation: 'pulse 2s infinite',
            }}
          />
          <span
            style={{
              fontSize: '0.82rem',
              fontWeight: 800,
              letterSpacing: '0.02em',
              color: isLight ? '#047857' : '#34d399',
              display: 'flex',
              alignItems: 'center',
              gap: 5,
            }}
          >
            <span>⚡</span> Space Savings & Efficiency
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span
            style={{
              fontSize: '0.68rem',
              fontWeight: 700,
              padding: '2px 7px',
              borderRadius: 4,
              background: isLight ? 'rgba(16, 185, 129, 0.15)' : 'rgba(16, 185, 129, 0.22)',
              color: isLight ? '#065f46' : '#6ee7b7',
              border: '1px solid rgba(16, 185, 129, 0.3)',
            }}
          >
            {savings.savings_ratio}
          </span>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              setCollapsed(!collapsed)
            }}
            style={{
              background: 'transparent',
              border: 'none',
              color: isLight ? '#64748b' : '#94a3b8',
              cursor: 'pointer',
              fontSize: '0.85rem',
              fontWeight: 700,
              padding: '0 3px',
              lineHeight: 1,
            }}
          >
            {collapsed ? '+' : '−'}
          </button>
        </div>
      </div>

      {!collapsed && (
        <>
          {/* Hero Reclaimed Space Metric */}
          <div
            style={{
              marginTop: 10,
              padding: '9px 12px',
              borderRadius: 8,
              background: isLight
                ? 'linear-gradient(135deg, rgba(16, 185, 129, 0.08) 0%, rgba(124, 58, 237, 0.08) 100%)'
                : 'linear-gradient(135deg, rgba(16, 185, 129, 0.12) 0%, rgba(168, 85, 247, 0.12) 100%)',
              border: isLight ? '1px solid rgba(16, 185, 129, 0.25)' : '1px solid rgba(16, 185, 129, 0.3)',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <div>
              <div style={{ fontSize: '0.68rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: isLight ? '#047857' : '#34d399', fontWeight: 700 }}>
                Total Reclaimed Storage
              </div>
              <div style={{ fontSize: '1.25rem', fontWeight: 900, color: isLight ? '#065f46' : '#10b981', display: 'flex', alignItems: 'baseline', gap: 6, marginTop: 2 }}>
                <span>+{formatBytes(savings.total_saved_bytes)}</span>
                <span style={{ fontSize: '0.74rem', fontWeight: 700, color: isLight ? '#059669' : '#6ee7b7' }}>
                  ({savings.total_saved_blocks} blocks)
                </span>
              </div>
            </div>

            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: '0.68rem', color: isLight ? '#64748b' : '#94a3b8', fontWeight: 600 }}>
                Reduction
              </div>
              <div style={{ fontSize: '1.15rem', fontWeight: 800, color: isLight ? '#7c3aed' : '#c084fc' }}>
                {savings.savings_percent}%
              </div>
            </div>
          </div>

          {/* Visual Footprint Comparison Meter */}
          <div style={{ marginTop: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.7rem', color: isLight ? '#475569' : '#94a3b8', marginBottom: 4 }}>
              <span>Traditional FS (NTFS/ext4)</span>
              <span><strong>{formatBytes(savings.total_logical_bytes)}</strong> ({savings.total_logical_blocks} blk)</span>
            </div>

            {/* Comparison Bar */}
            <div
              style={{
                height: 10,
                borderRadius: 5,
                background: isLight ? '#e2e8f0' : '#1e293b',
                overflow: 'hidden',
                position: 'relative',
                display: 'flex',
                border: isLight ? '1px solid #cbd5e1' : '1px solid #334155',
              }}
            >
              {/* Physical Occupied Portion */}
              <div
                style={{
                  height: '100%',
                  width: `${savings.total_logical_blocks > 0 ? (savings.total_physical_blocks / savings.total_logical_blocks) * 100 : 100}%`,
                  background: 'linear-gradient(90deg, #0284c7 0%, #10b981 100%)',
                  transition: 'width 0.4s ease',
                }}
                title={`AeroFS Physical Footprint: ${savings.total_physical_blocks} blocks (${formatBytes(savings.total_physical_bytes)})`}
              />
              {/* Saved Reclaimed Portion */}
              <div
                style={{
                  height: '100%',
                  flex: 1,
                  background: 'repeating-linear-gradient(45deg, rgba(168, 85, 247, 0.35), rgba(168, 85, 247, 0.35) 6px, rgba(16, 185, 129, 0.4) 6px, rgba(16, 185, 129, 0.4) 12px)',
                }}
                title={`Saved by CAS & CoW: ${savings.total_saved_blocks} blocks (${formatBytes(savings.total_saved_bytes)})`}
              />
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.68rem', marginTop: 3 }}>
              <span style={{ color: isLight ? '#0284c7' : '#38bdf8' }}>
                ● Physical Disk: <strong>{formatBytes(savings.total_physical_bytes)}</strong>
              </span>
              <span style={{ color: isLight ? '#047857' : '#34d399', fontWeight: 600 }}>
                ★ Saved: <strong>{savings.savings_percent}%</strong>
              </span>
            </div>
          </div>

          {/* Subsystem Breakdown Grid */}
          <div
            style={{
              marginTop: 10,
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: 8,
            }}
          >
            {/* CAS Deduplication Tile */}
            <div
              style={{
                padding: '7px 9px',
                borderRadius: 6,
                background: isLight ? 'rgba(124, 58, 237, 0.06)' : 'rgba(168, 85, 247, 0.1)',
                border: isLight ? '1px solid rgba(124, 58, 237, 0.25)' : '1px solid rgba(168, 85, 247, 0.3)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: '0.7rem', fontWeight: 700, color: isLight ? '#7c3aed' : '#c084fc', display: 'flex', alignItems: 'center', gap: 4 }}>
                  <span>🔗</span> CAS Dedup
                </span>
                <button
                  type="button"
                  onClick={onFilterShared}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: isLight ? '#7c3aed' : '#c084fc',
                    cursor: 'pointer',
                    fontSize: '0.64rem',
                    textDecoration: 'underline',
                    padding: 0,
                    fontWeight: 600,
                  }}
                  title="Highlight all purple shared deduplication sectors on the 3D drive"
                >
                  Highlight
                </button>
              </div>
              <div style={{ fontSize: '0.92rem', fontWeight: 800, color: isLight ? '#6b21a8' : '#e9d5ff', marginTop: 3 }}>
                +{formatBytes(savings.cas.saved_bytes)}
              </div>
              <div style={{ fontSize: '0.66rem', color: isLight ? '#64748b' : '#94a3b8', marginTop: 1 }}>
                {savings.cas.saved_blocks} duplicate blocks avoided
              </div>
            </div>

            {/* CoW Snapshots Tile */}
            <div
              style={{
                padding: '7px 9px',
                borderRadius: 6,
                background: isLight ? 'rgba(217, 119, 6, 0.06)' : 'rgba(245, 158, 11, 0.1)',
                border: isLight ? '1px solid rgba(217, 119, 6, 0.25)' : '1px solid rgba(245, 158, 11, 0.3)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: '0.7rem', fontWeight: 700, color: isLight ? '#d97706' : '#fbbf24', display: 'flex', alignItems: 'center', gap: 4 }}>
                  <span>📷</span> CoW Snaps
                </span>
                <button
                  type="button"
                  onClick={onFilterSnapshot}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: isLight ? '#d97706' : '#fbbf24',
                    cursor: 'pointer',
                    fontSize: '0.64rem',
                    textDecoration: 'underline',
                    padding: 0,
                    fontWeight: 600,
                  }}
                  title="Highlight all amber snapshot sectors on the 3D drive"
                >
                  Highlight
                </button>
              </div>
              <div style={{ fontSize: '0.92rem', fontWeight: 800, color: isLight ? '#b45309' : '#fef3c7', marginTop: 3 }}>
                +{formatBytes(savings.cow.saved_bytes)}
              </div>
              <div style={{ fontSize: '0.66rem', color: isLight ? '#64748b' : '#94a3b8', marginTop: 1 }}>
                {savings.cow.snapshot_count} instant zero-copy snapshots
              </div>
            </div>
          </div>

          {/* Action Row */}
          <div style={{ marginTop: 10, display: 'flex', gap: 6 }}>
            <button
              type="button"
              onClick={onOpenAnalysisModal}
              style={{
                flex: 1,
                background: isLight ? '#0284c7' : 'linear-gradient(135deg, #0284c7 0%, #0369a1 100%)',
                color: '#ffffff',
                border: 'none',
                padding: '5px 8px',
                borderRadius: 5,
                fontSize: '0.72rem',
                fontWeight: 700,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 5,
                boxShadow: isLight ? '0 2px 6px rgba(2, 132, 199, 0.2)' : '0 2px 8px rgba(2, 132, 199, 0.4)',
              }}
              title="Open complete mathematical and viva defense breakdown"
            >
              <span>📊</span> Full Savings Analysis
            </button>

            <button
              type="button"
              onClick={onOpen75DemoModal}
              style={{
                background: isLight ? 'rgba(124, 58, 237, 0.1)' : 'rgba(168, 85, 247, 0.18)',
                color: isLight ? '#6b21a8' : '#c084fc',
                border: isLight ? '1px solid rgba(124, 58, 237, 0.3)' : '1px solid rgba(168, 85, 247, 0.4)',
                padding: '5px 8px',
                borderRadius: 5,
                fontSize: '0.72rem',
                fontWeight: 700,
                cursor: 'pointer',
                whiteSpace: 'nowrap',
              }}
              title="Test real-time partial block deduplication"
            >
              🎨 75% Demo
            </button>
          </div>
        </>
      )}
    </div>
  )
}
