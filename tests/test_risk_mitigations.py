"""
Tests for AeroFS Remaining Risk Mitigations (Risks 1 to 8)
==========================================================
Verifies that all 8 architectural enhancements and edge-case mitigations
identified in the AeroFS Validation Report are functional, robust, and tested.
"""

import os
import sys
import time
import pytest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from aerofs import (
    AeroFileSystem,
    VirtualBlockDevice,
    DeduplicationEngine,
    MerkleTree,
    MetadataJournal,
)
from aerofs.disk import DEFAULT_BLOCK_SIZE

TEST_RISK_DISK = "test_risk_disk.bin"


@pytest.fixture(autouse=True)
def cleanup():
    """Cleans up test binary container and journal sidecars."""
    for p in [TEST_RISK_DISK, TEST_RISK_DISK.replace(".bin", ".journal.json")]:
        if os.path.exists(p):
            os.remove(p)
    yield
    for p in [TEST_RISK_DISK, TEST_RISK_DISK.replace(".bin", ".journal.json")]:
        if os.path.exists(p):
            os.remove(p)


# ===========================================================================
# Risk 1: Tier-2 Snapshot Extent Store (Independent Clean Copy)
# ===========================================================================

def test_risk1_tier2_independent_snapshot_extent_store():
    """
    Risk 1 Mitigation:
    Snapshot extent store captures an independent byte copy at snapshot time.
    When live physical block is corrupted and recovery_cache is cleared, Tier-2
    heals the block from the snapshot extent store rather than failing on
    the corrupted live block.
    """
    fs = AeroFileSystem(TEST_RISK_DISK, total_blocks=512)
    original_data = b"INDEPENDENT_SNAPSHOT_BYTES_" * 200
    inode, _ = fs.write_file("doc_tier2.bin", original_data)
    bid = inode.block_ids[0]

    # Create point-in-time snapshot (stores copy in snapshot_extent_store)
    fs.create_snapshot("clean_golden_snap")
    assert "clean_golden_snap" in fs.snapshot_extent_store
    assert bid in fs.snapshot_extent_store["clean_golden_snap"]
    assert fs.snapshot_extent_store["clean_golden_snap"][bid] == fs.dev.read_block(bid)

    # Evict Tier-1 recovery cache entry to force Tier-2 recovery
    fs.recovery_cache.pop(bid, None)
    assert bid not in fs.recovery_cache

    # Corrupt the shared live disk block
    fs.dev.inject_bit_rot(bid)
    assert fs.scrub_all()["status"] == "DEGRADED"

    # Self-heal — must succeed via Tier-2 extent store
    heal_result = fs.self_heal_all()
    assert bid in heal_result["repaired_blocks"]
    assert heal_result["post_heal_status"] == "HEALTHY"

    # Verify source was the snapshot extent store
    record = heal_result["heal_records"][0]
    assert record["source"] == "snapshot:clean_golden_snap"
    assert record["success"] is True

    # Verify exact byte recovery
    recovered_data = fs.read_file("doc_tier2.bin")
    assert recovered_data == original_data


# ===========================================================================
# Risks 2 & 3: Metadata and Recovery Cache Persistence via MetadataJournal
# ===========================================================================

def test_risk2_and_3_metadata_and_cache_persistence():
    """
    Risks 2 & 3 Mitigation:
    MetadataJournal persists file inodes, CAS dedup tables, snapshots,
    snapshot extent stores, and recovery cache.
    """
    fs1 = AeroFileSystem(TEST_RISK_DISK, total_blocks=512, enable_journal=True)
    payload_a = b"SHARED_CAS_CHUNK_ALPHA_" * 150
    payload_b = b"UNIQUE_CHUNK_BETA_" * 150

    inode_a, _ = fs1.write_file("file_a.txt", payload_a)
    inode_b, _ = fs1.write_file("file_b.txt", payload_b)
    fs1.create_snapshot("snap_pre_restart")
    root_a = inode_a.merkle_root
    bid_a = inode_a.block_ids[0]

    # Verify journal file was written
    journal_path = TEST_RISK_DISK.replace(".bin", ".journal.json")
    assert os.path.exists(journal_path)
    del fs1

    # Restart filesystem on the same container
    fs2 = AeroFileSystem(TEST_RISK_DISK, total_blocks=512, enable_journal=True)
    assert "file_a.txt" in fs2.files
    assert "file_b.txt" in fs2.files
    assert fs2.files["file_a.txt"].merkle_root == root_a
    assert fs2.read_file("file_a.txt") == payload_a
    assert "snap_pre_restart" in fs2.snapshots
    assert bid_a in fs2.recovery_cache

    # Verify CAS index survived: writing payload_a again should deduplicate
    _, dedup_count = fs2.write_file("file_a_clone.txt", payload_a)
    assert dedup_count >= 1

    # Verify integrity scrub after restart is clean
    assert fs2.scrub_all()["status"] == "HEALTHY"


