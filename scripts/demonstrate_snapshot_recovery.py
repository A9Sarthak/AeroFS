"""
Independent Snapshot Recovery Verification & Demonstration Script
=================================================================
Proves that AeroFS Tier-2 snapshot extent recovery works independently
and reliably even when:
  1. The live physical disk block is physically corrupted with bit-rot.
  2. The Tier-1 in-memory recovery cache is completely evicted / cleared.
  3. The live file is modified or deleted.
"""

import os
import sys
import hashlib

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from aerofs import AeroFileSystem

DEMO_DISK = "demo_snapshot_recovery.bin"
DEMO_JOURNAL = "demo_snapshot_recovery.journal.json"


def cleanup():
    for p in [DEMO_DISK, DEMO_JOURNAL]:
        if os.path.exists(p):
            os.remove(p)


def run_demonstration():
    cleanup()
    print("=" * 76)
    print("  AeroFS INDEPENDENT SNAPSHOT RECOVERY & RESTORATION DEMONSTRATION")
    print("=" * 76)

    fs = AeroFileSystem(DEMO_DISK, total_blocks=512, enable_journal=True)

    # Step 1: Create a critical original document
    original_data = b"MISSION_CRITICAL_PAYLOAD_DATA_EXTENT_01" * 100
    expected_hash = hashlib.sha256(original_data.ljust(4096, b"\x00")).hexdigest()
    print(f"\n[Step 1] Writing initial file 'flight_plan.dat' ({len(original_data)} bytes)...")
    inode, dedup = fs.write_file("flight_plan.dat", original_data)
    bid = inode.block_ids[0]
    print(f"         Allocated physical Block ID: {bid}")
    print(f"         Expected SHA-256 Digest:    {expected_hash}")

    # Step 2: Create Point-in-Time Snapshot
    print("\n[Step 2] Creating snapshot 'snapshot_alpha'...")
    snap_dict = fs.create_snapshot("snapshot_alpha")
    print(f"         Snapshot created: {snap_dict['name']} (Files captured: {snap_dict['file_count']})")
    assert "snapshot_alpha" in fs.snapshot_extent_store
    assert bid in fs.snapshot_extent_store["snapshot_alpha"]
    print(f"         Verified: snapshot_extent_store captured clean physical copy for block #{bid}.")

    # Step 3: Evict Tier-1 Recovery Cache to force Tier-2 path
    print("\n[Step 3] Purging Tier-1 in-memory recovery cache...")
    fs.recovery_cache.clear()
    assert len(fs.recovery_cache) == 0
    print(f"         Tier-1 Cache Entries: {len(fs.recovery_cache)} (Cache is completely empty)")

    # Step 4: Inject Physical Storage Bit-Rot
    print(f"\n[Step 4] Injecting simulated physical bit-rot into Block #{bid}...")
    fs.dev.inject_bit_rot(bid, num_corrupted_bytes=24)
    corrupted_data = fs.dev.read_block(bid)
    corrupted_hash = hashlib.sha256(corrupted_data).hexdigest()
    print(f"         Corrupted Block SHA-256:    {corrupted_hash}")
    assert corrupted_hash != expected_hash, "Corruption failed to alter block hash"

    # Step 5: Run Merkle Integrity Scrub
    print("\n[Step 5] Running Cryptographic Merkle Scrub audit...")
    scrub_report = fs.scrub_all()
    print(f"         Scrub Status: {scrub_report['status']}")
    print(f"         Corrupted Blocks Total: {scrub_report['corrupted_blocks_total']}")
    print(f"         Corrupted Block IDs:    {scrub_report['corrupted_block_ids']}")
    assert scrub_report["status"] == "DEGRADED"
    assert bid in scrub_report["corrupted_block_ids"]

    # Step 6: Trigger Autonomous Self-Healing
    print("\n[Step 6] Triggering Autonomous Self-Healing (Tier-1 empty -> Tier-2 extent search)...")
    heal_report = fs.self_heal_all()
    print(f"         Pre-Heal Status:  {heal_report['pre_heal_status']}")
    print(f"         Post-Heal Status: {heal_report['post_heal_status']}")
    print(f"         Repaired Count:   {heal_report['repaired_count']} (Block IDs: {heal_report['repaired_blocks']})")
    assert heal_report["post_heal_status"] == "HEALTHY"
    assert bid in heal_report["repaired_blocks"]

    # Step 7: Inspect Immutable Heal Audit Record
    record = heal_report["heal_records"][0]
    print("\n[Step 7] Inspecting Heal Audit Trail Record:")
    print(f"         • Target Block:     #{record['block_id']}")
    print(f"         • Owning Inode:     {record['owning_file']}")
    print(f"         • Recovery Source:  {record['source']}")
    print(f"         • Expected Hash:    {record['expected_hash']}")
    print(f"         • Recovered Hash:   {record['recovered_hash']}")
    print(f"         • Success:          {record['success']}")
    assert record["source"] == "snapshot:snapshot_alpha"
    assert record["success"] is True
    assert record["recovered_hash"] == expected_hash

    # Step 8: Verify Recovered Content Byte-for-Byte
    read_back = fs.read_file("flight_plan.dat")
    assert read_back == original_data
    print("\n[Step 8] Byte-for-Byte Match Verification: 100% IDENTICAL TO ORIGINAL.")

    # Step 9: Verify Snapshot Rollback Functionality
    print("\n[Step 9] Modifying live file and testing snapshot rollback...")
    fs.write_file("flight_plan.dat", b"COMPLETELY_NEW_MUTATED_CONTENT")
    assert fs.read_file("flight_plan.dat") == b"COMPLETELY_NEW_MUTATED_CONTENT"
    print("         File overwritten with new mutated content.")

    fs.restore_snapshot("snapshot_alpha")
    restored_data = fs.read_file("flight_plan.dat")
    assert restored_data == original_data
    print("         Snapshot 'snapshot_alpha' rolled back successfully.")
    print("         Verified: Inode pointer and content restored to original snapshot state.")

    # Step 10: Final Health Scrub
    final_scrub = fs.scrub_all()
    print(f"\n[Step 10] Final Filesystem Integrity Audit: {final_scrub['status']}")
    assert final_scrub["status"] == "HEALTHY"

    cleanup()
    print("\n" + "=" * 76)
    print("  INDEPENDENT SNAPSHOT RECOVERY & ROLLBACK: FULLY VERIFIED")
    print("=" * 76 + "\n")


if __name__ == "__main__":
    run_demonstration()
