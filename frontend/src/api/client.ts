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
  AutoHealSimulationResponse,
  PatrolStatusResponse,
  LiveHealResponse,
  BestFitPreviewResponse,
  CreateLargeFileResponse,
  CLIExecuteResponse,
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

export const checkFileConflict = (filename: string, contentHash: string) =>
  request<{
    exists: boolean
    is_duplicate: boolean
    conflict: boolean
    existing_hash?: string
    proposed_hash?: string
  }>('/files/check', {
    method: 'POST',
    body: JSON.stringify({ filename, content_hash: contentHash }),
  })

export const createTextFile = (filename: string, content: string, fillHolesFirst: boolean = false) =>
  request<CreateFileResponse>('/files/create_text', {
    method: 'POST',
    body: JSON.stringify({ filename, content, fill_holes_first: fillHolesFirst }),
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

export const simulatePartialDedup75 = () =>
  request<{
    status: string
    message: string
    file_a: { name: string; size: number; block_ids: number[] }
    file_b: { name: string; size: number; block_ids: number[] }
    shared_blocks: number[]
    shared_count: number
    file_a_unique: number[]
    file_b_unique: number[]
    dedup_hits: number
    space_saved_bytes: number
    telemetry: TelemetryResponse
  }>('/simulate/partial_dedup_75', { method: 'POST' })

// ---- Benchmark ----
export const runBenchmark = (workload: string) =>
  request<BenchmarkResponse>('/benchmark', {
    method: 'POST',
    body: JSON.stringify({ workload }),
  })

// ---- Format / Reset ----
export const formatFilesystem = () =>
  request<{ status: string; message: string }>('/format', { method: 'POST' })

// ---- Auto-Healing Simulator ----
export const simulateAutoHeal = (body: {
  scenario: 'read_repair' | 'background_scrub' | 'snapshot_extent'
  filename?: string
  block_id?: number
}) =>
  request<AutoHealSimulationResponse>('/simulate/auto_heal', {
    method: 'POST',
    body: JSON.stringify(body),
  })

export const getPatrolStatus = () =>
  request<PatrolStatusResponse>('/simulate/patrol_status')

export const togglePatrol = (active?: boolean) =>
  request<{ status: string; active: boolean; message: string }>('/simulate/patrol_toggle', {
    method: 'POST',
    body: JSON.stringify(active !== undefined ? { active } : {}),
  })

export const liveHeal = (body: { filename: string; block_index: number; stage: 'baseline' | 'corrupt' | 'repair' }) =>
  request<LiveHealResponse>('/simulate/live_heal', {
    method: 'POST',
    body: JSON.stringify(body),
  })

// ---- Best-Fit Allocation Simulation ----
export const getBestFitPreview = (blocksNeeded: number, fillHolesFirst: boolean = false) =>
  request<BestFitPreviewResponse>('/simulate/best_fit_preview', {
    method: 'POST',
    body: JSON.stringify({ blocks_needed: blocksNeeded, fill_holes_first: fillHolesFirst }),
  })

export const createLargeSimulatedFile = (
  filename: string,
  numBlocks: number,
  isUnique: boolean = true,
  fillHolesFirst: boolean = false
) =>
  request<CreateLargeFileResponse>('/simulate/create_large_file', {
    method: 'POST',
    body: JSON.stringify({
      filename,
      num_blocks: numBlocks,
      is_unique: isUnique,
      fill_holes_first: fillHolesFirst,
    }),
  })

// ---- Interactive CLI / Shell ----
export const executeCLICommand = (command: string) =>
  request<CLIExecuteResponse>('/cli/execute', {
    method: 'POST',
    body: JSON.stringify({ command }),
  })
