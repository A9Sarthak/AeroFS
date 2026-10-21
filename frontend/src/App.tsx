import { useState, useEffect } from 'react'
import Shell from './components/Shell'
import { useStore } from './state/store'
import {
  createTextFile,
  duplicateFile,
  createSnapshot,
  injectBitRot,
  runScrub,
  runHeal
} from './api/client'
import { useQueryClient } from '@tanstack/react-query'

const DEMO_STEPS = [
  {
    title: '1. Create Baseline File',
    desc: 'Creates a new 4 KiB file on disk. A new physical block and Merkle tree root will be allocated.',
    actionName: 'Create demo_base.txt',
    run: async () => {
      await createTextFile('demo_base.txt', 'AeroFS High Integrity Operating System Demo Data Payload ' + 'A'.repeat(500))
    }
  },
  {
    title: '2. CAS Deduplication',
    desc: 'Creates an exact duplicate file "demo_dup.txt". AeroFS Content-Addressable Storage reuses the physical block without allocating new disk space.',
    actionName: 'Duplicate File',
    run: async () => {
      await duplicateFile('demo_base.txt', 'demo_dup.txt')
    }
  },
  {
    title: '3. Copy-on-Write (CoW)',
    desc: 'Modifies "demo_dup.txt". CoW allocates a new physical block for the modified data while "demo_base.txt" remains unchanged.',
    actionName: 'Modify Duplicate (Trigger CoW)',
    run: async () => {
      await createTextFile('demo_dup.txt', 'Modified CoW content different from demo_base.txt ' + 'B'.repeat(500))
    }
  },
  {
    title: '4. Capture Point-in-Time Snapshot',
    desc: 'Captures snapshot "snap_demo_v1". Metadata and clean extents are preserved for instant restore and recovery.',
    actionName: 'Capture Snapshot',
    run: async () => {
      await createSnapshot('snap_demo_v1')
    }
  },
  {
    title: '5. Inject Simulated Bit Rot',
    desc: 'Flips bits in an allocated physical block on the disposable virtual disk to simulate silent storage corruption.',
    actionName: 'Inject Bit Rot',
    run: async () => {
      await injectBitRot()
    }
  },
  {
    title: '6. Cryptographic Merkle Scrub',
    desc: 'Audits every block on disk against trusted leaf hashes in the file inode Merkle trees to detect corrupted blocks.',
    actionName: 'Run Merkle Scrub',
    run: async () => {
      await runScrub()
    }
  },
  {
    title: '7. Verified Self-Healing',
    desc: 'Recovers corrupted blocks using the recovery cache or snapshot extents, verifying recovered bytes against expected hashes before committing.',
    actionName: 'Run Self-Heal',
    run: async () => {
      await runHeal()
    }
  }
]

