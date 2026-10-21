"""
AeroFS Virtual Block Device Driver
Simulates a physical raw block storage device backed by a binary container file.
Provides block-level read/write, allocation bitmap, and superblock metadata.
"""

import os
import struct
from typing import Optional, Dict, Any, List, Tuple, Set

MAGIC_NUMBER = b"AER0FS01"
DEFAULT_BLOCK_SIZE = 4096         # 4 KB per block
DEFAULT_NUM_BLOCKS = 4096          # 16 MB virtual disk (compact, fast, scalable to 16k blocks)
SUPERBLOCK_ID = 0
BITMAP_START_BLOCK = 1
DATA_START_BLOCK = 4               # Blocks 0-3 reserved for Superblock & Bitmap/Metadata


class DiskSuperblock:
    """Represents the filesystem superblock stored in Block 0."""
    def __init__(self, block_size: int = DEFAULT_BLOCK_SIZE, total_blocks: int = DEFAULT_NUM_BLOCKS):
        self.magic = MAGIC_NUMBER
        self.block_size = block_size
        self.total_blocks = total_blocks
        self.data_start_block = DATA_START_BLOCK
        self.root_inode_block = DATA_START_BLOCK

    def serialize(self) -> bytes:
        # Magic (8 bytes) + block_size (4) + total_blocks (4) + data_start (4) + root_inode_block (4)
        header = struct.pack(">8sIIII", self.magic, self.block_size, self.total_blocks, 
                             self.data_start_block, self.root_inode_block)
        # Pad up to block_size
        return header.ljust(self.block_size, b"\x00")

    @classmethod
    def deserialize(cls, data: bytes) -> 'DiskSuperblock':
        magic, block_size, total_blocks, data_start, root_inode = struct.unpack(">8sIIII", data[:24])
        if magic != MAGIC_NUMBER:
            raise ValueError(f"Invalid superblock magic: {magic} != {MAGIC_NUMBER}")
        sb = cls(block_size, total_blocks)
        sb.data_start_block = data_start
        sb.root_inode_block = root_inode
        return sb


