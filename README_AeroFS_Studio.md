# AeroFS Studio — 3D File-System Simulator
## Complete Product Specification and AI-Agent Implementation Brief

> **Goal:** Turn the existing AeroFS Operating Systems project into a polished, interactive, OS-like web desktop that visualizes file-system operations in 3D. Users should be able to create files, duplicate identical content, edit shared files, observe Copy-on-Write (CoW), create/restore snapshots, inject simulated bit rot, run Merkle scrubs, and watch verified self-healing—while seeing exactly how logical files map to physical virtual-disk blocks.

> **Scope boundary:** This is a web-based OS/file-system simulator, not a bootable operating system and not a real hardware disk controller. The UI must visualize actual AeroFS backend state. Never fabricate block IDs, deduplication results, corruption, recovery success, metrics, or benchmark numbers.

---

# 1. Instructions to the AI Coding Agent

You are extending an existing academic Operating Systems project named **AeroFS**. Build **AeroFS Studio**, a 3D interactive file-system simulation hub.

## Non-negotiable rules

1. **Audit before coding.** Inspect the repository layout, current Git status, README, API routes, dependencies, tests, and existing frontend. Do not assume suggested paths already exist.
2. **Preserve the storage engine.** Reuse the existing virtual block device, Copy-on-Write, CAS deduplication, reference counts, snapshots, SHA-256 hashes, Merkle trees, scrubbing, recovery cache, snapshot extent store (if implemented), self-healing, audit log, and metadata journal (if implemented).
3. **Do not replace real backend behavior with frontend mocks.** Buttons must call actual backend operations. Animations may explain real results but must not invent state.
4. **Do not break existing APIs, CLI workflows, disk formats, or tests.** Add compatible endpoints or adapters where necessary. Make focused changes and add regression tests.
5. **Verify API contracts.** Read the actual FastAPI routes and response schemas before building API calls. The endpoint examples below are suggestions, not claims that those routes already exist.
6. **Be honest about simulation.** Bit rot is injected corruption in a virtual disk image. The interface must not imply real hardware failure or a bootable OS.
7. **Protect user data.** Use a dedicated disposable demo/test disk path. Never automatically format or delete the existing project disk. Destructive operations require confirmation and clearly identify the target.
8. **Test continuously.** Run the current suite before changes and after each major phase. Add backend and frontend tests. Report exact results honestly; never silently skip failures.
9. **No fake performance numbers.** Show only measured benchmark values as measured. Label any illustrative data as illustrative and never mix it into real results.
10. **Finish with evidence.** Provide changed-file list, commands run, test output, known limitations, launch instructions, and a repeatable demo script.

Do not stop after producing a static mockup or a plan. Implement and verify end-to-end workflows.

---

# 2. Product Vision

**AeroFS Studio** should feel like a compact futuristic operating system inside a browser: a desktop shell, file manager, editor, storage monitor, and a 3D “storage universe.”

The app must answer this question:

> **When I create, duplicate, edit, snapshot, corrupt, or repair a file, what changes in the logical file system and what changes on the physical virtual disk?**

Every major action should result in:
1. a real backend operation;
2. an event in the operation timeline;
3. an updated logical file/inode view;
4. an updated physical block map;
5. relevant metrics and a plain-English explanation.

Aim for a premium sci-fi control room, not a cluttered hacker-movie screen: clear hierarchy, readable contrast, restrained glow, purposeful 3D motion, and meaningful data visualizations.

- Product name: **AeroFS Studio**
- Subtitle: **3D Storage & File-System Simulator**
- Default UI language: English.
- Use accurate terms: Logical File, Inode, Physical Block, CAS, Reference Count, Copy-on-Write, Snapshot, SHA-256, Merkle Root, Scrub, Recovery Source, Integrity Error.
- Add concise tooltips or an “Explain this” panel for technical terms.

---

# 3. AeroFS Concepts That Must Be Preserved

## 3.1 Virtual block device

- The virtual disk is backed by a binary container file.
- The common configured block size is 4096 bytes (4 KiB), but read the actual value from backend configuration/telemetry.
- Initial blocks may be reserved for superblock, bitmap, or metadata. Read the actual reserved-block range; do not hardcode it if the backend can vary.
- Each physical block has an ID and allocation state. Refcounts and hashes should be shown when available.
- The 3D view must reflect the configured total block count, block size, and allocation map.

## 3.2 Content-Addressable Storage (CAS) and deduplication

- Data chunks are fingerprinted using SHA-256.
- Identical chunks can map to the same physical block.
- Multiple logical files may point to one physical block.
- Reference counts should reflect the backend's actual ownership model, including snapshot references if counted.
- Duplicating an identical file should increase logical ownership/references but need not allocate additional physical data blocks.
- Visually distinguish **logical files** from **physical data blocks**.

## 3.3 Copy-on-Write (CoW)

When a shared file is edited:
- the original shared bytes must remain unchanged for other files/snapshots;
- changed content is written to new block(s) according to the backend's actual chunking and CoW implementation;
- the edited inode's mapping changes as appropriate;
- other owners retain the old mapping/data;
- reference counts and physical allocation change accordingly.

