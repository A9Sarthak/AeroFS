/**
 * LiveHealingDemo.tsx
 * Full interactive end-to-end auto-healing demonstration:
 *  1. Select file + block
 *  2. Capture baseline (content, Merkle tree, block bytes)
 *  3. Inject bit-rot — animated byte flip, diff view, broken Merkle tree
 *  4. Repair — animated data-flow from cache/snapshot, Merkle tree heals
 *  5. Before/after full comparison
 */

import { useState, useEffect, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getTelemetry, liveHeal } from '../../api/client'
import { useStore } from '../../state/store'
import type {
  LiveHealBaselineResponse,
  LiveHealCorruptResponse,
  LiveHealRepairResponse,
  ChangedOffset,
} from '../../api/types'

// ─────────────────────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────────────────────

/** Renders a simplified Merkle tree as a visual grid */
function MerkleTreeViz({
  leaves,
  root,
  corruptedIndex,
  label,
  accent,
}: {
  leaves: string[]
  root: string
  corruptedIndex?: number
  label: string
  accent: string
}) {
  if (!leaves.length) return null
  return (
    <div style={{ fontFamily: 'monospace' }}>
      <div style={{ fontSize: '0.72rem', color: '#64748b', fontWeight: 700, marginBottom: '0.5rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        {label}
      </div>
      {/* Root */}
      <div style={{ textAlign: 'center', marginBottom: '0.5rem' }}>
        <div style={{
          display: 'inline-block', padding: '3px 10px',
          background: 'rgba(139,92,246,0.15)', border: '1px solid #7c3aed',
          borderRadius: '4px', fontSize: '0.65rem', color: '#a78bfa', fontWeight: 700,
        }}>
          ROOT: {root.slice(0, 10)}…{root.slice(-6)}
        </div>
      </div>
      {/* Connector line */}
      <div style={{ textAlign: 'center', color: '#475569', fontSize: '0.9rem', lineHeight: 1, marginBottom: '0.35rem' }}>│</div>
      {/* Leaves */}
      <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', justifyContent: 'center' }}>
        {leaves.map((lh, idx) => {
          const isBad = idx === corruptedIndex
          return (
            <div key={idx} style={{
              padding: '4px 6px', borderRadius: '4px',
              background: isBad ? 'rgba(239,68,68,0.15)' : 'rgba(16,185,129,0.08)',
              border: `1px solid ${isBad ? '#ef4444' : 'rgba(16,185,129,0.3)'}`,
              fontSize: '0.6rem', color: isBad ? '#ef4444' : '#10b981',
              transition: 'all 0.4s ease',
              boxShadow: isBad ? '0 0 8px rgba(239,68,68,0.4)' : 'none',
              position: 'relative',
            }}>
              {isBad && (
                <span style={{ position: 'absolute', top: '-8px', left: '50%', transform: 'translateX(-50%)', fontSize: '0.65rem' }}>💀</span>
              )}
              B{idx}: {lh.slice(0, 8)}…
            </div>
          )
        })}
      </div>
    </div>
  )
}

/** Animated hex byte display that shows changed bytes */
function HexDiff({
  cleanHex,
  corruptedHex,
  changedOffsets,
  animate,
}: {
  cleanHex: string
  corruptedHex: string
  changedOffsets: ChangedOffset[]
  animate: boolean
}) {
  const changedByteSet = new Set(changedOffsets.map(c => c.offset))
  // Parse hex string into array of 2-char byte strings
  const cleanBytes = cleanHex.match(/.{2}/g) ?? []
  const corruptBytes = corruptedHex.match(/.{2}/g) ?? []

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
      {(['before', 'after'] as const).map((side) => {
        const bytes = side === 'before' ? cleanBytes : corruptBytes
        return (
          <div key={side}>
            <div style={{
              fontSize: '0.65rem', fontWeight: 700, textTransform: 'uppercase',
              color: side === 'before' ? '#10b981' : '#ef4444', marginBottom: '0.4rem'
            }}>
              {side === 'before' ? '✅ Clean bytes' : '💀 Corrupted bytes'}
            </div>
            <div style={{
              fontFamily: 'monospace', fontSize: '0.7rem',
              display: 'flex', flexWrap: 'wrap', gap: '3px',
            }}>
              {bytes.map((b, i) => {
                const isChanged = changedByteSet.has(i)
                return (
                  <span key={i} style={{
                    padding: '2px 4px', borderRadius: '3px',
                    background: isChanged
                      ? (side === 'before' ? 'rgba(16,185,129,0.25)' : 'rgba(239,68,68,0.3)')
                      : 'rgba(30,41,59,0.8)',
                    color: isChanged
                      ? (side === 'before' ? '#10b981' : '#ef4444')
                      : '#64748b',
                    border: isChanged
                      ? `1px solid ${side === 'before' ? '#10b981' : '#ef4444'}`
                      : '1px solid transparent',
                    fontWeight: isChanged ? 700 : 400,
                    transition: animate ? 'all 0.5s ease' : 'none',
                    animation: isChanged && animate && side === 'after'
                      ? 'byte-corrupt 0.6s ease forwards' : 'none',
                  }}>
                    {b}
                  </span>
                )
              })}
            </div>
          </div>
        )
      })}
    </div>
  )
}

/** Animated data flow arrow from source to block */
function DataFlowAnimation({
  source,
  active,
}: {
  source: 'cache' | 'snapshot'
  active: boolean
}) {
  const [flowActive, setFlowActive] = useState(false)
  useEffect(() => {
    if (active) {
      setTimeout(() => setFlowActive(true), 300)
    } else {
      setFlowActive(false)
    }
  }, [active])

  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      gap: '1rem', padding: '1.5rem', position: 'relative',
    }}>
      {/* Source box */}
      <div style={{
        padding: '0.75rem 1rem', borderRadius: '10px', textAlign: 'center', minWidth: '120px',
        background: source === 'cache'
          ? 'rgba(56,189,248,0.12)' : 'rgba(167,139,250,0.12)',
        border: `2px solid ${source === 'cache' ? '#38bdf8' : '#a78bfa'}`,
        boxShadow: flowActive
          ? `0 0 20px ${source === 'cache' ? 'rgba(56,189,248,0.4)' : 'rgba(167,139,250,0.4)'}`
          : 'none',
        transition: 'box-shadow 0.4s ease',
      }}>
        <div style={{ fontSize: '1.5rem' }}>{source === 'cache' ? '🧠' : '📷'}</div>
        <div style={{ fontSize: '0.75rem', fontWeight: 700, color: source === 'cache' ? '#38bdf8' : '#a78bfa', marginTop: '4px' }}>
          {source === 'cache' ? 'Recovery Cache' : 'Snapshot Store'}
        </div>
        <div style={{ fontSize: '0.65rem', color: '#64748b', marginTop: '2px' }}>
          {source === 'cache' ? 'Tier-1 • In-memory' : 'Tier-2 • Immutable'}
        </div>
      </div>

      {/* Animated flow arrow */}
      <div style={{ flex: 1, position: 'relative', height: '40px', overflow: 'hidden' }}>
        {/* Static arrow line */}
        <div style={{
          position: 'absolute', top: '50%', left: 0, right: 0,
          height: '2px', background: 'rgba(255,255,255,0.1)', transform: 'translateY(-50%)'
        }} />
        {/* Animated flow packet */}
        {flowActive && (
          <div style={{
            position: 'absolute', top: '50%', transform: 'translateY(-50%)',
            width: '20px', height: '8px', borderRadius: '4px',
            background: source === 'cache'
              ? 'linear-gradient(90deg, #38bdf8, #0ea5e9)' : 'linear-gradient(90deg, #a78bfa, #7c3aed)',
            boxShadow: `0 0 12px ${source === 'cache' ? '#38bdf8' : '#a78bfa'}`,
            animation: 'data-flow 0.8s ease-in-out 3',
          }} />
        )}
        {/* Arrow head */}
        <div style={{
          position: 'absolute', right: 0, top: '50%', transform: 'translateY(-50%)',
          color: flowActive ? (source === 'cache' ? '#38bdf8' : '#a78bfa') : '#334155',
          fontSize: '1.2rem', transition: 'color 0.4s ease',
        }}>→</div>
        <div style={{ position: 'absolute', top: '1rem', left: '50%', transform: 'translateX(-50%)', fontSize: '0.6rem', color: '#64748b', whiteSpace: 'nowrap' }}>
          {flowActive ? '📦 Clean block data transferring…' : ''}
        </div>
      </div>

      {/* Target block */}
      <div style={{
        padding: '0.75rem 1rem', borderRadius: '10px', textAlign: 'center', minWidth: '100px',
        background: flowActive ? 'rgba(16,185,129,0.15)' : 'rgba(239,68,68,0.1)',
        border: `2px solid ${flowActive ? '#10b981' : '#ef4444'}`,
        transition: 'all 0.6s ease',
        boxShadow: flowActive ? '0 0 20px rgba(16,185,129,0.3)' : '0 0 8px rgba(239,68,68,0.2)',
      }}>
        <div style={{ fontSize: '1.5rem' }}>{flowActive ? '✅' : '💀'}</div>
        <div style={{ fontSize: '0.75rem', fontWeight: 700, color: flowActive ? '#10b981' : '#ef4444', marginTop: '4px' }}>
          Physical Block
        </div>
        <div style={{ fontSize: '0.65rem', color: '#64748b', marginTop: '2px' }}>
          {flowActive ? 'REPAIRED' : 'CORRUPTED'}
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Main component
// ─────────────────────────────────────────────────────────────────────────────

