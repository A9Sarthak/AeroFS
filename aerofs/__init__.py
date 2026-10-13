"""AeroFS package initialization."""
from .disk import VirtualBlockDevice
from .dedup import DeduplicationEngine
from .merkle import MerkleTree, StorageScrubber
from .cow_fs import AeroFileSystem, FileInode, Snapshot
from .client import AeroFSRemoteClient, check_server_available

__all__ = [
    "VirtualBlockDevice",
    "DeduplicationEngine",
    "MerkleTree",
    "StorageScrubber",
    "AeroFileSystem",
    "FileInode",
    "Snapshot",
    "AeroFSRemoteClient",
    "check_server_available"
]