Do not claim every edit moves every block. Show only actual mapping changes returned by or observed from the backend.

## 3.4 Snapshots

- A snapshot captures a point-in-time filesystem view.
- Snapshot creation may preserve metadata and block references rather than copying every file byte. Describe it as low-copy/reference-based only if confirmed by implementation.
- If an independent `snapshot_extent_store` exists, visualize it as a separate source of preserved bytes.
- A snapshot's reference map and an independent clean extent copy are different things. Do not call a snapshot a full independent backup unless the implementation truly provides that guarantee.
- Snapshot restore must call the backend and show the actual result.

## 3.5 Integrity, Merkle trees, and simulated bit rot

- Use the backend's trusted expected SHA-256 leaf hashes and Merkle roots.
- A scrub compares current block bytes against expected integrity metadata.
- A Merkle proof proves inclusion relative to a root; it does not by itself establish that the root is trusted.
- Mark a block corrupt only when the backend reports it or a verified comparison proves the mismatch.
- Bit-rot injection is a controlled simulation, not actual hardware failure.

## 3.6 Verified self-healing and safe reads

- Recovery may use a recovery cache and/or historical snapshot extents, depending on actual backend capability.
- Candidate recovered bytes must be validated against the trusted expected hash before accepting them.
- Update integrity metadata only after successful verification.
- Run post-heal verification where supported.
- If no valid source exists, show degraded/unrecoverable status. Never silently present corrupt bytes as valid data.
- Preserve `IntegrityError` / `EIO` behavior through the API and display it clearly.
- If forensic reads are supported, put them behind an explicitly labelled advanced option with a warning. Normal reads must remain integrity-checked.

## 3.7 Persistence

If a metadata journal or restart persistence exists, display its status only when the backend can verify it. Test restart/remount behavior. Do not claim crash consistency merely because a JSON sidecar exists; document actual guarantees and limits.

---

# 4. Recommended Technology Stack

## Frontend

Recommended defaults, subject to repository inspection:
- **React + TypeScript + Vite** for the single-page application.
- **Three.js via React Three Fiber** for the 3D scene.
- **@react-three/drei** for camera controls, instancing helpers, and scene utilities where useful.
- **Tailwind CSS** or the repository's existing styling system.
- **Framer Motion** for restrained panel/UI transitions.
- **Zustand** or React Context for UI state.
- **TanStack Query** for requests, loading/error states, and cache invalidation.
- **Vitest + React Testing Library** for frontend tests.
- **Playwright** for critical browser workflows if available.

Use compatible stable versions. Do not add a library if the existing project already has a good solution.

## Backend

- Keep the current **Python + FastAPI AeroFS backend** unless repository inspection proves a different active architecture.
- Reuse the current `AeroFileSystem`, disk, CAS, CoW, snapshots, Merkle scrubber, recovery and audit implementations.
- Add REST endpoints only when necessary.
- Use Pydantic request/response schemas if consistent with the project.
- The backend is authoritative; the frontend must not maintain a competing physical-storage state.

## Architecture

```text
┌──────────────────────────────────────────────────────────────────┐
│ AeroFS Studio: React + TypeScript + Vite                         │
│ Desktop Shell | File Manager | Editor | Snapshot Manager          │
│ 3D Block Map | Integrity Lab | Metrics | Event Timeline           │
└──────────────────────────────┬───────────────────────────────────┘
                               │ HTTP / JSON
                               ▼
┌──────────────────────────────────────────────────────────────────┐
│ FastAPI REST API                                                  │
│ Validation | Error mapping | Operation results | Telemetry        │
└──────────────────────────────┬───────────────────────────────────┘
                               │
                               ▼
┌──────────────────────────────────────────────────────────────────┐
│ AeroFileSystem                                                    │
│ Inodes | CoW | Snapshots | CAS | Refcounts                        │
│ Merkle scrub | Recovery | Audit log | Persistence (if supported)  │
└──────────────────────────────┬───────────────────────────────────┘
                               │
                               ▼
┌──────────────────────────────────────────────────────────────────┐
│ Virtual Block Device / Disk Image                                 │
│ Allocation bitmap | Reserved blocks | Data blocks                 │
└──────────────────────────────────────────────────────────────────┘
```

---

# 5. Visual Design System and App Shell

## 5.1 Visual direction

Build a dark, high-contrast storage command center:
- deep charcoal/navy background;
- slightly lighter panels;
- one restrained accent for primary actions;
- cyan/blue for neutral storage and selection;
- purple for shared/deduplicated blocks;
- green for verified healthy blocks;
- amber for warnings/pending operations;
- red for confirmed corruption/unrecoverable data;
- gray for free blocks.

Color must never be the only status indicator. Include labels, icons, or accessible text.

## 5.2 Layout

### Top bar
- AeroFS Studio logo/name;
- selected workspace / disk image label;
- backend status: Connected / Disconnected;
- current operation indicator;
- help/settings.

