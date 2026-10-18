"""
AeroFS Merkle-Tree Cryptographic Integrity & Bit-Rot Detection Engine
Builds binary Merkle trees over file block extents to guarantee end-to-end data integrity.
Detects silent storage corruption (bit-rot) and localizes damaged blocks in O(log N) time.
Provides autonomous self-healing from recovery cache or historical snapshot extents.
"""

import hashlib
import time
from dataclasses import dataclass, field
from typing import List, Dict, Any, Tuple, Optional, TYPE_CHECKING
from .disk import VirtualBlockDevice

if TYPE_CHECKING:
    from .cow_fs import AeroFileSystem


def hash_pair(left: str, right: str) -> str:
    """Computes parent hash from two child hashes in the Merkle tree."""
    return hashlib.sha256((left + right).encode("utf-8")).hexdigest()


class MerkleTree:
    """
    Constructs and verifies a cryptographic Merkle tree over a sequence of physical disk blocks.
    """
    def __init__(self, block_ids: List[int], block_device: VirtualBlockDevice):
        self.block_ids = block_ids
        self.dev = block_device
        self.levels: List[List[str]] = []
        self.root_hash: str = ""
        self.rebuild()

    def rebuild(self) -> str:
        """Reads physical blocks from disk and computes the Merkle tree up to the root hash."""
        if not self.block_ids:
            self.root_hash = hashlib.sha256(b"").hexdigest()
            self.levels = [[self.root_hash]]
            return self.root_hash

        # Level 0: Leaf node hashes computed directly from physical block contents
        current_level = []
        for bid in self.block_ids:
            data = self.dev.read_block(bid)
            leaf_hash = hashlib.sha256(data).hexdigest()
            current_level.append(leaf_hash)

        self.levels = [current_level]

        # Build higher levels until root is reached
        while len(current_level) > 1:
            next_level = []
            for i in range(0, len(current_level), 2):
                left = current_level[i]
                # If odd number of nodes, duplicate the last node
                right = current_level[i + 1] if (i + 1 < len(current_level)) else left
                parent = hash_pair(left, right)
                next_level.append(parent)
            self.levels.append(next_level)
            current_level = next_level

        self.root_hash = self.levels[-1][0]
        return self.root_hash

    def audit_blocks(self, expected_leaf_hashes: List[str]) -> Tuple[bool, List[int]]:
        """
        Verifies current physical disk content against recorded expected hashes.
        Returns: (is_healthy, list_of_corrupted_block_ids)
        """
        corrupted = []
        for i, bid in enumerate(self.block_ids):
            data = self.dev.read_block(bid)
            actual_hash = hashlib.sha256(data).hexdigest()
            expected = expected_leaf_hashes[i] if i < len(expected_leaf_hashes) else ""
            if actual_hash != expected:
                corrupted.append(bid)
        
        return len(corrupted) == 0, corrupted

    def get_tree_structure(self) -> Dict[str, Any]:
        """Returns the hierarchical node structure for dashboard visualization."""
        levels_display = []
        for depth, level in enumerate(self.levels):
            levels_display.append([
                {"hash": h, "short_hash": h[:8] + "..." + h[-4:]} for h in level
            ])
        return {
            "root_hash": self.root_hash,
            "depth": len(self.levels),
            "block_ids": self.block_ids,
            "levels": levels_display
        }

    def render_ascii_tree(self) -> str:
        """Renders an ASCII diagram of the Merkle Tree for terminal display."""
        if not self.levels or not self.block_ids:
            return "  [Empty File / No Blocks]"
        lines = []
        lines.append(f"  Root Hash: [{self.root_hash[:10]}...{self.root_hash[-6:]}] (Tree Depth: {len(self.levels)})")
        for lvl_idx in reversed(range(len(self.levels))):
            level = self.levels[lvl_idx]
            tag = "ROOT" if lvl_idx == len(self.levels) - 1 else f"L{lvl_idx}"
            node_strs = [f"[{h[:8]}..]" for h in level]
            lines.append(f"    {tag:<6} : " + "  ".join(node_strs))
        leaf_bids = [f"[Blk #{bid}]" for bid in self.block_ids]
        lines.append(f"    BLOCKS : " + "  ".join(leaf_bids))
        return "\n".join(lines)

    def generate_proof(self, leaf_index: int) -> Dict[str, Any]:
        """
        Generates a cryptographic Merkle inclusion proof for a specific leaf block.
        Returns the sibling-hash path from leaf to root, allowing any verifier to
        reconstruct and validate the root hash without reading the full tree.
        """
        if not self.levels or leaf_index < 0 or leaf_index >= len(self.block_ids):
            return {"valid": False, "proof_path": [], "root_hash": self.root_hash}

        proof_path = []
        idx = leaf_index
        for level in self.levels[:-1]:  # Exclude the root level
            sibling_idx = idx ^ 1  # XOR to get sibling (left<->right)
            if sibling_idx < len(level):
                sibling_hash = level[sibling_idx]
            else:
                sibling_hash = level[idx]  # Duplicate for odd node
            direction = "right" if (idx % 2 == 0) else "left"
            proof_path.append({
                "sibling_hash": sibling_hash,
                "short_hash": sibling_hash[:8] + "..." + sibling_hash[-4:],
                "direction": direction
            })
            idx //= 2

        return {
            "valid": True,
            "leaf_block_id": self.block_ids[leaf_index],
            "leaf_hash": self.levels[0][leaf_index] if self.levels else "",
            "proof_path": proof_path,
            "root_hash": self.root_hash,
            "proof_depth": len(proof_path)
        }


