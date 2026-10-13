"""
Automated Unit Tests for AeroFS Subsystems
Verifies Block Device, Content-Addressable Deduplication, Merkle Trees, and CoW Snapshots.
"""

import os
import sys

# Ensure aerofs module can be imported regardless of execution cwd
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

import pytest
from aerofs import AeroFileSystem, VirtualBlockDevice, DeduplicationEngine, MerkleTree

TEST_DISK_PATH = "test_aerofs_disk.bin"


@pytest.fixture(autouse=True)
def cleanup():
    """Ensures test disk binary is cleaned up before and after tests."""
    if os.path.exists(TEST_DISK_PATH):
        os.remove(TEST_DISK_PATH)
    yield
    if os.path.exists(TEST_DISK_PATH):
        os.remove(TEST_DISK_PATH)


def test_virtual_block_device():
    """Verifies low-level physical block read, write, and allocation bitmap."""
    dev = VirtualBlockDevice(TEST_DISK_PATH, total_blocks=512, block_size=4096)
    
    # Check initial stats (blocks 0..3 reserved for metadata)
    stats = dev.get_stats()
    assert stats["allocated_blocks"] == 4
    assert stats["free_blocks"] == 508

    # Allocate a block and write pattern
    b1 = dev.allocate_block()
    assert b1 == 4
    test_data = b"HELLO_OPERATING_SYSTEMS_BLOCK_DATA"
    dev.write_block(b1, test_data)

    read_back = dev.read_block(b1)
    assert read_back[:len(test_data)] == test_data

    # Free block
    dev.free_block(b1)
    assert not dev.is_block_allocated(b1)


def test_chunk_deduplication():
    """Verifies Content-Addressable Storage (CAS) zero-allocation duplicate handling."""
    fs = AeroFileSystem(TEST_DISK_PATH, total_blocks=512)

    # 1. Write an original file with 4 distinct chunks (16 KB = 4 blocks)
    chunk0 = b"CHUNK_0_DATA_" * 256
    chunk1 = b"CHUNK_1_DATA_" * 256
    chunk2 = b"CHUNK_2_DATA_" * 256
    chunk3 = b"CHUNK_3_DATA_" * 256
    payload_a = (chunk0[:4096] + chunk1[:4096] + chunk2[:4096] + chunk3[:4096])
    
    inode1, dedup1 = fs.write_file("doc1.bin", payload_a)
    assert dedup1 == 0  # 4 distinct chunks, 0 intra-file duplicates
    assert len(inode1.block_ids) == 4
    
    stats1 = fs.dedup.get_stats()
    assert stats1["physical_unique_blocks"] == 4

    # 2. Write an identical file under a different name (Inter-file deduplication)
    inode2, dedup2 = fs.write_file("doc2_copy.bin", payload_a)
    assert dedup2 == 4  # All 4 blocks deduplicated across files!
    assert inode2.block_ids == inode1.block_ids  # Share same physical blocks!

    stats2 = fs.dedup.get_stats()
    # Physical blocks on disk did not increase at all!
    assert stats2["physical_unique_blocks"] == 4
    assert stats2["logical_blocks_written"] == 8
    assert stats2["savings_percent"] == 50.0


def test_copy_on_write_and_snapshots():
    """Verifies instant O(1) snapshots and Copy-on-Write immutability."""
    fs = AeroFileSystem(TEST_DISK_PATH, total_blocks=512)

    # Write initial file
    fs.write_file("data.txt", b"ORIGINAL_VERSION_DATA_BEFORE_SNAPSHOT")
    
    # Create instant snapshot
    snap = fs.create_snapshot("v1.0")
    assert snap["file_count"] == 1

    # Overwrite file with new data (Triggers Copy-on-Write)
    fs.write_file("data.txt", b"MODIFIED_VERSION_AFTER_SNAPSHOT")

    # Current active file has new data
    assert fs.read_file("data.txt") == b"MODIFIED_VERSION_AFTER_SNAPSHOT"

    # Restore snapshot v1.0
    fs.restore_snapshot("v1.0")
    assert fs.read_file("data.txt") == b"ORIGINAL_VERSION_DATA_BEFORE_SNAPSHOT"


def test_merkle_tree_bit_rot_detection():
    """Verifies cryptographic Merkle tree detects silent physical storage bit flips."""
    fs = AeroFileSystem(TEST_DISK_PATH, total_blocks=512)

    # Write test file
    inode, _ = fs.write_file("critical_db.dat", b"DATABASE_SYSTEM_CATALOG_BLOCKS" * 200)
    
    # Initial audit should be clean
    audit_clean = fs.scrub_all()
    assert audit_clean["status"] == "HEALTHY"
    assert audit_clean["corrupted_blocks_total"] == 0

    # Inject bit-rot into one of the file's blocks
    target_block = inode.block_ids[0]
    fs.dev.inject_bit_rot(target_block)

    # Re-run Merkle audit: should immediately flag CORRUPTED
    audit_corrupted = fs.scrub_all()
    assert audit_corrupted["status"] == "DEGRADED"
    assert audit_corrupted["corrupted_blocks_total"] >= 1
    assert target_block in audit_corrupted["details"][0]["corrupted_blocks"]


def test_merkle_inspection_and_tree_structure():
    """Verifies Merkle tree depth, structural export, and ASCII rendering."""
    fs = AeroFileSystem(TEST_DISK_PATH, total_blocks=512)
    fs.write_file("doc_tree.txt", b"A" * 12000) # Spans 3 blocks
    inspection = fs.inspect_file("doc_tree.txt")

    assert inspection["is_healthy"] is True
    assert len(inspection["corrupted_blocks"]) == 0
    assert "tree" in inspection
    assert inspection["tree"]["depth"] >= 2
    assert "Root Hash" in inspection["ascii_tree"]
    assert len(inspection["preview"]) > 0


def test_block_telemetry_details():
    """Verifies detailed block inspector returns refcounts, hashes, and referencing files."""
    fs = AeroFileSystem(TEST_DISK_PATH, total_blocks=512)
    inode, _ = fs.write_file("shared.bin", b"SHARED_BLOCK_CONTENT_TEST" * 50)
    bid = inode.block_ids[0]

    details = fs.get_block_details(bid)
    assert details["block_id"] == bid
    assert details["is_allocated"] is True
    assert details["refcount"] == 1
    assert "shared.bin" in details["referencing_files"]
    assert details["hash_matches"] is True


def test_self_healing_bit_rot():
    """Verifies that AeroFS can automatically detect and self-heal corrupted blocks."""
    fs = AeroFileSystem(TEST_DISK_PATH, total_blocks=512)
    inode, _ = fs.write_file("healed_file.txt", b"SELF_HEALING_STORAGE_SYSTEM_DATA" * 100)
    bid = inode.block_ids[0]

    # Inject corruption
    fs.dev.inject_bit_rot(bid)
    assert fs.scrub_all()["status"] == "DEGRADED"

    # Execute self-heal
    heal_result = fs.self_heal_all()
    assert bid in heal_result["repaired_blocks"]
    assert heal_result["post_heal_status"] == "HEALTHY"
    assert heal_result["remaining_corrupted"] == 0

    # Ensure content reads back cleanly
    read_data = fs.read_file("healed_file.txt")
    assert read_data == b"SELF_HEALING_STORAGE_SYSTEM_DATA" * 100