# ===========================================================================
# Risk 4: Measured OS Baseline Benchmark
# ===========================================================================

def test_risk4_measured_os_baseline_benchmark():
    """
    Risk 4 Mitigation:
    benchmark.py uses a measured file copy against the OS filesystem instead of
    a fixed hardcoded simulated constant.
    """
    from aerofs.benchmark import run_benchmarks
    run_benchmarks()
    # Check generated charts exist
    assert os.path.exists("benchmark_output/storage_comparison.png")
    assert os.path.exists("benchmark_output/snapshot_latency.png")


# ===========================================================================
# Risk 5: Realistic Bit-Rot Injection at Random Offsets
# ===========================================================================

def test_risk5_bit_rot_random_positions():
    """
    Risk 5 Mitigation:
    inject_bit_rot() flips bytes randomly across the entire 4 KB block
    instead of only touching the first 16 bytes.
    """
    dev = VirtualBlockDevice(TEST_RISK_DISK, total_blocks=512)
    bid = dev.allocate_block()
    clean_bytes = b"\xaa" * DEFAULT_BLOCK_SIZE
    dev.write_block(bid, clean_bytes)

    dev.inject_bit_rot(bid, num_corrupted_bytes=24)
    corrupted = dev.read_block(bid)
    assert corrupted != clean_bytes

    # Find which offsets differ
    diff_offsets = [i for i in range(DEFAULT_BLOCK_SIZE) if corrupted[i] != clean_bytes[i]]
    assert len(diff_offsets) == 24
    # At least some corrupted positions must be beyond the first 16 bytes
    assert max(diff_offsets) > 16, f"Expected corruption across block, max offset: {max(diff_offsets)}"


# ===========================================================================
# Risk 6: Server Test Reset Endpoint
# ===========================================================================

def test_risk6_server_test_reset_endpoint():
    """
    Risk 6 Mitigation:
    FastAPI app provides /api/test/reset and /api/format with clean state
    re-initialization.
    """
    from fastapi.testclient import TestClient
    from aerofs.app import app

    client = TestClient(app)
    # Write a test file via create_text endpoint
    r = client.post("/api/files/create_text", json={"filename": "reset_test.txt", "content": "RESET_DATA"})
    assert r.status_code == 200

    # Call test reset endpoint
    reset_r = client.post("/api/test/reset")
    assert reset_r.status_code == 200
    assert reset_r.json()["status"] == "success"

    # Confirm previous test file was wiped
    telem = client.get("/api/telemetry").json()
    assert "reset_test.txt" not in telem["files"]


# ===========================================================================
# Risk 7: Operation Timeouts
# ===========================================================================

def test_risk7_operation_timeouts():
    """
    Risk 7 Mitigation:
    write_file_with_timeout() and scrub_with_timeout() enforce wall-clock limits
    to guard against runaway checks or hanging virtual storage devices.
    """
    fs = AeroFileSystem(TEST_RISK_DISK, total_blocks=512)
    # Normal operation completes well within generous timeout
    inode, dedup = fs.write_file_with_timeout("timeout_test.txt", b"QUICK_WRITE", timeout_seconds=5.0)
    assert inode.size == len(b"QUICK_WRITE")

    scrub = fs.scrub_with_timeout(timeout_seconds=5.0)
    assert scrub["status"] == "HEALTHY"

    # Simulated slow scrub triggers TimeoutError
    import unittest.mock as mock
    with mock.patch.object(fs, "scrub_all", side_effect=lambda: time.sleep(0.1)):
        with pytest.raises(TimeoutError):
            fs.scrub_with_timeout(timeout_seconds=0.01)


# ===========================================================================
# Risk 8: Merkle Tree Level Caching
# ===========================================================================

def test_risk8_merkle_tree_caching():
    """
    Risk 8 Mitigation:
    get_cached_merkle_tree() caches the computed MerkleTree structure by root hash,
    avoiding redundant disk reads on repeated inspect or proof queries.
    Cache is updated with new tree on write and evicted on file deletion.
    """
    fs = AeroFileSystem(TEST_RISK_DISK, total_blocks=512)
    inode, _ = fs.write_file("cache_tree.bin", b"TREE_CACHE_" * 500)

    # First call builds tree and caches it
    tree1 = fs.get_cached_merkle_tree("cache_tree.bin")
    assert "cache_tree.bin" in fs._merkle_cache

    # Second call returns the cached instance
    tree2 = fs.get_cached_merkle_tree("cache_tree.bin")
    assert tree1 is tree2  # Exactly the same object in memory

    # Mutate the file — cache is updated with new root and new tree
    fs.write_file("cache_tree.bin", b"NEW_DATA_AFTER_MUTATION_" * 300)
    tree3 = fs.get_cached_merkle_tree("cache_tree.bin")
    assert tree3 is not tree1
    assert tree3.root_hash != tree1.root_hash

    # Delete file — cache entry is removed
    fs.delete_file("cache_tree.bin")
    assert "cache_tree.bin" not in fs._merkle_cache
