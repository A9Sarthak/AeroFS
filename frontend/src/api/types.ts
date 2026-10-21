// ============================================================
//  AeroFS Studio — Shared Types
//  Derived from actual API response shapes; no fabricated fields
// ============================================================

export type BlockState = 'free' | 'metadata' | 'unique' | 'shared' | 'corrupted' | 'snapshot' | 'unknown'

export interface BlockView {
  blockId: number
  state: BlockState
  allocated: boolean
  refCount?: number
  expectedHash?: string
  actualHash?: string
  hashMatches?: boolean
  ownerFileNames?: string[]
  ownerSnapshotNames?: string[]
  isMetadata?: boolean
  isCorrupted?: boolean
}

export interface FileView {
  name: string
  inode_id?: number
  size: number
  num_blocks: number
  block_ids: number[]
  merkle_root?: string
  leaf_hashes?: string[]
  created_at?: string
  modified_at?: string
  integrityStatus?: 'healthy' | 'degraded' | 'unknown'
}

export interface DiskView {
  total_blocks: number
  block_size: number
  capacity_bytes: number
  allocated_blocks: number
  free_blocks: number
  utilization_percent: number
  corrupted_blocks_count: number
}

export interface DeduplicationStats {
  total_chunks: number
  unique_chunks: number
  dedup_hits: number
  blocks_saved: number
  refcounts?: Record<string, number>
}

export interface SnapshotView {
  name: string
  created_at: string
  file_count: number
  total_size: number
  files: string[]
  block_ids?: number[]
  file_blocks?: Record<string, number[]>
}

export interface TelemetryResponse {
  disk: DiskView
  dedup: DeduplicationStats
  file_count: number
  snapshot_count: number
  grid_blocks: number[]   // 0=free,1=meta,2=unique,3=shared,4=corrupted
  files: FileView[]
  snapshots: SnapshotView[]
}

export interface HealthResponse {
  ok: boolean
  status: string
  disk_path: string
  total_blocks: number
  block_size: number
  version: string
}

export interface CreateFileResponse {
  status: string
  filename: string
  inode_id: number
  size: number
  blocks_used: number
  block_ids: number[]
  deduplicated_chunks: number
  merkle_root: string
}

export interface DuplicateResponse extends CreateFileResponse {
  source: string
  destination: string
  message: string
}

export interface ScrubReport {
  total_files: number
  files_checked: number
  corrupted_blocks: number[]
  status: string
  details?: Record<string, unknown>
}

export interface HealRecord {
  block_id: number
  success: boolean
  source: string
  expected_hash?: string
  recovered_hash?: string
  owning_file?: string
  timestamp?: string
  error?: string
}

export interface HealReport {
  healed_count: number
  failed_count: number
  records: HealRecord[]
  re_anchored_inodes: string[]
  status: string
}

export interface MerkleProof {
  block_index: number
  leaf_hash: string
  proof_path: string[]
  root_hash: string
  is_valid?: boolean
}

export interface AutoHealStep {
  step: number
  phase: string
  status: 'ok' | 'corrupted' | 'detected' | 'healed' | 'verified'
  title: string
  detail: string
}

export interface AutoHealSimulationResponse {
  status: string
  scenario: 'read_repair' | 'background_scrub' | 'snapshot_extent'
  title: string
  description: string
  steps: AutoHealStep[]
  target_file: string
  target_block: number
  expected_hash: string
  corrupted_hash: string
  recovered_hash: string
  recovery_source: string
  latency_ms: number
  is_healed: boolean
}

export interface PatrolStatusResponse {
  active: boolean
  heal_log_count: number
  last_heal?: HealRecord | null
  corrupted_blocks_count: number
}

// ── Live Healing Demo Types ────────────────────────────────────────────────────

export interface ChangedOffset {
  offset: number
  before: string  // hex string e.g. "0x41"
  after: string
  before_int: number
  after_int: number
}