### Left navigation
- Overview
- File System
- 3D Storage Map
- Snapshots
- Integrity Lab
- Recovery & Audit Log
- Benchmarks
- Settings / About

### Main workspace
- Displays the selected module.
- Overview should feature the 3D map prominently.
- Panels should resize/collapse cleanly.

### Right inspector
- Selected file/block/snapshot details.
- Logical owners and physical mappings.
- Hashes, reference counts, allocation status, and operation details where provided.
- Plain-English “Explain this state.”

### Bottom timeline/terminal drawer
- Recent operations and results.
- Expandable API result, changed block IDs, bytes written, hashes, and errors.
- Optional terminal-style command panel, but commands must invoke real backend operations.

## 5.3 Typography and interaction

- Use readable UI typography; use monospace for hashes, IDs, and logs.
- Provide loading skeletons, empty states, and error states.
- Every async operation needs loading, success, and failure handling.
- Prevent accidental duplicate submission.
- Confirm delete, format/reset, restore-overwrite, and corruption injection.
- Show short toasts but retain important details in the event timeline.
- Support keyboard focus, visible focus indicators, semantic labels, and reduced motion.

---

# 6. The 3D Storage Map — Signature Feature

This must be an actual interactive 3D scene, not a static illustration.

## 6.1 Scene metaphor

Represent the virtual disk as a 3D field of small cubes:
- each cube corresponds to one physical block ID;
- cubes are laid out in an adaptive grid/layered grid;
- reserved metadata blocks are visually separated or labelled;
- free blocks are dim gray;
- unique allocated blocks use a blue/cyan state;
- shared/deduplicated blocks are purple with a shared marker;
- confirmed corrupted blocks are red and may pulse (respect reduced-motion preferences);
- blocks being written/healed get a brief, accurate transition;
- selected blocks get an outline and open the inspector.

For large disks, use instanced meshes (`InstancedMesh` or equivalent), not one heavy mesh per block. Add level-of-detail, range selection, or pagination when necessary.

## 6.2 Block ID → coordinates

Use a deterministic mapping, for example:
- `x = block_id % columns`
- `z = floor(block_id / columns) % depth`
- `y = floor(block_id / (columns * depth))`

Choose grid dimensions based on actual `total_blocks`. This is only a visual coordinate system; it does not mean the virtual disk's binary file is physically arranged in 3D.

## 6.3 Camera and interaction

- Orbit/rotate with mouse or touch.
- Zoom and pan with limits.
- Click to select a block.
- Hover tooltip: block ID, state, refcount, hash prefix, owner count when available.
- Double-click or “Inspect” opens details.
- Search block ID.
- Filter: All, Free, Metadata/Reserved, Unique, Shared, Corrupted.
- Highlight all blocks used by a selected file.
- “Show relationships” draws lines from logical file extents to physical blocks.
- Show/hide labels, grid, and animations.
- Reset camera.
- Provide an accessible 2D grid/table fallback.
- Detect WebGL failure and show a friendly fallback instead of a blank page.

## 6.4 File-to-block relationship view

When a file is selected:
- show logical block order (`file block 0`, `file block 1`, …);
- draw lines or animated paths to its actual physical block IDs;
- when several logical extents map to the same block, converge links on that shared block;
- selecting a block highlights all files/snapshots referencing it, based on authoritative backend data.

Do not guess owners based on whichever file was last clicked. Fetch authoritative details or derive from a complete current metadata response.

## 6.5 Action animations

Animations must be driven by actual before/after backend state.

### Create file
1. User enters name/content.
2. Send create/write request.
3. On success, animate the logical file/inode appearing.
4. Highlight actual allocated/reused blocks.
5. Show actual allocation and dedup results.
6. Add timeline event.

### Duplicate identical file
1. User selects Duplicate.
2. Offer “Identical content” or “Duplicate and edit content.”
3. For identical content, write the exact same bytes under a new filename via backend.
4. Highlight shared physical blocks in purple.
5. Show actual dedup hits, allocation delta, and refcounts if available.
6. Claim sharing only if returned mappings confirm it.

### Edit a shared file — CoW
1. Open file in editor.
2. Capture the pre-save mapping read-only.
3. User changes content and saves via backend.
4. Fetch post-save mapping.
5. Animate only actual changed mappings.
6. Keep old blocks highlighted for other files/snapshots if they still reference them.
7. Show reused, allocated, released, and unchanged blocks if the backend exposes enough information.
8. Explain the real mapping change.
9. Never invent an old-to-new mapping if data is unavailable.

### Snapshot
1. Ask for a name.
2. Call backend.
3. Display a point-in-time marker and snapshot mapping.
4. If independent preserved extents exist, visualize them separately.
5. Show measured duration/allocation delta only if measured.
6. Explain what is preserved and whether independent clean bytes exist.

### Bit-rot injection
1. Show warning: “This injects simulated corruption into the selected virtual block.”
2. Require a valid allocated data block or explicit block selection.
3. Confirm before mutation.
4. Call backend.
5. Mark red only after backend confirms.
6. Show affected files/snapshots if known.
7. State that the test should use a disposable simulation disk.

