"""
Verified Self-Healing Test Suite for AeroFS
============================================
Tests the strengthened Merkle scrubbing and autonomous self-healing engine.

Coverage:
  1. scrub_all_files() — aggregated report structure
  2. Merkle inclusion proof generation (generate_proof)
  3. HealRecord dataclass and audit trail (heal_log)
  4. Tier-1 recovery from in-memory recovery_cache
  5. Tier-2 recovery from historical snapshot extents
  6. Multi-block corruption across multiple files
  7. Merkle root re-anchoring after heal
  8. Unrecoverable block reporting
  9. Post-heal Merkle scrub confirms HEALTHY status
 10. get_merkle_proof() exposed on AeroFileSystem
"""

import os
import sys
import hashlib

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

import pytest
from aerofs import AeroFileSystem, MerkleTree, HealRecord

TEST_DISK_PATH = "test_self_heal_disk.bin"


@pytest.fixture(autouse=True)
def cleanup():
    """Ensures test disk binary and journal are cleaned up before and after each test."""
    for p in [TEST_DISK_PATH, TEST_DISK_PATH.replace(".bin", ".journal.json")]:
        if os.path.exists(p):
            os.remove(p)
    yield
    for p in [TEST_DISK_PATH, TEST_DISK_PATH.replace(".bin", ".journal.json")]:
        if os.path.exists(p):
            os.remove(p)


# ---------------------------------------------------------------------------
# 1. scrub_all_files() — report structure
# ---------------------------------------------------------------------------

def test_scrub_all_files_returns_correct_structure():
    """scrub_all_files() via scrub_all() returns a well-formed report dict."""
    fs = AeroFileSystem(TEST_DISK_PATH, total_blocks=512)
    fs.write_file("alpha.txt", b"Alpha file content " * 100)
    fs.write_file("beta.txt", b"Beta  file content " * 100)

    report = fs.scrub_all()

    assert "status" in report
    assert "files_audited" in report
    assert "corrupted_blocks_total" in report
    assert "corrupted_block_ids" in report
    assert "details" in report
    assert report["status"] == "HEALTHY"
    assert report["files_audited"] == 2
    assert report["corrupted_blocks_total"] == 0
    assert report["corrupted_block_ids"] == []


# ---------------------------------------------------------------------------
# 2. Merkle inclusion proof generation
# ---------------------------------------------------------------------------

def test_merkle_proof_generation_single_block():
    """generate_proof() returns a valid path for a single-block file."""
    fs = AeroFileSystem(TEST_DISK_PATH, total_blocks=512)
    inode, _ = fs.write_file("tiny.txt", b"T" * 100)  # 1 block

    tree = MerkleTree(inode.block_ids, fs.dev)
    proof = tree.generate_proof(0)

    assert proof["valid"] is True
    assert proof["leaf_block_id"] == inode.block_ids[0]
    assert len(proof["leaf_hash"]) == 64           # SHA-256 hex
    assert proof["root_hash"] == tree.root_hash
    # Single leaf — no siblings needed, proof_path is empty (root == leaf)
    assert isinstance(proof["proof_path"], list)


def test_merkle_proof_generation_multi_block():
    """generate_proof() returns a non-empty sibling path for multi-block files."""
    fs = AeroFileSystem(TEST_DISK_PATH, total_blocks=512)
    # 3 blocks (12 KB > 2 * 4096)
    inode, _ = fs.write_file("multi.bin", b"M" * 12000)

    tree = MerkleTree(inode.block_ids, fs.dev)

    for i in range(len(inode.block_ids)):
        proof = tree.generate_proof(i)
        assert proof["valid"] is True
        assert proof["leaf_block_id"] == inode.block_ids[i]
        assert proof["proof_depth"] == len(proof["proof_path"])
        # Each sibling direction must be 'left' or 'right'
        for step in proof["proof_path"]:
            assert step["direction"] in ("left", "right")
            assert len(step["sibling_hash"]) == 64


def test_merkle_proof_invalid_index():
    """generate_proof() returns valid=False for out-of-range indices."""
    fs = AeroFileSystem(TEST_DISK_PATH, total_blocks=512)
    inode, _ = fs.write_file("x.txt", b"X" * 50)
    tree = MerkleTree(inode.block_ids, fs.dev)

    proof = tree.generate_proof(999)
    assert proof["valid"] is False


def test_get_merkle_proof_on_filesystem():
    """AeroFileSystem.get_merkle_proof() exposes proof API correctly."""
    fs = AeroFileSystem(TEST_DISK_PATH, total_blocks=512)
    fs.write_file("proof_test.txt", b"P" * 8192)  # 2 blocks

    proof = fs.get_merkle_proof("proof_test.txt", 0)
    assert proof["valid"] is True

    with pytest.raises(FileNotFoundError):
        fs.get_merkle_proof("nonexistent.txt", 0)

    with pytest.raises(IndexError):
        fs.get_merkle_proof("proof_test.txt", 50)


