"""
AeroFS Copy-on-Write (CoW) Inode & Directory Management Subsystem
Provides hierarchical file operations, zero-copy snapshots, and crash-resilient metadata.
Modeled after Apple APFS and ZFS storage designs.
"""

import time
import copy
import hashlib
import concurrent.futures
from typing import Dict, List, Optional, Any, Tuple
from .disk import VirtualBlockDevice, DEFAULT_BLOCK_SIZE
from .dedup import DeduplicationEngine, compute_chunk_hash
from .merkle import MerkleTree, StorageScrubber, HealRecord
from .journal import MetadataJournal


class IntegrityError(IOError):
    """Raised when cryptographic Merkle verification fails and data is unrecoverable."""
    pass


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

    @property
    def block_ids(self) -> List[int]:
        return sorted(list(set(
            bid for f in self.inodes.values() for bid in f.block_ids
        )))

    def to_dict(self) -> Dict[str, Any]:
        total_size = sum(f.size for f in self.inodes.values())
        all_block_ids = self.block_ids
        return {
            "name": self.name,
            "created_at": time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(self.created_at)),
            "file_count": len(self.inodes),
            "total_size": total_size,
            "files": [f.name for f in self.inodes.values()],
            "block_ids": all_block_ids,
            "file_blocks": {f.name: f.block_ids for f in self.inodes.values()}
        }