class VirtualBlockDevice:
    """
    Simulates a physical hard disk or NVMe block device using a binary file.
    Provides raw sector/block read/write operations and manages physical allocation state.
    """
    def __init__(self, disk_path: str = "aerofs_disk.bin", 
                 total_blocks: int = DEFAULT_NUM_BLOCKS, 
                 block_size: int = DEFAULT_BLOCK_SIZE,
                 format_if_missing: bool = True):
        self.disk_path = disk_path
        self.total_blocks = total_blocks
        self.block_size = block_size
        self.total_capacity_bytes = total_blocks * block_size
        self.data_start_block = DATA_START_BLOCK
        
        # In-memory allocation bitmap tracking used vs free blocks
        # 0 = free, 1 = allocated
        self.allocation_bitmap: List[int] = [0] * self.total_blocks
        self.corrupted_blocks = set() # Simulated bit-rot tracking
        
        if not os.path.exists(disk_path) and format_if_missing:
            self.format_disk()
            self.is_new_disk = True
        else:
            self.open_disk()
            self.is_new_disk = False

    def format_disk(self) -> None:
        """Initializes a blank virtual disk image file and formats superblock and bitmap."""
        self.is_new_disk = True
        with open(self.disk_path, "wb") as f:
            f.truncate(self.total_capacity_bytes)

        # Reset bitmap
        self.allocation_bitmap = [0] * self.total_blocks
        # Reserve superblock and metadata blocks
        for b in range(DATA_START_BLOCK):
            self.allocation_bitmap[b] = 1

        # Write superblock
        self.superblock = DiskSuperblock(self.block_size, self.total_blocks)
        self.write_block(SUPERBLOCK_ID, self.superblock.serialize())
        self._sync_bitmap_to_disk()

    def open_disk(self) -> None:
        """Opens an existing virtual disk image file and reads superblock."""
        if not os.path.exists(self.disk_path):
            raise FileNotFoundError(f"Virtual disk file {self.disk_path} not found.")
        
        raw_sb = self.read_block(SUPERBLOCK_ID)
        self.superblock = DiskSuperblock.deserialize(raw_sb)
        self.block_size = self.superblock.block_size
        self.total_blocks = self.superblock.total_blocks
        self._load_bitmap_from_disk()

    def read_block(self, block_id: int) -> bytes:
        """Reads a physical block from the virtual disk container."""
        if not (0 <= block_id < self.total_blocks):
            raise IndexError(f"Block ID {block_id} out of bounds (0..{self.total_blocks - 1})")
        
        with open(self.disk_path, "rb") as f:
            f.seek(block_id * self.block_size)
            data = f.read(self.block_size)
        return data

    def write_block(self, block_id: int, data: bytes) -> None:
        """Writes a physical block to the virtual disk container with padding."""
        if not (0 <= block_id < self.total_blocks):
            raise IndexError(f"Block ID {block_id} out of bounds (0..{self.total_blocks - 1})")
        
        if len(data) > self.block_size:
            raise ValueError(f"Data size ({len(data)} B) exceeds block size ({self.block_size} B)")
        
        padded_data = data.ljust(self.block_size, b"\x00")
        with open(self.disk_path, "r+b") as f:
            f.seek(block_id * self.block_size)
            f.write(padded_data)

    def get_free_extents(self) -> List[Tuple[int, int]]:
        """
        Scans allocation bitmap and returns list of contiguous free extents (holes):
        [(start_block, length), ...]
        """
        extents: List[Tuple[int, int]] = []
        in_extent = False
        start = -1
        for b in range(DATA_START_BLOCK, self.total_blocks):
            if self.allocation_bitmap[b] == 0:
                if not in_extent:
                    in_extent = True
                    start = b
            else:
                if in_extent:
                    extents.append((start, b - start))
                    in_extent = False
        if in_extent:
            extents.append((start, self.total_blocks - start))
        return extents

    def allocate_best_fit(self, count: int = 1, fill_holes_first: bool = False) -> List[int]:
        """
        Best-Fit Block Allocation Strategy (Minimizing External Fragmentation).

        If fill_holes_first is False (default Contiguous Best-Fit):
          Searches all available contiguous free holes on disk and selects the
          extent that minimizes leftover space (length - count >= 0).
          Files larger than a hole will skip it to stay in one contiguous extent.

        If fill_holes_first is True (Aggressive Hole-Filling / Scatter-Gather):
          Fills smaller available free holes first to aggressively eliminate fragments,
          spilling the remainder into larger extents.
        """
        if count <= 0:
            return []

        extents = self.get_free_extents()
        total_free = sum(e[1] for e in extents)
        if total_free < count:
            raise OSError(
                f"Virtual disk full: Requested {count} blocks, but only {total_free} free blocks remaining in storage subsystem."
            )

        # 1. Aggressive Hole-Filling (Fills smaller reclaimed holes first)
        if fill_holes_first:
            allocated: List[int] = []
            remaining = count
            # Sort extents ascending by size so smaller holes (e.g. 8-block hole) are consumed first
            sorted_extents = sorted(extents, key=lambda e: (e[1], e[0]))
            for start, length in sorted_extents:
                take = min(length, remaining)
                for b in range(start, start + take):
                    self.allocation_bitmap[b] = 1
                    allocated.append(b)
                remaining -= take
                if remaining == 0:
                    break
            self._sync_bitmap_to_disk()
            return allocated

        # 2. Contiguous Best-Fit Search (Only holes >= count to preserve file continuity)
        candidates = [e for e in extents if e[1] >= count]
        if candidates:
            # Pick extent with minimum leftover space; tie-break on lower block ID
            best_start, _ = min(candidates, key=lambda e: (e[1] - count, e[0]))
            allocated = list(range(best_start, best_start + count))
            for b in allocated:
                self.allocation_bitmap[b] = 1
            self._sync_bitmap_to_disk()
            return allocated

        # 3. Fragmented allocation fallback if no single hole is big enough
        allocated = []
        remaining = count
        sorted_extents = sorted(extents, key=lambda e: (-e[1], e[0]))
        for start, length in sorted_extents:
            take = min(length, remaining)
            for b in range(start, start + take):
                self.allocation_bitmap[b] = 1
                allocated.append(b)
            remaining -= take
            if remaining == 0:
                break

        self._sync_bitmap_to_disk()
        return allocated

    def allocate_block(self) -> int:
        """
        Finds and marks a free block using Best-Fit allocation strategy.
        Picks the smallest available hole to preserve larger contiguous extents.
        """
        allocated = self.allocate_best_fit(1)
        return allocated[0]

    def free_block(self, block_id: int) -> None:
        """Frees an allocated block in the bitmap and zeroes its content on disk."""
        if block_id < DATA_START_BLOCK or block_id >= self.total_blocks:
            return
        self.allocation_bitmap[block_id] = 0
        self.corrupted_blocks.discard(block_id)
        self.write_block(block_id, b"\x00" * self.block_size)
        self._sync_bitmap_to_disk()

    def is_block_allocated(self, block_id: int) -> bool:
        """Checks if a block is currently marked as allocated."""
        if 0 <= block_id < self.total_blocks:
            return self.allocation_bitmap[block_id] == 1
        return False

    def inject_bit_rot(self, block_id: int, num_corrupted_bytes: int = 16) -> None:
        """
        Simulates physical bit-rot or storage corruption on a specific block.
        Corrupts random bytes at random positions throughout the block, making
        the simulation realistic rather than always hitting the same offset.

        Args:
            block_id:            The physical block to corrupt.
            num_corrupted_bytes: Number of distinct byte positions to flip.
                                 Defaults to 16 for a modest but detectable corruption.
        """
        import random
        if not self.is_block_allocated(block_id):
            raise ValueError(f"Cannot inject bit-rot into unallocated block {block_id}")

        raw_data = bytearray(self.read_block(block_id))
        # Choose random byte positions spread across the entire block
        positions = random.sample(range(len(raw_data)), min(num_corrupted_bytes, len(raw_data)))
        for pos in positions:
            # XOR with a non-zero value to guarantee the byte actually changes
            flip_mask = random.randint(1, 255)
            raw_data[pos] ^= flip_mask

        with open(self.disk_path, "r+b") as f:
            f.seek(block_id * self.block_size)
            f.write(bytes(raw_data))

        self.corrupted_blocks.add(block_id)

    def repair_block(self, block_id: int, clean_data: bytes) -> None:
        """
        Repairs a corrupted physical block with clean, verified data.
        Clears the simulated bit-rot tracking flag.
        """
        self.write_block(block_id, clean_data)
        self.corrupted_blocks.discard(block_id)

    def _sync_bitmap_to_disk(self) -> None:
        """Persists the allocation bitmap to reserved bitmap blocks on disk."""
        bitmap_bytes = bytearray((self.total_blocks + 7) // 8)
        for i in range(self.total_blocks):
            if self.allocation_bitmap[i]:
                bitmap_bytes[i // 8] |= (1 << (i % 8))
        
        # Write into BITMAP_START_BLOCK
        self.write_block(BITMAP_START_BLOCK, bytes(bitmap_bytes[:self.block_size]))

    def _load_bitmap_from_disk(self) -> None:
        """Reads persisted allocation bitmap from disk."""
        raw_bitmap = self.read_block(BITMAP_START_BLOCK)
        self.allocation_bitmap = [0] * self.total_blocks
        for i in range(self.total_blocks):
            byte_val = raw_bitmap[i // 8] if (i // 8) < len(raw_bitmap) else 0
            if byte_val & (1 << (i % 8)):
                self.allocation_bitmap[i] = 1
        # Always reserve metadata blocks
        for b in range(DATA_START_BLOCK):
            self.allocation_bitmap[b] = 1

    def get_stats(self) -> Dict[str, Any]:
        """Returns physical disk capacity, allocation, and fragmentation metrics."""
        allocated_count = sum(self.allocation_bitmap)
        free_count = self.total_blocks - allocated_count
        extents = self.get_free_extents()
        largest_free_extent = max((e[1] for e in extents), default=0)

        # Standard Operating System External Fragmentation Metric:
        # Frag % = (1 - largest_free_extent / total_free_blocks) * 100
        frag_percent = round((1.0 - (largest_free_extent / free_count)) * 100, 2) if free_count > 0 else 0.0

        return {
            "total_blocks": self.total_blocks,
            "block_size": self.block_size,
            "capacity_bytes": self.total_capacity_bytes,
            "allocated_blocks": allocated_count,
            "free_blocks": free_count,
            "utilization_percent": round((allocated_count / self.total_blocks) * 100, 2),
            "corrupted_blocks_count": len(self.corrupted_blocks),
            "fragmentation_percent": frag_percent,
            "free_extents_count": len(extents),
            "largest_free_extent": largest_free_extent,
            "free_extents": [{"start": s, "length": l} for s, l in extents[:10]],
            "allocation_strategy": "Best-Fit (Anti-Fragmentation)"
        }
