import os
import pytest
from aerofs.disk import VirtualBlockDevice, DATA_START_BLOCK
from aerofs.cow_fs import AeroFileSystem


def test_virtual_block_device_best_fit(tmp_path):
    disk_path = str(tmp_path / "test_best_fit_dev.bin")
    dev = VirtualBlockDevice(disk_path=disk_path, total_blocks=64, block_size=4096)

    # Initially all data blocks DATA_START_BLOCK..63 are free
    free_extents = dev.get_free_extents()
    assert len(free_extents) == 1
    assert free_extents[0] == (DATA_START_BLOCK, 64 - DATA_START_BLOCK)

    # Artificially create specific holes:
    # Let's allocate all blocks
    for b in range(DATA_START_BLOCK, 64):
        dev.allocation_bitmap[b] = 1

    # Now create Hole A: length 5 (blocks 10..14)
    for b in range(10, 15):
        dev.allocation_bitmap[b] = 0

    # Hole B: length 2 (blocks 20..21)
    for b in range(20, 22):
        dev.allocation_bitmap[b] = 0

    # Hole C: length 10 (blocks 30..39)
    for b in range(30, 40):
        dev.allocation_bitmap[b] = 0

    extents = dev.get_free_extents()
    assert extents == [(10, 5), (20, 2), (30, 10)]

    # Request 2 blocks: Best-Fit MUST choose Hole B (blocks 20..21, leftover = 0)
    alloc_2 = dev.allocate_best_fit(2)
    assert alloc_2 == [20, 21]

    # Now remaining extents are [(10, 5), (30, 10)]
    assert dev.get_free_extents() == [(10, 5), (30, 10)]

    # Request 4 blocks: Best-Fit MUST choose Hole A (blocks 10..13, leftover = 1 vs 6)
    alloc_4 = dev.allocate_best_fit(4)
    assert alloc_4 == [10, 11, 12, 13]

    # Now remaining extents are [(14, 1), (30, 10)]
    assert dev.get_free_extents() == [(14, 1), (30, 10)]

    # Request 1 block: Best-Fit MUST choose the isolated 1-block hole at block 14!
    alloc_1 = dev.allocate_block()
    assert alloc_1 == 14

    # Now only Hole C remains
    assert dev.get_free_extents() == [(30, 10)]


def test_file_deletion_and_reoccupation(tmp_path):
    """
    Tests that when files are deleted, their blocks are freed,
    and new files created afterwards reclaim and occupy that space efficiently via Best-Fit.
    """
    disk_path = str(tmp_path / "test_reclaim.bin")
    fs = AeroFileSystem(disk_path=disk_path, total_blocks=128, enable_journal=False)

    # 1. Create file A (3 distinct chunks = 12KB) and file B (2 distinct chunks = 8KB)
    data_a = (b"Chunk A1: " + b"1" * 4000) + (b"Chunk A2: " + b"2" * 4000) + (b"Chunk A3: " + b"3" * 4000)
    inode_a, _ = fs.write_file("file_a.txt", data_a)
    assert len(inode_a.block_ids) == 3
    blocks_a = list(inode_a.block_ids)

    data_b = (b"Chunk B1: " + b"X" * 4000) + (b"Chunk B2: " + b"Y" * 4000)
    inode_b, _ = fs.write_file("file_b.txt", data_b)
    assert len(inode_b.block_ids) == 2
    blocks_b = list(inode_b.block_ids)

    # File A and B should be placed contiguously
    assert blocks_a == [4, 5, 6]
    assert blocks_b == [7, 8]

    # 2. Delete file A (blocks 4, 5, 6 become a 3-block free hole)
    deleted = fs.delete_file("file_a.txt")
    assert deleted is True
    assert not fs.dev.is_block_allocated(4)
    assert not fs.dev.is_block_allocated(5)
    assert not fs.dev.is_block_allocated(6)

    # Check free extents: Hole 1 is (4, 3), Hole 2 is (9, 119)
    extents = fs.dev.get_free_extents()
    assert extents[0] == (4, 3)

    # 3. Create a new file C that needs 3 blocks (12KB)
    # Best-Fit MUST occupy the freed hole (blocks 4, 5, 6) with 0 leftover!
    data_c = (b"Chunk C1: " + b"7" * 4000) + (b"Chunk C2: " + b"8" * 4000) + (b"Chunk C3: " + b"9" * 4000)
    inode_c, _ = fs.write_file("file_c.txt", data_c)
    assert inode_c.block_ids == [4, 5, 6]

    # 4. Delete file B (blocks 7, 8 become a 2-block free hole)
    fs.delete_file("file_b.txt")
    assert not fs.dev.is_block_allocated(7)
    assert not fs.dev.is_block_allocated(8)

    # Create a 2-block file D -> reclaims blocks 7, 8!
    data_d = (b"Chunk D1: " + b"M" * 4000) + (b"Chunk D2: " + b"N" * 4000)
    inode_d, _ = fs.write_file("file_d.txt", data_d)
    assert inode_d.block_ids == [7, 8]