class AeroFileSystem:
    """
    Main Copy-on-Write (CoW) filesystem controller.
    Coordinates the Virtual Block Device, Deduplication Engine, Merkle Trees, and Snapshots.

    Persistence: all mutating methods call self.checkpoint() to atomically save
    metadata to a JSON journal sidecar file. On startup, the journal is loaded
    automatically if present, restoring inodes, snapshots, CAS index, and recovery data.
    """
    def __init__(self, disk_path: str = "aerofs_disk.bin", total_blocks: int = 4096,
                 enable_journal: bool = True):
        self.block_size = DEFAULT_BLOCK_SIZE
        self.dev = VirtualBlockDevice(disk_path, total_blocks=total_blocks, block_size=self.block_size)
        self.dedup = DeduplicationEngine(self.dev)
        self.scrubber = StorageScrubber(self.dev)

        # Filesystem state
        self.next_inode_id = 1
        self.files: Dict[str, FileInode] = {}
        self.snapshots: Dict[str, Snapshot] = {}
        self.recovery_cache: Dict[int, bytes] = {}

        # Risk 1: Independent snapshot byte copies (decoupled from live physical blocks)
        # Keyed: snapshot_name -> {block_id -> clean_bytes_at_snap_time}
        self.snapshot_extent_store: Dict[str, Dict[int, bytes]] = {}

        # Risk 8: Merkle tree level cache (filename -> (merkle_root, MerkleTree))
        # Invalidated on any write or heal that modifies the inode.
        self._merkle_cache: Dict[str, Tuple[str, MerkleTree]] = {}

        # Risks 2 & 3: Metadata + recovery cache persistence via JSON journal
        self._journal_enabled = enable_journal
        if disk_path.endswith(".bin"):
            journal_path = disk_path[:-4] + ".journal.json"
        else:
            journal_path = disk_path + ".journal.json"
        self.journal = MetadataJournal(journal_path)

        if enable_journal:
            if getattr(self.dev, "is_new_disk", False):
                self.journal.delete()
            else:
                loaded = self.journal.load(self)
                if loaded:
                    # Guarantee allocation bitmap reflects all restored active files and snapshots
                    for f in self.files.values():
                        for bid in f.block_ids:
                            self.dev.allocation_bitmap[bid] = 1
                    for s in self.snapshots.values():
                        for bid in s.block_ids:
                            self.dev.allocation_bitmap[bid] = 1
                    self.dev._sync_bitmap_to_disk()

    def format(self) -> None:
        """Formats the virtual disk and resets all filesystem state cleanly."""
        self.dev.format_disk()
        self.files.clear()
        self.snapshots.clear()
        self.dedup.block_refcount.clear()
        self.dedup.hash_to_block.clear()
        self.dedup.block_to_hash.clear()
        self.recovery_cache.clear()
        self.snapshot_extent_store.clear()
        self._merkle_cache.clear()
        self.next_inode_id = 1
        self.scrubber.heal_log.clear()
        self.journal.delete()

    def checkpoint(self) -> None:
        """Atomically persists all in-memory metadata to the journal sidecar file."""
        if self._journal_enabled:
            self.journal.save(self)

    def write_file(self, filename: str, data: bytes, fill_holes_first: bool = False) -> Tuple[FileInode, int]:
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
            # Invalidate Merkle cache for this filename
            self._merkle_cache.pop(filename, None)

        # 2. Slice data into 4KB chunks
        chunk_size = self.block_size
        chunks = [data[i:i + chunk_size] for i in range(0, len(data), chunk_size)]
        if not chunks:
            chunks = [b""]  # Empty file gets 1 zero-block

        # Pre-calculate unique chunks that require new physical block allocations on disk
        seen_in_batch = set()
        unique_needed_count = 0
        for chunk in chunks:
            padded = chunk.ljust(self.block_size, b"\x00")
            h = compute_chunk_hash(padded)
            # If already exists in global CAS or seen earlier in this file, it will deduplicate
            if (h not in self.dedup.hash_to_block or not self.dev.is_block_allocated(self.dedup.hash_to_block[h])) and h not in seen_in_batch:
                seen_in_batch.add(h)
                unique_needed_count += 1

        # Allocate Best-Fit contiguous extent(s) for the new unique blocks
        preallocated_pool: List[int] = []
        if unique_needed_count > 0:
            preallocated_pool = self.dev.allocate_best_fit(unique_needed_count, fill_holes_first=fill_holes_first)

        allocated_block_ids = []
        leaf_hashes = []
        dedup_count = 0
        pool_idx = 0

        try:
            # 3. Write chunks through Content-Addressable Storage (CAS) with Best-Fit
            for chunk in chunks:
                padded = chunk.ljust(self.block_size, b"\x00")
                h = compute_chunk_hash(padded)
                is_already_stored = (
                    h in self.dedup.hash_to_block
                    and self.dev.is_block_allocated(self.dedup.hash_to_block[h])
                )

                target_bid = None
                if not is_already_stored and pool_idx < len(preallocated_pool):
                    target_bid = preallocated_pool[pool_idx]
                    pool_idx += 1

                bid, was_dedup = self.dedup.write_chunk(padded, preallocated_block_id=target_bid)
                if was_dedup:
                    dedup_count += 1
                allocated_block_ids.append(bid)
                self.recovery_cache[bid] = padded
                leaf_hashes.append(compute_chunk_hash(padded))
        finally:
            # Free any unused preallocated blocks (e.g. if duplicate chunks occurred within the file)
            while pool_idx < len(preallocated_pool):
                self.dev.free_block(preallocated_pool[pool_idx])
                pool_idx += 1

        # 4. Construct Merkle tree and populate cache
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
        # Warm Merkle cache immediately after write
        self._merkle_cache[filename] = (merkle_root, tree)

        # Risk 2/3: Persist to journal
        self.checkpoint()
        return inode, dedup_count

    def read_file(self, filename: str, verify_integrity: bool = True) -> bytes:
        """
        Reads file data by reassembling its physical block sequence.

        Parameters
        ----------
        filename : str
            The name of the file to read.
        verify_integrity : bool, default True
            When True, cryptographically verifies each block's SHA-256 hash against
            the inode's leaf_hashes. If a block is corrupt, it triggers on-demand
            self-healing. If both Tier-1 (cache) and Tier-2 (snapshots) fail, it raises
            IntegrityError (EIO) to guarantee that corrupted data is NEVER silently
            returned to user-space.
            When False, raw block contents are returned without verification (forensics).
        """
        if filename not in self.files:
            raise FileNotFoundError(f"File '{filename}' not found in AeroFS.")

        inode = self.files[filename]
        buffer = bytearray()
        for idx, bid in enumerate(inode.block_ids):
            chunk = self.dev.read_block(bid)
            if verify_integrity and idx < len(inode.leaf_hashes):
                expected_hash = inode.leaf_hashes[idx]
                actual_hash = hashlib.sha256(chunk).hexdigest()
                if actual_hash != expected_hash:
                    # Attempt on-demand self-healing
                    record = self.scrubber.heal_block(
                        block_id=bid,
                        expected_hash=expected_hash,
                        owning_file=filename,
                        recovery_cache=self.recovery_cache,
                        fs=self
                    )
                    if record.success:
                        # Re-read the repaired block
                        chunk = self.dev.read_block(bid)
                    else:
                        raise IntegrityError(
                            f"EIO: Cryptographic integrity check failed for file '{filename}' "
                            f"at block #{bid} (expected {expected_hash[:16]}..., got {actual_hash[:16]}...). "
                            f"Both recovery cache and snapshots failed or are missing. Corrupted data refused."
                        )
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
        self._merkle_cache.pop(filename, None)  # Invalidate cache
        for bid in inode.block_ids:
            freed = self.dedup.release_chunk(bid)
            if freed:
                self.recovery_cache.pop(bid, None)
        self.checkpoint()
        return True

    def create_snapshot(self, snapshot_name: str) -> Dict[str, Any]:
        """
        Creates an instant zero-copy snapshot of the filesystem.
        Increments reference counts on all active blocks (O(1) storage overhead).

        Risk 1 fix: also stores an independent physical byte copy of every referenced
        block in snapshot_extent_store. This gives Tier-2 healing a truly independent
        clean source that is NOT affected if the shared CAS physical block is later
        corrupted — because CoW deduplication would otherwise point snapshot and live
        file to the same physical block.
        """
        if snapshot_name in self.snapshots:
            raise ValueError(f"Snapshot '{snapshot_name}' already exists.")

        # Increment reference count for all currently referenced blocks
        for inode in self.files.values():
            for bid in inode.block_ids:
                self.dedup.block_refcount[bid] = self.dedup.block_refcount.get(bid, 0) + 1

        snap = Snapshot(snapshot_name, self.files)
        self.snapshots[snapshot_name] = snap

        # Risk 1: Capture independent byte copies at snapshot time
        extent_store: Dict[int, bytes] = {}
        for inode in self.files.values():
            for bid in inode.block_ids:
                if bid not in extent_store:
                    try:
                        extent_store[bid] = bytes(self.dev.read_block(bid))
                    except Exception:
                        pass  # Best-effort; block may not be readable
        self.snapshot_extent_store[snapshot_name] = extent_store

        self.checkpoint()
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
            for bid in saved_inode.block_ids:
                self.dedup.block_refcount[bid] = self.dedup.block_refcount.get(bid, 0) + 1
                self.dev.allocation_bitmap[bid] = 1
                try:
                    data = self.dev.read_block(bid)
                    chunk_hash = hashlib.sha256(data).hexdigest()
                    self.dedup.hash_to_block[chunk_hash] = bid
                    self.dedup.block_to_hash[bid] = chunk_hash
                except Exception:
                    pass
            self.files[name] = copy.deepcopy(saved_inode)
            self._merkle_cache.pop(name, None)  # Force fresh tree on next access

        self.dev._sync_bitmap_to_disk()
        self.checkpoint()
        return True

    def delete_snapshot(self, snapshot_name: str) -> bool:
        """Deletes a snapshot and releases its block references."""
        if snapshot_name not in self.snapshots:
            return False

        snap = self.snapshots.pop(snapshot_name)
        # Clean up independent extent store for this snapshot
        self.snapshot_extent_store.pop(snapshot_name, None)
        for saved_inode in snap.inodes.values():
            for bid in saved_inode.block_ids:
                freed = self.dedup.release_chunk(bid)
                if freed:
                    self.recovery_cache.pop(bid, None)
        self.checkpoint()
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
        Delegates to StorageScrubber.scrub_all_files() for full coverage.
        """
        return self.scrubber.scrub_all_files(self)

    def scrub_with_timeout(self, timeout_seconds: float = 30.0) -> Dict[str, Any]:
        """
        Risk 7: Runs scrub_all() with a configurable wall-clock timeout.
        Raises TimeoutError if the scrub does not complete within the limit.
        Useful for CLI and API contexts where very large disks could hang.
        """
        with concurrent.futures.ThreadPoolExecutor(max_workers=1) as executor:
            future = executor.submit(self.scrub_all)
            try:
                return future.result(timeout=timeout_seconds)
            except concurrent.futures.TimeoutError:
                raise TimeoutError(
                    f"Merkle scrub timed out after {timeout_seconds:.1f}s. "
                    "Consider running on a smaller disk partition."
                )

    def write_file_with_timeout(
        self, filename: str, data: bytes, timeout_seconds: float = 30.0
    ) -> Tuple[FileInode, int]:
        """
        Risk 7: Writes a file with a per-operation timeout to protect against
        unbounded latency on large writes or slow virtual devices.
        """
        with concurrent.futures.ThreadPoolExecutor(max_workers=1) as executor:
            future = executor.submit(self.write_file, filename, data)
            try:
                return future.result(timeout=timeout_seconds)
            except concurrent.futures.TimeoutError:
                raise TimeoutError(f"Write operation timed out after {timeout_seconds:.1f}s for '{filename}'.")

    def get_system_telemetry(self) -> Dict[str, Any]:
        """Gathers aggregated filesystem metrics for dashboard visualization."""
        disk_stats = self.dev.get_stats()
        dedup_stats = self.dedup.get_stats()
        
        # Map: block_id -> count of live files referencing it
        file_block_counts: Dict[int, int] = {}
        for f in self.files.values():
            for bid in f.block_ids:
                file_block_counts[bid] = file_block_counts.get(bid, 0) + 1

        # Map: block_id -> count of snapshots referencing it
        snap_block_counts: Dict[int, int] = {}
        for s in self.snapshots.values():
            for sf in s.inodes.values():
                for bid in sf.block_ids:
                    snap_block_counts[bid] = snap_block_counts.get(bid, 0) + 1

        # Classify block states for the visual block grid:
        # 0=Free, 1=System Metadata, 2=Unique Data, 3=CAS Deduplicated (>=2 live files), 4=Corrupted, 5=Snapshot Protected
        block_states = []
        sample_limit = self.dev.total_blocks
        for b in range(sample_limit):
            if b in self.dev.corrupted_blocks:
                block_states.append(4)  # Corrupted / Bit-Rot
            elif b < 4:
                block_states.append(1)  # System Metadata / Superblock
            elif not self.dev.is_block_allocated(b):
                block_states.append(0)  # Free
            else:
                live_refs = file_block_counts.get(b, 0)
                snap_refs = snap_block_counts.get(b, 0)

                if live_refs >= 2:
                    # TRUE CAS deduplication: 2+ active files share this physical block
                    block_states.append(3)  # Deduplicated Shared Block (Purple)
                elif snap_refs >= 1:
                    # Block is frozen / protected by a snapshot
                    block_states.append(5)  # Snapshot-Protected Block (Amber)
                else:
                    # Unique block belonging to a single active file
                    block_states.append(2)  # Unique Data Block (Green)

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
        and restores clean verified block bytes from recovery cache or snapshot extents.
        Re-anchors Merkle roots on healed inodes after repair.
        Delegates to StorageScrubber.heal_all() for two-tier recovery.
        """
        result = self.scrubber.heal_all(self)
        # Invalidate Merkle cache for all re-anchored inodes so fresh trees are built
        for fname in result.get("re_anchored_inodes", []):
            self._merkle_cache.pop(fname, None)
        # Persist updated leaf hashes and roots
        self.checkpoint()
        return result

    def get_cached_merkle_tree(self, filename: str) -> MerkleTree:
        """
        Risk 8: Returns a cached MerkleTree for the given file, rebuilding only
        when the inode's merkle_root has changed (e.g. after a write or heal).
        Avoids re-reading all disk blocks on every inspect/proof call.
        """
        if filename not in self.files:
            raise FileNotFoundError(f"File '{filename}' not found in AeroFS.")
        inode = self.files[filename]
        cached = self._merkle_cache.get(filename)
        if cached is not None:
            cached_root, cached_tree = cached
            if cached_root == inode.merkle_root:
                return cached_tree  # Cache hit — no disk I/O needed
        # Cache miss or root changed — rebuild
        tree = MerkleTree(inode.block_ids, self.dev)
        self._merkle_cache[filename] = (inode.merkle_root, tree)
        return tree

    def get_heal_log(self) -> List[Dict[str, Any]]:
        """Returns the full audit trail of all self-heal events since startup."""
        return [r.to_dict() for r in self.scrubber.heal_log]

    def get_merkle_proof(self, filename: str, block_index: int) -> Dict[str, Any]:
        """
        Generates a cryptographic Merkle inclusion proof for a specific block
        within a file. Uses the Merkle tree cache (Risk 8) to avoid redundant
        disk reads when called repeatedly on the same file.
        """
        if filename not in self.files:
            raise FileNotFoundError(f"File '{filename}' not found in AeroFS.")
        inode = self.files[filename]
        if not (0 <= block_index < len(inode.block_ids)):
            raise IndexError(f"Block index {block_index} out of range for file '{filename}'.")
        tree = self.get_cached_merkle_tree(filename)  # Uses cache
        return tree.generate_proof(block_index)
