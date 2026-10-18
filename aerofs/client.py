"""
AeroFS HTTP REST Client
Provides transparent synchronous access to a running AeroFS web server,
enabling the CLI, benchmarks, and interactive tools to share live filesystem state.
"""

import time
import requests
from typing import Dict, List, Optional, Any, Tuple


def check_server_available(base_url: str = "http://127.0.0.1:8000", timeout: float = 0.8) -> bool:
    """Checks if the AeroFS FastAPI server is running and reachable."""
    try:
        url = base_url.rstrip("/") + "/api/telemetry"
        res = requests.get(url, timeout=timeout)
        return res.status_code == 200
    except Exception:
        return False


class RemoteInode:
    """Represents an inode returned by the remote AeroFS server."""
    def __init__(self, inode_id: int, name: str, size: int, block_ids: List[int], merkle_root: str):
        self.inode_id = inode_id
        self.name = name
        self.size = size
        self.block_ids = block_ids
        self.merkle_root = merkle_root

    def to_dict(self) -> Dict[str, Any]:
        return {
            "inode_id": self.inode_id,
            "name": self.name,
            "size": self.size,
            "num_blocks": len(self.block_ids),
            "block_ids": self.block_ids,
            "merkle_root": self.merkle_root
        }


class RemoteDevice:
    """Proxies physical block device queries to the remote server."""
    def __init__(self, client: "AeroFSRemoteClient"):
        self.client = client
        self.total_blocks = 4096
        self.data_start_block = 4
        self.block_size = 4096

    @property
    def corrupted_blocks(self) -> List[int]:
        telemetry = self.client.get_telemetry()
        corrupted = []
        for i, st in enumerate(telemetry.get("grid_blocks", [])):
            if st == 4:
                corrupted.append(i)
        return corrupted

    def is_block_allocated(self, block_id: int) -> bool:
        telemetry = self.client.get_telemetry()
        grid = telemetry.get("grid_blocks", [])
        if 0 <= block_id < len(grid):
            return grid[block_id] != 0
        return False

    def inject_bit_rot(self, block_id: Optional[int] = None) -> Dict[str, Any]:
        self.client.invalidate_cache()
        payload = {}
        if block_id is not None:
            payload["block_id"] = block_id
        res = requests.post(f"{self.client.base_url}/api/simulate/bitrot", json=payload, timeout=5)
        res.raise_for_status()
        return res.json()

    def get_stats(self) -> Dict[str, Any]:
        telemetry = self.client.get_telemetry()
        return telemetry.get("disk", {
            "capacity_bytes": 16 * 1024 * 1024,
            "total_blocks": 4096,
            "block_size": 4096,
            "allocated_blocks": 0,
            "free_blocks": 4096,
            "utilization_percent": 0.0
        })


class RemoteDedup:
    """Proxies deduplication queries to the remote server."""
    def __init__(self, client: "AeroFSRemoteClient"):
        self.client = client

    def get_refcount(self, block_id: int) -> int:
        details = self.client.get_block_details(block_id)
        return details.get("refcount", 0)

    def get_stats(self) -> Dict[str, Any]:
        telemetry = self.client.get_telemetry()
        return telemetry.get("dedup", {
            "logical_blocks_written": 0,
            "physical_unique_blocks": 0,
            "dedup_hits": 0,
            "bytes_saved": 0,
            "savings_percent": 0.0,
            "dedup_ratio": "1.00"
        })


