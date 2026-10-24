// ============================================================
//  AeroFS Studio — 3D Block Content & Data Payload Viewer
//  Displays raw payload, decoded text, hex dump, CAS/CoW
//  sharing vs unique classification, and side-by-side
//  Shared vs Unique Proof when any block is clicked.
// ============================================================

import React, { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getBlockDetails } from '../../api/client'
import type { TelemetryResponse, BlockDetails } from '../../api/types'
import { formatBytes } from './savingsUtils'

interface BlockDataViewerProps {
  blockId: number | null
  onClose: () => void
  onSelectBlock: (id: number) => void
  telemetry?: TelemetryResponse | null
  theme: 'dark' | 'light'
}

export default function BlockDataViewer({
  blockId,
  onClose,
  onSelectBlock,
  telemetry,
  theme,
}: BlockDataViewerProps) {
  const [activeTab, setActiveTab] = useState<'text' | 'hex' | 'compare' | 'owners'>('text')
  const [copied, setCopied] = useState(false)
  const [isMinimized, setIsMinimized] = useState(false)
  const [isExpanded, setIsExpanded] = useState(false)

  const isLight = theme === 'light'

  // Fetch live block details and content for currently selected block
  const { data: details, isLoading } = useQuery<BlockDetails>({
    queryKey: ['block-details', blockId],
    queryFn: () => getBlockDetails(blockId!),
    enabled: blockId !== null,
    staleTime: 5000,
  })

  // Find files that own this block to offer sibling block navigation (e.g. Part 1, Part 2, etc.)
  const files = telemetry?.files || []
  const primaryFile = files.find((f) => f.block_ids?.includes(blockId ?? -1))
  const blockIds = primaryFile?.block_ids || []

  // Identify sample shared block and sample unique block within the file
  const sampleSharedId =
    blockIds.find((b) => (telemetry?.grid_blocks?.[b] ?? 0) === 3) ??
    ((details?.refcount ?? 1) > 1 ? blockId : null)

  const sampleUniqueId =
    blockIds.find((b) => (telemetry?.grid_blocks?.[b] ?? 0) === 2) ??
    ((details?.refcount ?? 1) <= 1 && details?.is_allocated ? blockId : null)

  // Query sample shared block payload
  const { data: sharedBlockData } = useQuery<BlockDetails>({
    queryKey: ['block-details', sampleSharedId],
    queryFn: () => getBlockDetails(sampleSharedId!),
    enabled: sampleSharedId !== null && sampleSharedId !== undefined,
    staleTime: 10000,
  })

  // Query sample unique block payload
  const { data: uniqueBlockData } = useQuery<BlockDetails>({
    queryKey: ['block-details', sampleUniqueId],
    queryFn: () => getBlockDetails(sampleUniqueId!),
    enabled: sampleUniqueId !== null && sampleUniqueId !== undefined,
    staleTime: 10000,
  })

  // Check for counterpart twin file (e.g. fileB_75pct.txt vs fileA_75pct.txt)
  const twinFile = files.find(
    (f) =>
      f.name !== primaryFile?.name &&
      f.block_ids?.some((b) => sampleSharedId !== null && f.block_ids.includes(sampleSharedId))
  )
  const twinUniqueId = twinFile?.block_ids?.find(
    (b) => !blockIds.includes(b)
  )

  const { data: twinUniqueData } = useQuery<BlockDetails>({
    queryKey: ['block-details', twinUniqueId],
    queryFn: () => getBlockDetails(twinUniqueId!),
    enabled: twinUniqueId !== null && twinUniqueId !== undefined,
    staleTime: 10000,
  })

  if (blockId === null) return null

  const handleCopy = () => {
    if (details?.data_text) {
      navigator.clipboard.writeText(details.data_text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  const isShared = (details?.refcount ?? 1) > 1 || (details?.referencing_files?.length ?? 0) >= 2
  const isSnapshotShared = (details?.referencing_snapshots?.length ?? 0) >= 1
  const isUnique = details?.is_allocated && !isShared && !isSnapshotShared && !details?.is_metadata

  const cardWidth = isMinimized
    ? 340
    : isExpanded || activeTab === 'compare'
    ? 680
    : 480

  return (
    <div
      style={{
        position: 'absolute',
        bottom: 24,
        right: 24,
        width: cardWidth,
        maxWidth: 'calc(100vw - 48px)',
        maxHeight: 'calc(100vh - 120px)',
        overflowY: 'auto',
        background: isLight ? 'rgba(255, 255, 255, 0.98)' : 'rgba(10, 15, 29, 0.96)',
        backdropFilter: 'blur(20px)',
        border: `1px solid ${
          isLight
            ? isShared
              ? 'rgba(124, 58, 237, 0.6)'
              : isUnique
              ? 'rgba(16, 185, 129, 0.6)'
              : 'rgba(2, 132, 199, 0.5)'
            : isShared
            ? 'rgba(168, 85, 247, 0.6)'
            : isUnique
            ? 'rgba(16, 185, 129, 0.6)'
            : 'rgba(56, 189, 248, 0.45)'
        }`,
        borderRadius: 12,
        padding: '1rem',
        zIndex: 35,
        boxShadow: isLight
          ? isShared
            ? '0 12px 40px rgba(124, 58, 237, 0.18), 0 4px 12px rgba(0,0,0,0.08)'
            : '0 12px 40px rgba(0, 0, 0, 0.14)'
          : isShared
          ? '0 16px 48px rgba(0, 0, 0, 0.7), 0 0 24px rgba(168, 85, 247, 0.25)'
          : '0 16px 48px rgba(0, 0, 0, 0.7), 0 0 24px rgba(16, 185, 129, 0.2)',
        color: isLight ? '#0f172a' : '#f8fafc',
        transition: 'width 0.2s ease, max-height 0.2s ease',
      }}
    >
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          borderBottom: isMinimized
            ? 'none'
            : isLight
            ? '1px solid rgba(0,0,0,0.08)'
            : '1px solid rgba(255,255,255,0.08)',
          paddingBottom: isMinimized ? 0 : 8,
          marginBottom: isMinimized ? 0 : 10,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span
            style={{
              width: 12,
              height: 12,
              borderRadius: 3,
              background: isShared
                ? '#a855f7'
                : isUnique
                ? '#10b981'
                : details?.is_metadata
                ? '#0284c7'
                : details?.is_corrupted
                ? '#ef4444'
                : '#64748b',
              boxShadow: `0 0 10px ${
                isShared ? '#a855f7' : isUnique ? '#10b981' : '#0284c7'
              }`,
            }}
          />
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              <span style={{ fontSize: '0.92rem', fontWeight: 800 }}>
                Physical Sector #{blockId}
              </span>
              <span
                style={{
                  fontSize: '0.66rem',
                  fontWeight: 700,
                  padding: '2px 7px',
                  borderRadius: 12,
                  background: isShared
                    ? isLight
                      ? 'rgba(124, 58, 237, 0.12)'
                      : 'rgba(168, 85, 247, 0.2)'
                    : isUnique
                    ? isLight
                      ? 'rgba(16, 185, 129, 0.12)'
                      : 'rgba(16, 185, 129, 0.2)'
                    : isLight
                    ? 'rgba(2, 132, 199, 0.1)'
                    : 'rgba(56, 189, 248, 0.15)',
                  color: isShared
                    ? isLight
                      ? '#6b21a8'
                      : '#c084fc'
                    : isUnique
                    ? isLight
                      ? '#047857'
                      : '#34d399'
                    : isLight
                    ? '#0284c7'
                    : '#38bdf8',
                  border: `1px solid ${
                    isShared ? '#a855f7' : isUnique ? '#10b981' : '#38bdf8'
                  }`,
                }}
              >
                {isShared
                  ? `🔗 CAS SHARED (Refcount: ${details?.refcount ?? 2})`
                  : isUnique
                  ? '🟢 UNIQUE DATA (Refcount: 1)'
                  : details?.is_metadata
                  ? '⚙️ SYSTEM METADATA'
                  : '⚪ FREE SECTOR'}
              </span>
            </div>
          </div>
        </div>

        {/* Window controls */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <button
            type="button"
            onClick={() => setIsExpanded(!isExpanded)}
            style={{
              background: 'transparent',
              border: 'none',
              color: isLight ? '#64748b' : '#94a3b8',
              cursor: 'pointer',
              fontSize: '0.85rem',
              fontWeight: 700,
              padding: '2px 5px',
            }}
            title={isExpanded ? 'Standard Width' : 'Wide / Comparison View'}
          >
            {isExpanded ? '❐' : '⛶'}
          </button>
          <button
            type="button"
            onClick={() => setIsMinimized(!isMinimized)}
            style={{
              background: 'transparent',
              border: 'none',
              color: isLight ? '#64748b' : '#94a3b8',
              cursor: 'pointer',
              fontSize: '0.85rem',
              fontWeight: 700,
              padding: '2px 5px',
            }}
            title={isMinimized ? 'Expand Viewer' : 'Minimize Viewer'}
          >
            {isMinimized ? '▲' : '▼'}
          </button>
          <button
            type="button"
            onClick={onClose}
            style={{
              background: 'transparent',
              border: 'none',
              color: isLight ? '#64748b' : '#94a3b8',
              cursor: 'pointer',
              fontSize: '1rem',
              fontWeight: 700,
              padding: '2px 5px',
              lineHeight: 1,
            }}
            title="Close Block Content Viewer"
          >
            ✕
          </button>
        </div>
      </div>

      {!isMinimized && (
        <>
          {/* ── Sharing vs Unique Classification Banner ──────────────────── */}
          <div
            style={{
              padding: '8px 12px',
              borderRadius: 8,
              background: isShared
                ? isLight
                  ? 'linear-gradient(135deg, rgba(124, 58, 237, 0.1) 0%, rgba(2, 132, 199, 0.08) 100%)'
                  : 'linear-gradient(135deg, rgba(168, 85, 247, 0.18) 0%, rgba(56, 189, 248, 0.12) 100%)'
                : isUnique
                ? isLight
                  ? 'rgba(16, 185, 129, 0.1)'
                  : 'rgba(16, 185, 129, 0.16)'
                : isLight
                ? 'rgba(2, 132, 199, 0.08)'
                : 'rgba(56, 189, 248, 0.1)',
              border: `1px solid ${
                isShared
                  ? isLight
                    ? 'rgba(124, 58, 237, 0.35)'
                    : 'rgba(168, 85, 247, 0.45)'
                  : isUnique
                  ? isLight
                    ? 'rgba(16, 185, 129, 0.35)'
                    : 'rgba(16, 185, 129, 0.45)'
                  : 'rgba(56, 189, 248, 0.3)'
              }`,
              marginBottom: 10,
              fontSize: '0.74rem',
              lineHeight: 1.45,
            }}
          >
            <div
              style={{
                fontWeight: 800,
                color: isShared
                  ? isLight
                    ? '#6b21a8'
                    : '#c084fc'
                  : isUnique
                  ? isLight
                    ? '#047857'
                    : '#34d399'
                  : '#38bdf8',
                marginBottom: 2,
              }}
            >
              {isShared
                ? '🔗 CAS Deduplicated Content (Multiple Files Share This Sector)'
                : isUnique
                ? '🟢 Unique Data Sector (Belongs Exclusively to 1 File)'
                : details?.sharing_label || 'Physical Sector Telemetry'}
            </div>
            <div style={{ color: isLight ? '#475569' : '#cbd5e1' }}>
              {details?.sharing_explanation ||
                (isShared
                  ? `This 4KB payload is 100% identical across ${details?.referencing_files?.join(', ')}. AeroFS stores it once on disk, saving 4,096 bytes per duplicate!`
                  : `This 4KB sector contains unique data specific to ${details?.referencing_files?.[0] || 'its owner file'}.`)}
            </div>
          </div>

          {/* ── Sibling Chunk Navigator (e.g. Part 1, Part 2, Part 3, Part 4) ── */}
          {primaryFile && primaryFile.block_ids && primaryFile.block_ids.length > 1 && (
            <div
              style={{
                marginBottom: 10,
                padding: '8px 10px',
                borderRadius: 8,
                background: isLight ? '#f1f5f9' : '#0f172a',
                border: isLight ? '1px solid #cbd5e1' : '1px solid #1e293b',
              }}
            >
              <div
                style={{
                  fontSize: '0.68rem',
                  color: isLight ? '#64748b' : '#94a3b8',
                  marginBottom: 6,
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
              >
                <span>
                  Owner File: <strong>{primaryFile.name}</strong> ({primaryFile.num_blocks} blocks)
                </span>
                <span style={{ fontSize: '0.66rem', color: isLight ? '#0284c7' : '#38bdf8' }}>
                  Click chunk to inspect payload:
                </span>
              </div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {primaryFile.block_ids.map((b, idx) => {
                  const isCurrent = b === blockId
                  const isBShared = (telemetry?.grid_blocks?.[b] ?? 0) === 3

                  return (
                    <button
                      key={`${b}-${idx}`}
                      type="button"
                      onClick={() => onSelectBlock(b)}
                      style={{
                        padding: '4px 9px',
                        borderRadius: 6,
                        fontSize: '0.70rem',
                        fontWeight: isCurrent ? 800 : 600,
                        border: isCurrent
                          ? '2px solid #38bdf8'
                          : isBShared
                          ? isLight
                            ? '1px solid #c084fc'
                            : '1px solid rgba(168, 85, 247, 0.4)'
                          : isLight
                          ? '1px solid #a7f3d0'
                          : '1px solid rgba(16, 185, 129, 0.4)',
                        background: isCurrent
                          ? '#0284c7'
                          : isBShared
                          ? isLight
                            ? 'rgba(124, 58, 237, 0.12)'
                            : 'rgba(168, 85, 247, 0.22)'
                          : isLight
                          ? 'rgba(16, 185, 129, 0.1)'
                          : 'rgba(16, 185, 129, 0.18)',
                        color: isCurrent
                          ? '#ffffff'
                          : isBShared
                          ? isLight
                            ? '#6b21a8'
                            : '#c084fc'
                          : isLight
                          ? '#047857'
                          : '#34d399',
                        cursor: 'pointer',
                        transition: 'all 0.15s ease',
                        boxShadow: isCurrent ? '0 0 10px rgba(56, 189, 248, 0.5)' : 'none',
                      }}
                      title={`Inspect Part ${idx + 1} (Block #${b})`}
                    >
                      Part {idx + 1} (#{b}) {isBShared ? '🔗 Shared' : '🟢 Unique'}
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {/* ── Content Viewer Tabs ───────────────────────────────────────── */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: 8,
              flexWrap: 'wrap',
              gap: 6,
            }}
          >
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
              <button
                type="button"
                onClick={() => setActiveTab('text')}
                style={{
                  padding: '4px 10px',
                  borderRadius: 5,
                  fontSize: '0.72rem',
                  fontWeight: 700,
                  border: 'none',
                  cursor: 'pointer',
                  background:
                    activeTab === 'text' ? '#0284c7' : 'rgba(255,255,255,0.06)',
                  color: activeTab === 'text' ? '#fff' : isLight ? '#64748b' : '#94a3b8',
                }}
              >
                📄 Decoded Text
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('hex')}
                style={{
                  padding: '4px 10px',
                  borderRadius: 5,
                  fontSize: '0.72rem',
                  fontWeight: 700,
                  border: 'none',
                  cursor: 'pointer',
                  background:
                    activeTab === 'hex' ? '#0284c7' : 'rgba(255,255,255,0.06)',
                  color: activeTab === 'hex' ? '#fff' : isLight ? '#64748b' : '#94a3b8',
                }}
              >
                🔢 Hex Dump
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('compare')}
                style={{
                  padding: '4px 10px',
                  borderRadius: 5,
                  fontSize: '0.72rem',
                  fontWeight: 700,
                  border: 'none',
                  cursor: 'pointer',
                  background:
                    activeTab === 'compare'
                      ? isLight
                        ? '#7c3aed'
                        : '#9333ea'
                      : 'rgba(168, 85, 247, 0.12)',
                  color:
                    activeTab === 'compare'
                      ? '#fff'
                      : isLight
                      ? '#7c3aed'
                      : '#c084fc',
                }}
              >
                ⚡ Shared vs Unique Proof
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('owners')}
                style={{
                  padding: '4px 10px',
                  borderRadius: 5,
                  fontSize: '0.72rem',
                  fontWeight: 700,
                  border: 'none',
                  cursor: 'pointer',
                  background:
                    activeTab === 'owners' ? '#0284c7' : 'rgba(255,255,255,0.06)',
                  color: activeTab === 'owners' ? '#fff' : isLight ? '#64748b' : '#94a3b8',
                }}
              >
                👥 Attribution ({details?.referencing_files?.length || 0})
              </button>
            </div>

            {activeTab === 'text' && (
              <button
                type="button"
                onClick={handleCopy}
                style={{
                  background: isLight ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.08)',
                  border: isLight ? '1px solid #cbd5e1' : '1px solid #334155',
                  borderRadius: 4,
                  padding: '2px 8px',
                  fontSize: '0.68rem',
                  color: copied ? '#10b981' : isLight ? '#475569' : '#cbd5e1',
                  cursor: 'pointer',
                  fontWeight: 600,
                }}
              >
                {copied ? '✓ Copied' : '📋 Copy Text'}
              </button>
            )}
          </div>

          {/* ── Content Viewport ─────────────────────────────────────────── */}
          <div
            style={{
              maxHeight: activeTab === 'compare' ? '380px' : '230px',
              minHeight: '120px',
              overflowY: 'auto',
              borderRadius: 8,
              background: isLight ? '#f8fafc' : '#070b14',
              border: isLight ? '1px solid #cbd5e1' : '1px solid #1e293b',
              padding: '0.75rem 0.85rem',
              fontFamily: 'monospace',
              fontSize: '0.72rem',
              lineHeight: 1.45,
              position: 'relative',
            }}
          >
            {isLoading ? (
              <div style={{ color: '#94a3b8', textAlign: 'center', padding: '2rem 0' }}>
                Reading physical sector from virtual disk container…
              </div>
            ) : activeTab === 'text' ? (
              <pre
                style={{
                  margin: 0,
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-all',
                  color: isLight ? '#0f172a' : '#e2e8f0',
                }}
              >
                {details?.data_text || '[Empty or zeroed block]'}
              </pre>
            ) : activeTab === 'hex' ? (
              <pre
                style={{
                  margin: 0,
                  whiteSpace: 'pre',
                  color: isLight ? '#0369a1' : '#38bdf8',
                  fontSize: '0.68rem',
                }}
              >
                {details?.hex_dump || '0000: 00 00 00 00 ... | ....'}
              </pre>
            ) : activeTab === 'compare' ? (
              /* ── Side-by-Side Shared vs Unique Proof Tab ── */
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {/* Comparison Banner */}
                <div
                  style={{
                    padding: '8px 10px',
                    borderRadius: 6,
                    background: isLight ? '#f1f5f9' : '#0f172a',
                    border: isLight ? '1px solid #e2e8f0' : '1px solid #1e293b',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    flexWrap: 'wrap',
                    gap: 6,
                  }}
                >
                  <div style={{ fontSize: '0.72rem' }}>
                    <strong>Proof Analysis:</strong> Comparing Shared CAS blocks vs Unique blocks
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <span style={{ color: '#c084fc', fontWeight: 700 }}>
                      🔗 75% Shared (Refcount: 2)
                    </span>
                    <span style={{ color: '#34d399', fontWeight: 700 }}>
                      🟢 25% Unique (Refcount: 1)
                    </span>
                  </div>
                </div>

                {/* Two Column Side-by-Side Comparison */}
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: isExpanded || cardWidth > 550 ? '1fr 1fr' : '1fr',
                    gap: 10,
                  }}
                >
                  {/* Left Column: Shared Content */}
                  <div
                    style={{
                      borderRadius: 6,
                      background: isLight ? '#ffffff' : '#0b1120',
                      border: '1px solid rgba(168, 85, 247, 0.4)',
                      padding: '8px 10px',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 6,
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        borderBottom: '1px solid rgba(168, 85, 247, 0.2)',
                        paddingBottom: 4,
                      }}
                    >
                      <strong style={{ color: '#c084fc', fontSize: '0.72rem' }}>
                        🔗 CAS Shared (Block #{sampleSharedId ?? '—'})
                      </strong>
                      <span
                        style={{
                          fontSize: '0.64rem',
                          padding: '1px 5px',
                          borderRadius: 4,
                          background: 'rgba(168, 85, 247, 0.2)',
                          color: '#c084fc',
                          fontWeight: 700,
                        }}
                      >
                        Refcount: {sharedBlockData?.refcount ?? 2}
                      </span>
                    </div>

                    <div style={{ fontSize: '0.66rem', color: isLight ? '#64748b' : '#94a3b8' }}>
                      Identical in: {sharedBlockData?.referencing_files?.join(', ') || primaryFile?.name}
                    </div>

                    <div
                      style={{
                        maxHeight: '130px',
                        overflowY: 'auto',
                        background: isLight ? '#f8fafc' : '#030712',
                        padding: '6px 8px',
                        borderRadius: 4,
                        fontSize: '0.66rem',
                        lineHeight: 1.4,
                        whiteSpace: 'pre-wrap',
                        wordBreak: 'break-all',
                        color: isLight ? '#1e293b' : '#e2e8f0',
                      }}
                    >
                      {sharedBlockData?.data_text || 'Loading shared block content…'}
                    </div>

                    <div
                      style={{
                        fontSize: '0.64rem',
                        color: '#a855f7',
                        fontWeight: 600,
                        marginTop: 'auto',
                      }}
                    >
                      ✓ Saved 4,096 bytes: Pointed to existing sector via SHA-256 hash match!
                    </div>
                  </div>

                  {/* Right Column: Unique Content */}
                  <div
                    style={{
                      borderRadius: 6,
                      background: isLight ? '#ffffff' : '#0b1120',
                      border: '1px solid rgba(16, 185, 129, 0.4)',
                      padding: '8px 10px',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 6,
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        borderBottom: '1px solid rgba(16, 185, 129, 0.2)',
                        paddingBottom: 4,
                      }}
                    >
                      <strong style={{ color: '#34d399', fontSize: '0.72rem' }}>
                        🟢 Unique Data (Block #{sampleUniqueId ?? '—'})
                      </strong>
                      <span
                        style={{
                          fontSize: '0.64rem',
                          padding: '1px 5px',
                          borderRadius: 4,
                          background: 'rgba(16, 185, 129, 0.2)',
                          color: '#34d399',
                          fontWeight: 700,
                        }}
                      >
                        Refcount: 1
                      </span>
                    </div>

                    <div style={{ fontSize: '0.66rem', color: isLight ? '#64748b' : '#94a3b8' }}>
                      Exclusive to: {uniqueBlockData?.referencing_files?.[0] || primaryFile?.name}
                    </div>

                    <div
                      style={{
                        maxHeight: '130px',
                        overflowY: 'auto',
                        background: isLight ? '#f8fafc' : '#030712',
                        padding: '6px 8px',
                        borderRadius: 4,
                        fontSize: '0.66rem',
                        lineHeight: 1.4,
                        whiteSpace: 'pre-wrap',
                        wordBreak: 'break-all',
                        color: isLight ? '#1e293b' : '#e2e8f0',
                      }}
                    >
                      {uniqueBlockData?.data_text || 'Loading unique block content…'}
                    </div>

                    <div
                      style={{
                        fontSize: '0.64rem',
                        color: '#10b981',
                        fontWeight: 600,
                        marginTop: 'auto',
                      }}
                    >
                      ⚠️ Allocated 4KB: Modified content produced unique SHA-256 fingerprint!
                    </div>
                  </div>
                </div>

                {/* Counterpart Divergence Comparison (e.g. File A Part 4 vs File B Part 4) */}
                {twinFile && twinUniqueId && (
                  <div
                    style={{
                      padding: '8px 10px',
                      borderRadius: 6,
                      background: isLight
                        ? 'rgba(124, 58, 237, 0.06)'
                        : 'rgba(168, 85, 247, 0.1)',
                      border: '1px solid rgba(168, 85, 247, 0.25)',
                    }}
                  >
                    <div
                      style={{
                        fontSize: '0.70rem',
                        fontWeight: 800,
                        color: isLight ? '#6b21a8' : '#c084fc',
                        marginBottom: 4,
                      }}
                    >
                      ⚡ Why Part 4 Diverged: {primaryFile?.name} vs {twinFile.name}
                    </div>
                    <div
                      style={{
                        display: 'grid',
                        gridTemplateColumns: '1fr 1fr',
                        gap: 8,
                      }}
                    >
                      <div>
                        <div
                          style={{
                            fontSize: '0.64rem',
                            fontWeight: 700,
                            color: '#38bdf8',
                            marginBottom: 2,
                          }}
                        >
                          {primaryFile?.name} Part 4 (#
                          {sampleUniqueId}):
                        </div>
                        <div
                          style={{
                            fontSize: '0.64rem',
                            maxHeight: '65px',
                            overflowY: 'auto',
                            background: isLight ? '#fff' : '#070b14',
                            padding: '4px 6px',
                            borderRadius: 4,
                            border: isLight ? '1px solid #e2e8f0' : '1px solid #1e293b',
                            whiteSpace: 'pre-wrap',
                            wordBreak: 'break-all',
                            color: isLight ? '#1e293b' : '#e2e8f0',
                          }}
                        >
                          {uniqueBlockData?.data_text?.slice(0, 180)}…
                        </div>
                      </div>

                      <div>
                        <div
                          style={{
                            fontSize: '0.64rem',
                            fontWeight: 700,
                            color: '#fbbf24',
                            marginBottom: 2,
                          }}
                        >
                          {twinFile.name} Part 4 (#{twinUniqueId}):
                        </div>
                        <div
                          style={{
                            fontSize: '0.64rem',
                            maxHeight: '65px',
                            overflowY: 'auto',
                            background: isLight ? '#fff' : '#070b14',
                            padding: '4px 6px',
                            borderRadius: 4,
                            border: isLight ? '1px solid #e2e8f0' : '1px solid #1e293b',
                            whiteSpace: 'pre-wrap',
                            wordBreak: 'break-all',
                            color: isLight ? '#1e293b' : '#e2e8f0',
                          }}
                        >
                          {twinUniqueData?.data_text?.slice(0, 180)}…
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              /* Owners & Chunk Mapping Tab */
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ fontSize: '0.7rem', color: isLight ? '#64748b' : '#94a3b8' }}>
                  Files referencing this physical sector:
                </div>
                {details?.file_chunks && details.file_chunks.length > 0 ? (
                  details.file_chunks.map((fc, i) => (
                    <div
                      key={i}
                      style={{
                        padding: '6px 8px',
                        borderRadius: 4,
                        background: isLight ? '#ffffff' : '#0f172a',
                        border: isLight ? '1px solid #e2e8f0' : '1px solid #1e293b',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                      }}
                    >
                      <div>
                        <strong style={{ color: isLight ? '#0284c7' : '#38bdf8' }}>
                          📄 {fc.file_name}
                        </strong>
                        <div style={{ fontSize: '0.66rem', color: isLight ? '#64748b' : '#94a3b8' }}>
                          Chunk #{fc.chunk_part} of {fc.total_chunks} ({formatBytes(fc.file_size)} total)
                        </div>
                      </div>
                      <span
                        style={{
                          fontSize: '0.66rem',
                          padding: '1px 6px',
                          borderRadius: 4,
                          background: isShared
                            ? 'rgba(168, 85, 247, 0.15)'
                            : 'rgba(16, 185, 129, 0.15)',
                          color: isShared ? '#c084fc' : '#34d399',
                          fontWeight: 700,
                        }}
                      >
                        {isShared ? 'CAS SHARED' : 'UNIQUE'}
                      </span>
                    </div>
                  ))
                ) : (
                  <div style={{ color: '#94a3b8' }}>No active files reference this block.</div>
                )}

                {details?.referencing_snapshots && details.referencing_snapshots.length > 0 && (
                  <div style={{ marginTop: 6 }}>
                    <div style={{ fontSize: '0.7rem', color: isLight ? '#64748b' : '#94a3b8' }}>
                      Snapshots preserving this sector:
                    </div>
                    {details.referencing_snapshots.map((s) => (
                      <div
                        key={s}
                        style={{
                          marginTop: 4,
                          padding: '4px 8px',
                          borderRadius: 4,
                          background: 'rgba(245, 158, 11, 0.12)',
                          border: '1px solid rgba(245, 158, 11, 0.25)',
                          color: '#fbbf24',
                          fontSize: '0.7rem',
                        }}
                      >
                        📷 {s} (Zero-Copy Frozen Reference)
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* ── Cryptographic Telemetry Footer ────────────────────────────── */}
          <div
            style={{
              marginTop: 8,
              fontSize: '0.68rem',
              display: 'flex',
              flexDirection: 'column',
              gap: 2,
              color: isLight ? '#64748b' : '#94a3b8',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>Expected SHA-256:</span>
              <span className="mono" style={{ color: isLight ? '#0284c7' : '#38bdf8' }}>
                {details?.expected_hash ? `${details.expected_hash.slice(0, 16)}...` : '—'}
              </span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>Actual on Disk:</span>
              <span
                className="mono"
                style={{
                  color: details?.hash_matches
                    ? isLight
                      ? '#047857'
                      : '#34d399'
                    : '#ef4444',
                }}
              >
                {details?.actual_hash ? `${details.actual_hash.slice(0, 16)}...` : '—'}
                {details?.hash_matches ? ' (Verified Clean ✓)' : ' (Bit-Rot Detected ✗)'}
              </span>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
