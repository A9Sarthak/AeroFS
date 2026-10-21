import { useState, useEffect, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  getTelemetry,
  runScrub,
  runHeal,
  injectBitRot,
  getMerkleProof,
  readFile,
  simulateAutoHeal,
  getPatrolStatus,
  togglePatrol,
} from '../../api/client'
import { useStore } from '../../state/store'
import type {
  ScrubReport,
  HealReport,
  MerkleProof,
  AutoHealSimulationResponse,
  AutoHealStep,
  PatrolStatusResponse,
} from '../../api/types'

export default function IntegrityLab() {
  const queryClient = useQueryClient()
  const showToast = useStore((s) => s.showToast)
  const addEvent = useStore((s) => s.addEvent)
  const setCurrentOperation = useStore((s) => s.setCurrentOperation)
  const setSelectedBlockId = useStore((s) => s.setSelectedBlockId)
  const setActiveView = useStore((s) => s.setActiveView)

  // Step state in the guided integrity pipeline
  const [currentStep, setCurrentStep] = useState<1 | 2 | 3 | 4 | 5>(1)
  const [selectedFileForTest, setSelectedFileForTest] = useState<string>('')
  const [targetBlockId, setTargetBlockId] = useState<number | undefined>(undefined)

  // Results
  const [scrubReport, setScrubReport] = useState<ScrubReport | null>(null)
  const [healReport, setHealReport] = useState<HealReport | null>(null)
  const [injectedResult, setInjectedResult] = useState<{ block: number; files: string[] } | null>(null)

  // Merkle Proof Explorer State
  const [proofFile, setProofFile] = useState<string>('')
  const [proofBlockIdx, setProofBlockIdx] = useState<number>(0)
  const [merkleProof, setMerkleProof] = useState<MerkleProof | null>(null)
  const [proofLoading, setProofLoading] = useState(false)

  // ─── Auto-Healing Simulator State ───────────────────────────────────────────
  type HealScenario = 'read_repair' | 'background_scrub' | 'snapshot_extent'
  const [healScenario, setHealScenario] = useState<HealScenario>('read_repair')
  const [healRunning, setHealRunning] = useState(false)
  const [healResult, setHealResult] = useState<AutoHealSimulationResponse | null>(null)
  const [visibleSteps, setVisibleSteps] = useState<number>(0) // animated step reveal
  const [patrolStatus, setPatrolStatus] = useState<PatrolStatusResponse | null>(null)
  const [patrolLoading, setPatrolLoading] = useState(false)
  const healScrollRef = useRef<HTMLDivElement>(null)

  // Fetch patrol status once on mount and after each simulation
  const refreshPatrol = async () => {
    try {
      const st = await getPatrolStatus()
      setPatrolStatus(st)
    } catch { /* ignore */ }
  }
  useEffect(() => { refreshPatrol() }, [])

  // Fetch telemetry
  const { data: telemetry } = useQuery({
    queryKey: ['telemetry'],
    queryFn: () => getTelemetry(),
    refetchInterval: 6000,
  })

  const files = telemetry?.files ?? []

  // Ensure default selected file if available
  if (!selectedFileForTest && files.length > 0) {
    setSelectedFileForTest(files[0].name)
    if (files[0].block_ids?.length > 0) {
      setTargetBlockId(files[0].block_ids[0])
    }
  }

  // Inject Bit Rot Mutation
  const injectMutation = useMutation({
    mutationFn: (blockId?: number) => injectBitRot(blockId),
    onMutate: () => setCurrentOperation('Simulating bit rot…'),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['telemetry'] })
      setInjectedResult({ block: data.corrupted_block, files: data.owning_files })
      setSelectedBlockId(data.corrupted_block)
      showToast('warning', `Simulated bit-rot injected into Block #${data.corrupted_block}`)
      addEvent({
        operation: 'Bit Rot Injected',
        status: 'warning',
        affectedBlockIds: [data.corrupted_block],
        message: `Injected simulated bit corruption into physical block #${data.corrupted_block}`,
      })
      setCurrentStep(3)
    },
    onError: (err: Error) => {
      showToast('error', `Bit rot injection failed: ${err.message}`)
    },
    onSettled: () => setCurrentOperation(null),
  })

  // Merkle Scrub Mutation
  const scrubMutation = useMutation({
    mutationFn: () => runScrub(),
    onMutate: () => setCurrentOperation('Running Merkle Scrub…'),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['telemetry'] })
      setScrubReport(data)
      const corruptedCount = data.corrupted_blocks?.length ?? 0
      if (corruptedCount > 0) {
        showToast('error', `Scrub detected ${corruptedCount} corrupted block(s)`)
        addEvent({
          operation: 'Merkle Scrub',
          status: 'warning',
          affectedBlockIds: data.corrupted_blocks,
          message: `Scrub completed: ${corruptedCount} corrupted block(s) detected via SHA-256 tree audit`,
        })
      } else {
        showToast('success', 'Scrub completed: All blocks healthy')
        addEvent({
          operation: 'Merkle Scrub',
          status: 'success',
          message: 'Scrub verified 100% block integrity across all files',
        })
      }
    },
    onError: (err: Error) => {
      showToast('error', `Scrub failed: ${err.message}`)
    },
    onSettled: () => setCurrentOperation(null),
  })

  // Self Heal Mutation
  const healMutation = useMutation({
    mutationFn: () => runHeal(),
    onMutate: () => setCurrentOperation('Self-healing blocks…'),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['telemetry'] })
      setHealReport(data)
      if (data.healed_count > 0) {
        showToast('success', `Repaired ${data.healed_count} block(s) from recovery source`)
        addEvent({
          operation: 'Self Heal Verified',
          status: 'success',
          message: `Repaired ${data.healed_count} block(s). Hashes verified against root.`,
        })
        setCurrentStep(5)
      } else if (data.failed_count > 0) {
        showToast('error', `Self heal failed for ${data.failed_count} block(s)`)
        addEvent({
          operation: 'Self Heal Failed',
          status: 'failed',
          message: `Unable to recover ${data.failed_count} block(s) — no clean parity/cache available`,
        })
      }
    },
    onError: (err: Error) => {
      showToast('error', `Heal failed: ${err.message}`)
    },
    onSettled: () => setCurrentOperation(null),
  })

  // ─── Auto-Heal Simulation Handler ───────────────────────────────────────────
  const runAutoHealSimulation = async () => {
    setHealRunning(true)
    setHealResult(null)
    setVisibleSteps(0)
    try {
      const result = await simulateAutoHeal({ scenario: healScenario })
      setHealResult(result)
      // Stagger step reveal for cinematic animation
      for (let i = 1; i <= result.steps.length; i++) {
        await new Promise(r => setTimeout(r, 420))
        setVisibleSteps(i)
      }
      await refreshPatrol()
      if (result.is_healed) {
        showToast('success', `Auto-Heal complete: ${result.title}`)
        addEvent({
          operation: 'Auto-Heal Simulation',
          status: 'success',
          message: `${result.title} — Block #${result.target_block} recovered via ${result.recovery_source}`,
        })
      } else {
        showToast('warning', 'Auto-Heal partially succeeded')
      }
    } catch (err: any) {
      showToast('error', `Auto-Heal simulation failed: ${err.message}`)
    } finally {
      setHealRunning(false)
      setTimeout(() => healScrollRef.current?.scrollIntoView({ behavior: 'smooth' }), 200)
    }
  }

  const handlePatrolToggle = async () => {
    setPatrolLoading(true)
    try {
      const res = await togglePatrol()
      await refreshPatrol()
      showToast(res.active ? 'success' : 'warning',
        res.active ? '🟢 Auto-Heal Patrol Daemon activated' : '🔴 Auto-Heal Patrol Daemon deactivated')
    } catch (err: any) {
      showToast('error', `Patrol toggle failed: ${err.message}`)
    } finally {
      setPatrolLoading(false)
    }
  }

  // Fetch Merkle Proof
  const handleFetchProof = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!proofFile) return
    setProofLoading(true)
    try {
      const proof = await getMerkleProof(proofFile, proofBlockIdx)
      setMerkleProof(proof)
    } catch (err: any) {
      showToast('error', `Failed to get proof: ${err.message}`)
      setMerkleProof(null)
    } finally {
      setProofLoading(false)
    }
  }

  const selectedFileObj = files.find((f) => f.name === selectedFileForTest)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem', height: '100%', overflowY: 'auto' }}>
      {/* Header */}
      <div style={{
        padding: '1.25rem',
        background: 'rgba(30, 41, 59, 0.7)',
        borderRadius: '8px',
        border: '1px solid rgba(255, 255, 255, 0.08)',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: '1rem'
      }}>
        <div>
          <h2 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span>🛡️</span> Integrity Lab & Merkle Verification
          </h2>
          <p style={{ margin: '4px 0 0', fontSize: '0.8rem', color: '#94a3b8' }}>
            End-to-end cryptographic verification: Simulated bit rot, Merkle tree audits, and verified self-healing
          </p>
        </div>

        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <button
            onClick={() => setActiveView('live-heal')}
            style={{
              background: 'linear-gradient(135deg, #ef4444, #f97316)',
              color: '#fff',
              border: 'none',
              padding: '6px 14px',
              borderRadius: '6px',
              fontSize: '0.85rem',
              fontWeight: 700,
              cursor: 'pointer',
              boxShadow: '0 0 15px rgba(239, 68, 68, 0.4)',
              display: 'flex',
              alignItems: 'center',
              gap: '6px'
            }}
          >
            <span>❤️‍🔥</span> Live Healing Lab
          </button>
          <button
            onClick={() => scrubMutation.mutate()}
            disabled={scrubMutation.isPending}
            style={{
              background: '#0284c7',
              color: '#fff',
              border: 'none',
              padding: '6px 14px',
              borderRadius: '6px',
              fontSize: '0.85rem',
              fontWeight: 600,
              cursor: 'pointer'
            }}
          >
            {scrubMutation.isPending ? 'Auditing…' : '🔍 Run Merkle Scrub'}
          </button>

          <button
            onClick={() => healMutation.mutate()}
            disabled={healMutation.isPending}
            style={{
              background: '#10b981',
              color: '#fff',
              border: 'none',
              padding: '6px 14px',
              borderRadius: '6px',
              fontSize: '0.85rem',
              fontWeight: 600,
              cursor: 'pointer'
            }}
          >
            {healMutation.isPending ? 'Healing…' : '🩹 Run Self-Heal'}
          </button>
        </div>
      </div>

      {/* Guided 5-Step Lifecycle Workflow */}
      <div style={{
        background: 'var(--bg-card)',
        borderRadius: '8px',
        border: '1px solid var(--border-dim)',
        padding: '1.25rem'
      }}>
        <h3 style={{ margin: '0 0 1rem', fontSize: '1rem', fontWeight: 700, color: 'var(--text-primary)' }}>
          Guided Integrity Lifecycle (Simulated Bit Rot → Detection → Healing)
        </h3>

        {/* Step progress pills */}
        <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.5rem', flexWrap: 'wrap' }}>
          {[
            { num: 1, label: '1. Baseline' },
            { num: 2, label: '2. Inject Bit-Rot' },
            { num: 3, label: '3. Detect via Scrub' },
            { num: 4, label: '4. Verified Heal' },
            { num: 5, label: '5. Verification' },
          ].map((s) => {
            const isActive = currentStep === s.num
            return (
              <button
                key={s.num}
                onClick={() => setCurrentStep(s.num as any)}
                style={{
                  padding: '6px 14px',
                  borderRadius: '20px',
                  fontSize: '0.8rem',
                  fontWeight: 600,
                  border: '1px solid var(--border-dim)',
                  cursor: 'pointer',
                  background: isActive ? 'var(--accent)' : 'var(--bg-input)',
                  color: isActive ? '#ffffff' : 'var(--text-secondary)',
                  transition: 'all 0.15s ease'
                }}
              >
                {s.label}
              </button>
            )
          })}
        </div>

        {/* Step 1: Baseline */}
        {currentStep === 1 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
              Choose an existing file to inspect its expected SHA-256 Merkle root and physical data blocks before injecting simulation:
            </div>

            <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
              <select
                value={selectedFileForTest}
                onChange={(e) => {
                  setSelectedFileForTest(e.target.value)
                  const f = files.find((item) => item.name === e.target.value)
                  if (f?.block_ids?.length) setTargetBlockId(f.block_ids[0])
                }}
                style={{
                  background: 'var(--bg-input)',
                  color: 'var(--text-primary)',
                  border: '1px solid var(--border-base)',
                  padding: '6px 12px',
                  borderRadius: '6px',
                  fontSize: '0.85rem',
                  minWidth: '220px'
                }}
              >
                {files.map((f) => (
                  <option key={f.name} value={f.name}>
                    {f.name} ({f.num_blocks} blocks)
                  </option>
                ))}
              </select>

              <button
                onClick={() => setCurrentStep(2)}
                style={{
                  background: '#0284c7',
                  color: '#fff',
                  border: 'none',
                  padding: '6px 16px',
                  borderRadius: '6px',
                  fontSize: '0.85rem',
                  fontWeight: 600,
                  cursor: 'pointer'
                }}
              >
                Next: Configure Injection →
              </button>
            </div>

            {selectedFileObj && (
              <div style={{
                background: 'var(--bg-panel)',
                padding: '1rem',
                borderRadius: '6px',
                border: '1px solid var(--border-dim)',
                display: 'grid',
                gridTemplateColumns: '140px 1fr',
                gap: '0.5rem',
                fontSize: '0.85rem'
              }}>
                <span style={{ color: 'var(--text-secondary)' }}>File:</span>
                <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{selectedFileObj.name}</span>

                <span style={{ color: 'var(--text-secondary)' }}>Size / Blocks:</span>
                <span style={{ color: 'var(--text-secondary)' }}>{selectedFileObj.size} bytes ({selectedFileObj.num_blocks} blocks)</span>

                <span style={{ color: 'var(--text-secondary)' }}>Physical Block IDs:</span>
                <span style={{ color: 'var(--accent)', fontFamily: 'monospace' }}>
                  {selectedFileObj.block_ids?.join(', ') || 'None'}
                </span>

                <span style={{ color: 'var(--text-secondary)' }}>Expected Merkle Root:</span>
                <span style={{ color: '#10b981', fontFamily: 'monospace', fontSize: '0.75rem', wordBreak: 'break-all' }}>
                  {selectedFileObj.merkle_root || 'N/A'}
                </span>
              </div>
            )}
          </div>
        )}

        {/* Step 2: Inject Bit Rot */}
        {currentStep === 2 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <div style={{
              background: 'rgba(239, 68, 68, 0.1)',
              border: '1px solid rgba(239, 68, 68, 0.3)',
              padding: '1rem',
              borderRadius: '6px'
            }}>
              <div style={{ fontWeight: 600, color: '#ef4444', fontSize: '0.9rem', marginBottom: 4 }}>
                ⚠️ Controlled Bit-Rot Simulation
              </div>
              <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                This flips bytes inside a physical block on the disposable virtual disk image to simulate silent hardware bit corruption.
                AeroFS uses Content-Addressable SHA-256 hashes to detect this discrepancy.
              </div>
            </div>

            <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
              <label style={{ fontSize: '0.85rem', color: 'var(--text-primary)' }}>
                Select Block to Corrupt:
              </label>
              <select
                value={targetBlockId ?? ''}
                onChange={(e) => setTargetBlockId(parseInt(e.target.value, 10))}
                style={{
                  background: 'var(--bg-input)',
                  color: 'var(--text-primary)',
                  border: '1px solid var(--border-base)',
                  padding: '6px 12px',
                  borderRadius: '6px',
                  fontSize: '0.85rem'
                }}
              >
                {selectedFileObj?.block_ids?.map((bid) => (
                  <option key={bid} value={bid}>
                    Block #{bid} (from {selectedFileObj.name})
                  </option>
                ))}
              </select>

              <button
                onClick={() => injectMutation.mutate(targetBlockId)}
                disabled={injectMutation.isPending || targetBlockId === undefined}
                style={{
                  background: '#ef4444',
                  color: '#fff',
                  border: 'none',
                  padding: '6px 16px',
                  borderRadius: '6px',
                  fontSize: '0.85rem',
                  fontWeight: 600,
                  cursor: 'pointer'
                }}
              >
                {injectMutation.isPending ? 'Injecting…' : '💥 Inject Bit Rot'}
              </button>
            </div>
          </div>
        )}

        {/* Step 3: Detect via Scrub */}
        {currentStep === 3 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
              Bit rot was injected into <strong>Block #{injectedResult?.block}</strong>.
              Now run the <strong>Merkle Scrub</strong> to let the storage engine compare disk bytes with the trusted SHA-256 leaf hashes:
            </div>

            <div>
              <button
                onClick={() => scrubMutation.mutate()}
                disabled={scrubMutation.isPending}
                style={{
                  background: '#0284c7',
                  color: '#fff',
                  border: 'none',
                  padding: '8px 18px',
                  borderRadius: '6px',
                  fontSize: '0.9rem',
                  fontWeight: 600,
                  cursor: 'pointer'
                }}
              >
                {scrubMutation.isPending ? 'Auditing Trees…' : '🔍 Run Merkle Scrub Now'}
              </button>
            </div>

            {scrubReport && (
              <div style={{
                background: 'var(--bg-panel)',
                padding: '1rem',
                borderRadius: '6px',
                border: '1px solid var(--border-dim)'
              }}>
                <div style={{ fontWeight: 600, color: 'var(--text-primary)', marginBottom: '0.5rem' }}>
                  Scrub Audit Report:
                </div>
                <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                  Audited <strong>{scrubReport.files_checked}</strong> files. Corrupted blocks found:
                  <span style={{ color: '#ef4444', fontWeight: 700, marginLeft: 6 }}>
                    {scrubReport.corrupted_blocks?.length > 0 ? scrubReport.corrupted_blocks.join(', ') : 'None'}
                  </span>
                </div>

                <div style={{ marginTop: '1rem' }}>
                  <button
                    onClick={() => setCurrentStep(4)}
                    style={{
                      background: '#0284c7',
                      color: '#fff',
                      border: 'none',
                      padding: '6px 16px',
                      borderRadius: '6px',
                      fontSize: '0.85rem',
                      fontWeight: 600,
                      cursor: 'pointer'
                    }}
                  >
                    Next: Self-Healing →
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Step 4: Heal */}
        {currentStep === 4 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
              AeroFS can automatically restore the corrupted block using either clean chunks from the <strong>Recovery Cache</strong> or <strong>Snapshot Extents</strong>.
              All recovered bytes are checked against expected SHA-256 hashes before being accepted.
            </div>

            <div>
              <button
                onClick={() => healMutation.mutate()}
                disabled={healMutation.isPending}
                style={{
                  background: '#10b981',
                  color: '#fff',
                  border: 'none',
                  padding: '8px 18px',
                  borderRadius: '6px',
                  fontSize: '0.9rem',
                  fontWeight: 600,
                  cursor: 'pointer'
                }}
              >
                {healMutation.isPending ? 'Repairing…' : '🩹 Run Verified Self-Heal'}
              </button>
            </div>
          </div>
        )}

        {/* Step 5: Verification Report */}
        {currentStep === 5 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <div style={{
              background: 'rgba(16, 185, 129, 0.1)',
              border: '1px solid rgba(16, 185, 129, 0.3)',
              padding: '1rem',
              borderRadius: '6px'
            }}>
              <div style={{ fontWeight: 600, color: '#10b981', fontSize: '0.95rem', marginBottom: 4 }}>
                ✓ Healing & Cryptographic Verification Complete
              </div>
              <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                Blocks were re-written and verified byte-for-byte against trusted Merkle roots.
              </div>
            </div>

            {healReport && (
              <div style={{
                background: 'var(--bg-panel)',
                padding: '1rem',
                borderRadius: '6px',
                border: '1px solid var(--border-dim)'
              }}>
                <div style={{ fontWeight: 600, color: 'var(--text-primary)', marginBottom: '0.5rem', fontSize: '0.9rem' }}>
                  Heal Operation Summary:
                </div>
                <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                  Successfully repaired: <strong>{healReport.healed_count}</strong> block(s).
                </div>

                {healReport.records?.map((rec, i) => (
                  <div key={i} style={{ marginTop: '0.5rem', padding: '0.5rem', background: 'var(--bg-card)', border: '1px solid var(--border-dim)', borderRadius: '4px', fontSize: '0.8rem' }}>
                    <div style={{ color: 'var(--text-primary)' }}>Block <strong>#{rec.block_id}</strong>: {rec.success ? '✓ RECOVERED' : '❌ FAILED'}</div>
                    <div style={{ color: 'var(--text-secondary)' }}>Recovery Source: <code>{rec.source}</code></div>
                  </div>
                ))}

                <div style={{ marginTop: '1rem' }}>
                  <button
                    onClick={() => {
                      setCurrentStep(1)
                      setScrubReport(null)
                      setHealReport(null)
                      setInjectedResult(null)
                    }}
                    style={{
                      background: 'var(--bg-card)',
                      color: 'var(--text-primary)',
                      border: '1px solid var(--border-base)',
                      padding: '6px 14px',
                      borderRadius: '6px',
                      fontSize: '0.85rem',
                      cursor: 'pointer'
                    }}
                  >
                    ↺ Reset Guided Test
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ══════════════════════════════════════════════════════════════════════
          AUTO-HEALING SIMULATOR CONSOLE
          ══════════════════════════════════════════════════════════════════════ */}
      <div style={{
        background: 'linear-gradient(135deg, rgba(15, 23, 42, 0.95) 0%, rgba(20, 30, 55, 0.95) 100%)',
        borderRadius: '12px',
        border: '1px solid rgba(139, 92, 246, 0.35)',
        padding: '1.5rem',
        boxShadow: '0 0 40px rgba(139, 92, 246, 0.08), inset 0 1px 0 rgba(255,255,255,0.05)'
      }}>
        {/* Section header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '1rem' }}>
          <div>
            <h3 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 800, background: 'linear-gradient(90deg, #a78bfa, #38bdf8)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
              ⚡ Auto-Healing Simulator Console
            </h3>
            <p style={{ margin: '4px 0 0', fontSize: '0.8rem', color: '#94a3b8', maxWidth: '560px' }}>
              Simulates the 3 core AeroFS self-healing scenarios: on-demand read-repair, background scrub patrol, and snapshot extent failover — with animated step-by-step playback.
            </p>
          </div>

          {/* Patrol Daemon Toggle */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: '0.75rem',
            background: 'rgba(30, 41, 59, 0.6)', padding: '0.6rem 1rem',
            borderRadius: '8px', border: '1px solid rgba(255,255,255,0.07)'
          }}>
            <span style={{ fontSize: '0.8rem', color: '#94a3b8', fontWeight: 600 }}>Auto-Heal Patrol</span>
            <button
              id="patrol-toggle-btn"
              onClick={handlePatrolToggle}
              disabled={patrolLoading}
              style={{
                position: 'relative', width: '44px', height: '24px',
                borderRadius: '12px', border: 'none', cursor: 'pointer',
                background: patrolStatus?.active ? '#10b981' : '#334155',
                transition: 'background 0.25s ease',
                outline: 'none'
              }}
              title={patrolStatus?.active ? 'Click to disable patrol daemon' : 'Click to enable patrol daemon'}
            >
              <span style={{
                position: 'absolute', top: '3px',
                left: patrolStatus?.active ? '23px' : '3px',
                width: '18px', height: '18px', borderRadius: '50%',
                background: '#fff', transition: 'left 0.25s ease',
                boxShadow: '0 1px 3px rgba(0,0,0,0.3)'
              }} />
            </button>
            <span style={{
              fontSize: '0.75rem', fontWeight: 700,
              color: patrolStatus?.active ? '#10b981' : '#64748b'
            }}>
              {patrolStatus?.active ? '🟢 Active' : '🔴 Inactive'}
            </span>
            {patrolStatus && patrolStatus.heal_log_count > 0 && (
              <span style={{ fontSize: '0.7rem', color: '#94a3b8' }}>
                ({patrolStatus.heal_log_count} heals logged)
              </span>
            )}
          </div>
        </div>

        {/* Scenario Selector Cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0.75rem', marginBottom: '1.5rem' }}>
          {([
            {
              id: 'read_repair',
              icon: '⚡',
              label: 'On-Demand Read-Repair',
              desc: 'Corruption caught during live application read. Zero-downtime recovery from Tier-1 cache.',
              accent: '#38bdf8',
            },
            {
              id: 'background_scrub',
              icon: '🛡️',
              label: 'Background Scrub Patrol',
              desc: 'Periodic daemon finds decayed cold blocks before any read happens. Proactive multi-tier repair.',
              accent: '#10b981',
            },
            {
              id: 'snapshot_extent',
              icon: '📷',
              label: 'Snapshot Extent Failover',
              desc: 'Cache miss scenario: data recovered from independent snapshot extent store.',
              accent: '#a78bfa',
            },
          ] as { id: HealScenario; icon: string; label: string; desc: string; accent: string }[]).map((sc) => {
            const isSelected = healScenario === sc.id
            return (
              <button
                key={sc.id}
                id={`heal-scenario-${sc.id}`}
                onClick={() => { setHealScenario(sc.id); setHealResult(null); setVisibleSteps(0) }}
                style={{
                  background: isSelected ? `rgba(${sc.accent === '#38bdf8' ? '56,189,248' : sc.accent === '#10b981' ? '16,185,129' : '167,139,250'}, 0.1)` : 'rgba(30, 41, 59, 0.5)',
                  border: `2px solid ${isSelected ? sc.accent : 'rgba(255,255,255,0.06)'}`,
                  borderRadius: '10px', padding: '1rem', cursor: 'pointer',
                  textAlign: 'left', transition: 'all 0.2s ease',
                  transform: isSelected ? 'translateY(-1px)' : 'none',
                  boxShadow: isSelected ? `0 4px 20px ${sc.accent}22` : 'none',
                }}
              >
                <div style={{ fontSize: '1.5rem', marginBottom: '0.4rem' }}>{sc.icon}</div>
                <div style={{ fontSize: '0.85rem', fontWeight: 700, color: isSelected ? sc.accent : '#f1f5f9', marginBottom: '0.3rem' }}>{sc.label}</div>
                <div style={{ fontSize: '0.72rem', color: '#94a3b8', lineHeight: 1.4 }}>{sc.desc}</div>
              </button>
            )
          })}
        </div>

        {/* Run Button */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1.5rem' }}>
          <button
            id="run-auto-heal-btn"
            onClick={runAutoHealSimulation}
            disabled={healRunning}
            style={{
              background: healRunning
                ? 'rgba(139, 92, 246, 0.3)'
                : 'linear-gradient(135deg, #7c3aed 0%, #2563eb 100%)',
              color: '#fff', border: 'none', padding: '0.6rem 1.5rem',
              borderRadius: '8px', fontSize: '0.9rem', fontWeight: 700,
              cursor: healRunning ? 'not-allowed' : 'pointer',
              display: 'flex', alignItems: 'center', gap: '0.5rem',
              transition: 'all 0.2s ease',
              boxShadow: healRunning ? 'none' : '0 4px 15px rgba(124, 58, 237, 0.4)',
            }}
          >
            {healRunning ? (
              <>
                <span style={{ display: 'inline-block', width: '14px', height: '14px', border: '2px solid rgba(255,255,255,0.3)', borderTop: '2px solid #fff', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
                Simulating…
              </>
            ) : (
              <>⚡ Run Auto-Healing Simulation</>
            )}
          </button>
          {healResult && !healRunning && (
            <span style={{
              fontSize: '0.8rem', color: healResult.is_healed ? '#10b981' : '#f59e0b',
              fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.3rem'
            }}>
              {healResult.is_healed ? '✓ Healed in' : '⚠ Completed in'} {healResult.latency_ms} ms
            </span>
          )}
        </div>

        {/* Animated Step Execution Feed */}
        {healResult && (
          <div ref={healScrollRef} style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
            {/* Title */}
            <div style={{
              fontSize: '0.95rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '0.25rem',
              display: 'flex', alignItems: 'center', gap: '0.5rem'
            }}>
              <span>{healResult.title}</span>
              <span style={{
                fontSize: '0.7rem', padding: '2px 8px', borderRadius: '20px', fontWeight: 700,
                background: healResult.is_healed ? 'rgba(16,185,129,0.15)' : 'rgba(245,158,11,0.15)',
                color: healResult.is_healed ? '#10b981' : '#f59e0b',
                border: `1px solid ${healResult.is_healed ? 'rgba(16,185,129,0.3)' : 'rgba(245,158,11,0.3)'}`
              }}>
                {healResult.is_healed ? '✓ HEALED' : '⚠ PARTIAL'}
              </span>
            </div>

            {/* 5 animated steps */}
            {healResult.steps.map((step: AutoHealStep, idx: number) => {
              const isVisible = idx < visibleSteps
              const stepColors: Record<string, { bg: string; border: string; icon: string; label: string }> = {
                ok:        { bg: 'rgba(14,165,233,0.08)',  border: 'rgba(14,165,233,0.25)',  icon: '🔵', label: 'BASELINE' },
                corrupted: { bg: 'rgba(239,68,68,0.1)',    border: 'rgba(239,68,68,0.3)',    icon: '💀', label: 'CORRUPTED' },
                detected:  { bg: 'rgba(245,158,11,0.1)',   border: 'rgba(245,158,11,0.3)',   icon: '🔍', label: 'DETECTED' },
                healed:    { bg: 'rgba(16,185,129,0.1)',   border: 'rgba(16,185,129,0.3)',   icon: '✅', label: 'HEALED' },
                verified:  { bg: 'rgba(167,139,250,0.1)',  border: 'rgba(167,139,250,0.3)',  icon: '🔐', label: 'VERIFIED' },
              }
              const sc = stepColors[step.status] ?? stepColors['ok']
              return (
                <div
                  key={idx}
                  style={{
                    background: sc.bg, border: `1px solid ${sc.border}`,
                    borderRadius: '8px', padding: '0.75rem 1rem',
                    opacity: isVisible ? 1 : 0,
                    transform: isVisible ? 'translateY(0)' : 'translateY(8px)',
                    transition: 'opacity 0.35s ease, transform 0.35s ease',
                    display: 'flex', alignItems: 'flex-start', gap: '0.75rem',
                  }}
                >
                  <span style={{ fontSize: '1.1rem', lineHeight: 1, marginTop: '1px', flexShrink: 0 }}>{sc.icon}</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.2rem' }}>
                      <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-secondary)' }}>STEP {step.step}</span>
                      <span style={{ fontSize: '0.68rem', padding: '1px 7px', borderRadius: '10px', background: sc.border, color: '#ffffff', fontWeight: 600 }}>{sc.label}</span>
                      <span style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-primary)' }}>{step.phase}</span>
                    </div>
                    <div style={{ fontSize: '0.82rem', color: 'var(--text-primary)', fontWeight: 600 }}>{step.title}</div>
                    <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', lineHeight: 1.45, marginTop: '2px' }}>{step.detail}</div>
                  </div>
                </div>
              )
            })}

            {/* Hash Comparison + Recovery Source */}
            {visibleSteps >= healResult.steps.length && (
              <div style={{
                marginTop: '0.5rem', padding: '1rem 1.25rem',
                background: 'rgba(15, 23, 42, 0.8)',
                border: '1px solid rgba(255,255,255,0.08)',
                borderRadius: '8px', display: 'grid',
                gridTemplateColumns: '1fr 1fr', gap: '0.75rem',
                opacity: 1, transition: 'opacity 0.4s ease'
              }}>
                <div>
                  <div style={{ fontSize: '0.7rem', color: '#64748b', fontWeight: 600, marginBottom: 4 }}>CORRUPTED HASH (before)</div>
                  <code style={{ fontSize: '0.72rem', color: '#ef4444', wordBreak: 'break-all', lineHeight: 1.4 }}>{healResult.corrupted_hash}</code>
                </div>
                <div>
                  <div style={{ fontSize: '0.7rem', color: '#64748b', fontWeight: 600, marginBottom: 4 }}>RECOVERED HASH (after)</div>
                  <code style={{ fontSize: '0.72rem', color: '#10b981', wordBreak: 'break-all', lineHeight: 1.4 }}>{healResult.recovered_hash}</code>
                </div>
                <div>
                  <div style={{ fontSize: '0.7rem', color: '#64748b', fontWeight: 600, marginBottom: 4 }}>RECOVERY SOURCE</div>
                  <span style={{
                    fontSize: '0.8rem', padding: '3px 10px', borderRadius: '12px', fontWeight: 700,
                    background: 'rgba(167,139,250,0.15)', color: '#a78bfa',
                    border: '1px solid rgba(167,139,250,0.3)'
                  }}>{healResult.recovery_source}</span>
                </div>
                <div>
                  <div style={{ fontSize: '0.7rem', color: '#64748b', fontWeight: 600, marginBottom: 4 }}>LATENCY</div>
                  <span style={{ fontSize: '0.8rem', color: '#38bdf8', fontWeight: 700 }}>{healResult.latency_ms} ms</span>
                  <span style={{ fontSize: '0.72rem', color: '#64748b', marginLeft: '6px' }}>— Zero I/O Error</span>
                </div>
                {healResult.expected_hash === healResult.recovered_hash && (
                  <div style={{ gridColumn: '1 / -1', textAlign: 'center', padding: '0.5rem', background: 'rgba(16,185,129,0.08)', borderRadius: '6px', border: '1px solid rgba(16,185,129,0.2)' }}>
                    <span style={{ color: '#10b981', fontSize: '0.85rem', fontWeight: 700 }}>
                      ✓ SHA-256 Verified: Recovered hash matches expected Merkle leaf — 100% Data Integrity Confirmed
                    </span>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Patrol last-heal info */}
        {patrolStatus?.last_heal && (
          <div style={{
            marginTop: '1rem', padding: '0.75rem 1rem',
            background: 'rgba(16, 185, 129, 0.05)',
            border: '1px solid rgba(16, 185, 129, 0.15)',
            borderRadius: '8px', fontSize: '0.78rem', color: '#94a3b8'
          }}>
            🕐 <strong style={{ color: '#10b981' }}>Last Patrol Heal:</strong>{' '}
            Block <strong>#{patrolStatus.last_heal.block_id}</strong> in file{' '}
            <strong>{patrolStatus.last_heal.owning_file}</strong>{' '}
            via <code>{patrolStatus.last_heal.source}</code>{' '}
            at {patrolStatus.last_heal.timestamp}
          </div>
        )}
      </div>

      {/* Merkle Proof Explorer Section */}
      <div style={{
        background: 'var(--bg-card)',
        borderRadius: '8px',
        border: '1px solid var(--border-dim)',
        padding: '1.25rem'
      }}>
        <h3 style={{ margin: '0 0 0.5rem', fontSize: '1rem', fontWeight: 700, color: 'var(--text-primary)' }}>
          🌿 Merkle Tree Inclusion Proof Explorer
        </h3>
        <p style={{ margin: '0 0 1rem', fontSize: '0.8rem', color: '#94a3b8' }}>
          Retrieve an inclusion audit path for any logical block to verify membership against the inode's root hash.
        </p>

        <form onSubmit={handleFetchProof} style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <select
            value={proofFile}
            onChange={(e) => {
              setProofFile(e.target.value)
              setProofBlockIdx(0)
            }}
            style={{
              background: 'var(--bg-input)',
              color: 'var(--text-primary)',
              border: '1px solid var(--border-base)',
              padding: '6px 12px',
              borderRadius: '6px',
              fontSize: '0.85rem',
              minWidth: '200px'
            }}
          >
            <option value="">Select File...</option>
            {files.map((f) => (
              <option key={f.name} value={f.name}>
                {f.name} ({f.num_blocks} blocks)
              </option>
            ))}
          </select>

          <input
            type="number"
            min="0"
            placeholder="Block Index (0, 1...)"
            value={proofBlockIdx}
            onChange={(e) => setProofBlockIdx(parseInt(e.target.value, 10) || 0)}
            style={{
              background: 'var(--bg-input)',
              color: 'var(--text-primary)',
              border: '1px solid var(--border-base)',
              padding: '6px 12px',
              borderRadius: '6px',
              fontSize: '0.85rem',
              width: '140px'
            }}
          />

          <button
            type="submit"
            disabled={!proofFile || proofLoading}
            style={{
              background: '#0284c7',
              color: '#fff',
              border: 'none',
              padding: '6px 16px',
              borderRadius: '6px',
              fontSize: '0.85rem',
              fontWeight: 600,
              cursor: proofFile ? 'pointer' : 'not-allowed',
              opacity: proofFile ? 1 : 0.6
            }}
          >
            {proofLoading ? 'Generating…' : 'Generate Proof'}
          </button>
        </form>

        {merkleProof && (
          <div style={{
            marginTop: '1rem',
            background: 'var(--bg-panel)',
            padding: '1rem',
            borderRadius: '6px',
            border: '1px solid var(--border-dim)',
            display: 'flex',
            flexDirection: 'column',
            gap: '0.5rem',
            fontSize: '0.85rem'
          }}>
            <div>
              <span style={{ color: 'var(--text-secondary)' }}>Leaf Hash (Block #{merkleProof.block_index}): </span>
              <code style={{ color: 'var(--accent)' }}>{merkleProof.leaf_hash}</code>
            </div>

            <div>
              <span style={{ color: 'var(--text-secondary)' }}>Proof Path (Sibling nodes): </span>
              <div style={{ marginTop: 4, display: 'flex', flexDirection: 'column', gap: 2 }}>
                {merkleProof.proof_path?.length > 0 ? (
                  merkleProof.proof_path.map((sibling, idx) => (
                    <code key={idx} style={{ color: 'var(--text-secondary)', fontSize: '0.75rem', paddingLeft: '1rem' }}>
                      Level {idx}: {sibling}
                    </code>
                  ))
                ) : (
                  <span style={{ color: 'var(--text-muted)' }}>Single-leaf tree (leaf is root)</span>
                )}
              </div>
            </div>

            <div>
              <span style={{ color: '#94a3b8' }}>Calculated Root Hash: </span>
              <code style={{ color: '#10b981' }}>{merkleProof.root_hash}</code>
            </div>

            <div style={{
              marginTop: '0.5rem',
              padding: '0.5rem',
              background: 'rgba(56, 189, 248, 0.1)',
              borderRadius: '4px',
              color: '#38bdf8',
              fontSize: '0.75rem'
            }}>
              ℹ️ A valid Merkle proof demonstrates inclusion with respect to the root. In AeroFS, the root is trusted because it is anchored in the file's inode metadata.
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