class AeroFSRemoteClient:
    """
    Drop-in replacement for AeroFileSystem that talks to the FastAPI server.
    All operations update the server's in-memory disk and reflect on the web dashboard.
    """
    def __init__(self, base_url: str = "http://127.0.0.1:8000"):
        self.base_url = base_url.rstrip("/")
        self.dev = RemoteDevice(self)
        self.dedup = RemoteDedup(self)
        self._cached_telemetry: Optional[Dict[str, Any]] = None
        self._cache_time: float = 0.0

    def get_telemetry(self, max_age: float = 0.25) -> Dict[str, Any]:
        now = time.time()
        if self._cached_telemetry and (now - self._cache_time < max_age):
            return self._cached_telemetry
        try:
            res = requests.get(f"{self.base_url}/api/telemetry", timeout=3)
            res.raise_for_status()
            self._cached_telemetry = res.json()
            self._cache_time = now
            return self._cached_telemetry
        except Exception as e:
            if self._cached_telemetry:
                return self._cached_telemetry
            raise e

    def invalidate_cache(self):
        self._cached_telemetry = None
        self._cache_time = 0.0

    @property
    def files(self) -> Dict[str, Any]:
        telemetry = self.get_telemetry()
        file_list = telemetry.get("files", [])
        return {f["name"]: RemoteInode(f["inode_id"], f["name"], f["size"], f.get("block_ids", []), f.get("merkle_root", "")) for f in file_list}

    @property
    def snapshots(self) -> Dict[str, Any]:
        telemetry = self.get_telemetry()
        return {s["name"]: s for s in telemetry.get("snapshots", [])}

    def list_files(self) -> List[Dict[str, Any]]:
        self.invalidate_cache()
        telemetry = self.get_telemetry()
        return telemetry.get("files", [])

    def read_file(self, filename: str) -> bytes:
        res = requests.get(f"{self.base_url}/api/files/read/{filename}", timeout=5)
        if res.status_code == 404:
            raise FileNotFoundError(f"File '{filename}' not found in AeroFS.")
        if res.status_code == 500:
            raise IOError(f"AeroFS remote read error (EIO): {res.text}")
        res.raise_for_status()
        content_type = res.headers.get("content-type", "")
        if "application/json" in content_type:
            data = res.json()
            return data.get("content", "").encode("utf-8")
        return res.content

    def write_file(self, filename: str, data: bytes) -> Tuple[RemoteInode, int]:
        self.invalidate_cache()
        try:
            text = data.decode("utf-8")
            res = requests.post(
                f"{self.base_url}/api/files/create_text",
                json={"filename": filename, "content": text},
                timeout=10
            )
        except UnicodeDecodeError:
            res = requests.post(
                f"{self.base_url}/api/files/upload",
                files={"file": (filename, data)},
                timeout=10
            )
        if res.status_code == 400:
            raise ValueError(res.json().get("detail", "Error writing file"))
        res.raise_for_status()
        ret = res.json()
        block_ids = ret.get("block_ids", list(range(ret.get("blocks_used", 0))))
        inode = RemoteInode(
            inode_id=ret.get("inode_id", 1),
            name=filename,
            size=ret.get("size", len(data)),
            block_ids=block_ids,
            merkle_root=ret.get("merkle_root", "")
        )
        return inode, ret.get("deduplicated_chunks", 0)

    def delete_file(self, filename: str) -> bool:
        self.invalidate_cache()
        res = requests.delete(f"{self.base_url}/api/files/{filename}", timeout=5)
        return res.status_code == 200

    def create_snapshot(self, snapshot_name: str) -> Dict[str, Any]:
        self.invalidate_cache()
        res = requests.post(
            f"{self.base_url}/api/snapshots/create",
            json={"name": snapshot_name},
            timeout=5
        )
        if res.status_code == 400:
            raise ValueError(res.json().get("detail", f"Snapshot '{snapshot_name}' already exists."))
        res.raise_for_status()
        return res.json().get("snapshot", {})

    def list_snapshots(self) -> List[Dict[str, Any]]:
        self.invalidate_cache()
        telemetry = self.get_telemetry()
        return telemetry.get("snapshots", [])

    def restore_snapshot(self, snapshot_name: str) -> bool:
        self.invalidate_cache()
        res = requests.post(
            f"{self.base_url}/api/snapshots/restore",
            json={"name": snapshot_name},
            timeout=5
        )
        if res.status_code == 404:
            raise KeyError(res.json().get("detail", f"Snapshot '{snapshot_name}' does not exist."))
        res.raise_for_status()
        return True

    def delete_snapshot(self, snapshot_name: str) -> bool:
        self.invalidate_cache()
        res = requests.delete(f"{self.base_url}/api/snapshots/{snapshot_name}", timeout=5)
        return res.status_code == 200

    def inspect_file(self, filename: str) -> Dict[str, Any]:
        res = requests.get(f"{self.base_url}/api/files/inspect/{filename}", timeout=5)
        if res.status_code == 404:
            raise FileNotFoundError(f"File '{filename}' not found in AeroFS.")
        res.raise_for_status()
        return res.json()

    def get_block_details(self, block_id: int) -> Dict[str, Any]:
        res = requests.get(f"{self.base_url}/api/blocks/{block_id}", timeout=5)
        if res.status_code == 400:
            raise IndexError(res.json().get("detail", f"Block ID {block_id} out of bounds"))
        res.raise_for_status()
        return res.json()

    def scrub_all(self) -> Dict[str, Any]:
        self.invalidate_cache()
        res = requests.post(f"{self.base_url}/api/merkle/scrub", timeout=10)
        res.raise_for_status()
        return res.json()

    def self_heal_all(self) -> Dict[str, Any]:
        self.invalidate_cache()
        res = requests.post(f"{self.base_url}/api/merkle/heal", timeout=10)
        res.raise_for_status()
        return res.json()