### Merkle scrub
1. Call backend scrub.
2. Show actual progress only if the backend reports progress; otherwise use an indeterminate loader.
3. Display actual files audited, corrupt IDs, healthy/degraded status, and measured duration if available.
4. Highlight confirmed corrupt blocks.
5. Show expected/current hash details if supplied.

### Self-healing
1. Confirm that the operation may write repaired bytes.
2. Call backend heal.
3. Display each actual record: block ID, source (`recovery_cache`, `snapshot:<name>`, or failure), success/failure, hashes when available.
4. Animate repair only after backend verification succeeds.
5. Run/refresh post-heal scrub if not included in the backend result.
6. Show actual `HEALTHY`, `DEGRADED`, or `UNRECOVERABLE` state.
7. If healing fails, keep the block red and say the data could not be recovered.

---

# 7. Required Screens and Behaviors

## 7.1 Overview

Show:
- backend connection state;
- total capacity, block size, allocated/free blocks, utilization;
- logical vs physical bytes if available;
- dedup ratio/hits/bytes saved if reported;
- file and snapshot counts;
- last scrub result and corrupted block count;
- recent operation timeline;
- 3D block map and legend;
- quick actions: Create File, Duplicate, Snapshot, Scrub, Inject Bit Rot (destructive warning), Self-Heal.

If a metric is unavailable, display “Not reported by backend,” not a fabricated zero.

## 7.2 File Manager

Features:
- list/grid toggle;
- filename, size, block count, modified time, integrity status where available;
- search/sort;
- create, read/open, edit/save, duplicate;
- rename/delete only if supported;
- file details and physical mapping;
- “Show in 3D” action;
- clear handling of `IntegrityError`/EIO.

### Create file dialog
- filename;
- content editor or test-payload selector;
- optional size/pattern generator;
- exact payload byte length;
- create button.

Useful demo payloads:
- small text;
- one 4096-byte block;
- multi-block file;
- repeated content;
- unique content.

Show exact payload size before submission. Do not silently pad/truncate content unless that is the backend contract.

### Duplicate dialog
- source file;
- destination filename;
- identical copy vs edited copy;
- optional “Likely to deduplicate” prediction, clearly marked as prediction;
- after success, actual shared block IDs and dedup metrics.

### Editor
- plain text editor is sufficient;
- show original/current size and unsaved state;
- save through backend;
- compare real block mappings before/after;
- handle stale editor state or concurrent modification if version metadata exists.

## 7.3 Inode/file inspector

Display fields only when available:
- filename, inode ID, logical size;
- ordered physical block IDs;
- creation/modification times;
- Merkle root and leaf hashes;
- integrity status;
- file/snapshot owners and references.

Actions: Open, Edit, Duplicate, Show in 3D, Generate/verify Merkle proof, Run integrity check, View timeline. Provide copy buttons for IDs/hashes and collapse long hashes by default.

## 7.4 Snapshot Manager

- list/create/inspect/restore/delete snapshots (only supported actions);
- snapshot time and file count;
- compare current state to snapshot;
- show independent extent store separately if present;
- restore confirmation and affected scope.

Comparison should identify unchanged, added, removed, and changed files, plus changed block mappings where data is available. Do not call a snapshot a “full backup” unless the implementation provides that guarantee.

## 7.5 Integrity Lab

A guided workflow:
1. **Baseline:** choose file, record original bytes/hash in the test flow, run clean scrub.
2. **Inject:** select a data block and confirm simulated bit rot.
3. **Detect:** run scrub and display actual mismatch.
4. **Recover:** run self-heal and show actual source.
5. **Verify:** compare recovered bytes against trusted expected hash and run post-heal scrub.
6. **Failure case:** in a disposable workspace, make both recovery sources unavailable and verify safe read failure.

Each step must show: operation, OS concept, expected observation, actual result, and pass/fail. Pass/fail is determined by actual assertions, not by whether an animation finished.

## 7.6 Recovery and Audit Log

Chronological entries:
- timestamp;
- operation;
- block ID;
- owner file(s);
- expected hash;
- observed/recovered hash;
- recovery source;
- success/failure;
- error/status;
- duration if measured.

Filters: operation, status, file, block, time range. Use backend audit logs as source of truth. If logs are in-memory since startup, label them accordingly.

## 7.7 Benchmarks

Display only actual measurements:
- workload and dataset size;
- number of files and logical bytes;
- physical bytes/unique blocks;
- dedup hits/savings;
- snapshot/scrub/heal latency;
- repeat count, median, spread when available;
- environment details when available.

Distinguish “Measured AeroFS,” “Measured baseline,” and “Illustrative/simulated baseline.” Never compare a measured value to a hardcoded constant as if both were measured. Avoid unsupported claims such as “300× faster” or “90% savings.”

---

# 8. Backend API Integration

## 8.1 Inventory current routes first