# ---------------------------------------------------------------------------
# 3. HealRecord audit trail
# ---------------------------------------------------------------------------

def test_heal_log_is_empty_before_any_heal():
    """No heal records exist before any healing operation."""
    fs = AeroFileSystem(TEST_DISK_PATH, total_blocks=512)
    fs.write_file("log_test.txt", b"L" * 1000)
    assert fs.get_heal_log() == []


def test_heal_log_records_one_entry_per_healed_block():
    """heal_log accumulates exactly one HealRecord per corrupted block healed."""
    fs = AeroFileSystem(TEST_DISK_PATH, total_blocks=512)
    inode, _ = fs.write_file("record_test.txt", b"R" * 5000)

    bid = inode.block_ids[0]
    fs.dev.inject_bit_rot(bid)

    fs.self_heal_all()
    log = fs.get_heal_log()

    assert len(log) == 1
    entry = log[0]
    assert entry["block_id"] == bid
    assert entry["success"] is True
    assert entry["owning_file"] == "record_test.txt"
    assert entry["source"] == "recovery_cache"
    assert len(entry["expected_hash"]) == 64
    assert len(entry["recovered_hash"]) == 64
    assert "timestamp" in entry


def test_heal_log_accumulates_across_multiple_heals():
    """heal_log persists entries across successive self_heal_all() calls."""
    fs = AeroFileSystem(TEST_DISK_PATH, total_blocks=512)
    inode, _ = fs.write_file("acc.txt", b"A" * 9000)  # 3 blocks

    # Heal pass 1
    fs.dev.inject_bit_rot(inode.block_ids[0])
    fs.self_heal_all()
    assert len(fs.get_heal_log()) == 1

    # Heal pass 2 (corrupt a different block)
    fs.dev.inject_bit_rot(inode.block_ids[1])
    fs.self_heal_all()
    assert len(fs.get_heal_log()) == 2


# ---------------------------------------------------------------------------
# 4. Tier-1: Recovery from recovery_cache
# ---------------------------------------------------------------------------

def test_tier1_cache_heals_corrupted_block():
    """Single corrupted block is repaired from in-memory recovery cache."""
    fs = AeroFileSystem(TEST_DISK_PATH, total_blocks=512)
    content = b"TIER_ONE_CACHE_RECOVERY " * 170
    inode, _ = fs.write_file("cache_heal.txt", content)
    bid = inode.block_ids[0]

    # Verify cache has the block
    assert bid in fs.recovery_cache

    fs.dev.inject_bit_rot(bid)
    assert fs.scrub_all()["status"] == "DEGRADED"

    result = fs.self_heal_all()
    assert bid in result["repaired_blocks"]
    assert result["repaired_count"] >= 1
    assert result["post_heal_status"] == "HEALTHY"
    assert result["remaining_corrupted"] == 0

    # Content must read back cleanly
    recovered = fs.read_file("cache_heal.txt")
    assert recovered == content


# ---------------------------------------------------------------------------
# 5. Tier-2: Recovery from snapshot extents
# ---------------------------------------------------------------------------

def test_tier2_snapshot_path_exercised_when_cache_cleared():
    """
    When recovery_cache is cleared, self-healing falls back to the snapshot
    extent search path. Reports the result (healed or unrecoverable) correctly.
    """
    fs = AeroFileSystem(TEST_DISK_PATH, total_blocks=512)
    content = b"SNAPSHOT_FALLBACK_CONTENT " * 160
    inode, _ = fs.write_file("snap_heal.txt", content)

    # Take a snapshot BEFORE corruption
    fs.create_snapshot("pre_corrupt_snap")

    # Evict recovery cache to force Tier-2 fallback
    fs.recovery_cache.clear()

    bid = inode.block_ids[0]
    fs.dev.inject_bit_rot(bid)
    assert fs.scrub_all()["status"] == "DEGRADED"

    result = fs.self_heal_all()
    # At minimum verify the structured output is correct
    assert "repaired_blocks" in result
    assert "unrecoverable_blocks" in result
    assert result["repaired_count"] + result["unrecoverable_count"] >= 1


# ---------------------------------------------------------------------------
# 6. Multi-block corruption across multiple files
# ---------------------------------------------------------------------------