def test_external_fragmentation_metric(tmp_path):
    disk_path = str(tmp_path / "test_frag_metric.bin")
    dev = VirtualBlockDevice(disk_path=disk_path, total_blocks=100, block_size=4096)

    stats = dev.get_stats()
    # Initially all free blocks are contiguous in 1 hole -> 0% fragmentation
    assert stats["fragmentation_percent"] == 0.0
    assert stats["allocation_strategy"] == "Best-Fit (Anti-Fragmentation)"
    assert stats["free_extents_count"] == 1

    # Create fragmentation: allocate alternate blocks
    for b in range(DATA_START_BLOCK, 100, 2):
        dev.allocation_bitmap[b] = 1

    frag_stats = dev.get_stats()
    # Now there are many 1-block holes -> high external fragmentation
    assert frag_stats["fragmentation_percent"] > 90.0
    assert frag_stats["free_extents_count"] > 10


def test_best_fit_preview_and_large_file_api():
    from fastapi.testclient import TestClient
    from aerofs.app import app

    client = TestClient(app)

    # Preview Best Fit for 8 blocks
    res = client.post("/api/simulate/best_fit_preview", json={"blocks_needed": 8})
    assert res.status_code == 200
    data = res.json()
    assert data["blocks_needed"] == 8
    assert "best_fit" in data
    assert "first_fit" in data
    assert "worst_fit" in data
    assert len(data["holes"]) > 0

    # Create Large File (4 blocks unique)
    res_create = client.post(
        "/api/simulate/create_large_file",
        json={"filename": "test_large_file_demo.bin", "num_blocks": 4, "is_unique": True}
    )
    assert res_create.status_code == 200
    create_data = res_create.json()
    assert create_data["status"] == "success"
    assert create_data["num_blocks"] == 4
    assert len(create_data["block_ids"]) == 4

    # Cleanup
    del_res = client.delete("/api/files/test_large_file_demo.bin")
    assert del_res.status_code == 200


def test_large_file_skips_small_hole_in_contiguous_mode_and_fills_in_hole_filling_mode(tmp_path):
    """
    Directly validates the user scenario:
    - Free Hole 1 has 8 blocks (sectors 4..11).
    - File 1 needs 64 blocks.
    - Contiguous Best-Fit skips Hole 1 because 8 < 64 (avoiding fragmentation),
      allocating the 64 blocks contiguously in Hole 2 (sectors 14..77).
    - An 8-block file fits Hole 1 exactly (sectors 4..11).
    - In fill_holes_first=True mode, the 64-block file fills Hole 1 first (4..11)
      and spills remainder into Hole 2.
    """
    disk_path = str(tmp_path / "test_user_scenario.bin")
    dev = VirtualBlockDevice(disk_path=disk_path, total_blocks=256, block_size=4096)

    # Artificially occupy blocks 12..13 (simulating existing files like hello / a)
    dev.allocation_bitmap[12] = 1
    dev.allocation_bitmap[13] = 1

    # Free extents are now:
    # Hole 1: sectors 4..11 (8 blocks)
    # Hole 2: sectors 14..255 (242 blocks)
    extents = dev.get_free_extents()
    assert extents[0] == (4, 8)
    assert extents[1] == (14, 242)

    # 1. Contiguous Best-Fit for 64 blocks: MUST skip Hole 1 and take Hole 2 (14..77)
    alloc_64_contiguous = dev.allocate_best_fit(64, fill_holes_first=False)
    assert alloc_64_contiguous == list(range(14, 78))
    # Hole 1 (4..11) MUST still be free!
    for b in range(4, 12):
        assert not dev.is_block_allocated(b)

    # Free the 64 blocks back
    for b in alloc_64_contiguous:
        dev.free_block(b)

    # 2. File of 8 blocks: MUST take Hole 1 (4..11) with 0 leftover!
    alloc_8 = dev.allocate_best_fit(8, fill_holes_first=False)
    assert alloc_8 == list(range(4, 12))

    # Free the 8 blocks back
    for b in alloc_8:
        dev.free_block(b)

    # 3. Large 64 blocks with fill_holes_first=True:
    # MUST consume Hole 1 (4..11, 8 blocks) and spill 56 blocks into Hole 2 (14..69)
    alloc_64_scatter = dev.allocate_best_fit(64, fill_holes_first=True)
    assert len(alloc_64_scatter) == 64
    assert alloc_64_scatter[:8] == list(range(4, 12))
    assert alloc_64_scatter[8:] == list(range(14, 70))