Before implementing frontend API calls:
1. Inspect the active `aerofs/app.py` or actual FastAPI entry point.
2. Inspect `cow_fs.py`, `disk.py`, `dedup.py`, `merkle.py`, and `client.py`.
3. Inspect current API tests.
4. Record exact routes and request/response schemas.
5. Reuse existing routes and response fields.
6. Add missing endpoints only after confirming they are needed.

## 8.2 Suggested capabilities

The following are suggested routes, not a claim that they already exist. Match existing routes or add deliberate, tested aliases.

| Capability | Example route | Method | Notes |
|---|---|---:|---|
| Health | `/api/health` | GET | Add only if needed |
| Telemetry | `/api/telemetry` | GET | Disk, dedup, counts, block states |
| List files | `/api/files` | GET | Authoritative summaries |
| Read file | `/api/files/{filename}` | GET | Preserve integrity errors |
| Create/update | `/api/files/{filename}` | PUT/POST | Validate content/name |
| Duplicate | `/api/files/{filename}/duplicate` | POST | Optional convenience route |
| Delete | `/api/files/{filename}` | DELETE | Only if supported |
| Block details | `/api/blocks/{block_id}` | GET | Allocation/hash/refcount/owners |
| List snapshots | `/api/snapshots` | GET | Snapshot list |
| Create snapshot | `/api/snapshots` | POST | Validate name |
| Restore snapshot | `/api/snapshots/{name}/restore` | POST | Confirm in UI |
| Delete snapshot | `/api/snapshots/{name}` | DELETE | Only if implemented |
| Scrub | `/api/merkle/scrub` | POST | Actual scrub report |
| Heal | `/api/merkle/heal` | POST | Per-block result |
| Heal log | `/api/merkle/heal_log` | GET | Reuse if present |
| Merkle proof | `/api/merkle/proof/{filename}/{block_index}` | GET | Reuse if present |
| Inject bit rot | `/api/simulate/bitrot` | POST | Simulation-only; validate block |
| Run benchmark | `/api/benchmark` | POST | Long task may need job IDs |
| Job status | `/api/jobs/{job_id}` | GET | Only if background jobs exist |

Prefer stable file IDs for routes if filenames can contain slashes. Do not leak absolute disk paths to the browser.

## 8.3 Response/error contract

Where feasible, use consistent responses, e.g.:

```json
{
  "ok": true,
  "operation_id": "server-generated-id",
  "message": "File saved",
  "data": {},
  "metrics": {},
  "events": []
}
```

This is an example only. Do not break existing clients by changing established response shapes without a compatibility plan. Use a frontend API adapter to normalize existing responses.

Errors should have appropriate HTTP status, a stable code (e.g. `FILE_NOT_FOUND`, `INTEGRITY_ERROR`, `RECOVERY_FAILED`, `INVALID_BLOCK`, `CONFLICT`), safe message, and operation ID if available.

Never return HTTP 200 with corrupt file bytes after an integrity failure. Preserve `IntegrityError`/EIO semantics.

## 8.4 Refresh strategy

Start with reliable request/response synchronization. After every successful mutation:
1. consume operation result;
2. refetch/invalidate relevant telemetry, files, snapshots, and selected block/file data;
3. animate from captured pre-operation state to returned post-operation state;
4. append an event timeline entry.

Use WebSockets/SSE only if genuine backend progress/events are available. Do not invent a live-sync stream.

Separate:
- **Backend state:** authoritative blocks, mappings, hashes, refcounts, snapshots, outcomes.
- **Presentation state:** camera, selection, filters, open panels, animation progress.

Never leave a successful-looking animation/state after the server rejected an operation.

---

# 9. Suggested Frontend Structure

Adapt to the existing repo; do not create a duplicate frontend if one exists.

```text
frontend/
├── package.json
├── vite.config.ts
├── tsconfig.json
├── src/
│   ├── main.tsx
│   ├── App.tsx
│   ├── app/                 # shell, routes, navigation
│   ├── api/                 # HTTP client, types, files, snapshots, integrity
│   ├── components/          # top bar, sidebar, inspector, timeline, dialogs
│   ├── features/
│   │   ├── overview/
│   │   ├── file-manager/
│   │   ├── editor/
│   │   ├── storage-map/     # scene, instanced blocks, controls, coordinates
│   │   ├── snapshots/
│   │   ├── integrity-lab/
│   │   ├── audit-log/
│   │   └── benchmarks/
│   ├── state/               # UI-only state
│   ├── hooks/
│   ├── utils/
│   ├── styles/
│   └── test/
└── README.md
```

Keep backend modules under the current `aerofs/` package. Avoid moving core modules merely to match this example.

## Suggested frontend types

Derive actual fields from API responses; use an adapter rather than assuming all fields exist.

