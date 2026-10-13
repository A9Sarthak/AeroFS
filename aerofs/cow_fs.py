"""
AeroFS Copy-on-Write (CoW) Inode & Directory Management Subsystem
Provides hierarchical file operations, zero-copy snapshots, and crash-resilient metadata.
Modeled after Apple APFS and ZFS storage designs.
"""

import time
import copy
from typing import Dict, List, Optional, Any, Tuple
from .disk import VirtualBlockDevice, DEFAULT_BLOCK_SIZE
from .dedup import DeduplicationEngine, compute_chunk_hash
from .merkle import MerkleTree, StorageScrubber


class FileInode:
    """Represents file metadata, block extent pointers, and Merkle tree roots."""
    def __init__(self, inode_id: int, name: str, size: int = 0):
        self.inode_id = inode_id
        self.name = name
        self.size = size
        self.created_at = time.time()
        self.modified_at = self.created_at
        self.block_ids: List[int] = []
        self.merkle_root: str = ""
        self.leaf_hashes: List[str] = []

    def to_dict(self) -> Dict[str, Any]:
        return {
            "inode_id": self.inode_id,
            "name": self.name,
            "size": self.size,
            "num_blocks": len(self.block_ids),
            "block_ids": self.block_ids,
            "merkle_root": self.merkle_root,
            "created_at": time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(self.created_at)),
            "modified_at": time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(self.modified_at))
        }


class Snapshot:
    """Represents a frozen, immutable point-in-time state of the filesystem."""
    def __init__(self, name: str, inodes_snapshot: Dict[str, FileInode]):
        self.name = name
        self.created_at = time.time()
        # Deepcopy of inodes preserves exact block pointer map at this instant
        self.inodes: Dict[str, FileInode] = copy.deepcopy(inodes_snapshot)

    def to_dict(self) -> Dict[str, Any]:
        total_size = sum(f.size for f in self.inodes.values())
        return {
            "name": self.name,
            "created_at": time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(self.created_at)),
            "file_count": len(self.inodes),
            "total_size": total_size,
            "files": [f.name for f in self.inodes.values()]
        }