export interface LiveHealBaselineResponse {
  stage: 'baseline'
  filename: string
  file_size: number
  num_blocks: number
  block_ids: number[]
  target_block_id: number
  target_block_index: number
  content_preview: string
  block_bytes_hex: string
  block_preview: string
  block_hash: string
  merkle_root: string
  merkle_leaves: string[]
  recovery_cache_has_block: boolean
  snapshot_name: string | null
  snapshot_has_block: boolean
}

export interface LiveHealCorruptResponse {
  stage: 'corrupt'
  filename: string
  target_block_id: number
  target_block_index: number
  clean_hash: string
  clean_hex_sample: string
  clean_preview: string
  clean_merkle_leaves: string[]
  clean_merkle_root: string
  corrupted_hash: string
  corrupted_hex_sample: string
  corrupted_preview: string
  corrupted_merkle_leaves: string[]
  corrupted_merkle_root: string
  changed_offsets: ChangedOffset[]
  total_bytes_changed: number
  hash_matches: boolean
}

export interface LiveHealRepairResponse {
  stage: 'repair'
  filename: string
  target_block_id: number
  target_block_index: number
  corrupted_hash: string
  corrupted_hex: string
  corrupted_preview: string
  recovery_source: string
  recovered_from_description: string
  recovered_bytes_hex: string
  repaired_hash: string
  repaired_hex: string
  repaired_preview: string
  new_merkle_root: string
  new_merkle_leaves: string[]
  full_content_after: string
  is_healed: boolean
  hash_verified: boolean
}

export type LiveHealResponse =
  | LiveHealBaselineResponse
  | LiveHealCorruptResponse
  | LiveHealRepairResponse

export interface BlockDetails {
  block_id: number
  is_allocated: boolean
  is_corrupted: boolean
  is_metadata: boolean
  refcount: number
  expected_hash?: string
  actual_hash?: string
  hash_matches: boolean
  referencing_files: string[]
  referencing_snapshots: string[]
}

export interface InspectFileResponse {
  inode: FileView
  is_healthy: boolean
  corrupted_blocks: number[]
  tree: unknown
  ascii_tree: string
  preview: string
}

export interface OperationEvent {
  id: string
  timestamp: string
  operation: string
  status: 'success' | 'warning' | 'failed'
  message: string
  affectedBlockIds?: number[]
  fileName?: string
  durationMs?: number
  details?: Record<string, unknown>
}

export interface BenchmarkResult {
  operation: string
  size_bytes?: number
  duration_ms: number
  blocks_used?: number
  dedup_hits?: number
  files_audited?: number
  total_dedup_hits?: number
}

export interface BenchmarkResponse {
  status: string
  workload: string
  results: BenchmarkResult[]
  note: string
}

// Grid block state mapping (from API integer codes)
export const GRID_STATE_MAP: Record<number, BlockState> = {
  0: 'free',
  1: 'metadata',
  2: 'unique',
  3: 'shared',
  4: 'corrupted',
  5: 'snapshot',
}

export const BLOCK_STATE_COLORS: Record<BlockState, string> = {
  free:      '#1e293b',
  metadata:  '#0ea5e9',
  unique:    '#10b981',
  shared:    '#8b5cf6',
  corrupted: '#ef4444',
  snapshot:  '#f59e0b',
  unknown:   '#475569',
}

export const BLOCK_STATE_COLORS_LIGHT: Record<BlockState, string> = {
  free:      '#cbd5e1',
  metadata:  '#0284c7',
  unique:    '#059669',
  shared:    '#7c3aed',
  corrupted: '#dc2626',
  snapshot:  '#d97706',
  unknown:   '#94a3b8',
}

export const BLOCK_STATE_LABELS: Record<BlockState, string> = {
  free:      'Free',
  metadata:  'Metadata/Superblock',
  unique:    'Unique Data',
  shared:    'CAS Deduplicated',
  corrupted: 'Corrupted',
  snapshot:  'Snapshot Protected',
  unknown:   'Unknown',
}