```ts
export type BlockState =
  | "free" | "metadata" | "unique" | "shared" | "corrupted" | "unknown";

export interface BlockView {
  blockId: number;
  state: BlockState;
  allocated: boolean;
  refCount?: number;
  expectedHash?: string;
  actualHash?: string;
  hashMatches?: boolean;
  ownerFileNames?: string[];
  ownerSnapshotNames?: string[];
}

export interface FileView {
  name: string;
  inodeId?: number;
  sizeBytes: number;
  blockIds: number[];
  merkleRoot?: string;
  leafHashes?: string[];
  integrityStatus?: "healthy" | "degraded" | "unknown";
}

export interface DiskView {
  blockSizeBytes: number;
  totalBlocks: number;
  allocatedBlocks: number;
  freeBlocks: number;
  reservedBlocks?: number[];
}

export interface OperationEvent {
  id: string;
  timestamp: string;
  operation: string;
  status: "success" | "warning" | "failed";
  message: string;
  affectedBlockIds?: number[];
  fileName?: string;
  durationMs?: number;
  details?: Record<string, unknown>;
}
```

These types are a starting point, not an excuse to fake missing fields. Represent unavailable fields as unknown/not reported.

---

# 10. End-to-End Acceptance Workflows

## Workflow A — Create a file
1. Open File Manager → Create File.
2. Enter filename and content/sample payload.
3. Show exact payload length and estimated block count (label estimate if chunking may differ).
4. Submit to backend.
5. Refresh file list, telemetry, and mappings.
6. Highlight the new inode and actual blocks in 3D.
7. Add timeline event.
8. On failure, show error and do not animate a fake file.

**Pass:** File reads back byte-for-byte and the map reflects actual physical IDs.

## Workflow B — Duplicate identical content
1. Create `report-a.txt`.
2. Duplicate as `report-b.txt` with identical bytes.
3. Verify both contents.
4. Show separate logical files and shared physical blocks where confirmed.
5. Show actual dedup hits, physical allocation delta, and refcounts if available.

**Pass:** Dedup visualization is based on actual mappings, not a hardcoded savings percentage.

## Workflow C — Edit one shared file (CoW)
1. Create two identical files and verify sharing.
2. Edit one file and save.
3. Fetch new mapping.
4. Highlight changed mapping(s) only.
5. Prove the duplicate still contains the original bytes.
6. If a snapshot exists, prove it remains unchanged.
7. Show actual refcount/allocation changes.

**Pass:** Original owners preserve their data; edited file contains new bytes; map matches backend state.

## Workflow D — Snapshot and restore
1. Create files including a duplicate.
2. Take a named snapshot.
3. Modify/delete a file.
4. Restore snapshot.
5. Verify names and contents.
6. Show before/after mappings.
7. Display independent extent-store details only if implemented.

**Pass:** Readback and mappings match the snapshot state as defined by the backend.

## Workflow E — Corruption, detection, recovery
1. Write known content and save original bytes/hash in the test workflow.
2. Confirm healthy scrub.
3. Inject simulated bit rot into an allocated data block.
4. Run scrub/read and confirm detection.
5. Self-heal using a valid available source.
6. Compare recovered bytes to trusted original and expected hash.
7. Run post-heal scrub and require healthy status.
8. In a disposable workspace, make both recovery sources unavailable.
9. Verify read fails with `IntegrityError`/EIO and no corrupt bytes are shown as valid.

**Pass:** Every state is supported by backend results, including unrecoverable cases.

## Workflow F — Merkle proof
1. Select file and block index.
2. Request proof from backend.
3. Display leaf hash, sibling path, and root.
4. Verify proof against supplied root.
5. Explain that proof validity is not equivalent to root authenticity.
6. Show errors for invalid index/malformed proof.

**Pass:** No unsupported claim that a proof alone proves the root is trusted.

## Workflow G — Backend failure
1. Disconnect/stop backend or simulate request failure.
2. Show Disconnected / Request Failed.
3. Preserve safe unsaved editor text where possible.
4. Mark stale data as stale.
5. Refetch and reconcile after reconnecting.

**Pass:** No fake successful operation or silent state corruption.

---

# 11. 3D Performance Requirements

- Use `InstancedMesh` or equivalent for large block counts.
- Avoid re-rendering the full scene for every pointer move.
- Memoize coordinate generation and use stable keys.
- Show labels on hover/selection or at useful zoom levels; do not render thousands of labels by default.
- Provide camera fit/reset controls.
- Offer a 2D grid/table fallback.
- Detect WebGL failure.
- Support reduced-motion and disabling animations.
- Do not block controls while animations run.
- Do not fetch full block contents for every cube; use telemetry and fetch detailed hashes/owners only on selection.
- Use pagination/ranges/LOD for large disks when API supports it.
- Dispose of geometries, materials, and listeners when scenes unmount.
- Never expose absolute disk paths or raw storage bytes unnecessarily.

---

# 12. Safety and Error Handling

- Validate filenames and snapshot names server-side.
- Prevent path traversal.
- Never let browser input choose arbitrary disk-image paths.
- Restrict reset/format to a configured disposable demo disk with strong confirmation.
- Configure CORS for the expected frontend origin; do not enable all origins unnecessarily.
- Do not expose stack traces/secrets in API errors.
- Treat file contents as data, never as executable instructions.
- Never execute uploaded content.
- Use request timeouts and cancellation where supported.
- Handle HTTP 400/404/409/422/500 and network failures explicitly.
- On integrity failure, show “File integrity check failed” and never render corrupt bytes as trusted.
- Forensic mode requires explicit action and warning; label bytes untrusted.
- Never run destructive corruption tests against the user's only copy of important data.