@dataclass
class HealRecord:
    """
    Immutable audit record for a single block self-heal event.
    Persisted in the heal log for post-mortem analysis and telemetry.
    """
    block_id: int
    timestamp: float = field(default_factory=time.time)
    source: str = "unknown"          # 'recovery_cache' | 'snapshot:<name>' | 'failed'
    owning_file: str = ""
    expected_hash: str = ""
    recovered_hash: str = ""
    success: bool = False

    def to_dict(self) -> Dict[str, Any]:
        return {
            "block_id": self.block_id,
            "timestamp": time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(self.timestamp)),
            "source": self.source,
            "owning_file": self.owning_file,
            "expected_hash": self.expected_hash,
            "recovered_hash": self.recovered_hash,
            "success": self.success,
        }


class StorageScrubber:
    """
    Filesystem-wide integrity scrubbing and autonomous self-healing engine.

    Scrubbing workflow:
      1. scrub_file()      — Audits a single inode's Merkle tree.
      2. scrub_all_files() — Iterates all inodes and reports aggregated corruption.

    Self-healing workflow:
      1. heal_block()  — Repairs one block from recovery_cache or snapshot extents.
      2. heal_all()    — Heals every corrupted block found across all inodes and
                        re-anchors Merkle roots on affected inodes after repair.
    """
    def __init__(self, block_device: VirtualBlockDevice):
        self.dev = block_device
        self.heal_log: List[HealRecord] = []   # Persistent audit trail

    # ------------------------------------------------------------------
    # Scrubbing
    # ------------------------------------------------------------------

    def scrub_file(self, file_name: str, block_ids: List[int], expected_root: str,
                   expected_leaves: List[str]) -> Dict[str, Any]:
        """Audits a single file's Merkle tree against recorded leaf hashes."""
        if not block_ids:
            return {"file": file_name, "status": "CLEAN", "corrupted_blocks": []}

        tree = MerkleTree(block_ids, self.dev)
        is_clean, corrupted_blocks = tree.audit_blocks(expected_leaves)

        return {
            "file": file_name,
            "status": "CLEAN" if (is_clean and tree.root_hash == expected_root) else "CORRUPTED",
            "expected_root": expected_root,
            "actual_root": tree.root_hash,
            "corrupted_blocks": corrupted_blocks
        }

    def scrub_all_files(self, fs: "AeroFileSystem") -> Dict[str, Any]:
        """
        Runs a full filesystem-wide Merkle integrity scrub over every registered inode.
        Also checks device-level corrupted_blocks set for blocks not owned by any file.
        Returns a structured report consumable by both CLI and REST API.
        """
        results: List[Dict[str, Any]] = []
        total_corrupted = 0
        corrupted_block_ids: List[int] = []

        for name, inode in fs.files.items():
            audit = self.scrub_file(name, inode.block_ids, inode.merkle_root, inode.leaf_hashes)
            results.append(audit)
            if audit["status"] == "CORRUPTED":
                total_corrupted += len(audit["corrupted_blocks"])
                corrupted_block_ids.extend(audit["corrupted_blocks"])

        # Cross-check raw device corruption flags for orphan blocks
        orphan_corrupted = [
            b for b in self.dev.corrupted_blocks
            if b not in corrupted_block_ids
        ]
        if orphan_corrupted:
            total_corrupted += len(orphan_corrupted)
            corrupted_block_ids.extend(orphan_corrupted)
            results.append({
                "file": "Physical Storage Layer (orphan)",
                "status": "CORRUPTED",
                "expected_root": "N/A",
                "actual_root": "N/A",
                "corrupted_blocks": orphan_corrupted
            })

        return {
            "timestamp": time.strftime("%Y-%m-%d %H:%M:%S"),
            "status": "HEALTHY" if total_corrupted == 0 else "DEGRADED",
            "files_audited": len(fs.files),
            "corrupted_blocks_total": total_corrupted,
            "corrupted_block_ids": list(set(corrupted_block_ids)),
            "details": results
        }

    # ------------------------------------------------------------------
    # Self-Healing
    # ------------------------------------------------------------------

    def _find_clean_copy_in_snapshots(
        self,
        block_id: int,
        expected_hash: str,
        fs: "AeroFileSystem"
    ) -> Tuple[Optional[bytes], str]:
        """
        Tier-2 recovery: searches historical snapshot extent stores for a clean,
        verified copy of the given block.

        Two-phase search (Risk 1 fix):

        Phase A — Independent extent store (PREFERRED):
            At create_snapshot() time, AeroFileSystem copies the raw bytes of every
            referenced block into snapshot_extent_store[snap_name][block_id].
            These copies are PHYSICALLY INDEPENDENT of the live CAS block even though
            both inodes point to the same block_id. If the physical block is later
            corrupted, Phase A can still recover the original clean bytes because it
            reads from the in-memory (and journal-persisted) extent store, not disk.

        Phase B — Live disk read (FALLBACK):
            If no extent store is present (e.g. upgrade from old journal), try reading
            the shared physical block and verify against expected hash. This may fail
            if the block is already corrupted (original limitation).

        Returns: (clean_bytes, source_label) or (None, 'not_found')
        """
        # Sort snapshots newest-first for fastest recovery probability
        sorted_snaps = sorted(
            fs.snapshots.values(),
            key=lambda s: s.created_at,
            reverse=True
        )

        for snap in sorted_snaps:
            # Phase A: Independent extent store (Risk 1 fix — truly independent copy)
            extent_store = fs.snapshot_extent_store.get(snap.name, {})
            if block_id in extent_store:
                candidate = extent_store[block_id]
                if hashlib.sha256(candidate).hexdigest() == expected_hash:
                    return candidate, f"snapshot:{snap.name}"
                # Extent exists but hash doesn't match — block was already corrupt
                # when snapshot was taken; continue to next snapshot

            # Phase B: Fallback — read shared physical block (may be corrupt)
            for inode in snap.inodes.values():
                if block_id in inode.block_ids:
                    try:
                        candidate = self.dev.read_block(block_id)
                    except Exception:
                        continue
                    if hashlib.sha256(candidate).hexdigest() == expected_hash:
                        return candidate, f"snapshot:{snap.name}:live"

        return None, "not_found"


    def heal_block(
        self,
        block_id: int,
        expected_hash: str,
        owning_file: str,
        recovery_cache: Dict[int, bytes],
        fs: "AeroFileSystem"
    ) -> HealRecord:
        """
        Attempts to repair a single corrupted block using a two-tier strategy:

        Tier 1 — Recovery Cache (O(1) in-memory lookup):
          The recovery_cache is populated at write_file() time with clean block
          bytes. If the cached data's hash still matches the inode's expected hash,
          it is written directly to disk.

        Tier 2 — Snapshot Extent Search (O(S * B) where S=snapshots, B=blocks/snap):
          If the cache is missing or stale (e.g. overwritten by a different file),
          AeroFS scans all historical point-in-time snapshots for any inode that
          references the same block_id and whose on-disk bytes verify against the
          expected hash.

        After a successful write, the corrupted_blocks flag is cleared.
        An immutable HealRecord is appended to self.heal_log for audit purposes.
        """
        record = HealRecord(
            block_id=block_id,
            owning_file=owning_file,
            expected_hash=expected_hash,
        )

        # --- Tier 1: Recovery cache ---
        cached = recovery_cache.get(block_id)
        if cached is not None:
            cached_hash = hashlib.sha256(cached).hexdigest()
            if cached_hash == expected_hash:
                self.dev.repair_block(block_id, cached)
                record.source = "recovery_cache"
                record.recovered_hash = cached_hash
                record.success = True
                self.heal_log.append(record)
                return record

        # --- Tier 2: Snapshot extent search ---
        clean_data, source_label = self._find_clean_copy_in_snapshots(
            block_id, expected_hash, fs
        )
        if clean_data is not None:
            self.dev.repair_block(block_id, clean_data)
            record.source = source_label
            record.recovered_hash = hashlib.sha256(clean_data).hexdigest()
            record.success = True
            self.heal_log.append(record)
            return record

        # --- Unrecoverable ---
        record.source = "failed"
        record.success = False
        self.heal_log.append(record)
        return record

    def heal_all(
        self,
        fs: "AeroFileSystem"
    ) -> Dict[str, Any]:
        """
        Full self-healing pass:
          1. Runs scrub_all_files() to discover all corrupted blocks.
          2. For each corrupted block, calls heal_block() with cache + snapshot fallback.
          3. Re-anchors Merkle roots on every affected inode so future scrubs
             reflect the repaired state without requiring a full file re-write.
          4. Runs a post-heal scrub to confirm recovery success.
          5. Returns a detailed report including per-block heal records.
        """
        pre_scrub = self.scrub_all_files(fs)
        repaired: List[int] = []
        unrecoverable: List[int] = []
        heal_records: List[Dict[str, Any]] = []
        affected_inodes: set = set()

        # Build block_id -> owning inode mapping
        block_owner: Dict[int, str] = {}
        block_expected_hash: Dict[int, str] = {}
        for name, inode in fs.files.items():
            for i, bid in enumerate(inode.block_ids):
                block_owner[bid] = name
                if i < len(inode.leaf_hashes):
                    block_expected_hash[bid] = inode.leaf_hashes[i]

        all_corrupted = list(set(pre_scrub["corrupted_block_ids"]))

        for bid in all_corrupted:
            owner = block_owner.get(bid, "[orphan]")
            expected = block_expected_hash.get(
                bid,
                fs.dedup.get_expected_hash(bid) or ""
            )
            record = self.heal_block(
                block_id=bid,
                expected_hash=expected,
                owning_file=owner,
                recovery_cache=fs.recovery_cache,
                fs=fs
            )
            heal_records.append(record.to_dict())
            if record.success:
                repaired.append(bid)
                if owner != "[orphan]":
                    affected_inodes.add(owner)
            else:
                unrecoverable.append(bid)

        # Re-anchor Merkle roots on all affected inodes
        re_anchored = []
        for fname in affected_inodes:
            inode = fs.files.get(fname)
            if inode:
                import hashlib as _hl
                new_leaves = [
                    _hl.sha256(self.dev.read_block(b)).hexdigest()
                    for b in inode.block_ids
                ]
                new_tree = MerkleTree(inode.block_ids, self.dev)
                inode.leaf_hashes = new_leaves
                inode.merkle_root = new_tree.root_hash
                re_anchored.append(fname)

        # Post-heal verification
        post_scrub = self.scrub_all_files(fs)

        return {
            "pre_heal_status": pre_scrub["status"],
            "post_heal_status": post_scrub["status"],
            "repaired_blocks": repaired,
            "repaired_count": len(repaired),
            "unrecoverable_blocks": unrecoverable,
            "unrecoverable_count": len(unrecoverable),
            "re_anchored_inodes": re_anchored,
            "remaining_corrupted": post_scrub["corrupted_blocks_total"],
            "heal_records": heal_records
        }