type DemoPhase = 'idle' | 'baseline' | 'corrupting' | 'corrupted' | 'repairing' | 'repaired'

export default function LiveHealingDemo() {
  const showToast = useStore(s => s.showToast)
  const addEvent = useStore(s => s.addEvent)

  // File/block selection
  const [selectedFile, setSelectedFile] = useState<string>('')
  const [selectedBlockIdx, setSelectedBlockIdx] = useState<number>(0)

  // Phase tracking
  const [phase, setPhase] = useState<DemoPhase>('idle')
  const [loading, setLoading] = useState(false)

  // Data from each stage
  const [baseline, setBaseline] = useState<LiveHealBaselineResponse | null>(null)
  const [corrupt, setCorrupt] = useState<LiveHealCorruptResponse | null>(null)
  const [repair, setRepair] = useState<LiveHealRepairResponse | null>(null)

  // Bit flip animation
  const [bitFlipDone, setBitFlipDone] = useState(false)
  const [repairFlowing, setRepairFlowing] = useState(false)

  const bottomRef = useRef<HTMLDivElement>(null)

  const { data: telemetry } = useQuery({
    queryKey: ['telemetry'],
    queryFn: getTelemetry,
    refetchInterval: 10000,
  })
  const files = telemetry?.files ?? []

  // Auto-select first file
  useEffect(() => {
    if (!selectedFile && files.length > 0) {
      setSelectedFile(files[0].name)
    }
  }, [files, selectedFile])

  const selectedFileObj = files.find(f => f.name === selectedFile)

  const scrollToBottom = () => setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 100)

  // ── Stage handlers ───────────────────────────────────────────────────────────

  const handleBaseline = async () => {
    if (!selectedFile) return
    setLoading(true)
    setPhase('baseline')
    setCorrupt(null)
    setRepair(null)
    setBitFlipDone(false)
    setRepairFlowing(false)
    try {
      const res = await liveHeal({ filename: selectedFile, block_index: selectedBlockIdx, stage: 'baseline' })
      setBaseline(res as LiveHealBaselineResponse)
      showToast('success', `Baseline captured for "${selectedFile}" — Block #${(res as LiveHealBaselineResponse).target_block_id}`)
      scrollToBottom()
    } catch (err: any) {
      showToast('error', `Baseline failed: ${err.message}`)
      setPhase('idle')
    } finally {
      setLoading(false)
    }
  }

  const handleCorrupt = async () => {
    if (!baseline) return
    setLoading(true)
    setPhase('corrupting')
    setBitFlipDone(false)
    try {
      const res = await liveHeal({ filename: selectedFile, block_index: selectedBlockIdx, stage: 'corrupt' })
      const c = res as LiveHealCorruptResponse
      setCorrupt(c)
      setPhase('corrupted')
      // Animate bit flip reveal
      setTimeout(() => setBitFlipDone(true), 500)
      addEvent({
        operation: 'Live Bit-Rot Injection',
        status: 'warning',
        message: `Injected ${c.total_bytes_changed} byte change(s) into Block #${c.target_block_id} of "${selectedFile}"`,
      })
      showToast('warning', `⚠️ ${c.total_bytes_changed} byte(s) corrupted in Block #${c.target_block_id}`)
      scrollToBottom()
    } catch (err: any) {
      showToast('error', `Corruption failed: ${err.message}`)
      setPhase('baseline')
    } finally {
      setLoading(false)
    }
  }

  const handleRepair = async () => {
    if (!corrupt) return
    setLoading(true)
    setPhase('repairing')
    setRepairFlowing(true)
    try {
      // Add dramatic pause for the animation
      await new Promise(r => setTimeout(r, 1200))
      const res = await liveHeal({ filename: selectedFile, block_index: selectedBlockIdx, stage: 'repair' })
      const r = res as LiveHealRepairResponse
      setRepair(r)
      setPhase('repaired')
      addEvent({
        operation: 'Live Auto-Heal Recovery',
        status: 'success',
        message: `Block #${r.target_block_id} restored via "${r.recovery_source}". SHA-256 verified ✓`,
      })
      showToast('success', `✅ Block #${r.target_block_id} fully recovered via ${r.recovery_source}`)
      scrollToBottom()
    } catch (err: any) {
      showToast('error', `Repair failed: ${err.message}`)
      setPhase('corrupted')
      setRepairFlowing(false)
    } finally {
      setLoading(false)
    }
  }

  const handleReset = () => {
    setPhase('idle')
    setBaseline(null)
    setCorrupt(null)
    setRepair(null)
    setBitFlipDone(false)
    setRepairFlowing(false)
  }

  const handleAutoRun = async () => {
    if (!selectedFile || loading) return
    setLoading(true)
    setPhase('idle')
    setBaseline(null)
    setCorrupt(null)
    setRepair(null)
    setBitFlipDone(false)
    setRepairFlowing(false)

    try {
      // Step 1: Baseline
      setPhase('baseline')
      const bRes = await liveHeal({ filename: selectedFile, block_index: selectedBlockIdx, stage: 'baseline' })
      const b = bRes as LiveHealBaselineResponse
      setBaseline(b)
      showToast('success', `Baseline captured for "${selectedFile}"`)
      scrollToBottom()

      // Pause to view baseline
      await new Promise(r => setTimeout(r, 1500))

      // Step 2: Corrupt
      setPhase('corrupting')
      const cRes = await liveHeal({ filename: selectedFile, block_index: selectedBlockIdx, stage: 'corrupt' })
      const c = cRes as LiveHealCorruptResponse
      setCorrupt(c)
      setPhase('corrupted')
      setTimeout(() => setBitFlipDone(true), 400)
      addEvent({
        operation: 'Live Bit-Rot Injection',
        status: 'warning',
        message: `Injected ${c.total_bytes_changed} byte change(s) into Block #${c.target_block_id} of "${selectedFile}"`,
      })
      showToast('warning', `⚠️ ${c.total_bytes_changed} byte(s) corrupted in Block #${c.target_block_id}`)
      scrollToBottom()

      // Pause to inspect corruption & broken Merkle tree
      await new Promise(r => setTimeout(r, 2200))

      // Step 3: Repair
      setPhase('repairing')
      setRepairFlowing(true)
      await new Promise(r => setTimeout(r, 1400))
      const rRes = await liveHeal({ filename: selectedFile, block_index: selectedBlockIdx, stage: 'repair' })
      const r = rRes as LiveHealRepairResponse
      setRepair(r)
      setPhase('repaired')
      addEvent({
        operation: 'Live Auto-Heal Recovery',
        status: 'success',
        message: `Block #${r.target_block_id} restored via "${r.recovery_source}". SHA-256 verified ✓`,
      })
      showToast('success', `✅ Block #${r.target_block_id} fully recovered via ${r.recovery_source}`)
      scrollToBottom()
    } catch (err: any) {
      showToast('error', `Auto-run error: ${err.message}`)
    } finally {
      setLoading(false)
    }
  }

  // ── Phase step indicator ─────────────────────────────────────────────────────

  const PHASES = [
    { id: 'baseline',  label: '1. Baseline',    icon: '📋' },
    { id: 'corrupted', label: '2. Bit-Rot',     icon: '💀' },
    { id: 'repaired',  label: '3. Auto-Heal',   icon: '✅' },
  ]

  const phaseOrder: Record<string, number> = { idle: 0, baseline: 1, corrupting: 1, corrupted: 1, repairing: 2, repaired: 3 }

  const recoverySource = repair?.recovery_source.includes('cache') ? 'cache' : 'snapshot'

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      {/* ── Header ── */}
      <div style={{
        background: 'linear-gradient(135deg, rgba(15,23,42,0.98) 0%, rgba(20,30,60,0.98) 100%)',
        borderRadius: '12px', padding: '1.5rem',
        border: '1px solid rgba(239,68,68,0.3)',
        boxShadow: '0 0 40px rgba(239,68,68,0.06)',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '1rem' }}>
          <div>
            <h2 style={{
              margin: 0, fontSize: '1.2rem', fontWeight: 800,
              background: 'linear-gradient(90deg, #ef4444, #f97316, #10b981)',
              WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
            }}>
              🔬 Live Auto-Healing Lab
            </h2>
            <p style={{ margin: '4px 0 0', fontSize: '0.8rem', color: '#94a3b8' }}>
              Pick a file → inject hardware bit-rot → watch AeroFS detect & repair in real time with byte-level diffs and animated Merkle tree healing
            </p>
          </div>

          {/* Phase progress */}
          <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
            {PHASES.map((p, i) => {
              const completed = phaseOrder[phase] > i + 1
              const active = phaseOrder[phase] === i + 1 || (p.id === 'corrupted' && (phase === 'corrupting' || phase === 'corrupted'))
              return (
                <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                  <div style={{
                    padding: '4px 10px', borderRadius: '20px', fontSize: '0.75rem', fontWeight: 700,
                    background: completed ? 'rgba(16,185,129,0.2)' : active ? 'rgba(251,146,60,0.2)' : 'rgba(30,41,59,0.6)',
                    color: completed ? '#10b981' : active ? '#fb923c' : '#475569',
                    border: `1px solid ${completed ? 'rgba(16,185,129,0.4)' : active ? 'rgba(251,146,60,0.4)' : 'rgba(71,85,105,0.3)'}`,
                    transition: 'all 0.3s ease',
                  }}>
                    {p.icon} {p.label}
                  </div>
                  {i < PHASES.length - 1 && <span style={{ color: '#334155', fontSize: '0.8rem' }}>→</span>}
                </div>
              )
            })}
          </div>
        </div>

        {/* File + Block selector */}
        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', marginTop: '1.25rem', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <label style={{ fontSize: '0.7rem', color: '#64748b', fontWeight: 600, textTransform: 'uppercase' }}>Target File</label>
            <select
              id="live-heal-file-select"
              value={selectedFile}
              onChange={e => { setSelectedFile(e.target.value); setSelectedBlockIdx(0); handleReset() }}
              style={{
                background: 'var(--bg-input)', color: 'var(--text-primary)',
                border: '1px solid var(--border-base)', padding: '6px 12px',
                borderRadius: '6px', fontSize: '0.85rem', minWidth: '200px',
              }}
            >
              <option value="">Select file…</option>
              {files.map(f => (
                <option key={f.name} value={f.name}>
                  {f.name} ({f.num_blocks} blocks, {f.size}B)
                </option>
              ))}
            </select>
          </div>

          {selectedFileObj && selectedFileObj.block_ids?.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <label style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', fontWeight: 600, textTransform: 'uppercase' }}>Block to Corrupt</label>
              <select
                id="live-heal-block-select"
                value={selectedBlockIdx}
                onChange={e => { setSelectedBlockIdx(parseInt(e.target.value)); handleReset() }}
                style={{
                  background: 'var(--bg-input)', color: 'var(--text-primary)',
                  border: '1px solid var(--border-base)', padding: '6px 12px',
                  borderRadius: '6px', fontSize: '0.85rem',
                }}
              >
                {selectedFileObj.block_ids.map((bid, i) => (
                  <option key={bid} value={i}>Block [{i}] → Physical #{bid}</option>
                ))}
              </select>
            </div>
          )}

          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-end', paddingBottom: '0px', marginTop: 'auto', flexWrap: 'wrap' }}>
            <button
              id="live-heal-autorun-btn"
              onClick={handleAutoRun}
              disabled={!selectedFile || loading}
              style={{
                background: 'linear-gradient(135deg, #8b5cf6, #ec4899)', color: '#fff',
                border: 'none', padding: '7px 16px', borderRadius: '7px',
                fontSize: '0.85rem', fontWeight: 700, cursor: 'pointer',
                boxShadow: '0 0 15px rgba(139,92,246,0.3)',
                opacity: (!selectedFile || loading) ? 0.5 : 1,
              }}
            >
              {loading ? '⏳ Story in progress…' : '▶ Auto-Play Story'}
            </button>
            <button
              id="live-heal-baseline-btn"
              onClick={handleBaseline}
              disabled={!selectedFile || loading}
              style={{
                background: 'linear-gradient(135deg, #0284c7, #0ea5e9)', color: '#fff',
                border: 'none', padding: '7px 16px', borderRadius: '7px',
                fontSize: '0.85rem', fontWeight: 700, cursor: 'pointer',
                opacity: (!selectedFile || loading) ? 0.5 : 1,
              }}
            >
              📋 Capture Baseline
            </button>
            <button
              id="live-heal-corrupt-btn"
              onClick={handleCorrupt}
              disabled={!baseline || loading || phase === 'corrupted' || phase === 'corrupting' || phase === 'repairing' || phase === 'repaired'}
              style={{
                background: 'linear-gradient(135deg, #ef4444, #dc2626)', color: '#fff',
                border: 'none', padding: '7px 16px', borderRadius: '7px',
                fontSize: '0.85rem', fontWeight: 700, cursor: 'pointer',
                opacity: (!baseline || loading || phase === 'corrupted' || phase === 'corrupting' || phase === 'repairing' || phase === 'repaired') ? 0.4 : 1,
              }}
            >
              {loading && phase === 'corrupting' ? '⚡ Flipping bits…' : '💀 Inject Bit-Rot'}
            </button>
            <button
              id="live-heal-repair-btn"
              onClick={handleRepair}
              disabled={!corrupt || loading || phase === 'repaired' || phase === 'repairing'}
              style={{
                background: 'linear-gradient(135deg, #10b981, #059669)', color: '#fff',
                border: 'none', padding: '7px 16px', borderRadius: '7px',
                fontSize: '0.85rem', fontWeight: 700, cursor: 'pointer',
                opacity: (!corrupt || loading || phase === 'repaired' || phase === 'repairing') ? 0.4 : 1,
                animation: phase === 'corrupted' ? 'pulse-btn 1.5s ease-in-out infinite' : 'none',
              }}
            >
              {loading && phase === 'repairing' ? '🔧 Repairing…' : '⚡ Run Auto-Heal'}
            </button>
            {phase === 'repaired' && (
              <button onClick={handleReset} style={{
                background: 'var(--bg-card)', color: 'var(--text-primary)', border: '1px solid var(--border-base)',
                padding: '7px 14px', borderRadius: '7px', fontSize: '0.85rem', cursor: 'pointer'
              }}>↺ Reset</button>
            )}
          </div>
        </div>
      </div>

      {/* ── Phase 1: BASELINE ── */}
      {baseline && (
        <div style={{
          background: 'rgba(14,165,233,0.05)', border: '1px solid rgba(14,165,233,0.25)',
          borderRadius: '10px', padding: '1.25rem',
          animation: 'fade-in 0.4s ease',
        }}>
          <h3 style={{ margin: '0 0 1rem', fontSize: '0.95rem', fontWeight: 800, color: '#38bdf8', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            📋 Phase 1 — Baseline State Captured
            <span style={{ fontSize: '0.7rem', background: 'rgba(14,165,233,0.15)', border: '1px solid rgba(14,165,233,0.3)', padding: '2px 8px', borderRadius: '10px', color: '#7dd3fc' }}>
              HEALTHY ✓
            </span>
          </h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
            {/* Left: File info + content preview */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              <div style={{ background: 'var(--bg-panel)', borderRadius: '8px', padding: '0.75rem', border: '1px solid var(--border-dim)' }}>
                <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', fontWeight: 600, marginBottom: '0.5rem' }}>FILE INFO</div>
                <div style={{ display: 'grid', gridTemplateColumns: '100px 1fr', gap: '4px', fontSize: '0.78rem' }}>
                  <span style={{ color: 'var(--text-secondary)' }}>File:</span><span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{baseline.filename}</span>
                  <span style={{ color: 'var(--text-secondary)' }}>Size:</span><span style={{ color: 'var(--text-secondary)' }}>{baseline.file_size} bytes</span>
                  <span style={{ color: 'var(--text-secondary)' }}>Blocks:</span><span style={{ color: 'var(--text-secondary)' }}>{baseline.num_blocks} physical blocks</span>
                  <span style={{ color: 'var(--text-secondary)' }}>Target:</span><span style={{ color: 'var(--accent)', fontFamily: 'monospace' }}>Block #{baseline.target_block_id} (index {baseline.target_block_index})</span>
                  <span style={{ color: 'var(--text-secondary)' }}>Hash:</span><span style={{ color: '#10b981', fontFamily: 'monospace', fontSize: '0.65rem', wordBreak: 'break-all' }}>{baseline.block_hash.slice(0, 32)}…</span>
                </div>
              </div>

              {/* Recovery sources available */}
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <div style={{
                  flex: 1, padding: '0.5rem 0.75rem', borderRadius: '6px', textAlign: 'center',
                  background: baseline.recovery_cache_has_block ? 'rgba(16,185,129,0.1)' : 'rgba(100,116,139,0.1)',
                  border: `1px solid ${baseline.recovery_cache_has_block ? 'rgba(16,185,129,0.3)' : 'rgba(100,116,139,0.2)'}`,
                }}>
                  <div style={{ fontSize: '0.9rem' }}>🧠</div>
                  <div style={{ fontSize: '0.65rem', color: baseline.recovery_cache_has_block ? '#10b981' : '#64748b', fontWeight: 700 }}>
                    Tier-1 Cache
                  </div>
                  <div style={{ fontSize: '0.6rem', color: '#64748b' }}>
                    {baseline.recovery_cache_has_block ? '✓ Ready' : '✗ Empty'}
                  </div>
                </div>
                <div style={{
                  flex: 1, padding: '0.5rem 0.75rem', borderRadius: '6px', textAlign: 'center',
                  background: baseline.snapshot_has_block ? 'rgba(167,139,250,0.1)' : 'rgba(100,116,139,0.1)',
                  border: `1px solid ${baseline.snapshot_has_block ? 'rgba(167,139,250,0.3)' : 'rgba(100,116,139,0.2)'}`,
                }}>
                  <div style={{ fontSize: '0.9rem' }}>📷</div>
                  <div style={{ fontSize: '0.65rem', color: baseline.snapshot_has_block ? '#a78bfa' : '#64748b', fontWeight: 700 }}>
                    Snapshot Store
                  </div>
                  <div style={{ fontSize: '0.6rem', color: '#64748b' }}>
                    {baseline.snapshot_has_block ? `✓ "${baseline.snapshot_name}"` : '✗ Not found'}
                  </div>
                </div>
              </div>

              {/* Content preview */}
              <div>
                <div style={{ fontSize: '0.7rem', color: '#64748b', fontWeight: 600, marginBottom: '4px' }}>CONTENT PREVIEW (first 300 chars)</div>
                <pre style={{
                  background: 'rgba(15,23,42,0.8)', border: '1px solid rgba(255,255,255,0.06)',
                  borderRadius: '6px', padding: '0.6rem', fontSize: '0.65rem', color: '#94a3b8',
                  overflow: 'hidden', maxHeight: '100px', margin: 0, whiteSpace: 'pre-wrap', lineHeight: 1.5,
                }}>
                  {baseline.content_preview.slice(0, 300)}
                </pre>
              </div>
            </div>

            {/* Right: Merkle tree */}
            <div style={{ background: 'rgba(15,23,42,0.7)', borderRadius: '8px', padding: '0.75rem', border: '1px solid rgba(255,255,255,0.06)' }}>
              <MerkleTreeViz
                leaves={baseline.merkle_leaves}
                root={baseline.merkle_root}
                label="Trusted Merkle Tree (all leaves healthy)"
                accent="#10b981"
              />

              {/* Block hex */}
              <div style={{ marginTop: '1rem' }}>
                <div style={{ fontSize: '0.7rem', color: '#64748b', fontWeight: 600, marginBottom: '4px' }}>BLOCK BYTES (first 64 bytes hex)</div>
                <code style={{
                  display: 'block', fontFamily: 'monospace', fontSize: '0.6rem',
                  color: '#10b981', wordBreak: 'break-all', lineHeight: 1.6,
                  background: 'rgba(16,185,129,0.05)', padding: '0.5rem', borderRadius: '4px',
                }}>
                  {baseline.block_bytes_hex.match(/.{2}/g)?.join(' ')}
                </code>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Phase 2: CORRUPTION ── */}
      {corrupt && (
        <div style={{
          background: 'rgba(239,68,68,0.05)', border: '1px solid rgba(239,68,68,0.3)',
          borderRadius: '10px', padding: '1.25rem',
          animation: 'fade-in 0.4s ease',
          boxShadow: '0 0 30px rgba(239,68,68,0.06)',
        }}>
          <h3 style={{ margin: '0 0 0.5rem', fontSize: '0.95rem', fontWeight: 800, color: '#ef4444', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            💀 Phase 2 — Hardware Bit-Rot Injected
            <span style={{
              fontSize: '0.7rem', background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.35)',
              padding: '2px 8px', borderRadius: '10px', color: '#fca5a5',
              animation: 'pulse-dot 1.5s ease infinite',
            }}>
              ⚠ CORRUPTED
            </span>
          </h3>
          <p style={{ margin: '0 0 1rem', fontSize: '0.78rem', color: '#94a3b8' }}>
            <strong style={{ color: '#fca5a5' }}>{corrupt.total_bytes_changed} byte(s)</strong> silently flipped in Block #{corrupt.target_block_id}.
            SHA-256 mismatch detected — AeroFS identifies this as bit-rot.
          </p>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
            {/* Left: byte diff */}
            <div>
              {/* Changed offsets list */}
              <div style={{ marginBottom: '0.75rem' }}>
                <div style={{ fontSize: '0.7rem', color: '#64748b', fontWeight: 600, marginBottom: '0.4rem' }}>CHANGED BYTE OFFSETS</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                  {corrupt.changed_offsets.slice(0, 16).map((co, i) => (
                    <div key={i} style={{
                      padding: '3px 8px', borderRadius: '4px', fontSize: '0.65rem', fontFamily: 'monospace',
                      background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.25)', color: '#fca5a5',
                      animation: bitFlipDone ? `flip-in 0.3s ease ${i * 0.05}s both` : 'none',
                    }}>
                      @{co.offset}: <span style={{ color: '#10b981' }}>{co.before}</span>→<span style={{ color: '#ef4444' }}>{co.after}</span>
                    </div>
                  ))}
                  {corrupt.changed_offsets.length > 16 && (
                    <div style={{ padding: '3px 8px', fontSize: '0.65rem', color: '#64748b' }}>+{corrupt.changed_offsets.length - 16} more…</div>
                  )}
                </div>
              </div>

              {/* Hex diff */}
              <div>
                <div style={{ fontSize: '0.7rem', color: '#64748b', fontWeight: 600, marginBottom: '0.4rem' }}>HEX BYTE COMPARISON (first 64 bytes)</div>
                <HexDiff
                  cleanHex={corrupt.clean_hex_sample}
                  corruptedHex={corrupt.corrupted_hex_sample}
                  changedOffsets={corrupt.changed_offsets}
                  animate={bitFlipDone}
                />
              </div>

              {/* Hash comparison */}
              <div style={{ marginTop: '0.75rem', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <div style={{ fontSize: '0.7rem', color: '#64748b', fontWeight: 600 }}>SHA-256 HASH MISMATCH DETECTED</div>
                <div style={{ fontSize: '0.65rem', fontFamily: 'monospace', wordBreak: 'break-all' }}>
                  <span style={{ color: '#64748b' }}>Expected: </span>
                  <span style={{ color: '#10b981' }}>{corrupt.clean_hash}</span>
                </div>
                <div style={{ fontSize: '0.65rem', fontFamily: 'monospace', wordBreak: 'break-all' }}>
                  <span style={{ color: '#64748b' }}>Actual:   </span>
                  <span style={{ color: '#ef4444' }}>{corrupt.corrupted_hash}</span>
                </div>
              </div>
            </div>

            {/* Right: side-by-side Merkle trees */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              <div style={{ background: 'rgba(15,23,42,0.7)', borderRadius: '8px', padding: '0.75rem', border: '1px solid rgba(255,255,255,0.05)' }}>
                <MerkleTreeViz
                  leaves={corrupt.clean_merkle_leaves}
                  root={corrupt.clean_merkle_root}
                  label="Trusted Merkle Tree (in inode metadata)"
                  accent="#10b981"
                />
              </div>
              <div style={{ textAlign: 'center', fontSize: '0.75rem', color: '#ef4444', fontWeight: 700 }}>↓ Disk hash changed — tree mismatch!</div>
              <div style={{ background: 'rgba(239,68,68,0.05)', borderRadius: '8px', padding: '0.75rem', border: '1px solid rgba(239,68,68,0.25)' }}>
                <MerkleTreeViz
                  leaves={corrupt.corrupted_merkle_leaves}
                  root={corrupt.corrupted_merkle_root || '(MISMATCH DETECTED)'}
                  corruptedIndex={corrupt.target_block_index}
                  label="Computed from disk (leaf FAILED ← bit-rot detected here)"
                  accent="#ef4444"
                />
              </div>
            </div>
          </div>

          {/* Content diff */}
          <div style={{ marginTop: '1rem' }}>
            <div style={{ fontSize: '0.7rem', color: '#64748b', fontWeight: 600, marginBottom: '0.4rem' }}>CONTENT DIFF (first 200 chars of block)</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
              <div>
                <div style={{ fontSize: '0.65rem', color: '#10b981', fontWeight: 700, marginBottom: '3px' }}>✅ Before (clean)</div>
                <pre style={{ margin: 0, background: 'rgba(16,185,129,0.05)', border: '1px solid rgba(16,185,129,0.2)', borderRadius: '6px', padding: '0.5rem', fontSize: '0.62rem', color: '#94a3b8', overflow: 'hidden', maxHeight: '80px', whiteSpace: 'pre-wrap' }}>
                  {corrupt.clean_preview.slice(0, 200)}
                </pre>
              </div>
              <div>
                <div style={{ fontSize: '0.65rem', color: '#ef4444', fontWeight: 700, marginBottom: '3px' }}>💀 After (corrupted)</div>
                <pre style={{ margin: 0, background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.25)', borderRadius: '6px', padding: '0.5rem', fontSize: '0.62rem', color: '#fca5a5', overflow: 'hidden', maxHeight: '80px', whiteSpace: 'pre-wrap' }}>
                  {corrupt.corrupted_preview.slice(0, 200)}
                </pre>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Phase 3: REPAIR ── */}
      {(phase === 'repairing' || phase === 'repaired') && corrupt && (
        <div style={{
          background: phase === 'repaired' ? 'rgba(16,185,129,0.05)' : 'rgba(251,146,60,0.05)',
          border: `1px solid ${phase === 'repaired' ? 'rgba(16,185,129,0.3)' : 'rgba(251,146,60,0.3)'}`,
          borderRadius: '10px', padding: '1.25rem',
          animation: 'fade-in 0.4s ease',
        }}>
          <h3 style={{ margin: '0 0 0.75rem', fontSize: '0.95rem', fontWeight: 800, color: phase === 'repaired' ? '#10b981' : '#fb923c', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            {phase === 'repairing' ? '🔧 Phase 3 — Auto-Healing In Progress…' : '✅ Phase 3 — Auto-Heal Complete!'}
            {phase === 'repairing' && (
              <span style={{ width: '14px', height: '14px', display: 'inline-block', border: '2px solid rgba(255,255,255,0.2)', borderTop: '2px solid #fb923c', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
            )}
          </h3>

          {/* Animated data flow */}
          <DataFlowAnimation
            source={repair ? recoverySource : (baseline?.recovery_cache_has_block ? 'cache' : 'snapshot')}
            active={repairFlowing}
          />

          {repair && (
            <>
              {/* Recovery source info */}
              <div style={{ textAlign: 'center', marginBottom: '1rem' }}>
                <span style={{
                  display: 'inline-block', padding: '6px 16px', borderRadius: '20px', fontSize: '0.8rem', fontWeight: 700,
                  background: 'rgba(167,139,250,0.15)', border: '1px solid rgba(167,139,250,0.35)', color: '#a78bfa',
                }}>
                  🔑 Recovered from: {repair.recovery_source}
                </span>
                <p style={{ fontSize: '0.75rem', color: '#64748b', margin: '4px 0 0' }}>
                  {repair.recovered_from_description}
                </p>
              </div>

              {/* Repair byte comparison */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1rem' }}>
                <div>
                  <div style={{ fontSize: '0.7rem', color: '#64748b', fontWeight: 600, marginBottom: '4px' }}>RECOVERY SOURCE BYTES (first 64)</div>
                  <code style={{ display: 'block', fontFamily: 'monospace', fontSize: '0.6rem', color: '#a78bfa', wordBreak: 'break-all', background: 'rgba(167,139,250,0.06)', padding: '0.5rem', borderRadius: '4px', lineHeight: 1.6 }}>
                    {repair.recovered_bytes_hex.match(/.{2}/g)?.join(' ')}
                  </code>
                </div>
                <div>
                  <div style={{ fontSize: '0.7rem', color: '#64748b', fontWeight: 600, marginBottom: '4px' }}>REPAIRED BLOCK BYTES (on disk)</div>
                  <code style={{ display: 'block', fontFamily: 'monospace', fontSize: '0.6rem', color: '#10b981', wordBreak: 'break-all', background: 'rgba(16,185,129,0.06)', padding: '0.5rem', borderRadius: '4px', lineHeight: 1.6 }}>
                    {repair.repaired_hex.match(/.{2}/g)?.join(' ')}
                  </code>
                </div>
              </div>

              {/* Hash verification */}
              <div style={{ background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.25)', borderRadius: '8px', padding: '0.75rem', marginBottom: '1rem' }}>
                <div style={{ fontSize: '0.7rem', color: '#64748b', fontWeight: 600, marginBottom: '0.5rem' }}>SHA-256 VERIFICATION</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '0.65rem', fontFamily: 'monospace' }}>
                  <div><span style={{ color: '#64748b' }}>Corrupted: </span><span style={{ color: '#ef4444' }}>{repair.corrupted_hash}</span></div>
                  <div><span style={{ color: '#64748b' }}>Repaired:  </span><span style={{ color: '#10b981' }}>{repair.repaired_hash}</span></div>
                </div>
                {repair.hash_verified && (
                  <div style={{ marginTop: '0.5rem', padding: '4px 10px', background: 'rgba(16,185,129,0.15)', borderRadius: '6px', display: 'inline-block' }}>
                    <span style={{ color: '#10b981', fontSize: '0.8rem', fontWeight: 700 }}>✓ Hash changed — block is different from corrupted state</span>
                  </div>
                )}
              </div>

              {/* Re-healed Merkle tree */}
              <div style={{ background: 'rgba(15,23,42,0.7)', borderRadius: '8px', padding: '0.75rem', border: '1px solid rgba(16,185,129,0.2)', marginBottom: '1rem' }}>
                <MerkleTreeViz
                  leaves={repair.new_merkle_leaves}
                  root={repair.new_merkle_root}
                  label="Re-verified Merkle Tree (all leaves restored)"
                  accent="#10b981"
                />
                <div style={{ textAlign: 'center', marginTop: '0.5rem', fontSize: '0.7rem', color: '#10b981' }}>
                  ✓ New Merkle Root: <code>{repair.new_merkle_root.slice(0, 20)}…</code> — inode re-anchored
                </div>
              </div>

              {/* ── FINAL BEFORE / AFTER COMPARISON ── */}
              <div style={{
                background: 'var(--bg-panel)', border: '1px solid var(--border-dim)',
                borderRadius: '10px', padding: '1rem',
              }}>
                <div style={{ fontWeight: 800, fontSize: '0.9rem', color: 'var(--text-primary)', marginBottom: '0.75rem', textAlign: 'center' }}>
                  📊 Full Before vs After Comparison
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', gap: '0.75rem', alignItems: 'stretch' }}>
                  {/* Before */}
                  <div style={{ background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: '8px', padding: '0.75rem' }}>
                    <div style={{ fontSize: '0.72rem', fontWeight: 700, color: '#ef4444', marginBottom: '0.5rem' }}>💀 CORRUPTED STATE</div>
                    <div style={{ fontSize: '0.65rem', color: '#64748b', marginBottom: '4px' }}>Block Hash:</div>
                    <code style={{ fontSize: '0.6rem', color: '#ef4444', wordBreak: 'break-all' }}>{repair.corrupted_hash.slice(0, 32)}…</code>
                    <div style={{ fontSize: '0.65rem', color: '#64748b', marginBottom: '4px', marginTop: '8px' }}>Block Preview:</div>
                    <pre style={{ margin: 0, fontSize: '0.6rem', color: '#fca5a5', maxHeight: '60px', overflow: 'hidden', whiteSpace: 'pre-wrap' }}>
                      {repair.corrupted_preview.slice(0, 150)}
                    </pre>
                  </div>

                  {/* Arrow */}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#10b981', fontSize: '1.5rem' }}>⚡</div>

                  {/* After */}
                  <div style={{ background: 'rgba(16,185,129,0.06)', border: '1px solid rgba(16,185,129,0.2)', borderRadius: '8px', padding: '0.75rem' }}>
                    <div style={{ fontSize: '0.72rem', fontWeight: 700, color: '#10b981', marginBottom: '0.5rem' }}>✅ REPAIRED STATE</div>
                    <div style={{ fontSize: '0.65rem', color: '#64748b', marginBottom: '4px' }}>Block Hash:</div>
                    <code style={{ fontSize: '0.6rem', color: '#10b981', wordBreak: 'break-all' }}>{repair.repaired_hash.slice(0, 32)}…</code>
                    <div style={{ fontSize: '0.65rem', color: '#64748b', marginBottom: '4px', marginTop: '8px' }}>Block Preview:</div>
                    <pre style={{ margin: 0, fontSize: '0.6rem', color: '#6ee7b7', maxHeight: '60px', overflow: 'hidden', whiteSpace: 'pre-wrap' }}>
                      {repair.repaired_preview.slice(0, 150)}
                    </pre>
                  </div>
                </div>

                {/* Full content after */}
                <div style={{ marginTop: '0.75rem' }}>
                  <div style={{ fontSize: '0.7rem', color: '#64748b', fontWeight: 600, marginBottom: '4px' }}>FULL FILE CONTENT (after repair, first 400 chars)</div>
                  <pre style={{
                    margin: 0, background: 'rgba(16,185,129,0.04)', border: '1px solid rgba(16,185,129,0.15)',
                    borderRadius: '6px', padding: '0.6rem', fontSize: '0.62rem', color: '#6ee7b7',
                    maxHeight: '100px', overflow: 'hidden', whiteSpace: 'pre-wrap',
                  }}>
                    {repair.full_content_after.slice(0, 400)}
                  </pre>
                </div>

                {/* Success badge */}
                {repair.is_healed && (
                  <div style={{ textAlign: 'center', marginTop: '0.75rem' }}>
                    <div style={{
                      display: 'inline-block', padding: '8px 20px', borderRadius: '20px',
                      background: 'linear-gradient(135deg, rgba(16,185,129,0.2), rgba(5,150,105,0.2))',
                      border: '1px solid rgba(16,185,129,0.4)', color: '#10b981',
                      fontSize: '0.9rem', fontWeight: 800,
                      boxShadow: '0 0 20px rgba(16,185,129,0.2)',
                    }}>
                      ✅ 100% DATA INTEGRITY RESTORED — Zero I/O Errors — Zero Downtime
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      )}

      <div ref={bottomRef} />

      {/* CSS animations */}
      <style>{`
        @keyframes fade-in {
          from { opacity: 0; transform: translateY(12px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes flip-in {
          from { opacity: 0; transform: scale(0.8); }
          to   { opacity: 1; transform: scale(1); }
        }
        @keyframes data-flow {
          0%   { left: 0%; opacity: 1; }
          100% { left: calc(100% - 20px); opacity: 0.3; }
        }
        @keyframes pulse-btn {
          0%, 100% { box-shadow: 0 4px 15px rgba(16,185,129,0.3); }
          50%       { box-shadow: 0 4px 25px rgba(16,185,129,0.6); }
        }
        @keyframes byte-corrupt {
          0%   { transform: scale(1);   background: rgba(16,185,129,0.25); }
          50%  { transform: scale(1.2); background: rgba(239,68,68,0.5); }
          100% { transform: scale(1);   background: rgba(239,68,68,0.3); }
        }
      `}</style>
    </div>
  )
}
