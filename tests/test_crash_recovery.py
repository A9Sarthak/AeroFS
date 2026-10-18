"""
Comprehensive Crash Resilience & Metadata Recovery Test Suite for AeroFS
========================================================================
Validates filesystem durability under simulated crashes, power failures,
torn writes, and unhandled process terminations.
"""

import os
import sys
import json
import pytest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from aerofs import (
    AeroFileSystem,
    VirtualBlockDevice,
    DeduplicationEngine,
    MetadataJournal,
)

CRASH_DISK = "test_crash_disk.bin"
CRASH_JOURNAL = "test_crash_disk.journal.json"
CRASH_TMP = "test_crash_disk.journal.json.tmp"


@pytest.fixture(autouse=True)
def cleanup():
    """Ensures test crash disk and journal files are cleaned before and after tests."""
    for p in [CRASH_DISK, CRASH_JOURNAL, CRASH_TMP]:
        if os.path.exists(p):
            os.remove(p)
    yield
    for p in [CRASH_DISK, CRASH_JOURNAL, CRASH_TMP]:
        if os.path.exists(p):
            os.remove(p)


def test_crash_clean_restart_recovery():
    """
    Scenario 1: Normal crash / sudden process exit between operations.
    Verifies that all committed state (inodes, CAS dedup tables, snapshots,
    block mappings, and Merkle roots) survives process termination and is
    faithfully reconstructed on mount.
    """
    fs1 = AeroFileSystem(CRASH_DISK, total_blocks=512, enable_journal=True)
    chunk1 = b"CRASH_TEST_CHUNK_AAA_" * 180
    chunk2 = b"CRASH_TEST_CHUNK_BBB_" * 180

    inode1, _ = fs1.write_file("service.conf", chunk1)
    inode2, dedup_cnt = fs1.write_file("service_backup.conf", chunk1)  # 100% dedup
    assert dedup_cnt >= 1

    inode3, _ = fs1.write_file("database.db", chunk2)
    fs1.create_snapshot("snap_stable_v1")

    root1 = inode1.merkle_root
    root3 = inode3.merkle_root

    # Simulate abrupt process crash by deleting the in-memory object without graceful unmount
    del fs1

    # New process mounts the same virtual disk container
    fs2 = AeroFileSystem(CRASH_DISK, total_blocks=512, enable_journal=True)

    # 1. Verify files exist and read back exact bytes
    assert "service.conf" in fs2.files
    assert "service_backup.conf" in fs2.files
    assert "database.db" in fs2.files
    assert fs2.read_file("service.conf") == chunk1
    assert fs2.read_file("service_backup.conf") == chunk1
    assert fs2.read_file("database.db") == chunk2

    # 2. Verify Merkle roots match pre-crash values
    assert fs2.files["service.conf"].merkle_root == root1
    assert fs2.files["database.db"].merkle_root == root3

    # 3. Verify deduplication index survived crash
    _, dedup_new = fs2.write_file("service_third.conf", chunk1)
    assert dedup_new >= 1

    # 4. Verify snapshot survived crash
    assert "snap_stable_v1" in fs2.snapshots
    assert len(fs2.snapshots["snap_stable_v1"].inodes) == 3

    # 5. Full Merkle scrub confirms 100% integrity
    assert fs2.scrub_all()["status"] == "HEALTHY"


def test_crash_mid_journal_write_atomic_rename():
    """
    Scenario 2: Crash occurs MID-WRITE while saving metadata.
    MetadataJournal writes to a temporary file (.tmp) first and uses atomic
    POSIX os.replace() to commit. If a crash leaves a half-written or corrupted
    .tmp file, the primary journal remains intact and uncorrupted.
    """
    fs1 = AeroFileSystem(CRASH_DISK, total_blocks=512, enable_journal=True)
    payload = b"ATOMIC_RENAME_SHIELD_" * 200
    fs1.write_file("critical_payload.dat", payload)
    del fs1

    assert os.path.exists(CRASH_JOURNAL)

    # Simulate crash mid-write: write incomplete/torn garbage to the .tmp sidecar
    with open(CRASH_TMP, "w") as f:
        f.write('{"version": 2, "broken_json": [partial_unclosed_data')

    # Reboot filesystem: must ignore or overwrite the abandoned .tmp file and load valid journal
    fs2 = AeroFileSystem(CRASH_DISK, total_blocks=512, enable_journal=True)
    assert "critical_payload.dat" in fs2.files
    assert fs2.read_file("critical_payload.dat") == payload
    assert fs2.scrub_all()["status"] == "HEALTHY"