---

# 13. Testing Plan

## Before coding
Run the existing backend tests and record the baseline from the current checkout. Inspect Git status and preserve uncommitted user changes. A previously pasted test count is not proof that the current repository passes.

## Backend tests
Cover:
- API schema/status codes;
- create/read/update/duplicate/delete;
- dedup sharing and reference counts;
- CoW isolation;
- snapshot create/restore;
- bit-rot injection;
- scrub results;
- recovery-cache recovery;
- independent snapshot-extent recovery;
- both-sources-unavailable read failure;
- IntegrityError/EIO mapping;
- trusted hash verification and post-heal scrub;
- Merkle proof validation;
- telemetry/block detail accuracy;
- test reset/isolation;
- restart persistence if implemented.

## Frontend tests
Cover:
- API adapter/error mapping;
- loading/empty/error states;
- create validation;
- duplicate workflow;
- edit/save;
- snapshot confirmation;
- corruption warning;
- scrub/heal result rendering;
- block filters/selection;
- inspector values;
- disconnected backend;
- accessibility labels and keyboard interactions.

## Browser E2E tests
Automate at least:
1. Create file → read it → inspect blocks.
2. Duplicate file → prove shared block IDs.
3. Edit one duplicate → prove the other is unchanged.
4. Snapshot → mutate → restore.
5. Bit rot → scrub detects → heal → post-heal scrub healthy.
6. Both recovery sources unavailable → read fails safely.
7. Backend unavailable → UI shows error, no fake success.

Use temporary directories, isolated disk paths, and isolated ports. Clean up even when assertions fail.

## Quality gates
- Existing tests pass.
- New tests pass.
- No failures silently skipped.
- TypeScript type check passes.
- Lint/build passes if configured.
- No console errors during core workflows.
- 3D view remains usable for configured disk size.
- Setup instructions work from a clean checkout.

---

# 14. Implementation Phases

## Phase 0 — Repository audit
- Inspect Git status and repo layout.
- Identify backend entry point, routes, disk configuration, frontend, and tests.
- Document actual current storage behavior.
- Inventory routes and schemas.
- Run baseline tests.

**Deliverable:** architecture summary, route inventory, baseline report.

## Phase 1 — Frontend shell
- Add React/TypeScript/Vite only if no frontend already exists.
- Configure API base URL with environment variables.
- Build top bar, sidebar, workspace, inspector, timeline.
- Add connection/loading/error states and responsive layout.
- Connect telemetry and file listing.

**Deliverable:** desktop shell backed by live API data.

## Phase 2 — File manager
- Implement create, open/read, edit/save, duplicate.
- Add validation and confirmation.
- Capture pre/post mappings.
- Add timeline events.
- Verify byte-for-byte readback.

**Deliverable:** real file workflows and CAS/CoW results.

## Phase 3 — 3D block field
- Adaptive block coordinates.
- Instanced rendering.
- Legend, hover, selection, filters, search, camera controls.
- File-to-block relationship highlighting.
- 2D fallback.
- Performance testing.

**Deliverable:** interactive 3D map driven by backend telemetry.

## Phase 4 — Snapshots and CoW teaching mode
- Snapshot manager and restore confirmation.
- Current-vs-snapshot comparison.
- Animate actual block mapping changes.
- Show shared blocks and refcounts.
- Distinguish references from independent snapshot extents.

**Deliverable:** demonstrable deduplication, CoW, and snapshots.

## Phase 5 — Integrity Lab
- Connect bit-rot, scrub, heal, heal log, Merkle proof.
- Display expected/current hashes.
- Guided baseline → corruption → detection → recovery → verification.
- Handle IntegrityError/EIO.
- Test unrecoverable scenario only on disposable disk.
- Verify recovery source and post-heal status.

**Deliverable:** end-to-end verified self-healing demo.

## Phase 6 — Metrics and benchmarks
- Show real disk/dedup/snapshot/scrub/heal metrics.
- Add audit filters.
- Integrate benchmark output without fake baselines.
- Label illustrative values clearly.

**Deliverable:** evidence-focused evaluation dashboard.

## Phase 7 — Polish and release
- Refine transitions, empty states, responsiveness, help text.
- Check reduced motion, keyboard access, contrast, WebGL fallback.
- Run full backend/frontend tests and build.
- Update docs and capture screenshots only from the running app.

**Deliverable:** reliable project-ready AeroFS Studio.

---

# 15. Guided Viva / Demonstration Mode

Add an optional **Guided Demo** that performs real backend operations in a disposable demo workspace.

