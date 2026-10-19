"""
AeroFS Interactive Web API & Telemetry Controller
Provides REST endpoints for filesystem operations, live block monitoring, and simulation.
"""

import os
import random
import time
from typing import Optional
from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.responses import HTMLResponse, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from .cow_fs import AeroFileSystem, IntegrityError

app = FastAPI(title="AeroFS Operating System Storage Subsystem", version="1.0.0")

# CORS for React dev server
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:3000", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Initialize global AeroFS instance (16 MB = 4096 blocks)
DISK_FILE = os.getenv("AEROFS_DISK_PATH", "aerofs_production_disk.bin")
fs = AeroFileSystem(disk_path=DISK_FILE, total_blocks=4096)

def reset_app_filesystem(disk_path: Optional[str] = None):
    """Reconfigures or resets the global fs object cleanly for tests."""
    global fs, DISK_FILE
    if disk_path:
        DISK_FILE = disk_path
    fs = AeroFileSystem(disk_path=DISK_FILE, total_blocks=4096)
    fs.format()

# Ensure baseline clean files exist on startup so dashboard is pre-populated
if not fs.files:
    if any(fs.dev.allocation_bitmap[fs.dev.data_start_block:]):
        fs.dev.format_disk()
    base_text = "Operating System Core Kernel Architecture & Filesystem Implementation.\n" * 120
    fs.write_file("kernel_core.c", base_text.encode("utf-8"))
    fs.write_file("kernel_core_backup.c", base_text.encode("utf-8"))
    fs.create_snapshot("baseline_snap_v1")


class SnapshotRequest(BaseModel):
    name: str


class RestoreRequest(BaseModel):
    name: str


class TextFileRequest(BaseModel):
    filename: str
    content: str


class BitrotRequest(BaseModel):
    block_id: Optional[int] = None


class DuplicateRequest(BaseModel):
    source_filename: str
    dest_filename: str


class BenchmarkRequest(BaseModel):
    workload: str = "standard"  # standard | large | dedup_heavy


@app.get("/api/health")
async def health_check():
    """Returns backend liveness and filesystem status."""
    return {
        "ok": True,
        "status": "connected",
        "disk_path": DISK_FILE,
        "total_blocks": fs.dev.total_blocks,
        "block_size": fs.dev.block_size,
        "version": "1.0.0"
    }


@app.get("/api/files")
async def list_files():
    """Returns list of all active files in AeroFS."""
    return {"files": fs.list_files(), "count": len(fs.files)}


@app.get("/api/snapshots")
async def list_snapshots():
    """Returns list of all snapshots."""
    return {"snapshots": fs.list_snapshots(), "count": len(fs.snapshots)}


@app.post("/api/files/{filename}/duplicate")
async def duplicate_file(filename: str, req: DuplicateRequest):
    """Duplicates a file to a new name (demonstrates CAS dedup sharing)."""
    if filename not in fs.files:
        raise HTTPException(status_code=404, detail=f"Source file '{filename}' not found.")
    try:
        source_data = fs.read_file(filename, verify_integrity=False)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    pre_blocks = set(range(fs.dev.total_blocks))
    inode, dedup_count = fs.write_file(req.dest_filename, source_data)
    return {
        "status": "success",
        "source": filename,
        "destination": req.dest_filename,
        "filename": req.dest_filename,
        "inode_id": inode.inode_id,
        "size": inode.size,
        "block_ids": inode.block_ids,
        "deduplicated_chunks": dedup_count,
        "merkle_root": inode.merkle_root,
        "message": f"Duplicated '{filename}' → '{req.dest_filename}'. {dedup_count} blocks reused via CAS."
    }


@app.post("/api/benchmark")
async def run_benchmark(req: BenchmarkRequest):
    """Runs a real benchmark workload and returns measured results."""
    results = []
    file_sizes = []

    if req.workload in ("standard", "large", "dedup_and_cow", "write_throughput", "snapshot_latency"):
        multiplier = 3 if req.workload == "large" else 1
        # Write benchmark
        t0 = time.time()
        payload = ("AeroFS Benchmark Block Content\n" * 150 * multiplier).encode()
        inode, dedup = fs.write_file("_bench_file_a.tmp", payload)
        write_ms = round((time.time() - t0) * 1000, 2)
        results.append({"operation": "write_file", "size_bytes": len(payload),
                        "duration_ms": write_ms, "blocks_used": len(inode.block_ids),
                        "dedup_hits": dedup})

        # Duplicate benchmark
        t0 = time.time()
        dup_inode, dup_dedup = fs.write_file("_bench_file_b.tmp", payload)
        dup_ms = round((time.time() - t0) * 1000, 2)
        results.append({"operation": "duplicate_identical", "size_bytes": len(payload),
                        "duration_ms": dup_ms, "blocks_used": len(dup_inode.block_ids),
                        "dedup_hits": dup_dedup})

        # Snapshot benchmark
        t0 = time.time()
        snap_name = f"_bench_snap_{int(time.time())}"
        fs.create_snapshot(snap_name)
        snap_ms = round((time.time() - t0) * 1000, 2)
        results.append({"operation": "create_snapshot", "duration_ms": snap_ms})

        # Scrub benchmark
        t0 = time.time()
        scrub = fs.scrub_all()
        scrub_ms = round((time.time() - t0) * 1000, 2)
        results.append({"operation": "merkle_scrub", "duration_ms": scrub_ms,
                        "files_audited": scrub.get("total_files", 0)})

        # Cleanup
        fs.delete_file("_bench_file_a.tmp")
        fs.delete_file("_bench_file_b.tmp")
        fs.delete_snapshot(snap_name)

    elif req.workload == "dedup_heavy":
        payload = ("DEDUP_TEST_BLOCK " * 256).encode()
        t0 = time.time()
        total_dedup = 0
        for i in range(10):
            _, d = fs.write_file(f"_dedup_bench_{i}.tmp", payload)
            total_dedup += d
        elapsed_ms = round((time.time() - t0) * 1000, 2)
        results.append({"operation": "dedup_heavy_10files", "duration_ms": elapsed_ms,
                        "total_dedup_hits": total_dedup})
        for i in range(10):
            fs.delete_file(f"_dedup_bench_{i}.tmp")

    return {"status": "success", "workload": req.workload, "results": results,
            "note": "All values are measured from the live AeroFS backend."}


