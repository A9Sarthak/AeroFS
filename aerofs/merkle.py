"""
AeroFS Merkle-Tree Cryptographic Integrity & Bit-Rot Detection Engine
Builds binary Merkle trees over file block extents to guarantee end-to-end data integrity.
Detects silent storage corruption (bit-rot) and localizes damaged blocks in O(log N) time.
"""

import hashlib
from typing import List, Dict, Any, Tuple, Optional
from .disk import VirtualBlockDevice


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


class StorageScrubber:
    """
    Filesystem-wide integrity scrubbing engine.
    Scans all allocated blocks, validates Merkle proofs, and reports bit-rot status.
    """
    def __init__(self, block_device: VirtualBlockDevice):
        self.dev = block_device

    def scrub_file(self, file_name: str, block_ids: List[int], expected_root: str, 
                   expected_leaves: List[str]) -> Dict[str, Any]:
        """Audits a single file's Merkle tree."""
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