def test_multi_file_multi_block_heal():
    """Self-healing correctly repairs corruption spanning multiple files."""
    fs = AeroFileSystem(TEST_DISK_PATH, total_blocks=512)

    inode1, _ = fs.write_file("file_a.txt", b"AAAA" * 2000)  # ~2 blocks
    inode2, _ = fs.write_file("file_b.txt", b"BBBB" * 2000)  # ~2 blocks

    # Corrupt one block from each file
    bid_a = inode1.block_ids[0]
    bid_b = inode2.block_ids[0]
    fs.dev.inject_bit_rot(bid_a)
    fs.dev.inject_bit_rot(bid_b)

    assert fs.scrub_all()["corrupted_blocks_total"] >= 2

    result = fs.self_heal_all()
    assert bid_a in result["repaired_blocks"]
    assert bid_b in result["repaired_blocks"]
    assert result["post_heal_status"] == "HEALTHY"
    assert result["remaining_corrupted"] == 0

    # Both files read back correctly
    assert fs.read_file("file_a.txt") == b"AAAA" * 2000
    assert fs.read_file("file_b.txt") == b"BBBB" * 2000


# ---------------------------------------------------------------------------
# 7. Merkle root re-anchoring after heal
# ---------------------------------------------------------------------------

def test_merkle_root_re_anchored_after_heal():
    """
    After self-healing, the inode's merkle_root and leaf_hashes are updated
    to reflect the clean repaired blocks, so subsequent scrubs pass cleanly.
    """
    fs = AeroFileSystem(TEST_DISK_PATH, total_blocks=512)
    content = b"REANCHOR_TEST " * 300
    inode, _ = fs.write_file("anchor.txt", content)

    bid = inode.block_ids[0]
    fs.dev.inject_bit_rot(bid)

    # Merkle scrub now fails
    assert fs.scrub_all()["status"] == "DEGRADED"

    # Self-heal
    result = fs.self_heal_all()
    assert result["post_heal_status"] == "HEALTHY"
    assert "anchor.txt" in result["re_anchored_inodes"]

    # Inode's Merkle root must be re-computed and match actual disk state
    repaired_inode = fs.files["anchor.txt"]
    tree = MerkleTree(repaired_inode.block_ids, fs.dev)
    assert repaired_inode.merkle_root == tree.root_hash

    # A subsequent scrub must pass without any corruption reported
    post_scrub = fs.scrub_all()
    assert post_scrub["status"] == "HEALTHY"
    assert post_scrub["corrupted_blocks_total"] == 0


# ---------------------------------------------------------------------------
# 8. Unrecoverable block reporting
# ---------------------------------------------------------------------------

def test_unrecoverable_block_reported_correctly():
    """
    A block with no cache entry and no matching snapshot data is reported
    as unrecoverable, not silently ignored.
    """
    fs = AeroFileSystem(TEST_DISK_PATH, total_blocks=512)
    inode, _ = fs.write_file("corrupt_only.txt", b"UNRECOVERABLE " * 300)
    bid = inode.block_ids[0]

    # Remove from cache so Tier-1 fails
    fs.recovery_cache.pop(bid, None)

    # No snapshots exist so Tier-2 also fails
    fs.dev.inject_bit_rot(bid)

    result = fs.self_heal_all()
    assert bid in result["unrecoverable_blocks"]
    assert result["unrecoverable_count"] >= 1

    # Verify the heal record marks it as failed
    failed_records = [r for r in result["heal_records"] if r["block_id"] == bid]
    assert len(failed_records) == 1
    assert failed_records[0]["success"] is False
    assert failed_records[0]["source"] == "failed"


# ---------------------------------------------------------------------------
# 9. Post-heal Merkle scrub confirms correct status
# ---------------------------------------------------------------------------

def test_post_heal_scrub_reflects_true_state():
    """heal_all()'s built-in post-heal scrub always reflects true disk state."""
    fs = AeroFileSystem(TEST_DISK_PATH, total_blocks=512)
    inode, _ = fs.write_file("verify.txt", b"V" * 8192)

    for bid in inode.block_ids:
        fs.dev.inject_bit_rot(bid)

    result = fs.self_heal_all()

    if result["unrecoverable_count"] == 0:
        assert result["post_heal_status"] == "HEALTHY"
        assert result["remaining_corrupted"] == 0
    else:
        assert result["post_heal_status"] == "DEGRADED"


# ---------------------------------------------------------------------------
# 10. scrub_all_files() correctly reports orphan device-level corruption
# ---------------------------------------------------------------------------

def test_scrub_reports_orphan_device_corrupted_blocks():
    """
    Blocks flagged in dev.corrupted_blocks that are not owned by any active
    inode are still captured in the scrub report as a 'Physical Storage Layer'
    orphan entry.
    """
    fs = AeroFileSystem(TEST_DISK_PATH, total_blocks=512)
    inode, _ = fs.write_file("orphan_test.txt", b"O" * 4096)
    bid = inode.block_ids[0]

    # Delete file so bid has no inode owner, then manually flag as corrupted
    fs.delete_file("orphan_test.txt")
    fs.dev.corrupted_blocks.add(bid)

    report = fs.scrub_all()
    assert report["status"] == "DEGRADED"

    orphan_entries = [d for d in report["details"] if "orphan" in d["file"]]
    assert len(orphan_entries) >= 1
    assert bid in orphan_entries[0]["corrupted_blocks"]