@app.get("/", response_class=HTMLResponse)
async def serve_dashboard():
    """Serves the AeroFS interactive visualization dashboard."""
    html_path = os.path.join(os.path.dirname(__file__), "templates", "dashboard.html")
    if os.path.exists(html_path):
        with open(html_path, "r", encoding="utf-8") as f:
            return HTMLResponse(content=f.read())
    return HTMLResponse(content="<h2>AeroFS Dashboard Template Not Found</h2>")


@app.get("/api/telemetry")
async def get_telemetry():
    """Returns real-time disk block map, deduplication metrics, and inode lists."""
    return fs.get_system_telemetry()


@app.post("/api/files/create_text")
async def create_text_file(req: TextFileRequest):
    """Creates or updates a text file in AeroFS using CoW and CAS Deduplication."""
    if not req.filename or not req.content:
        raise HTTPException(status_code=400, detail="Filename and content cannot be empty.")
    
    inode, dedup_count = fs.write_file(req.filename, req.content.encode("utf-8"))
    return {
        "status": "success",
        "filename": req.filename,
        "inode_id": inode.inode_id,
        "size": inode.size,
        "blocks_used": len(inode.block_ids),
        "block_ids": inode.block_ids,
        "deduplicated_chunks": dedup_count,
        "merkle_root": inode.merkle_root
    }


@app.post("/api/files/upload")
async def upload_binary_file(file: UploadFile = File(...)):
    """Uploads any arbitrary binary/document file into AeroFS."""
    content = await file.read()
    inode, dedup_count = fs.write_file(file.filename, content)
    return {
        "status": "success",
        "filename": file.filename,
        "inode_id": inode.inode_id,
        "size": inode.size,
        "blocks_used": len(inode.block_ids),
        "block_ids": inode.block_ids,
        "deduplicated_chunks": dedup_count,
        "merkle_root": inode.merkle_root
    }


@app.get("/api/files/read/{filename}")
async def read_file_content(filename: str):
    """Reads and returns the content of a file from AeroFS."""
    try:
        data = fs.read_file(filename)
        # Try returning as text if valid utf-8, else octet-stream
        try:
            text = data.decode("utf-8")
            return {"filename": filename, "type": "text", "content": text}
        except UnicodeDecodeError:
            return Response(content=data, media_type="application/octet-stream")
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail=f"File '{filename}' not found.")
    except (IOError, IntegrityError) as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.delete("/api/files/{filename}")
async def delete_file(filename: str):
    """Deletes a file and releases physical blocks if unreferenced."""
    success = fs.delete_file(filename)
    if not success:
        raise HTTPException(status_code=404, detail=f"File '{filename}' not found.")
    return {"status": "success", "message": f"File '{filename}' deleted."}


@app.post("/api/snapshots/create")
async def create_snapshot(req: SnapshotRequest):
    """Creates an instant zero-copy point-in-time snapshot."""
    try:
        snap = fs.create_snapshot(req.name)
        return {"status": "success", "snapshot": snap}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/api/snapshots/restore")
async def restore_snapshot(req: RestoreRequest):
    """Restores the filesystem state to an earlier snapshot."""
    try:
        fs.restore_snapshot(req.name)
        return {"status": "success", "message": f"Filesystem restored to snapshot '{req.name}'."}
    except KeyError as e:
        raise HTTPException(status_code=404, detail=str(e))


@app.delete("/api/snapshots/{name}")
async def delete_snapshot(name: str):
    """Deletes a snapshot and reclaims any unreferenced blocks."""
    success = fs.delete_snapshot(name)
    if not success:
        raise HTTPException(status_code=404, detail=f"Snapshot '{name}' not found.")
    return {"status": "success", "message": f"Snapshot '{name}' deleted."}


@app.get("/api/files/inspect/{filename}")
async def inspect_file_merkle(filename: str):
    """Provides full Merkle tree proof, block layout, and preview for an inode."""
    try:
        return fs.inspect_file(filename)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail=f"File '{filename}' not found.")