class AeroFileSystem:
    """
    Main Copy-on-Write (CoW) filesystem controller.
    Coordinates the Virtual Block Device, Deduplication Engine, Merkle Trees, and Snapshots.
    """
    def __init__(self, disk_path: str = "aerofs_disk.bin", total_blocks: int = 4096):
        self.block_size = DEFAULT_BLOCK_SIZE
        self.dev = VirtualBlockDevice(disk_path, total_blocks=total_blocks, block_size=self.block_size)
        self.dedup = DeduplicationEngine(self.dev)
        self.scrubber = StorageScrubber(self.dev)
        
        # Filesystem state
        self.next_inode_id = 1
        self.files: Dict[str, FileInode] = {}
        self.snapshots: Dict[str, Snapshot] = {}
        self.recovery_cache: Dict[int, bytes] = {}

    def write_file(self, filename: str, data: bytes) -> Tuple[FileInode, int]:
        """
        Writes data to a file using Copy-on-Write (CoW) and Deduplication semantics.
        Never overwrites existing blocks in-place.
        Returns: (FileInode, deduplicated_chunks_count)
        """
        # 1. Release previous blocks if file already exists (decrements refcount)
        old_inode = self.files.get(filename)
        if old_inode:
            for bid in old_inode.block_ids:
                freed = self.dedup.release_chunk(bid)
                if freed:
                    self.recovery_cache.pop(bid, None)

        # 2. Slice data into 4KB chunks
        chunk_size = self.block_size
        chunks = [data[i:i + chunk_size] for i in range(0, len(data), chunk_size)]
        if not chunks:
            chunks = [b""] # Empty file gets 1 zero-block

        allocated_block_ids = []
        leaf_hashes = []
        dedup_count = 0

        # 3. Write chunks through Content-Addressable Storage (CAS)
        for chunk in chunks:
            padded = chunk.ljust(self.block_size, b"\x00")
            bid, was_dedup = self.dedup.write_chunk(padded)
            if was_dedup:
                dedup_count += 1
            allocated_block_ids.append(bid)
            self.recovery_cache[bid] = padded
            leaf_hashes.append(compute_chunk_hash(padded))

        # 4. Construct Merkle tree for data verification
        tree = MerkleTree(allocated_block_ids, self.dev)
        merkle_root = tree.rebuild()

        # 5. Create or update Inode
        inode_id = old_inode.inode_id if old_inode else self.next_inode_id
        if not old_inode:
            self.next_inode_id += 1

        inode = FileInode(inode_id, filename, len(data))
        inode.block_ids = allocated_block_ids
        inode.merkle_root = merkle_root
        inode.leaf_hashes = leaf_hashes
        inode.modified_at = time.time()
        
        self.files[filename] = inode
        return inode, dedup_count

    def read_file(self, filename: str) -> bytes:
        """Reads file data by reassembling its physical block sequence."""
        if filename not in self.files:
            raise FileNotFoundError(f"File '{filename}' not found in AeroFS.")
        
        inode = self.files[filename]
        buffer = bytearray()
        for bid in inode.block_ids:
            chunk = self.dev.read_block(bid)
            buffer.extend(chunk)
        
        # Trim padding to original file size
        return bytes(buffer[:inode.size])

    def delete_file(self, filename: str) -> bool:
        """
        Deletes a file.
        Decrements refcounts for all its blocks. Physical blocks are only 
        reclaimed if no snapshots reference them!
        """
        if filename not in self.files:
            return False

        inode = self.files.pop(filename)
        for bid in inode.block_ids:
            freed = self.dedup.release_chunk(bid)
            if freed:
                self.recovery_cache.pop(bid, None)
        return True

    def create_snapshot(self, snapshot_name: str) -> Dict[str, Any]:
        """
        Creates an instant zero-copy snapshot of the filesystem.
        Increments reference counts on all active blocks (O(1) storage overhead).
        """
        if snapshot_name in self.snapshots:
            raise ValueError(f"Snapshot '{snapshot_name}' already exists.")

        # Increment reference count for all currently referenced blocks
        for inode in self.files.values():
            for bid in inode.block_ids:
                self.dedup.block_refcount[bid] = self.dedup.block_refcount.get(bid, 0) + 1

        snap = Snapshot(snapshot_name, self.files)
        self.snapshots[snapshot_name] = snap
        return snap.to_dict()

    def restore_snapshot(self, snapshot_name: str) -> bool:
        """
        Rolls back the active filesystem state to an earlier point-in-time snapshot.
        """
        if snapshot_name not in self.snapshots:
            raise KeyError(f"Snapshot '{snapshot_name}' does not exist.")

        # Release current active file references
        current_files = list(self.files.keys())
        for f in current_files:
            self.delete_file(f)

        # Restore from snapshot
        snap = self.snapshots[snapshot_name]
        for name, saved_inode in snap.inodes.items():
            # Re-increment refcounts for restored files
            for bid in saved_inode.block_ids:
                self.dedup.block_refcount[bid] = self.dedup.block_refcount.get(bid, 0) + 1
            self.files[name] = copy.deepcopy(saved_inode)

        return True

    def delete_snapshot(self, snapshot_name: str) -> bool:
        """Deletes a snapshot and releases its block references."""
        if snapshot_name not in self.snapshots:
            return False

        snap = self.snapshots.pop(snapshot_name)
        for saved_inode in snap.inodes.values():
            for bid in saved_inode.block_ids:
                freed = self.dedup.release_chunk(bid)
                if freed:
                    self.recovery_cache.pop(bid, None)
        return True

    def list_files(self) -> List[Dict[str, Any]]:
        """Returns list of active file metadata dictionaries."""
        return [inode.to_dict() for inode in self.files.values()]

    def list_snapshots(self) -> List[Dict[str, Any]]:
        """Returns list of all active point-in-time snapshots."""
        return [snap.to_dict() for snap in self.snapshots.values()]

    def scrub_all(self) -> Dict[str, Any]:
        """
        Runs Merkle-tree cryptographic verification across all files.
        Detects silent bit-rot or simulated hardware sector failures.
        """
        results = []
        total_corrupted = 0
        for name, inode in self.files.items():
            audit = self.scrubber.scrub_file(name, inode.block_ids, inode.merkle_root, inode.leaf_hashes)
            results.append(audit)
            if audit["status"] == "CORRUPTED":
                total_corrupted += len(audit["corrupted_blocks"])

        # Also cross-check physical storage device level
        if len(self.dev.corrupted_blocks) > 0 and total_corrupted == 0:
            total_corrupted = len(self.dev.corrupted_blocks)
            results.append({
                "file": "Physical Storage Layer",
                "status": "CORRUPTED",
                "expected_root": "N/A",
                "actual_root": "N/A",
                "corrupted_blocks": list(self.dev.corrupted_blocks)
            })

        return {
            "timestamp": time.strftime("%Y-%m-%d %H:%M:%S"),
            "status": "HEALTHY" if total_corrupted == 0 else "DEGRADED",
            "files_audited": len(results),
            "corrupted_blocks_total": total_corrupted,
            "details": results
        }

    def get_system_telemetry(self) -> Dict[str, Any]:
        """Gathers aggregated filesystem metrics for dashboard visualization."""
        disk_stats = self.dev.get_stats()
        dedup_stats = self.dedup.get_stats()
        
        # Classify block states for the visual block grid
        # Types: 0=Free, 1=System Metadata, 2=Unique Data, 3=Deduplicated (ref>1), 4=Corrupted
        block_states = []
        # Sample first 1024 blocks for the visual display grid
        sample_limit = min(1024, self.dev.total_blocks)
        for b in range(sample_limit):
            if b in self.dev.corrupted_blocks:
                block_states.append(4) # Corrupted / Bit-Rot
            elif b < 4:
                block_states.append(1) # System Metadata / Superblock
            elif not self.dev.is_block_allocated(b):
                block_states.append(0) # Free
            else:
                ref = self.dedup.get_refcount(b)
                if ref > 1:
                    block_states.append(3) # Deduplicated Shared Block
                else:
                    block_states.append(2) # Unique Data Block

        return {
            "disk": disk_stats,
            "dedup": dedup_stats,
            "file_count": len(self.files),
            "snapshot_count": len(self.snapshots),
            "grid_blocks": block_states,
            "files": self.list_files(),
            "snapshots": self.list_snapshots()
        }

    def get_block_details(self, block_id: int) -> Dict[str, Any]:
        """Returns deep block telemetry for inspector panels and CLI display."""
        if not (0 <= block_id < self.dev.total_blocks):
            raise IndexError(f"Block ID {block_id} out of bounds (0..{self.dev.total_blocks - 1})")

        is_allocated = self.dev.is_block_allocated(block_id)
        is_corrupted = block_id in self.dev.corrupted_blocks
        is_metadata = block_id < 4
        refcount = self.dedup.get_refcount(block_id)
        expected_hash = self.dedup.get_expected_hash(block_id)

        referencing_files = [f.name for f in self.files.values() if block_id in f.block_ids]
        referencing_snaps = [
            s.name for s in self.snapshots.values()
            if any(block_id in sf.block_ids for sf in s.inodes.values())
        ]

        actual_hash = None
        if is_allocated:
            import hashlib
            data = self.dev.read_block(block_id)
            actual_hash = hashlib.sha256(data).hexdigest()

        return {
            "block_id": block_id,
            "is_allocated": is_allocated,
            "is_corrupted": is_corrupted,
            "is_metadata": is_metadata,
            "refcount": refcount,
            "expected_hash": expected_hash,
            "actual_hash": actual_hash,
            "hash_matches": (expected_hash == actual_hash) if (expected_hash and actual_hash) else True,
            "referencing_files": referencing_files,
            "referencing_snapshots": referencing_snaps
        }

    def inspect_file(self, filename: str) -> Dict[str, Any]:
        """Provides full Merkle tree proof and block layout for an inode."""
        if filename not in self.files:
            raise FileNotFoundError(f"File '{filename}' not found in AeroFS.")

        inode = self.files[filename]
        tree = MerkleTree(inode.block_ids, self.dev)
        tree_struct = tree.get_tree_structure()
        ascii_tree = tree.render_ascii_tree()
        is_clean, corrupted_blocks = tree.audit_blocks(inode.leaf_hashes)

        try:
            content_bytes = self.read_file(filename)
            preview = content_bytes[:500].decode("utf-8", errors="replace")
        except Exception:
            preview = "[Binary payload]"

        return {
            "inode": inode.to_dict(),
            "is_healthy": is_clean and (tree.root_hash == inode.merkle_root),
            "corrupted_blocks": corrupted_blocks,
            "tree": tree_struct,
            "ascii_tree": ascii_tree,
            "preview": preview
        }

    def self_heal_all(self) -> Dict[str, Any]:
        """
        Self-healing engine: audits the filesystem, detects corrupted blocks,
        and restores clean verified block bytes from recovery cache.
        """
        audit = self.scrub_all()
        repaired_blocks = []

        for item in audit["details"]:
            for bid in item["corrupted_blocks"]:
                if bid in self.recovery_cache:
                    clean_data = self.recovery_cache[bid]
                    self.dev.repair_block(bid, clean_data)
                    repaired_blocks.append(bid)

        # Check any block flagged on raw device
        for bid in list(self.dev.corrupted_blocks):
            if bid in self.recovery_cache:
                clean_data = self.recovery_cache[bid]
                self.dev.repair_block(bid, clean_data)
                repaired_blocks.append(bid)

        post_audit = self.scrub_all()

        return {
            "repaired_blocks": list(set(repaired_blocks)),
            "repaired_count": len(set(repaired_blocks)),
            "post_heal_status": post_audit["status"],
            "remaining_corrupted": post_audit["corrupted_blocks_total"]
        }
