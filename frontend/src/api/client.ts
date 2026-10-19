// ============================================================
//  AeroFS Studio — HTTP API Client
//  All calls go through the Vite proxy → FastAPI backend
// ============================================================

import type {
  HealthResponse,
  TelemetryResponse,
  CreateFileResponse,
  DuplicateResponse,
  ScrubReport,
  HealReport,
  BlockDetails,
  InspectFileResponse,
  MerkleProof,
  SnapshotView,
  FileView,
  BenchmarkResponse,
} from './types'

const BASE = '/api'

async function request<T>(
  path: string,
  options?: RequestInit,
  signal?: AbortSignal
): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    signal,
    headers: {
      'Content-Type': 'application/json',
      ...(options?.headers ?? {}),
    },
  })
  if (!res.ok) {
    let detail = `HTTP ${res.status}`
    try {
      const err = await res.json()
      detail = err.detail || err.message || detail
    } catch { /* ignore parse errors */ }
    throw new Error(detail)
  }
  return res.json() as Promise<T>
}

// ---- Health ----
export const getHealth = (ctx?: { signal?: AbortSignal } | AbortSignal) => {
  const signal = ctx instanceof AbortSignal ? ctx : ctx?.signal
  return request<HealthResponse>('/health', undefined, signal)
}

// ---- Telemetry ----
export const getTelemetry = (ctx?: { signal?: AbortSignal } | AbortSignal) => {
  const signal = ctx instanceof AbortSignal ? ctx : ctx?.signal
  return request<TelemetryResponse>('/telemetry', undefined, signal)
}

// ---- Files ----
export const listFiles = (ctx?: { signal?: AbortSignal } | AbortSignal) => {
  const signal = ctx instanceof AbortSignal ? ctx : ctx?.signal
  return request<{ files: FileView[]; count: number }>('/files', undefined, signal)
}

export const createTextFile = (filename: string, content: string) =>
  request<CreateFileResponse>('/files/create_text', {
    method: 'POST',
    body: JSON.stringify({ filename, content }),
  })

export const readFile = (filename: string) =>
  request<{ filename: string; type: string; content: string }>(
    `/files/read/${encodeURIComponent(filename)}`
  )

export const deleteFile = (filename: string) =>
  request<{ status: string; message: string }>(
    `/files/${encodeURIComponent(filename)}`,
    { method: 'DELETE' }
  )

export const inspectFile = (filename: string) =>
  request<InspectFileResponse>(`/files/inspect/${encodeURIComponent(filename)}`)

export const duplicateFile = (source: string, dest: string) =>
  request<DuplicateResponse>(`/files/${encodeURIComponent(source)}/duplicate`, {
    method: 'POST',
    body: JSON.stringify({ source_filename: source, dest_filename: dest }),
  })

// ---- Blocks ----
export const getBlockDetails = (blockId: number) =>
  request<BlockDetails>(`/blocks/${blockId}`)

// ---- Snapshots ----
export const listSnapshots = (ctx?: { signal?: AbortSignal } | AbortSignal) => {
  const signal = ctx instanceof AbortSignal ? ctx : ctx?.signal
  return request<{ snapshots: SnapshotView[]; count: number }>('/snapshots', undefined, signal)
}

export const createSnapshot = (name: string) =>
  request<{ status: string; snapshot: SnapshotView }>('/snapshots/create', {
    method: 'POST',
    body: JSON.stringify({ name }),
  })

export const restoreSnapshot = (name: string) =>
  request<{ status: string; message: string }>('/snapshots/restore', {
    method: 'POST',
    body: JSON.stringify({ name }),
  })

export const deleteSnapshot = (name: string) =>
  request<{ status: string; message: string }>(
    `/snapshots/${encodeURIComponent(name)}`,
    { method: 'DELETE' }
  )

// ---- Merkle / Integrity ----
export const runScrub = () =>
  request<ScrubReport>('/merkle/scrub', { method: 'POST' })

export const runHeal = () =>
  request<HealReport>('/merkle/heal', { method: 'POST' })

export const getHealLog = () =>
  request<{ heal_events: HealReport['records']; total_events: number }>('/merkle/heal_log')

export const getMerkleProof = (filename: string, blockIndex: number) =>
  request<MerkleProof>(`/merkle/proof/${encodeURIComponent(filename)}/${blockIndex}`)

// ---- Simulation ----
export const injectBitRot = (blockId?: number) =>
  request<{
    status: string
    corrupted_block: number
    owning_files: string[]
    message: string
  }>('/simulate/bitrot', {
    method: 'POST',
    body: JSON.stringify(blockId !== undefined ? { block_id: blockId } : {}),
  })

export const simulateWorkload = () =>
  request<{ status: string; message: string; telemetry: TelemetryResponse }>(
    '/simulate/workload',
    { method: 'POST' }
  )

// ---- Benchmark ----
export const runBenchmark = (workload: string) =>
  request<BenchmarkResponse>('/benchmark', {
    method: 'POST',
    body: JSON.stringify({ workload }),
  })

// ---- Format / Reset ----
export const formatFilesystem = () =>
  request<{ status: string; message: string }>('/format', { method: 'POST' })