@app.get("/api/blocks/{block_id}")
async def inspect_block(block_id: int):
    """Returns deep block telemetry including refcount, checksum, and file owners."""
    try:
        return fs.get_block_details(block_id)
    except IndexError as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/api/merkle/scrub")
async def run_merkle_scrub():
    """Runs a full Merkle-tree cryptographic audit across all files."""
    report = fs.scrub_all()
    return report


@app.post("/api/merkle/heal")
async def self_heal_filesystem():
    """Runs the self-healing engine to detect and repair corrupted blocks.
    Returns per-block heal records including recovery source (cache vs snapshot)."""
    report = fs.self_heal_all()
    return report


@app.get("/api/merkle/heal_log")
async def get_heal_log():
    """Returns the full chronological audit trail of all self-heal events since startup."""
    return {"heal_events": fs.get_heal_log(), "total_events": len(fs.scrubber.heal_log)}


@app.get("/api/merkle/proof/{filename}/{block_index}")
async def get_merkle_proof(filename: str, block_index: int):
    """Generates a cryptographic Merkle inclusion proof for a specific block in a file."""
    try:
        proof = fs.get_merkle_proof(filename, block_index)
        return proof
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail=f"File '{filename}' not found.")
    except IndexError as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/api/simulate/bitrot")
async def simulate_bit_rot(req: Optional[BitrotRequest] = None):
    """Injects simulated physical bit-rot into an active file's allocated block."""
    if not fs.files:
        sample_payload = ("AeroFS Kernel Protected Storage Block\n" * 120).encode("utf-8")
        fs.write_file("kernel_core.c", sample_payload)

    target_block = None
    if req and req.block_id is not None:
        target_block = req.block_id
        if not (0 <= target_block < fs.dev.total_blocks):
            raise HTTPException(status_code=400, detail=f"Block #{target_block} out of bounds (0..{fs.dev.total_blocks - 1}).")
    else:
        # Prioritize blocks belonging to active registered files
        candidate_blocks = [
            b for f in fs.files.values() for b in f.block_ids
            if b not in fs.dev.corrupted_blocks
        ]
        if not candidate_blocks:
            candidate_blocks = [
                b for b in range(fs.dev.data_start_block, fs.dev.total_blocks)
                if fs.dev.is_block_allocated(b) and b not in fs.dev.corrupted_blocks
            ]
        if not candidate_blocks:
            sample_payload = ("Additional High-Priority Kernel Data Block\n" * 120).encode("utf-8")
            inode, _ = fs.write_file(f"extra_file_{len(fs.files)}.txt", sample_payload)
            candidate_blocks = [b for b in inode.block_ids if b not in fs.dev.corrupted_blocks]

        target_block = random.choice(candidate_blocks)

    fs.dev.inject_bit_rot(target_block)

    owning_files = [f.name for f in fs.files.values() if target_block in f.block_ids]
    owner_str = f" in file '{owning_files[0]}'" if owning_files else ""
    return {
        "status": "success",
        "corrupted_block": target_block,
        "owning_files": owning_files,
        "message": f"Simulated bit-rot injected into physical block #{target_block}{owner_str}."
    }


@app.post("/api/format")
async def format_filesystem():
    """Formats the virtual disk and resets all filesystem state."""
    fs.format()
    return {"status": "success", "message": "Filesystem formatted cleanly."}


@app.post("/api/test/reset")
async def test_reset_filesystem():
    """Test-only endpoint to wipe and cleanly reset filesystem state between tests."""
    fs.format()
    return {"status": "success", "message": "Test reset complete."}


@app.post("/api/simulate/workload")
async def simulate_demo_workload():
    """Generates a realistic OS workload with duplicates, CoW mutations, and snapshots."""
    # 1. Base document
    base_text = "Operating System Core Kernel Architecture & Filesystem Implementation.\n" * 150
    fs.write_file("kernel_core.c", base_text.encode("utf-8"))

    # 2. Duplicate document (demonstrating 100% inter-file deduplication)
    fs.write_file("kernel_core_backup.c", base_text.encode("utf-8"))

    # 3. Create instant snapshot
    snap_name = f"snapshot_v1_{random.randint(100, 999)}"
    fs.create_snapshot(snap_name)

    # 4. Slightly modified version (Copy-on-Write: shares old blocks, only new diff is allocated)
    mutated_text = base_text + ("\n// Added patch for high-priority scheduler fix\n" * 10)
    fs.write_file("kernel_core.c", mutated_text.encode("utf-8"))

    # 5. Additional distinct file
    config_text = "CONFIG_DEDUP=y\nCONFIG_COW=y\nCONFIG_MERKLE_TREE=y\n" * 80
    fs.write_file("os_config.sys", config_text.encode("utf-8"))

    return {
        "status": "success",
        "message": "Demo workload generated: created files, deduplicated clones, snapshot, and CoW modifications.",
        "telemetry": fs.get_system_telemetry()
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("aerofs.app:app", host="0.0.0.0", port=8000, reload=True)