def test_crash_corrupted_journal_graceful_fallback():
    """
    Scenario 3: Physical media sector corruption damages the journal itself.
    If the journal JSON file is corrupted or unreadable, AeroFS must not crash
    with an unhandled exception. It should log a warning and fall back safely.
    """
    fs1 = AeroFileSystem(CRASH_DISK, total_blocks=512, enable_journal=True)
    fs1.write_file("sample.txt", b"SAMPLE_DATA")
    del fs1

    # Corrupt the journal file with unparseable binary noise
    with open(CRASH_JOURNAL, "wb") as f:
        f.write(b"\xff\xfe\x00\x00_BAD_METADATA_HEADER_CORRUPTED_")

    # Mounting should handle the corrupted journal gracefully
    fs2 = AeroFileSystem(CRASH_DISK, total_blocks=512, enable_journal=True)
    # Starts clean without throwing unhandled JSONDecodeError
    assert isinstance(fs2.files, dict)
    # Device is still fully operable for new writes
    fs2.write_file("new_after_corrupted_journal.txt", b"FRESH_DATA")
    assert fs2.read_file("new_after_corrupted_journal.txt") == b"FRESH_DATA"


def test_crash_recovery_cache_tier1_heals_after_restart():
    """
    Scenario 4: Recovery cache persistence across crashes.
    A block written in process 1 is corrupted AFTER process 2 mounts the disk.
    Process 2 must be able to restore the block using the persisted Tier-1
    recovery cache saved by Process 1.
    """
    fs1 = AeroFileSystem(CRASH_DISK, total_blocks=512, enable_journal=True)
    original_data = b"RECOVERY_CACHE_CROSS_CRASH_" * 190
    inode, _ = fs1.write_file("cache_durability.bin", original_data)
    bid = inode.block_ids[0]
    del fs1  # Abrupt exit

    # Process 2 boots after restart
    fs2 = AeroFileSystem(CRASH_DISK, total_blocks=512, enable_journal=True)
    assert bid in fs2.recovery_cache, "Recovery cache was not restored from journal"

    # Inject bit-rot into the disk block
    fs2.dev.inject_bit_rot(bid)
    assert fs2.scrub_all()["status"] == "DEGRADED"

    # Self-healing must repair the block from the persisted recovery cache
    heal_res = fs2.self_heal_all()
    assert bid in heal_res["repaired_blocks"]
    assert heal_res["post_heal_status"] == "HEALTHY"
    assert heal_res["heal_records"][0]["source"] == "recovery_cache"
    assert fs2.read_file("cache_durability.bin") == original_data


def test_crash_extent_store_tier2_heals_after_restart():
    """
    Scenario 5: Snapshot extent store persistence across crashes.
    A snapshot taken in process 1 is persisted. After process 2 mounts,
    the live block is corrupted and recovery cache is evicted.
    Process 2 must successfully heal from the historical snapshot extent store.
    """
    fs1 = AeroFileSystem(CRASH_DISK, total_blocks=512, enable_journal=True)
    original_data = b"EXTENT_STORE_CROSS_CRASH_" * 190
    inode, _ = fs1.write_file("extent_durability.bin", original_data)
    bid = inode.block_ids[0]
    fs1.create_snapshot("pre_crash_snap")
    del fs1  # Abrupt exit

    # Process 2 mounts
    fs2 = AeroFileSystem(CRASH_DISK, total_blocks=512, enable_journal=True)
    assert "pre_crash_snap" in fs2.snapshot_extent_store
    assert bid in fs2.snapshot_extent_store["pre_crash_snap"]

    # Evict recovery cache to guarantee Tier-2 path
    fs2.recovery_cache.pop(bid, None)

    # Corrupt live block
    fs2.dev.inject_bit_rot(bid)
    assert fs2.scrub_all()["status"] == "DEGRADED"

    # Self-heal via Tier-2 extent store
    heal_res = fs2.self_heal_all()
    assert bid in heal_res["repaired_blocks"]
    assert heal_res["post_heal_status"] == "HEALTHY"
    assert heal_res["heal_records"][0]["source"] == "snapshot:pre_crash_snap"
    assert fs2.read_file("extent_durability.bin") == original_data


def test_crash_copy_on_write_atomicity_preserves_old_version():
    """
    Scenario 6: Copy-on-Write write atomicity.
    When a file is modified, CoW allocates new blocks. The old block is never
    overwritten in-place. If a crash occurs before the file's inode pointer
    is updated, the historical snapshot still points to the uncorrupted old block.
    """
    fs = AeroFileSystem(CRASH_DISK, total_blocks=512, enable_journal=True)
    v1_data = b"VERSION_1_IMMUTABLE_BLOCK_" * 160
    fs.write_file("doc.txt", v1_data)
    fs.create_snapshot("snap_v1")

    v1_bid = fs.files["doc.txt"].block_ids[0]

    # Write Version 2 (allocates new CoW block)
    v2_data = b"VERSION_2_MODIFIED_BLOCK__" * 160
    fs.write_file("doc.txt", v2_data)
    v2_bid = fs.files["doc.txt"].block_ids[0]
    assert v1_bid != v2_bid, "CoW must allocate a distinct block for modification"

    # Even if v2_bid is corrupted on disk, snap_v1 still reads v1_data cleanly
    fs.dev.inject_bit_rot(v2_bid)

    # Restore snapshot v1
    fs.restore_snapshot("snap_v1")
    assert fs.read_file("doc.txt") == v1_data