Suggested sequence:
1. Create a file — show inode and physical allocation.
2. Create an identical duplicate — show CAS sharing.
3. Edit one duplicate — show CoW mapping changes and prove the other is unchanged.
4. Create a snapshot — explain its preserved view.
5. Inject simulated bit rot — show the selected block become corrupted.
6. Run Merkle scrub — show actual detected block IDs and hash mismatch.
7. Self-heal — show the actual recovery source and hash verification.
8. Post-heal scrub — show actual final status.
9. Show unrecoverable scenario only in disposable workspace.
10. Summarize actual counts, bytes, and durations.

Each step must show:
- operation;
- OS concept demonstrated;
- expected observation;
- actual result;
- pass/fail based on assertions;
- relevant blocks and hashes.

Controls: Next, Back (explanation navigation, not necessarily rollback), Run Step, Reset Demo Workspace. Reset must only affect the explicitly selected disposable demo disk.

---

# 16. Suggested Visual Wireframe

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│ AeroFS Studio    [Virtual Disk: demo]    [Backend: Connected]        [Help] │
├────────────┬───────────────────────────────────────────────┬─────────────────┤
│ Overview   │ Disk Overview                                 │ Inspector       │
│ Files      │                                               │ Selected Block  │
│ 3D Map     │       INTERACTIVE 3D BLOCK FIELD              │ ID: 42          │
│ Snapshots  │                                               │ State: Shared   │
│ Integrity  │       [rotate / zoom / select]                │ Refcount: ...   │
│ Recovery   │                                               │ Expected SHA... │
│ Benchmarks │                                               │ Owners: ...     │
│ Settings   │                                               │ [Open Details]  │
├────────────┴───────────────────────────────────────────────┴─────────────────┤
│ Event Timeline: File created → blocks allocated → duplicate reused blocks   │
└──────────────────────────────────────────────────────────────────────────────┘
```

The final design can be more creative, but retain the information hierarchy and workflows.

---

# 17. README and Handoff Requirements

Update the repository's main README with:
- what AeroFS Studio is and is not;
- architecture diagram;
- setup requirements;
- backend/frontend start commands;
- API base URL configuration;
- test commands;
- guided demo instructions;
- explanations of CAS, CoW, snapshots, Merkle trees, bit rot, and self-healing;
- known limitations;
- screenshots/GIFs captured after the app actually runs;
- benchmark methodology and measured-vs-simulated distinction.

Do not add screenshots that imply a feature works when it is only a mockup. Do not report test counts without running tests against the current code.

---

# 18. Definition of Done

## Functionality
- [ ] Frontend starts using documented commands.
- [ ] Real telemetry and file list are shown.
- [ ] Create/read/edit/duplicate work end-to-end.
- [ ] Identical files show shared physical blocks when confirmed.
- [ ] Editing a shared file demonstrates actual CoW changes.
- [ ] Snapshot create/inspect/restore works.
- [ ] 3D block selection, filters, and inspector work.
- [ ] Bit-rot, scrub, heal, and audit workflows work.
- [ ] Unrecoverable reads show integrity failure, not success.
- [ ] Merkle proof UI explains trusted-root limitations.
- [ ] Backend/network errors are visible.
- [ ] Guided demo uses real operations and only resets its disposable workspace.

## Correctness
- [ ] Backend tests pass.
- [ ] Frontend tests pass.
- [ ] Critical browser workflows pass.
- [ ] File bytes verified after create/edit/restore/recovery.
- [ ] Dedup/refcounts remain correct.
- [ ] Recovery bytes match trusted expected hashes.
- [ ] Post-heal scrub is healthy for recoverable cases.
- [ ] Unrecoverable cases remain degraded and are never marked healed.
- [ ] Existing CLI/API behavior is preserved.

## Visual quality
- [ ] 3D scene works at configured disk size.
- [ ] 2D fallback exists.
- [ ] Status is not conveyed by color alone.
- [ ] Reduced-motion and keyboard basics work.
- [ ] Loading, empty, success, warning, and error states exist.
- [ ] Destructive actions require confirmation.

## Evidence
- [ ] Exact test commands/results are documented.
- [ ] Type-check/build/lint results are documented where configured.
- [ ] Changed files are listed.
- [ ] Limitations are explicit.
- [ ] Clean-checkout launch instructions work.
- [ ] Screenshots/demo steps reflect the running app.

---

# 19. Final Instructions to the Agent

Implement this as a real extension of the existing AeroFS project.

Work in this order:
1. Audit repository and report current architecture.
2. Run existing tests and record baseline.
3. Propose the smallest safe implementation plan.
4. Implement one phase at a time.
5. Test after every phase.
6. Preserve backend behavior and data safety.
7. Complete 3D visualization and core workflows.
8. Run full test suite and frontend build.
9. Deliver a final report with features implemented, files changed, exact commands, test counts/failures, measured performance, limitations, launch steps, and a short viva script.

Do not stop after a plan. Do not report success without running checks. If a feature is impossible because the backend lacks an API or capability, identify the gap, add the smallest safe support if appropriate, or clearly label it unavailable. **Never fake data.**

The result should be visually impressive, technically accurate, interactive, testable, and easy to explain in an Operating Systems project demonstration.
