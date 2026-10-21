import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { runBenchmark } from '../../api/client'
import { useStore } from '../../state/store'
import type { BenchmarkResponse } from '../../api/types'

export default function Benchmarks() {
  const queryClient = useQueryClient()
  const showToast = useStore((s) => s.showToast)
  const setCurrentOperation = useStore((s) => s.setCurrentOperation)
  const addEvent = useStore((s) => s.addEvent)

  const [selectedWorkload, setSelectedWorkload] = useState('dedup_and_cow')
  const [benchmarkData, setBenchmarkData] = useState<BenchmarkResponse | null>(null)

  const benchMutation = useMutation({
    mutationFn: (workload: string) => runBenchmark(workload),
    onMutate: () => setCurrentOperation('Executing real storage benchmark…'),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['telemetry'] })
      setBenchmarkData(data)
      showToast('success', 'Benchmark completed successfully')
      addEvent({
        operation: 'Benchmark Run',
        status: 'success',
        message: `Executed benchmark suite "${data.workload}": measured real latencies and deduplication hits`,
      })
    },
    onError: (err: Error) => {
      showToast('error', `Benchmark failed: ${err.message}`)
    },
    onSettled: () => setCurrentOperation(null),
  })

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
            <span>⚡</span> Storage Engine Benchmarks
          </h2>
          <p style={{ margin: '4px 0 0', fontSize: '0.8rem', color: '#94a3b8' }}>
            Live performance evaluation measuring real CoW write latency, deduplication speed, and scrub throughput
          </p>
        </div>

        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
          <select
            value={selectedWorkload}
            onChange={(e) => setSelectedWorkload(e.target.value)}
            style={{
              background: 'var(--bg-input)',
              color: 'var(--text-primary)',
              border: '1px solid var(--border-dim)',
              padding: '6px 12px',
              borderRadius: '6px',
              fontSize: '0.85rem'
            }}
          >
            <option value="dedup_and_cow">Workload: Dedup & CoW Multi-File</option>
            <option value="write_throughput">Workload: Write Throughput</option>
            <option value="snapshot_latency">Workload: Snapshot & Restore</option>
          </select>

          <button
            onClick={() => benchMutation.mutate(selectedWorkload)}
            disabled={benchMutation.isPending}
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
            {benchMutation.isPending ? 'Benchmarking…' : '▶ Run Benchmark'}
          </button>
        </div>
      </div>

      {/* Honest Scientific Disclaimer as per Rule 9 */}
      <div style={{
        padding: '0.85rem 1rem',
        background: 'rgba(56, 189, 248, 0.08)',
        border: '1px solid rgba(56, 189, 248, 0.25)',
        borderRadius: '6px',
        fontSize: '0.8rem',
        color: 'var(--text-secondary)',
        lineHeight: 1.5
      }}>
        <strong style={{ color: 'var(--accent)' }}>Scientific Measurement Notice:</strong> All metrics displayed below are measured directly on the active Python virtual disk backend during execution. No simulated or fabricated performance multipliers are used.
      </div>

      {/* Results View */}
      {benchmarkData ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div style={{
            background: 'var(--bg-card)',
            borderRadius: '8px',
            border: '1px solid var(--border-dim)',
            padding: '1.25rem'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                Measured Operation Results — {benchmarkData.workload}
              </h3>
              <span style={{ fontSize: '0.75rem', color: '#10b981', fontWeight: 600 }}>
                Status: {benchmarkData.status.toUpperCase()}
              </span>
            </div>

            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem', textAlign: 'left' }}>
                <thead>
                  <tr style={{ background: 'rgba(30, 41, 59, 0.5)', color: '#94a3b8' }}>
                    <th style={{ padding: '0.6rem 1rem' }}>Operation</th>
                    <th style={{ padding: '0.6rem 1rem' }}>Duration (ms)</th>
                    <th style={{ padding: '0.6rem 1rem' }}>Size</th>
                    <th style={{ padding: '0.6rem 1rem' }}>Throughput</th>
                    <th style={{ padding: '0.6rem 1rem' }}>Blocks Used</th>
                    <th style={{ padding: '0.6rem 1rem' }}>Dedup Hits</th>
                  </tr>
                </thead>
                <tbody>
                  {benchmarkData.results.map((res, i) => {
                    const throughput = res.size_bytes && res.duration_ms > 0
                      ? ((res.size_bytes / (1024 * 1024)) / (res.duration_ms / 1000)).toFixed(2)
                      : null

                    return (
                      <tr key={i} style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.05)' }}>
                        <td style={{ padding: '0.6rem 1rem', fontWeight: 600, color: '#f8fafc' }}>
                          {res.operation}
                        </td>
                        <td style={{ padding: '0.6rem 1rem', color: '#38bdf8', fontWeight: 600 }}>
                          {res.duration_ms.toFixed(2)} ms
                        </td>
                        <td style={{ padding: '0.6rem 1rem', color: '#cbd5e1' }}>
                          {res.size_bytes ? `${(res.size_bytes / 1024).toFixed(1)} KiB` : '—'}
                        </td>
                        <td style={{ padding: '0.6rem 1rem', color: '#10b981' }}>
                          {throughput ? `${throughput} MB/s` : '—'}
                        </td>
                        <td style={{ padding: '0.6rem 1rem', color: '#cbd5e1' }}>
                          {res.blocks_used !== undefined ? res.blocks_used : '—'}
                        </td>
                        <td style={{ padding: '0.6rem 1rem', color: res.dedup_hits ? '#8b5cf6' : '#64748b', fontWeight: res.dedup_hits ? 700 : 400 }}>
                          {res.dedup_hits !== undefined ? res.dedup_hits : (res.total_dedup_hits ?? '—')}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            {benchmarkData.note && (
              <div style={{ marginTop: '1rem', fontSize: '0.75rem', color: '#64748b', fontStyle: 'italic' }}>
                Note: {benchmarkData.note}
              </div>
            )}
          </div>
        </div>
      ) : (
        <div style={{
          background: 'var(--bg-card)',
          borderRadius: '8px',
          border: '1px solid var(--border-dim)',
          padding: '3rem 1.5rem',
          textAlign: 'center',
          color: 'var(--text-muted)'
        }}>
          <div style={{ fontSize: '2.5rem', marginBottom: '0.5rem' }}>⚡</div>
          <div style={{ fontSize: '1rem', color: 'var(--text-primary)', fontWeight: 600 }}>No Benchmark Executed Yet</div>
          <div style={{ fontSize: '0.8rem', marginTop: '0.25rem' }}>
            Click <strong>Run Benchmark</strong> above to trigger real backend workload execution and measure live latencies.
          </div>
        </div>
      )}
    </div>
  )
}
