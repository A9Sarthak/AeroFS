import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  getTelemetry,
  runScrub,
  runHeal,
  injectBitRot,
  getMerkleProof,
  readFile
} from '../../api/client'
import { useStore } from '../../state/store'
import type { ScrubReport, HealReport, MerkleProof } from '../../api/types'

export default function IntegrityLab() {
  const queryClient = useQueryClient()
  const showToast = useStore((s) => s.showToast)
  const addEvent = useStore((s) => s.addEvent)
  const setCurrentOperation = useStore((s) => s.setCurrentOperation)
  const setSelectedBlockId = useStore((s) => s.setSelectedBlockId)

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

        <div style={{ display: 'flex', gap: '0.5rem' }}>
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
                  border: 'none',
                  cursor: 'pointer',
                  background: isActive ? '#38bdf8' : '#1e293b',
                  color: isActive ? '#0f172a' : '#94a3b8',
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
            <div style={{ fontSize: '0.85rem', color: '#cbd5e1', lineHeight: 1.5 }}>
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
                  background: '#1e293b',
                  color: '#fff',
                  border: '1px solid #334155',
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
                  background: '#38bdf8',
                  color: '#0f172a',
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
                background: 'rgba(30, 41, 59, 0.4)',
                padding: '1rem',
                borderRadius: '6px',
                border: '1px solid rgba(255, 255, 255, 0.05)',
                display: 'grid',
                gridTemplateColumns: '140px 1fr',
                gap: '0.5rem',
                fontSize: '0.85rem'
              }}>
                <span style={{ color: '#94a3b8' }}>File:</span>
                <span style={{ color: '#f8fafc', fontWeight: 600 }}>{selectedFileObj.name}</span>

                <span style={{ color: '#94a3b8' }}>Size / Blocks:</span>
                <span style={{ color: '#cbd5e1' }}>{selectedFileObj.size} bytes ({selectedFileObj.num_blocks} blocks)</span>

                <span style={{ color: '#94a3b8' }}>Physical Block IDs:</span>
                <span style={{ color: '#38bdf8', fontFamily: 'monospace' }}>
                  {selectedFileObj.block_ids?.join(', ') || 'None'}
                </span>

                <span style={{ color: '#94a3b8' }}>Expected Merkle Root:</span>
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
              <div style={{ fontSize: '0.8rem', color: '#cbd5e1', lineHeight: 1.5 }}>
                This flips bytes inside a physical block on the disposable virtual disk image to simulate silent hardware bit corruption.
                AeroFS uses Content-Addressable SHA-256 hashes to detect this discrepancy.
              </div>
            </div>

            <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
              <label style={{ fontSize: '0.85rem', color: '#cbd5e1' }}>
                Select Block to Corrupt:
              </label>
              <select
                value={targetBlockId ?? ''}
                onChange={(e) => setTargetBlockId(parseInt(e.target.value, 10))}
                style={{
                  background: '#1e293b',
                  color: '#fff',
                  border: '1px solid #334155',
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
            <div style={{ fontSize: '0.85rem', color: '#cbd5e1', lineHeight: 1.5 }}>
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
                background: 'rgba(30, 41, 59, 0.6)',
                padding: '1rem',
                borderRadius: '6px',
                border: '1px solid rgba(255, 255, 255, 0.08)'
              }}>
                <div style={{ fontWeight: 600, color: '#f8fafc', marginBottom: '0.5rem' }}>
                  Scrub Audit Report:
                </div>
                <div style={{ fontSize: '0.85rem', color: '#cbd5e1' }}>
                  Audited <strong>{scrubReport.files_checked}</strong> files. Corrupted blocks found:
                  <span style={{ color: '#ef4444', fontWeight: 700, marginLeft: 6 }}>
                    {scrubReport.corrupted_blocks?.length > 0 ? scrubReport.corrupted_blocks.join(', ') : 'None'}
                  </span>
                </div>

                <div style={{ marginTop: '1rem' }}>
                  <button
                    onClick={() => setCurrentStep(4)}
                    style={{
                      background: '#38bdf8',
                      color: '#0f172a',
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
            <div style={{ fontSize: '0.85rem', color: '#cbd5e1', lineHeight: 1.5 }}>
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
              <div style={{ fontSize: '0.85rem', color: '#cbd5e1', lineHeight: 1.5 }}>
                Blocks were re-written and verified byte-for-byte against trusted Merkle roots.
              </div>
            </div>

            {healReport && (
              <div style={{
                background: 'rgba(30, 41, 59, 0.6)',
                padding: '1rem',
                borderRadius: '6px',
                border: '1px solid rgba(255, 255, 255, 0.08)'
              }}>
                <div style={{ fontWeight: 600, color: '#f8fafc', marginBottom: '0.5rem', fontSize: '0.9rem' }}>
                  Heal Operation Summary:
                </div>
                <div style={{ fontSize: '0.85rem', color: '#cbd5e1' }}>
                  Successfully repaired: <strong>{healReport.healed_count}</strong> block(s).
                </div>

                {healReport.records?.map((rec, i) => (
                  <div key={i} style={{ marginTop: '0.5rem', padding: '0.5rem', background: '#0f172a', borderRadius: '4px', fontSize: '0.8rem' }}>
                    <div>Block <strong>#{rec.block_id}</strong>: {rec.success ? '✓ RECOVERED' : '❌ FAILED'}</div>
                    <div style={{ color: '#94a3b8' }}>Recovery Source: <code>{rec.source}</code></div>
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
                      background: '#334155',
                      color: '#f8fafc',
                      border: 'none',
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
              background: '#1e293b',
              color: '#fff',
              border: '1px solid #334155',
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
              background: '#1e293b',
              color: '#fff',
              border: '1px solid #334155',
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
              background: '#38bdf8',
              color: '#0f172a',
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
            background: 'rgba(30, 41, 59, 0.5)',
            padding: '1rem',
            borderRadius: '6px',
            border: '1px solid rgba(255, 255, 255, 0.05)',
            display: 'flex',
            flexDirection: 'column',
            gap: '0.5rem',
            fontSize: '0.85rem'
          }}>
            <div>
              <span style={{ color: '#94a3b8' }}>Leaf Hash (Block #{merkleProof.block_index}): </span>
              <code style={{ color: '#38bdf8' }}>{merkleProof.leaf_hash}</code>
            </div>

            <div>
              <span style={{ color: '#94a3b8' }}>Proof Path (Sibling nodes): </span>
              <div style={{ marginTop: 4, display: 'flex', flexDirection: 'column', gap: 2 }}>
                {merkleProof.proof_path?.length > 0 ? (
                  merkleProof.proof_path.map((sibling, idx) => (
                    <code key={idx} style={{ color: '#cbd5e1', fontSize: '0.75rem', paddingLeft: '1rem' }}>
                      Level {idx}: {sibling}
                    </code>
                  ))
                ) : (
                  <span style={{ color: '#64748b' }}>Single-leaf tree (leaf is root)</span>
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