export default function App() {
  const queryClient = useQueryClient()
  const showToast = useStore((s) => s.showToast)
  const addEvent = useStore((s) => s.addEvent)
  const setActiveView = useStore((s) => s.setActiveView)
  const setSelectedBlockId = useStore((s) => s.setSelectedBlockId)
  const setSelectedFileName = useStore((s) => s.setSelectedFileName)

  const [demoOpen, setDemoOpen] = useState(false)
  const [demoStepIdx, setDemoStepIdx] = useState(0)
  const [demoRunning, setDemoRunning] = useState(false)
  const [stepSuccess, setStepSuccess] = useState<boolean | null>(null)

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return
      }
      if (e.key === 'Escape') {
        setSelectedBlockId(null)
        setSelectedFileName(null)
      } else if (e.key === '1') setActiveView('overview')
      else if (e.key === '2') setActiveView('files')
      else if (e.key === '3') setActiveView('storage')
      else if (e.key === '4') setActiveView('snapshots')
      else if (e.key === '5') setActiveView('integrity')
      else if (e.key === '6') setActiveView('audit')
      else if (e.key === '7') setActiveView('benchmarks')
      else if (e.key === '8') setActiveView('settings')
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [setActiveView, setSelectedBlockId, setSelectedFileName])

  const executeDemoStep = async () => {
    setDemoRunning(true)
    setStepSuccess(null)
    const step = DEMO_STEPS[demoStepIdx]
    try {
      await step.run()
      queryClient.invalidateQueries({ queryKey: ['telemetry'] })
      queryClient.invalidateQueries({ queryKey: ['files'] })
      queryClient.invalidateQueries({ queryKey: ['snapshots'] })
      setStepSuccess(true)
      showToast('success', `Demo step "${step.title}" executed successfully!`)
      addEvent({
        operation: 'Guided Demo Step',
        status: 'success',
        message: `Successfully executed: ${step.title}`,
      })
    } catch (err: any) {
      setStepSuccess(false)
      showToast('error', `Demo step failed: ${err.message}`)
      addEvent({
        operation: 'Guided Demo Failed',
        status: 'failed',
        message: err.message,
      })
    } finally {
      setDemoRunning(false)
    }
  }

  const currentStep = DEMO_STEPS[demoStepIdx]

  return (
    <>
      <Shell />

      {/* Floating Guided Tour Launcher Button */}
      <button
        onClick={() => setDemoOpen(true)}
        style={{
          position: 'fixed',
          bottom: '24px',
          right: '24px',
          background: 'linear-gradient(135deg, #0284c7 0%, #7c3aed 100%)',
          color: '#ffffff',
          border: 'none',
          padding: '10px 18px',
          borderRadius: '30px',
          fontWeight: 700,
          fontSize: '0.85rem',
          boxShadow: '0 8px 24px rgba(124, 58, 237, 0.4)',
          cursor: 'pointer',
          zIndex: 90,
          display: 'flex',
          alignItems: 'center',
          gap: '0.5rem',
          transition: 'transform 0.2s ease',
        }}
        onMouseEnter={(e) => (e.currentTarget.style.transform = 'scale(1.05)')}
        onMouseLeave={(e) => (e.currentTarget.style.transform = 'scale(1)')}
      >
        <span>🚀</span> Guided Demo Mode
      </button>

      {/* Guided Tour Modal */}
      {demoOpen && (
        <div style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0, 0, 0, 0.75)',
          backdropFilter: 'blur(5px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 100
        }}>
          <div style={{
            background: 'var(--bg-surface)',
            border: '1px solid var(--border-accent)',
            borderRadius: '12px',
            padding: '1.75rem',
            width: '520px',
            maxWidth: '90vw',
            boxShadow: '0 25px 50px rgba(0,0,0,0.4)',
            display: 'flex',
            flexDirection: 'column',
            gap: '1.25rem'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span style={{ fontSize: '1.3rem' }}>🚀</span>
                <h3 style={{ margin: 0, color: 'var(--text-primary)', fontSize: '1.15rem', fontWeight: 700 }}>
                  AeroFS Interactive Guided Tour
                </h3>
              </div>
              <button
                onClick={() => setDemoOpen(false)}
                style={{
                  background: 'transparent',
                  color: '#94a3b8',
                  border: 'none',
                  fontSize: '1.2rem',
                  cursor: 'pointer'
                }}
              >
                ✕
              </button>
            </div>

            {/* Step Indicator */}
            <div style={{ display: 'flex', gap: '0.35rem' }}>
              {DEMO_STEPS.map((_, i) => (
                <div
                  key={i}
                  style={{
                    flex: 1,
                    height: '4px',
                    borderRadius: '2px',
                    background: i === demoStepIdx ? '#38bdf8' : i < demoStepIdx ? '#10b981' : '#334155',
                    transition: 'background 0.2s'
                  }}
                />
              ))}
            </div>

            {/* Current Step Description */}
            <div style={{
              background: 'rgba(30, 41, 59, 0.6)',
              padding: '1.25rem',
              borderRadius: '8px',
              border: '1px solid rgba(255, 255, 255, 0.05)'
            }}>
              <div style={{ fontSize: '1rem', fontWeight: 700, color: '#38bdf8', marginBottom: '0.5rem' }}>
                {currentStep.title}
              </div>
              <p style={{ margin: 0, fontSize: '0.85rem', color: '#cbd5e1', lineHeight: 1.5 }}>
                {currentStep.desc}
              </p>

              {stepSuccess === true && (
                <div style={{ marginTop: '0.75rem', color: '#10b981', fontSize: '0.8rem', fontWeight: 600 }}>
                  ✓ Step completed on backend! Check the 3D map & telemetry.
                </div>
              )}
              {stepSuccess === false && (
                <div style={{ marginTop: '0.75rem', color: '#ef4444', fontSize: '0.8rem', fontWeight: 600 }}>
                  ✕ Step encountered an error. Check backend connection.
                </div>
              )}
            </div>

            {/* Actions */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button
                  onClick={() => {
                    setDemoStepIdx((i) => Math.max(0, i - 1))
                    setStepSuccess(null)
                  }}
                  disabled={demoStepIdx === 0}
                  style={{
                    background: '#1e293b',
                    color: '#94a3b8',
                    border: '1px solid #334155',
                    padding: '6px 14px',
                    borderRadius: '6px',
                    fontSize: '0.85rem',
                    cursor: demoStepIdx === 0 ? 'not-allowed' : 'pointer',
                    opacity: demoStepIdx === 0 ? 0.5 : 1
                  }}
                >
                  ← Back
                </button>
                <button
                  onClick={() => {
                    setDemoStepIdx((i) => Math.min(DEMO_STEPS.length - 1, i + 1))
                    setStepSuccess(null)
                  }}
                  disabled={demoStepIdx === DEMO_STEPS.length - 1}
                  style={{
                    background: '#1e293b',
                    color: '#f8fafc',
                    border: '1px solid #334155',
                    padding: '6px 14px',
                    borderRadius: '6px',
                    fontSize: '0.85rem',
                    cursor: demoStepIdx === DEMO_STEPS.length - 1 ? 'not-allowed' : 'pointer',
                    opacity: demoStepIdx === DEMO_STEPS.length - 1 ? 0.5 : 1
                  }}
                >
                  Next →
                </button>
              </div>

              <button
                onClick={executeDemoStep}
                disabled={demoRunning}
                style={{
                  background: 'linear-gradient(135deg, #0284c7 0%, #38bdf8 100%)',
                  color: '#0f172a',
                  border: 'none',
                  padding: '8px 20px',
                  borderRadius: '6px',
                  fontSize: '0.85rem',
                  fontWeight: 700,
                  cursor: demoRunning ? 'not-allowed' : 'pointer',
                  boxShadow: '0 4px 12px rgba(56, 189, 248, 0.3)'
                }}
              >
                {demoRunning ? 'Executing…' : `Execute: ${currentStep.actionName}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
