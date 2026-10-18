"""
AeroFS Metadata Persistence Journal
=====================================
Serializes and deserializes all in-memory filesystem state to a JSON sidecar
file stored alongside the virtual disk container.

State persisted:
  - File inodes (name, inode_id, size, block_ids, leaf_hashes, merkle_root)
  - Dedup CAS index (hash_to_block, block_to_hash, block_refcount, counters)
  - Snapshots (name, created_at, inode copies)
  - Snapshot extent store (independent byte copies of blocks at snap time)
  - Recovery cache (clean block bytes for Tier-1 healing after restart)
  - Heal audit log (HealRecord history)

The journal is saved atomically (write to .tmp, then rename) to prevent
partial-write corruption of the journal itself.

Limitations:
  - Physical block data is stored in the binary disk container, NOT here.
  - If the disk container is deleted, the journal alone cannot reconstruct data.
  - Heal log timestamps are not restored (they are serialized as strings).
"""

import os
import json
import base64
import time
from typing import TYPE_CHECKING, Dict, Any

if TYPE_CHECKING:
    from .cow_fs import AeroFileSystem

JOURNAL_VERSION = 2  # Increment on incompatible schema changes


class MetadataJournal:
    """
    Persistent metadata sidecar for AeroFileSystem.

    Usage:
        journal = MetadataJournal("aerofs_disk.bin.journal.json")
        journal.load(fs)     # on startup — returns True if state was restored
        journal.save(fs)     # after every mutating operation
        journal.delete()     # when formatting disk
    """

    def __init__(self, journal_path: str):
        self.journal_path = journal_path
        self._tmp_path = journal_path + ".tmp"

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def exists(self) -> bool:
        """Returns True if a journal file is present on disk."""
        return os.path.exists(self.journal_path)

    def save(self, fs: "AeroFileSystem") -> None:
        """
        Atomically serializes all filesystem metadata to the journal file.
        Uses write-to-tmp + rename to prevent partial-write corruption.
        """
        data: Dict[str, Any] = {
            "version": JOURNAL_VERSION,
            "saved_at": time.time(),
            "next_inode_id": fs.next_inode_id,
            "files": self._serialize_inodes(fs.files),
            "snapshots": self._serialize_snapshots(fs.snapshots),
            "dedup": self._serialize_dedup(fs.dedup),
            "recovery_cache": self._serialize_bytes_dict(fs.recovery_cache),
            "snapshot_extent_store": {
                snap_name: self._serialize_bytes_dict(extents)
                for snap_name, extents in fs.snapshot_extent_store.items()
            },
            "heal_log": [r.to_dict() for r in fs.scrubber.heal_log],
        }

        # Atomic write: tmp → rename
        with open(self._tmp_path, "w", encoding="utf-8") as f:
            json.dump(data, f, separators=(",", ":"))
        os.replace(self._tmp_path, self.journal_path)

    def load(self, fs: "AeroFileSystem") -> bool:
        """
        Restores filesystem metadata from the journal into a live AeroFileSystem.
        Returns True if metadata was successfully restored, False otherwise.
        The caller must still verify block data integrity via scrub_all().
        """
        if not self.exists():
            return False

        try:
            with open(self.journal_path, "r", encoding="utf-8") as f:
                data = json.load(f)
        except (json.JSONDecodeError, UnicodeDecodeError, ValueError, IOError, OSError, Exception) as e:
            print(f"[Journal] WARNING: Could not read journal ({e}). Starting fresh.")
            return False

        if data.get("version") != JOURNAL_VERSION:
            print(f"[Journal] WARNING: Journal version mismatch "
                  f"(expected {JOURNAL_VERSION}, got {data.get('version')}). Ignoring.")
            return False

        from .cow_fs import FileInode, Snapshot

        try:
            fs.next_inode_id = data.get("next_inode_id", 1)

            # Restore active file inodes
            fs.files.clear()
            for name, idata in data.get("files", {}).items():
                fs.files[name] = self._deserialize_inode(idata, FileInode)

            # Restore snapshots
            fs.snapshots.clear()
            for snap_name, sdata in data.get("snapshots", {}).items():
                fs.snapshots[snap_name] = self._deserialize_snapshot(sdata, FileInode, Snapshot)

            # Restore dedup engine state
            self._restore_dedup(fs.dedup, data.get("dedup", {}))

            # Restore recovery cache
            fs.recovery_cache = self._deserialize_bytes_dict(data.get("recovery_cache", {}))

            # Restore snapshot extent store
            fs.snapshot_extent_store = {
                snap_name: self._deserialize_bytes_dict(extents)
                for snap_name, extents in data.get("snapshot_extent_store", {}).items()
            }

            return True

        except (KeyError, TypeError, ValueError) as e:
            print(f"[Journal] WARNING: Journal deserialization error ({e}). Starting fresh.")
            fs.files.clear()
            fs.snapshots.clear()
            fs.recovery_cache.clear()
            fs.snapshot_extent_store.clear()
            return False

    def delete(self) -> None:
        """Removes the journal file (call when formatting the disk)."""
        for path in [self.journal_path, self._tmp_path]:
            try:
                os.remove(path)
            except FileNotFoundError:
                pass

    # ------------------------------------------------------------------
    # Private serialization helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _serialize_inodes(inodes: dict) -> dict:
        result = {}
        for name, inode in inodes.items():
            result[name] = {
                "inode_id": inode.inode_id,
                "name": inode.name,
                "size": inode.size,
                "created_at": inode.created_at,
                "modified_at": inode.modified_at,
                "block_ids": inode.block_ids,
                "merkle_root": inode.merkle_root,
                "leaf_hashes": inode.leaf_hashes,
            }
        return result

    @staticmethod
    def _deserialize_inode(idata: dict, FileInode) -> Any:
        inode = FileInode(idata["inode_id"], idata["name"], idata["size"])
        inode.created_at = idata["created_at"]
        inode.modified_at = idata["modified_at"]
        inode.block_ids = idata["block_ids"]
        inode.merkle_root = idata["merkle_root"]
        inode.leaf_hashes = idata["leaf_hashes"]
        return inode

    @classmethod
    def _serialize_snapshots(cls, snapshots: dict) -> dict:
        result = {}
        for snap_name, snap in snapshots.items():
            result[snap_name] = {
                "name": snap.name,
                "created_at": snap.created_at,
                "inodes": cls._serialize_inodes(snap.inodes),
            }
        return result

    @classmethod
    def _deserialize_snapshot(cls, sdata: dict, FileInode, Snapshot) -> Any:
        snap_inodes = {}
        for iname, idata in sdata.get("inodes", {}).items():
            snap_inodes[iname] = cls._deserialize_inode(idata, FileInode)
        snap = Snapshot.__new__(Snapshot)
        snap.name = sdata["name"]
        snap.created_at = sdata["created_at"]
        snap.inodes = snap_inodes
        return snap

    @staticmethod
    def _serialize_dedup(dedup) -> dict:
        return {
            "hash_to_block": dedup.hash_to_block,
            "block_refcount": {str(k): v for k, v in dedup.block_refcount.items()},
            "block_to_hash": {str(k): v for k, v in dedup.block_to_hash.items()},
            "logical_blocks_written": dedup.logical_blocks_written,
            "physical_blocks_written": dedup.physical_blocks_written,
            "dedup_hits": dedup.dedup_hits,
        }

    @staticmethod
    def _restore_dedup(dedup, data: dict) -> None:
        dedup.hash_to_block = data.get("hash_to_block", {})
        dedup.block_refcount = {int(k): v for k, v in data.get("block_refcount", {}).items()}
        dedup.block_to_hash = {int(k): v for k, v in data.get("block_to_hash", {}).items()}
        dedup.logical_blocks_written = data.get("logical_blocks_written", 0)
        dedup.physical_blocks_written = data.get("physical_blocks_written", 0)
        dedup.dedup_hits = data.get("dedup_hits", 0)

    @staticmethod
    def _serialize_bytes_dict(d: Dict[int, bytes]) -> dict:
        """Encodes {int → bytes} as {str → base64_str} for JSON compatibility."""
        return {
            str(k): base64.b64encode(v).decode("ascii")
            for k, v in d.items()
        }

    @staticmethod
    def _deserialize_bytes_dict(d: dict) -> Dict[int, bytes]:
        """Decodes {str → base64_str} back to {int → bytes}."""
        return {int(k): base64.b64decode(v) for k, v in d.items()}
