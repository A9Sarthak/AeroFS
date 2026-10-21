"""
AeroFS Content-Addressable Chunk Deduplication Engine
Implements block-level SHA-256 fingerprinting, reference counting, and 
zero-allocation deduplication across files and snapshots.
"""

import hashlib
from typing import Dict, Tuple, Any, Optional
from .disk import VirtualBlockDevice


def compute_chunk_hash(data: bytes) -> str:
    """Computes SHA-256 hex digest for a data chunk."""
    return hashlib.sha256(data).hexdigest()


class DeduplicationEngine:
    """
    Content-Addressable Storage (CAS) layer.
    Eliminates redundant physical block writes by maintaining a global 
    hash-to-block index with reference counting.
    """
    def __init__(self, block_device: VirtualBlockDevice):
        self.dev = block_device
        # Maps SHA-256 hash -> physical block_id
        self.hash_to_block: Dict[str, int] = {}
        # Maps physical block_id -> reference count
        self.block_refcount: Dict[int, int] = {}
        # Maps physical block_id -> SHA-256 hash (for integrity verification)
        self.block_to_hash: Dict[int, str] = {}
        
        # Telemetry metrics
        self.logical_blocks_written: int = 0
        self.physical_blocks_written: int = 0
        self.dedup_hits: int = 0

    def write_chunk(self, data: bytes, preallocated_block_id: Optional[int] = None) -> Tuple[int, bool]:
        """
        Stores a 4KB chunk in content-addressable storage.
        If chunk already exists on disk, reuses physical block and increments refcount.
        If unique, uses preallocated_block_id (from Best-Fit allocation) or allocates a new block.
        Returns: (block_id, is_deduplicated)
        """
        self.logical_blocks_written += 1
        chunk_hash = compute_chunk_hash(data)

        # Check if identical chunk already exists in storage
        if chunk_hash in self.hash_to_block:
            existing_block = self.hash_to_block[chunk_hash]
            # Verify the block is still valid on disk
            if self.dev.is_block_allocated(existing_block):
                self.block_refcount[existing_block] = self.block_refcount.get(existing_block, 0) + 1
                self.dedup_hits += 1
                return existing_block, True

        # Unique chunk: Allocate physical block on virtual disk (Best-Fit)
        if preallocated_block_id is not None:
            new_block = preallocated_block_id
        else:
            new_block = self.dev.allocate_block()

        self.dev.write_block(new_block, data)
        
        # Register in CAS tables
        self.hash_to_block[chunk_hash] = new_block
        self.block_refcount[new_block] = 1
        self.block_to_hash[new_block] = chunk_hash
        self.physical_blocks_written += 1

        return new_block, False

    def release_chunk(self, block_id: int) -> bool:
        """
        Decrements the reference count of a physical block.
        Only returns block to free-list when reference count drops to zero.
        Returns: True if physical block was freed, False if still referenced.
        """
        if block_id not in self.block_refcount:
            return False

        self.block_refcount[block_id] -= 1
        
        if self.block_refcount[block_id] <= 0:
            # No references remain (all files/snapshots deleted this block)
            chunk_hash = self.block_to_hash.pop(block_id, None)
            if chunk_hash and chunk_hash in self.hash_to_block:
                del self.hash_to_block[chunk_hash]
            del self.block_refcount[block_id]
            self.dev.free_block(block_id)
            return True
        
        return False

    def get_refcount(self, block_id: int) -> int:
        """Returns the current reference count for a block."""
        return self.block_refcount.get(block_id, 0)

    def get_expected_hash(self, block_id: int) -> Optional[str]:
        """Returns the expected SHA-256 fingerprint for a block."""
        return self.block_to_hash.get(block_id)

    def get_stats(self) -> Dict[str, Any]:
        """Calculates storage deduplication ratio and total saved capacity."""
        logical_bytes = self.logical_blocks_written * self.dev.block_size
        physical_unique_blocks = len(self.block_refcount)
        physical_bytes = physical_unique_blocks * self.dev.block_size
        bytes_saved = max(0, logical_bytes - physical_bytes)
        
        savings_percent = round((bytes_saved / logical_bytes * 100), 2) if logical_bytes > 0 else 0.0
        dedup_ratio = round(logical_bytes / physical_bytes, 2) if physical_bytes > 0 else 1.0

        return {
            "logical_blocks_written": self.logical_blocks_written,
            "physical_unique_blocks": physical_unique_blocks,
            "dedup_hits": self.dedup_hits,
            "logical_bytes": logical_bytes,
            "physical_bytes": physical_bytes,
            "bytes_saved": bytes_saved,
            "savings_percent": savings_percent,
            "dedup_ratio": f"{dedup_ratio}x"
        }
